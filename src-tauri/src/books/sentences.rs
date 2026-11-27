//! The sentences a word is asked with: which one comes next, whether one
//! can be used, and what an answer given to one is worth. A word is given
//! [`GIVEN`] of them, once; a bank kept before that has more, each shown
//! [`SHOWS`] times before another is drawn, never the one of the last time
//! while there is another. Nothing here touches the
//! database, the clock or the model.

use crate::domain::SentencePart;

use super::practice::{accepts, auxiliary, clitic, mark, Auxiliary};
use super::spelling::Spelling;
use super::vocab::{tokens, LEADING};

/// Times a sentence is shown before it is spent.
pub const SHOWS: u32 = 2;
/// Sentences a word is given, the one time it is given any.
pub const GIVEN: usize = 1;
/// Words the model is asked about in one request.
pub const WORDS_PER_CALL: usize = 10;
/// The longest sentence kept, in characters: one to read at a glance.
pub const SENTENCE_CHARS: usize = 240;

/// Uses left in a word's bank at or under which more sentences are written
/// for it, in the background, before they run out: two sentences' worth.
pub const LOW: u32 = 4;

/// One sentence of a word's bank that can still be asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Banked {
    pub id: String,
    /// From the book, not written by the model.
    pub book: bool,
    /// The sentence the chapter being practised has the word in.
    pub own: bool,
    /// Times it was shown: the answers given to it.
    pub shows: u32,
    /// The word was asked with it the last time it was asked, or already in
    /// this sitting.
    pub last: bool,
}

/// The sentence a word is asked with next; none for a word with no bank.
/// Never the one it was asked with the last time, nor one already shown in
/// the same sitting, while there is another, so that no sentence is learned
/// by heart. The first time, the one of the chapter itself, or failing that
/// another of the book. After that one of those shown least, drawn by
/// `draw` among that many: they rotate, never in an order.
pub fn choose(bank: &[Banked], draw: impl Fn(usize) -> Option<usize>) -> Option<&Banked> {
    let fresh: Vec<&Banked> = bank.iter().filter(|sentence| !sentence.last).collect();
    let pool: Vec<&Banked> = if fresh.is_empty() {
        bank.iter().collect()
    } else {
        fresh
    };
    if pool.iter().all(|sentence| sentence.shows == 0) {
        let first = pool
            .iter()
            .find(|sentence| sentence.own)
            .or_else(|| pool.iter().find(|sentence| sentence.book));
        if let Some(first) = first {
            return Some(first);
        }
    }
    let least = pool.iter().map(|sentence| sentence.shows).min()?;
    let candidates: Vec<&Banked> = pool
        .into_iter()
        .filter(|sentence| sentence.shows == least)
        .collect();
    draw(candidates.len()).and_then(|at| candidates.get(at).copied())
}

/// How many more times the sentences of a bank can be shown before every
/// one of them is spent.
pub fn left(bank: &[Banked]) -> u32 {
    bank.iter()
        .map(|sentence| SHOWS.saturating_sub(sentence.shows))
        .sum()
}

/// How often `form` is in `sentence` as written.
fn times(sentence: &str, form: &str) -> usize {
    mark(sentence, &[form.to_owned()])
        .iter()
        .filter(|part| part.marked)
        .count()
}

/// Whether a sentence can ask a word by this `form` of it: short enough to
/// read at a glance, with the form in it exactly once, so that the blank
/// that stands for it is one and its answer is one.
pub fn fits(sentence: &str, form: &str) -> bool {
    sentence.chars().count() <= SENTENCE_CHARS && times(sentence, form) == 1
}

/// Whether `hint` can stand for the word where its sentence is blanked: it
/// says something, and it does not hold the English word it is a hint to.
pub fn hint_fits(hint: &str, form: &str) -> bool {
    let (hint, form) = (tokens(hint), tokens(form));
    !hint.is_empty() && !form.is_empty() && !hint.windows(form.len()).any(|window| window == form)
}

/// Whether `hint` is words of `translation`, as they are written there. A
/// word is asked by what its sentence says in the learner's language, never
/// by a form that sentence does not have: "salvada" is no hint to a word
/// its translation renders "salvarse".
pub fn in_translation(hint: &str, translation: &str) -> bool {
    times(translation, hint) > 0
}

/// The sentences among `sentences` that can ask a word by one of its
/// `forms`, each with the form it has, as it is written there: at most
/// `limit`, in the order of the book, none twice.
pub fn found(sentences: &[String], forms: &[String], limit: usize) -> Vec<(String, String)> {
    let mut kept: Vec<(String, String)> = Vec::new();
    for sentence in sentences {
        if kept.len() >= limit {
            break;
        }
        let marked: Vec<String> = mark(sentence, forms)
            .into_iter()
            .filter(|part| part.marked)
            .map(|part| part.text)
            .collect();
        let [form] = marked.as_slice() else {
            continue;
        };
        if fits(sentence, form) && !kept.iter().any(|(held, _)| held == sentence) {
            kept.push((sentence.clone(), form.clone()));
        }
    }
    kept
}

/// The word's other translations in the form its `hint` has, as they are
/// kept of what the second look `listed`: each once, [`unaided`] by the
/// learner's `lang`, and none that says nothing, is the hint itself or
/// holds the English `form`. Nor one of the word's `base` translations,
/// unless the hint is one: the sentence then has the word in its base form,
/// and so may its translations be.
pub fn other_hints(
    listed: &[String],
    (hint, form, lang): (&str, &str, &str),
    base: &[String],
) -> Vec<String> {
    let is_base = |text: &str| base.iter().any(|each| tokens(each) == tokens(text));
    let base_form = is_base(hint);
    let mut kept: Vec<String> = Vec::new();
    for each in listed.iter().map(|each| unaided(each, form, lang)) {
        let said = tokens(&each);
        let held = |other: &str| tokens(other) == said;
        if hint_fits(&each, form)
            && !held(hint)
            && !kept.iter().any(|other| held(other))
            && (base_form || !is_base(&each))
        {
            kept.push(each);
        }
    }
    kept
}

/// The English words that make a compound tense with the verb after them:
/// a form without one shows no such tense. "'d" and "'ve" are written onto
/// the word before them.
const HAVE: [&str; 4] = ["have", "has", "had", "having"];
const BE: [&str; 8] = ["be", "am", "is", "are", "was", "were", "been", "being"];

/// Whether the English `form` holds one of these `words`, standing apart
/// or written onto another word after an apostrophe (`joined`).
fn holds(form: &[String], words: &[&str], joined: &[&str]) -> bool {
    form.iter().any(|token| {
        words.contains(&token.as_str())
            || joined.iter().any(|end| token.ends_with(&format!("'{end}")))
    })
}

/// `hint` without the words of the learner's `lang` that stand for English
/// ones outside the `form`: the auxiliary of a compound tense, and the
/// pronouns written apart before it. The learner is shown the form alone:
/// "made a point of", taken from "I'd made a point of", is "empeñado en",
/// never "me había empeñado en", which is "had made a point of". A tense
/// its translation writes in one word ("se empeñó") is not split, and a
/// hint that would be left with nothing stays as it is. What is left is
/// the end of the hint, so it is still words of its translation.
pub fn unaided(hint: &str, form: &str, lang: &str) -> String {
    let english = tokens(form);
    let be = holds(&english, &BE, &["s", "re", "m"]);
    // A progressive is left out only for an English form that is itself
    // the -ing form: "estaba colgando" may well say "hung".
    let ing = english.iter().any(|token| token.ends_with("ing"));
    let shows = |auxiliary: Auxiliary| match auxiliary {
        Auxiliary::Perfect => holds(&english, &HAVE, &["d", "ve"]),
        Auxiliary::Passive => be,
        Auxiliary::Progressive => be || !ing,
    };
    let words: Vec<&str> = hint.split_whitespace().collect();
    let mut from = 0_usize;
    loop {
        let at = from
            + words[from..]
                .iter()
                .take_while(|word| clitic(word, lang))
                .count();
        let (Some(word), Some(next)) = (words.get(at), words.get(at + 1)) else {
            break;
        };
        match auxiliary(word, next, lang) {
            Some(each) if !shows(each) => from = at + 1,
            _ => break,
        }
    }
    words[from..].join(" ")
}

/// The English words that make a sentence negative, and the endings that
/// do it written onto a word ("wouldn't", "cannot").
const NEGATORS: [&str; 14] = [
    "not", "no", "never", "nothing", "nobody", "none", "nowhere", "neither", "nor", "without",
    "hardly", "barely", "scarcely", "cannot",
];

/// Whether these English `tokens` make a sentence negative.
fn negative(tokens: &[String]) -> bool {
    tokens
        .iter()
        .any(|token| NEGATORS.contains(&token.as_str()) || token.ends_with("n't"))
}

/// The words of the learner's language that say "not" before a verb, and
/// go with the negation outside a form when they begin its hint.
const DENIALS: [(&str, &[&str]); 1] = [("es", &["no", "nunca", "jamas", "tampoco", "ni"])];

/// The words of the learner's language that a negation calls for ("ninguna"
/// for "a" in "wouldn't stand a chance"), each with the word it is without
/// one: what the English says, "a chance" is "una oportunidad". Said with
/// no denial before them, they are right only after a "no" that is not
/// there.
const CONCORDS: [(&str, &[(&str, &str)]); 1] = [(
    "es",
    &[
        ("ningun", "un"),
        ("ninguno", "uno"),
        ("ninguna", "una"),
        ("ningunos", "unos"),
        ("ningunas", "unas"),
        ("nadie", "alguien"),
        ("nada", "algo"),
    ],
)];

/// What an earlier reading put for a word a negation calls for ("tener
/// alguna oportunidad" for "tener ninguna oportunidad"), with what it is
/// now: "alguna" is itself a word a question or a doubt calls for, and
/// "stand a chance" says "una". Read only where a negation outside the
/// form made it, and never in "alguna vez", which is "ever".
const FORMER: [(&str, &[(&str, &str)]); 1] = [(
    "es",
    &[
        ("algun", "un"),
        ("alguno", "uno"),
        ("alguna", "una"),
        ("algunos", "unos"),
        ("algunas", "unas"),
    ],
)];

/// The articles of the learner's language: a word after one is a noun,
/// never a word a negation calls for ("de la nada").
const ARTICLES: [(&str, &[&str]); 1] = [(
    "es",
    &["el", "la", "lo", "los", "las", "un", "una", "unos", "unas"],
)];

/// The entry of a language's table, by its primary tag.
fn of_lang<T: Copy>(table: &[(&str, T)], lang: &str) -> Option<T> {
    let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
    table
        .iter()
        .find(|(tag, _)| *tag == primary)
        .map(|(_, each)| *each)
}

/// A word as the tables read it: lowercase, without accents or punctuation.
fn said(word: &str) -> String {
    tokens(word).concat()
}

/// Whether `word` says "not" in the learner's language.
fn denial(word: &str, lang: &str) -> bool {
    of_lang(&DENIALS, lang).is_some_and(|table| table.contains(&said(word).as_str()))
}

/// The word the `at`th of `words` is without a negation, when a negation
/// is what calls for it. Not after an article, where it is a noun, and not
/// a "nada" that heads them, which is "swims".
fn concord(words: &[&str], at: usize, lang: &str) -> Option<&'static str> {
    let word = said(words.get(at)?);
    let after_article = at
        .checked_sub(1)
        .and_then(|before| words.get(before))
        .is_some_and(|before| {
            of_lang(&ARTICLES, lang).is_some_and(|table| table.contains(&said(before).as_str()))
        });
    if after_article || (at == 0 && word == "nada") {
        return None;
    }
    let ever = words.get(at + 1).is_some_and(|next| said(next) == "vez");
    let former = of_lang(&FORMER, lang)
        .unwrap_or_default()
        .iter()
        .filter(|_| !ever);
    of_lang(&CONCORDS, lang)?
        .iter()
        .chain(former)
        .find(|(negated, _)| *negated == word)
        .map(|(_, plain)| *plain)
}

/// Whether `text` has a word a negation calls for and no denial before it
/// to call for it: "tener ninguna oportunidad".
fn denied_by_nothing(text: &str, lang: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();
    let called = (0..words.len()).position(|at| concord(&words, at, lang).is_some());
    called.is_some_and(|at| !words[..at].iter().any(|word| denial(word, lang)))
}

/// Whether the English `form` is free of the negation its `sentence` has:
/// what that negation gives a translation of the form is not the form's.
fn negated_outside(form: &str, sentence: &str) -> bool {
    !negative(&tokens(form)) && negative(&tokens(sentence))
}

/// `words` with each a negation calls for said as it is without one.
fn plain_words(words: &[&str], lang: &str, keep: impl Fn(&str) -> bool) -> Vec<String> {
    words
        .iter()
        .enumerate()
        .map(|(at, word)| match concord(words, at, lang) {
            Some(plain) if !keep(word) => plain.to_owned(),
            _ => (*word).to_owned(),
        })
        .collect()
}

/// `hint` without what a negation outside the English `form` gives it in
/// the learner's `lang`: the "no" before it and the words that negation
/// calls for. The learner is shown the form alone: "stand a chance", taken
/// from "wouldn't stand a chance", is "tendría alguna oportunidad", never
/// "tendría ninguna oportunidad", which only a "no" before it makes right.
/// Only when the `sentence` has a negation the form does not show, and
/// never for a word the word's `base` translations say as their own ("no
/// ver" for "overlook"); a base translation with the same fault
/// ([`denied_by_nothing`]) says nothing of it. A hint that would be left
/// with nothing stays as it is.
///
/// What is left need not be words of its translation, so it is made of a
/// hint already looked at; [`shown_in`] still finds it there.
pub fn affirmed(hint: &str, (form, sentence): (&str, &str), base: &[String], lang: &str) -> String {
    if !negated_outside(form, sentence) {
        return hint.to_owned();
    }
    let owned: Vec<Vec<String>> = base
        .iter()
        .filter(|each| !denied_by_nothing(each, lang))
        .map(|each| tokens(each))
        .collect();
    let own = |word: &str| {
        let word = said(word);
        owned.iter().any(|each| each.contains(&word))
    };
    let words: Vec<&str> = hint.split_whitespace().collect();
    let denied = words
        .iter()
        .take_while(|word| denial(word, lang) && !own(word))
        .count();
    if denied == words.len() {
        return hint.to_owned();
    }
    plain_words(&words, lang, own)[denied..].join(" ")
}

/// A base translation of a word without the words a negation outside its
/// English `form` calls for, when nothing in it denies: "tener alguna
/// oportunidad" for "tener ninguna oportunidad", the translation of
/// "stand a chance" taken from "wouldn't stand a chance". A translation
/// that denies itself is the word's own meaning ("no ver" for "overlook")
/// and stays as it is.
pub fn affirmed_base(text: &str, (form, sentence): (&str, &str), lang: &str) -> String {
    if !negated_outside(form, sentence) || !denied_by_nothing(text, lang) {
        return text.to_owned();
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    plain_words(&words, lang, |_| false).join(" ")
}

/// Whether `hint` is words of `translation`, as it is written there or as
/// it reads without its negation ([`affirmed`]): a hint is never glossed
/// again for having lost a "no" its English form does not show.
pub fn shown_in(hint: &str, translation: &str, lang: &str) -> bool {
    if in_translation(hint, translation) {
        return true;
    }
    let words: Vec<&str> = translation
        .split_whitespace()
        .filter(|word| !denial(word, lang))
        .collect();
    in_translation(hint, &plain_words(&words, lang, |_| false).join(" "))
}

/// Whether a sentence has the word in another form than its base form:
/// "receded" for "recede".
pub fn inflected(form: &str, lemma: &str) -> bool {
    tokens(form) != tokens(lemma)
}

/// What an answer given to a word in a sentence is worth.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Right,
    /// The word, in a form that does not fill the blank, or its base
    /// translation where the sentence has the word in another form: no
    /// answer yet.
    WrongForm,
    /// Another English word for what was shown, not the one asked for: no
    /// answer yet. What was shown did not say which of them was meant.
    OtherWord,
    /// A word of the learner's language from the root of the one asked
    /// for, of another kind ("patada" for "kicked"): no answer yet, and the
    /// learner is reminded of the kind asked for.
    OtherKind,
    Miss,
}

/// The reflexive pronouns a verb is written with: which one is up to the
/// subject of its sentence.
const REFLEXIVE: [&str; 9] = [
    "myself",
    "yourself",
    "himself",
    "herself",
    "itself",
    "oneself",
    "ourselves",
    "yourselves",
    "themselves",
];

/// `text` without its reflexive pronouns: "distancing herself" is
/// "distancing". One that is all there is stays.
pub fn bare(text: &str) -> String {
    let kept: Vec<&str> = text
        .split_whitespace()
        .filter(|word| {
            let word = word
                .trim_matches(|each: char| !each.is_alphanumeric())
                .to_lowercase();
            !REFLEXIVE.contains(&word.as_str())
        })
        .collect();
    if kept.is_empty() {
        text.to_owned()
    } else {
        kept.join(" ")
    }
}

/// `verdict`, unless it is a miss with one of the `rivals`: the other
/// English words for what the learner was shown. That is no miss: the
/// answer is right for what they saw, and it is not the word they are
/// learning.
pub fn or_other(verdict: Verdict, answer: &str, rivals: &[String], spelling: Spelling) -> Verdict {
    let rivals: Vec<String> = rivals.iter().map(|each| bare(each)).collect();
    if verdict == Verdict::Miss && accepts(&bare(answer), &rivals, &LEADING, spelling) {
        Verdict::OtherWord
    } else {
        verdict
    }
}

/// The longest short sentence a word is asked with when its tag cannot
/// tell it from a word written alike, in words.
pub const FRAGMENT_WORDS: usize = 8;

/// The words the second look said fix the sense of the word in a sentence,
/// kept only where the sentence has them as words of its own, outside the
/// word itself, three at most and each once.
pub fn cue_in(cue: &[String], (sentence, form): (&str, &str)) -> Vec<String> {
    let words = tokens(sentence);
    let own = tokens(form);
    let mut kept: Vec<String> = Vec::new();
    for each in cue {
        let said = tokens(each);
        let fits = !said.is_empty()
            && said.iter().all(|word| !own.contains(word))
            && words.windows(said.len()).any(|run| run == said.as_slice());
        let text = said.join(" ");
        if fits && !kept.contains(&text) && kept.len() < 3 {
            kept.push(text);
        }
    }
    kept
}

/// Words taken on each side of the word when no words that fix its sense
/// are known, or they are too far: "her **fair** hair and".
pub const AROUND: usize = 2;

/// Where `run`, in words, is among the written words `words` (each as its
/// words, joined by a space: "well-known" is "well known"), the first time:
/// the first written word and how many it takes.
fn at(words: &[String], run: &[String]) -> Option<(usize, usize)> {
    if run.is_empty() {
        return None;
    }
    let wanted = run.join(" ");
    (0..words.len()).find_map(|start| {
        (1..=run.len().min(words.len() - start))
            .find(|len| words[start..start + len].join(" ") == wanted)
            .map(|len| (start, len))
    })
}

/// The short sentence a word is asked with when its tag cannot tell it from
/// a word written alike, the word marked: the words of `sentence` from the
/// first of the word and the words that fix its sense (`cue`) to the last,
/// as written ("her fair hair"); when those are not known, or too far apart
/// for a glance, the word and [`AROUND`] words on each side. None only when
/// the sentence does not have the word as written.
pub fn fragment(sentence: &str, form: &str, cue: &[String]) -> Option<Vec<SentencePart>> {
    let written: Vec<&str> = sentence.split_whitespace().collect();
    let words: Vec<String> = written.iter().map(|each| tokens(each).join(" ")).collect();
    let (start, len) = at(&words, &tokens(form))?;
    let end = start + len - 1;
    let (mut first, mut last) = (start, end);
    let mut any = false;
    for each in cue {
        if let Some((place, size)) = at(&words, &tokens(each)) {
            first = first.min(place);
            last = last.max(place + size - 1);
            any = true;
        }
    }
    if !any || last - first + 1 > FRAGMENT_WORDS {
        first = start.saturating_sub(AROUND);
        last = (end + AROUND).min(written.len() - 1);
    }
    let text = written[first..=last].join(" ");
    let text = text.trim_matches(|c: char| !c.is_alphanumeric());
    Some(mark(text, &[form.to_owned()]))
}

/// Whether the words the second look said fix the sense of the word
/// (`cue`) are in `sentence` near enough to it for a short sentence
/// ([`FRAGMENT_WORDS`]): then the few words it is asked with lead to its
/// meaning as surely as the whole sentence does.
pub fn fixes(sentence: &str, form: &str, cue: &[String]) -> bool {
    let written: Vec<&str> = sentence.split_whitespace().collect();
    let words: Vec<String> = written.iter().map(|each| tokens(each).join(" ")).collect();
    let Some((start, len)) = at(&words, &tokens(form)) else {
        return false;
    };
    let (mut first, mut last) = (start, start + len - 1);
    let mut any = false;
    for each in cue {
        if let Some((place, size)) = at(&words, &tokens(each)) {
            first = first.min(place);
            last = last.max(place + size - 1);
            any = true;
        }
    }
    any && last - first < FRAGMENT_WORDS
}

/// [`fragment`] for a word that can be written in any of `forms`: the first
/// one the sentence has.
pub fn few_words(sentence: &str, forms: &[String], cue: &[String]) -> Option<Vec<SentencePart>> {
    forms.iter().find_map(|form| fragment(sentence, form, cue))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(parts: &[crate::domain::SentencePart]) -> (String, Vec<String>) {
        let text = parts.iter().map(|part| part.text.as_str()).collect();
        let marked = parts
            .iter()
            .filter(|part| part.marked)
            .map(|part| part.text.clone())
            .collect();
        (text, marked)
    }

    #[test]
    fn a_fragment_runs_from_the_word_to_the_words_that_fix_its_sense() {
        let cue = vec!["hair".to_owned()];
        let parts =
            fragment("She tied back her fair hair and left.", "fair", &cue).expect("a fragment");
        assert_eq!(
            shown(&parts),
            ("fair hair".to_owned(), vec!["fair".to_owned()])
        );
        let cue = vec!["her".to_owned(), "hair".to_owned()];
        let parts =
            fragment("She tied back her fair hair, and left.", "fair", &cue).expect("a fragment");
        assert_eq!(shown(&parts).0, "her fair hair");
    }

    #[test]
    fn only_words_that_fix_the_sense_near_the_word_make_a_short_sentence_of_it() {
        let hair = vec!["hair".to_owned()];
        assert!(fixes(
            "She tied back her fair hair and left.",
            "fair",
            &hair
        ));
        assert!(!fixes("She tied back her fair hair and left.", "fair", &[]));
        let end = vec!["end".to_owned()];
        let long = "A fair one came along the road by the river to the very end.";
        assert!(!fixes(long, "fair", &end));
    }

    #[test]
    fn without_words_that_fix_the_sense_the_words_around_it_stand_in() {
        let parts =
            fragment("She tied back her fair hair and left.", "fair", &[]).expect("a fragment");
        assert_eq!(shown(&parts).0, "back her fair hair and");
        let far = vec!["end".to_owned()];
        let long = "A fair one came along the road by the river to the very end.";
        assert_eq!(
            shown(&fragment(long, "fair", &far).expect("a fragment")).0,
            "A fair one came"
        );
        // Written with a hyphen, a word is still found in its place.
        let parts = fragment("Her fair well-known face.", "fair", &["face".to_owned()])
            .expect("a fragment");
        assert_eq!(shown(&parts).0, "fair well-known face");
        assert!(fragment("Nothing of it here.", "fair", &[]).is_none());
    }

    #[test]
    fn only_words_the_sentence_has_outside_the_word_fix_its_sense() {
        let said = vec![
            "hair".to_owned(),
            "Hair".to_owned(),
            "fair".to_owned(),
            "blond".to_owned(),
            " ".to_owned(),
        ];
        assert_eq!(cue_in(&said, ("Her fair hair shone.", "fair")), ["hair"]);
    }

    fn banked(id: &str, book: bool, own: bool, shows: u32) -> Banked {
        Banked {
            last: false,
            id: id.into(),
            book,
            own,
            shows,
        }
    }

    #[test]
    fn never_the_sentence_of_the_last_time_while_there_is_another() {
        let mut bank = vec![
            banked("a", true, true, 1),
            banked("b", false, false, 2),
            banked("c", false, false, 2),
        ];
        bank[0].last = true;
        // "a" is the only one not spent, but it was the last one: the least
        // shown of the others comes.
        assert_eq!(chosen(&bank, 0), Some("b"));
        // Alone in its bank, it comes all the same.
        assert_eq!(chosen(&bank[..1], 0), Some("a"));
        assert_eq!(left(&bank), 1);
    }

    fn chosen(bank: &[Banked], at: usize) -> Option<&str> {
        choose(bank, |len| (at < len).then_some(at)).map(|sentence| sentence.id.as_str())
    }

    fn list(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| (*word).to_owned()).collect()
    }

    #[test]
    fn the_first_time_a_word_comes_with_the_sentence_of_its_chapter() {
        let bank = [
            banked("claude", false, false, 0),
            banked("other chapter", true, false, 0),
            banked("this chapter", true, true, 0),
        ];
        assert_eq!(chosen(&bank, 0), Some("this chapter"));
        // No sentence of its own: another of the book.
        assert_eq!(chosen(&bank[..2], 0), Some("other chapter"));
        // None of the book: any, as drawn.
        assert_eq!(chosen(&bank[..1], 0), Some("claude"));
        assert_eq!(chosen(&[], 0), None);
    }

    #[test]
    fn after_the_first_time_one_shown_least_is_drawn_at_random() {
        let bank = [
            banked("a", true, true, 1),
            banked("b", false, false, 2),
            banked("c", false, false, 0),
            banked("d", false, false, 0),
        ];
        // Only the least shown are drawn from, never in an order.
        assert_eq!(chosen(&bank, 0), Some("c"));
        assert_eq!(chosen(&bank, 1), Some("d"));
        assert_eq!(chosen(&bank, 2), None);
    }

    #[test]
    fn with_every_sentence_spent_the_one_shown_least_comes_back() {
        let bank = [banked("a", true, true, 3), banked("b", false, false, 2)];
        assert_eq!(chosen(&bank, 0), Some("b"));
    }

    #[test]
    fn a_sentence_fits_with_the_form_in_it_exactly_once() {
        assert!(fits("She stirred the soup.", "stirred"));
        assert!(fits("They never give up.", "give up"));
        assert!(!fits("She stirred, and he stirred.", "stirred"));
        assert!(!fits("She mixed the soup.", "stirred"));
        // Part of another word is not the form.
        assert!(!fits("It was stirring.", "stir"));
        let long = format!("She stirred {}.", "the soup ".repeat(40));
        assert!(!fits(&long, "stirred"));
    }

    #[test]
    fn a_hint_says_something_and_does_not_give_the_word_away() {
        assert!(hint_fits("removió", "stirred"));
        assert!(!hint_fits("  ", "stirred"));
        assert!(!hint_fits("removió (stirred)", "stirred"));
        assert!(!hint_fits("removió", ""));
    }

    #[test]
    fn a_hint_is_words_of_the_translation_of_its_sentence() {
        let natural = "Era demasiado ancha para poder salvarse jamás.";
        assert!(in_translation("removió", "Removió la sopa."));
        assert!(in_translation("removio", "Removió la sopa."));
        assert!(in_translation("se retiró", "El mar se retiró despacio."));
        assert!(in_translation("salvarse", natural));
        // A form the translation does not have, or words it has apart.
        assert!(!in_translation("salvada", natural));
        assert!(!in_translation("se retiró", "Se le retiró el mar."));
        assert!(!in_translation("sopa", "Removió las sopas."));
        assert!(!in_translation("", "Removió la sopa."));
    }

    #[test]
    fn the_sentences_of_the_book_are_those_with_the_word_once() {
        let sentences = list(&[
            "Nothing moved.",
            "She Stirred the soup.",
            "He stirs, then stirs again.",
            "She Stirred the soup.",
            "Do not stir it.",
            "Stir once more.",
        ]);
        let forms = list(&["stir", "stirred", "stirs"]);
        assert_eq!(
            found(&sentences, &forms, 2),
            [
                ("She Stirred the soup.".to_owned(), "Stirred".to_owned()),
                ("Do not stir it.".to_owned(), "stir".to_owned())
            ]
        );
    }

    #[test]
    fn a_hint_says_no_negation_its_english_form_does_not_show() {
        let donut = "And poor, stupid Donut wouldn’t stand a chance out here in the cold.";
        let base = list(&["tener posibilidades", "tener una oportunidad"]);
        let affirmed = |hint: &str, form: &str, sentence: &str, base: &[String]| {
            affirmed(hint, (form, sentence), base, "es")
        };
        // "wouldn't" is outside the form, and so is the "ninguna" it calls for.
        assert_eq!(
            affirmed(
                "tendría ninguna oportunidad",
                "stand a chance",
                donut,
                &base
            ),
            "tendría una oportunidad"
        );
        assert_eq!(
            affirmed(
                "no tendría ninguna oportunidad",
                "stand a chance",
                donut,
                &base
            ),
            "tendría una oportunidad"
        );
        let drones = "Looking up at the sky, he didn’t spot any camera drones.";
        assert_eq!(
            affirmed("ningún dron", "camera drones", drones, &[]),
            "un dron"
        );
        assert_eq!(
            affirmed("nunca visto", "seen", "He had never seen it.", &[]),
            "visto"
        );
        assert_eq!(
            affirmed("a nadie", "anyone", "She didn't tell anyone.", &[]),
            "a alguien"
        );
    }

    #[test]
    fn a_hint_keeps_a_negation_that_is_its_words_own() {
        let donut = "And poor, stupid Donut wouldn’t stand a chance out here in the cold.";
        let base = list(&["tener posibilidades", "tener una oportunidad"]);
        let affirmed = |hint: &str, form: &str, sentence: &str, base: &[String]| {
            affirmed(hint, (form, sentence), base, "es")
        };
        // A hint already affirmed stays as it is.
        assert_eq!(
            affirmed("tendría posibilidades", "stand a chance", donut, &base),
            "tendría posibilidades"
        );
        // The form holds the negation: so may its hint.
        assert_eq!(
            affirmed(
                "no tendría ninguna oportunidad",
                "wouldn’t stand a chance",
                donut,
                &base
            ),
            "no tendría ninguna oportunidad"
        );
        // No negation in the sentence: the word says it.
        assert_eq!(
            affirmed(
                "ninguna oportunidad",
                "no chance",
                "There was no chance.",
                &[]
            ),
            "ninguna oportunidad"
        );
        // The word means it in every translation: "de la nada", "no ver".
        let air = "It didn't come out of thin air.";
        assert_eq!(
            affirmed("de la nada", "out of thin air", air, &list(&["de la nada"])),
            "de la nada"
        );
        let overlook = "He didn't overlook it.";
        assert_eq!(
            affirmed(
                "no ver",
                "overlook",
                overlook,
                &list(&["no ver", "pasar por alto"])
            ),
            "no ver"
        );
        // "nada" may be "swims": it is left alone.
        assert_eq!(affirmed("nada", "swim", "She doesn't swim.", &[]), "nada");
        // A base translation with the same fault says nothing of it.
        let faulty = list(&["tener posibilidades", "tener ninguna oportunidad"]);
        assert_eq!(
            affirmed(
                "tendría ninguna oportunidad",
                "stand a chance",
                donut,
                &faulty
            ),
            "tendría una oportunidad"
        );
        // "anything" is "nada" only after a "no".
        assert_eq!(
            affirmed(
                "sabía nada",
                "knew anything",
                "He didn't know anything.",
                &[]
            ),
            "sabía algo"
        );
        // After an article it is a noun.
        assert_eq!(
            affirmed("de la nada", "out of thin air", air, &[]),
            "de la nada"
        );
        // Nothing would be left: the hint as it was.
        assert_eq!(affirmed("nunca", "ever", "I never ever go.", &[]), "nunca");
        // A language without a table keeps its hint.
        assert_eq!(
            super::affirmed("aucune chance", ("stand a chance", donut), &[], "fr"),
            "aucune chance"
        );
    }

    #[test]
    fn a_base_translation_loses_what_only_a_negation_outside_its_word_calls_for() {
        let donut = "And poor, stupid Donut wouldn’t stand a chance out here in the cold.";
        let base =
            |text: &str, form: &str, sentence: &str| affirmed_base(text, (form, sentence), "es");
        assert_eq!(
            base("tener ninguna oportunidad", "stand a chance", donut),
            "tener una oportunidad"
        );
        assert_eq!(
            base("tendría ninguna oportunidad", "stand a chance", donut),
            "tendría una oportunidad"
        );
        // A translation that denies is the word's own meaning.
        assert_eq!(
            base("no tener ninguna oportunidad", "stand a chance", donut),
            "no tener ninguna oportunidad"
        );
        assert_eq!(
            base("no ver", "overlook", "He didn't overlook it."),
            "no ver"
        );
        assert_eq!(
            base(
                "de la nada",
                "out of thin air",
                "It didn't come out of thin air."
            ),
            "de la nada"
        );
        // No negation outside the word: it says it.
        assert_eq!(
            base("ninguna oportunidad", "no chance", "There was no chance."),
            "ninguna oportunidad"
        );
        assert_eq!(
            base("tener posibilidades", "stand a chance", donut),
            "tener posibilidades"
        );
    }

    #[test]
    fn a_hint_affirmed_is_still_read_in_its_translation() {
        let translation = "Y la pobre y tonta Donut no tendría ninguna oportunidad aquí fuera.";
        assert!(shown_in("tendría una oportunidad", translation, "es"));
        assert!(shown_in(
            "no tendría ninguna oportunidad",
            translation,
            "es"
        ));
        assert!(!shown_in("tendría alguna suerte", translation, "es"));
    }

    #[test]
    fn a_hint_says_no_tense_its_english_form_does_not_show() {
        let unaided = |hint: &str, form: &str| unaided(hint, form, "es");
        // "I'd made a point of": "'d" is outside the form, and so is "había".
        assert_eq!(
            unaided("me había empeñado en", "made a point of"),
            "empeñado en"
        );
        assert_eq!(
            unaided("se había hecho añicos", "shattered"),
            "hecho añicos"
        );
        assert_eq!(unaided("Habría fallecido", "passed away"), "fallecido");
        assert_eq!(
            unaided("me he distanciado", "distanced myself"),
            "distanciado"
        );
        // "was running", "was adorned": the same for "to be".
        assert_eq!(unaided("estaba corriendo", "running"), "corriendo");
        assert_eq!(unaided("fue adornado", "adorned"), "adornado");
        // The form has its auxiliary: the hint keeps its own.
        assert_eq!(unaided("ha suspirado", "has sighed"), "ha suspirado");
        assert_eq!(
            unaided("me había empeñado en", "I'd made a point of"),
            "me había empeñado en"
        );
        assert_eq!(
            unaided("estaba corriendo", "was running"),
            "estaba corriendo"
        );
        // A "había" that makes no tense is the word: "there was".
        assert_eq!(unaided("había gente", "crowd"), "había gente");
        // A tense written in one word cannot be split.
        assert_eq!(unaided("se empeñó en", "made a point of"), "se empeñó en");
        // Nothing would be left: the hint as it was.
        assert_eq!(unaided("había", "had"), "había");
        // A language without a table keeps its hint.
        assert_eq!(super::unaided("avait fait", "made", "fr"), "avait fait");
    }

    #[test]
    fn the_hints_listed_say_no_tense_their_english_form_does_not_show() {
        let base = list(&["empeñarse en", "asegurarse de"]);
        let listed = list(&["me había asegurado de", "me había empeñado en"]);
        assert_eq!(
            other_hints(&listed, ("empeñado en", "made a point of", "es"), &base),
            ["asegurado de"]
        );
    }

    #[test]
    fn the_other_hints_kept_are_those_that_say_something_new_and_not_the_word() {
        let listed = list(&[
            " se retiró ",
            "Retrocedió",
            "",
            "se alejó",
            "Se retiró",
            "receded",
        ]);
        let base = list(&["retroceder", "retirarse", "alejarse"]);
        let kept =
            |listed: &[String], hint: &str| other_hints(listed, (hint, "receded", "es"), &base);
        assert_eq!(kept(&listed, "retrocedió"), ["se retiró", "se alejó"]);
        // A base form is no form of the sentence, unless the hint is one.
        let mixed = list(&["Retirarse", "se alejó"]);
        assert_eq!(kept(&mixed, "retrocedió"), ["se alejó"]);
        assert_eq!(kept(&mixed, "retroceder"), ["Retirarse", "se alejó"]);
        assert_eq!(kept(&[], "retrocedió"), Vec::<String>::new());
    }

    #[test]
    fn a_sentence_has_the_word_inflected_when_its_form_is_not_the_base_form() {
        assert!(inflected("receded", "recede"));
        assert!(inflected("gave up", "give up"));
        assert!(!inflected("Recede", "recede"));
        assert!(!inflected("give up", "give up"));
    }
}
