//! The sentences a word is asked with: which one comes next, whether one
//! can be used, and what an answer given to one is worth. A word is given
//! [`GIVEN`] of them, once; a bank kept before that has more, each shown
//! [`SHOWS`] times before another is drawn. Nothing here touches the
//! database, the clock or the model.

use super::practice::{
    accepts, accepts_native, articles, auxiliary, clitic, is_base, mark, shape, Auxiliary,
};
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
}

/// The sentence a word is asked with next; none for a word with no bank.
/// The first time, the one of the chapter itself, or failing that another
/// of the book. After that one of those not yet spent, drawn by `draw`
/// among that many; and when all are spent, the one shown least.
pub fn choose(bank: &[Banked], draw: impl Fn(usize) -> Option<usize>) -> Option<&Banked> {
    if bank.iter().all(|sentence| sentence.shows == 0) {
        let first = bank
            .iter()
            .find(|sentence| sentence.own)
            .or_else(|| bank.iter().find(|sentence| sentence.book));
        if first.is_some() {
            return first;
        }
    }
    let unspent: Vec<&Banked> = bank
        .iter()
        .filter(|sentence| sentence.shows < SHOWS)
        .collect();
    if unspent.is_empty() {
        return bank.iter().min_by_key(|sentence| sentence.shows);
    }
    draw(unspent.len()).and_then(|at| unspent.get(at).copied())
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

/// What English → native asks of a word in a sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskedAlone {
    /// What an answer is judged against, the form asked for first.
    pub judged: Vec<String>,
    /// What is shown as accepted.
    pub accepted: Vec<String>,
    /// The form the sentence gives the word, when it is none of those.
    pub note: Option<String>,
}

/// What English → native asks of a word whose sentence `said` it in these
/// translations, the hint first. A verb taken `alone` is asked for in that
/// form: "freezes" is "se congela", whatever its sentence makes of it. The
/// form the sentence gives it ("se congele" in "before she freezes") is
/// right too, and pointed out when it is not one of them. Without that,
/// what the sentence says is asked for, as it is. Unless `lead`, the
/// sentence's form stays first in what is judged: a verb called by its base
/// form is taken alone as an infinitive, which asks for no form of its own.
pub fn asked_alone(alone: Option<&[String]>, said: &[String], lead: bool) -> AskedAlone {
    let Some(alone) = alone else {
        return AskedAlone {
            judged: said.to_vec(),
            accepted: said.to_vec(),
            note: None,
        };
    };
    let held = |list: &[String], text: &str| list.iter().any(|each| tokens(each) == tokens(text));
    let (first, then) = if lead { (alone, said) } else { (said, alone) };
    let mut judged = first.to_vec();
    for each in then {
        if !held(&judged, each) {
            judged.push(each.clone());
        }
    }
    AskedAlone {
        judged,
        accepted: alone.to_vec(),
        note: said.first().filter(|hint| !held(alone, hint)).cloned(),
    }
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
    /// Right, with the word's base translation where the sentence has it in
    /// another form: it counts, and the form it has there is pointed out.
    RightBase,
    /// The word, in a form that does not fill the blank, or its base
    /// translation where the sentence has the word in another form: no
    /// answer yet.
    WrongForm,
    /// Another English word for what was shown, not the one asked for: no
    /// answer yet. What was shown did not say which of them was meant.
    OtherWord,
    Miss,
}

/// An answer in the learner's language to a word shown in its sentence.
/// The `hints` are its translations as the translation of the sentence has
/// the word, the one it uses first: any of them is right. That form is the
/// one the learner's language has there, not always the one of the English
/// word: an infinitive, with or without its pronoun on it, is the form a
/// base translation has (`is_base`). So is any
/// `base` translation, or any hint, in another form, for a word that
/// inflects (`accepts_native`): the first hint is then pointed out. But a
/// base translation the word is `shown` as, written as it is, is the word
/// in the wrong form when the sentence has it `inflected`: "retroceder" for
/// "receded" is no answer yet.
pub fn recognition(
    answer: &str,
    (base, shown): (&[String], &[String]),
    (hints, inflected): (&[String], bool),
    (native, spelling): ((&str, bool), Spelling),
) -> Verdict {
    let articles = articles(native.0);
    if accepts(answer, hints, articles, spelling) {
        return Verdict::Right;
    }
    let either = [base, hints].concat();
    if !accepts_native(answer, &either, native, spelling) {
        return Verdict::Miss;
    }
    // A hint that is one of the base translations is no other form.
    let other_form = hints
        .first()
        .is_some_and(|exact| !is_base(exact, base, native, spelling));
    if !other_form {
        Verdict::Right
    } else if inflected && accepts(answer, shown, articles, spelling) {
        Verdict::WrongForm
    } else {
        Verdict::RightBase
    }
}

/// [`recognition`] of a verb, held to the form of the sentence where the
/// learner's language has one form for it: an answer that is right, and is
/// none of the `hints` as they are written, is no answer yet when the first
/// hint is a gerund or an infinitive (`books::practice::shape`) and the
/// answer is not. "predicaba" for "predicando" is the word in another form.
/// A past is not one form in Spanish: any form is right for it, as before.
pub fn in_form(
    verdict: Verdict,
    answer: &str,
    hints: &[String],
    (lang, spelling): (&str, Spelling),
) -> Verdict {
    let right = matches!(verdict, Verdict::Right | Verdict::RightBase);
    let asked = hints.first().and_then(|hint| shape(hint, lang));
    if right
        && asked.is_some()
        && shape(answer, lang) != asked
        && !accepts(answer, hints, articles(lang), spelling)
    {
        Verdict::WrongForm
    } else {
        verdict
    }
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
fn bare(text: &str) -> String {
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

/// An answer in English to the blank of a sentence. Only `form` fills it,
/// or an answer `upheld` before; any of the word's `other` forms is the
/// word in the wrong form. A reflexive pronoun counts for nothing either
/// way: the translation shown does not say which one the sentence has.
pub fn production(
    answer: &str,
    form: &str,
    (other, upheld): (&[String], &[String]),
    spelling: Spelling,
) -> Verdict {
    let answer = bare(answer);
    let answer = answer.as_str();
    let mut fills: Vec<String> = upheld.iter().map(|each| bare(each)).collect();
    fills.push(bare(form));
    let other: Vec<String> = other.iter().map(|each| bare(each)).collect();
    let other = other.as_slice();
    if accepts(answer, &fills, &LEADING, spelling) {
        Verdict::Right
    } else if accepts(answer, other, &LEADING, spelling) {
        Verdict::WrongForm
    } else {
        Verdict::Miss
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

#[cfg(test)]
mod tests {
    use super::*;

    fn banked(id: &str, book: bool, own: bool, shows: u32) -> Banked {
        Banked {
            id: id.into(),
            book,
            own,
            shows,
        }
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
    fn after_the_first_time_one_not_spent_is_drawn() {
        let bank = [
            banked("a", true, true, 1),
            banked("b", false, false, 2),
            banked("c", false, false, 0),
        ];
        assert_eq!(chosen(&bank, 0), Some("a"));
        assert_eq!(chosen(&bank, 1), Some("c"));
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
    fn a_past_is_right_for_a_word_whose_sentence_has_had_outside_it() {
        // "So after our fight, I'd made a point of smoking": the learner is
        // shown "made a point of" alone.
        let base = list(&["empeñarse en", "hacer hincapié en"]);
        let spelling = Spelling::of(false);
        let judged = |answer: &str, hints: &[&str]| {
            let hints = list(hints);
            let verdict = recognition(
                answer,
                (&base, &base),
                (&hints, true),
                (("es", true), spelling),
            );
            in_form(verdict, answer, &hints, ("es", spelling))
        };
        let hints = ["empeñado en", "asegurado de"];
        assert_eq!(judged("empeñado en", &hints), Verdict::Right);
        for answer in ["me aseguré de", "me asegure de", "me había asegurado de"] {
            assert_eq!(judged(answer, &hints), Verdict::RightBase, "{answer}");
        }
        // As a hint kept before this was asked for has it.
        let kept = ["me había empeñado en", "me había asegurado de"];
        assert_eq!(judged("me aseguré de", &kept), Verdict::RightBase);
        assert_eq!(judged("me olvidé de", &hints), Verdict::Miss);
    }

    #[test]
    fn a_verb_is_asked_as_it_is_alone_and_its_sentence_form_is_pointed_out() {
        let said = list(&["se congele", "se hiele"]);
        let alone = list(&["se congela", "se hiela"]);
        let asked = asked_alone(Some(&alone), &said, true);
        assert_eq!(asked.accepted, alone);
        assert_eq!(asked.judged[..2], alone[..]);
        assert_eq!(asked.note.as_deref(), Some("se congele"));
        // "freezes" in "before she freezes": any of the two is right.
        let base = list(&["congelarse", "helarse"]);
        let spelling = Spelling::of(false);
        let judged = |answer: &str| {
            let verdict = recognition(
                answer,
                (&base, &base),
                (&asked.judged, true),
                (("es", true), spelling),
            );
            in_form(verdict, answer, &asked.judged, ("es", spelling))
        };
        assert_eq!(judged("se congela"), Verdict::Right);
        assert_eq!(judged("Se hiela."), Verdict::Right);
        assert_eq!(judged("se congele"), Verdict::Right);
        assert_eq!(judged("congelarse"), Verdict::WrongForm);
        // The sentence has it as it is alone: nothing to point out.
        let same = asked_alone(Some(&alone), &list(&["se congela"]), true);
        assert_eq!((same.note, same.judged), (None, alone.clone()));
        // Not taken alone: what the sentence says, as before.
        let before = asked_alone(None, &said, true);
        assert_eq!((before.accepted, before.note), (said, None));
    }

    #[test]
    fn a_verb_called_by_its_base_form_keeps_any_form_its_sentence_allows() {
        // "freeze" in "they freeze at night": taken alone, "congelarse".
        let base = list(&["congelarse", "helarse"]);
        let asked = asked_alone(Some(&base), &list(&["se congelan"]), false);
        assert_eq!(asked.accepted, base);
        assert_eq!(asked.note.as_deref(), Some("se congelan"));
        let spelling = Spelling::of(false);
        let judged = |answer: &str| {
            let verdict = recognition(
                answer,
                (&base, &base),
                (&asked.judged, false),
                (("es", true), spelling),
            );
            in_form(verdict, answer, &asked.judged, ("es", spelling))
        };
        // Right in any form, as before: the base form asks for none.
        for answer in [
            "congelarse",
            "se congelan",
            "se congela",
            "congelan",
            "helarse",
        ] {
            let verdict = judged(answer);
            assert!(
                matches!(verdict, Verdict::Right | Verdict::RightBase),
                "{answer}: {verdict:?}"
            );
        }
    }

    #[test]
    fn a_verb_is_held_to_the_gerund_or_the_infinitive_its_sentence_has() {
        let base = list(&["predicar", "adoctrinar"]);
        let spelling = Spelling::of(false);
        let judged = |answer: &str, hints: &[&str], inflected: bool| {
            let hints = list(hints);
            let verdict = recognition(
                answer,
                (&base, &base),
                (&hints, inflected),
                (("es", true), spelling),
            );
            in_form(verdict, answer, &hints, ("es", spelling))
        };
        // "proselytizing": one form in Spanish, and it is asked for.
        let ing = |answer: &str| judged(answer, &["predicando", "adoctrinando"], true);
        assert_eq!(ing("predicando"), Verdict::Right);
        assert_eq!(ing("Adoctrinando."), Verdict::Right);
        assert_eq!(ing("estaba predicando"), Verdict::RightBase);
        assert_eq!(ing("predicaba"), Verdict::WrongForm);
        assert_eq!(ing("predicó"), Verdict::WrongForm);
        assert_eq!(ing("predicar"), Verdict::WrongForm);
        assert_eq!(ing("cantando"), Verdict::Miss);
        // "to proselytize": the infinitive, and no other form.
        let to = |answer: &str| judged(answer, &["predicar"], false);
        assert_eq!(to("predicar"), Verdict::Right);
        assert_eq!(to("adoctrinar"), Verdict::Right);
        assert_eq!(to("predicaba"), Verdict::WrongForm);
        assert_eq!(to("predicando"), Verdict::WrongForm);
        // "proselytized": a past is not one form in Spanish.
        let past = |answer: &str| judged(answer, &["predicó"], true);
        assert_eq!(past("predicaba"), Verdict::RightBase);
        assert_eq!(past("predicando"), Verdict::RightBase);
        // A hint listed as it is written is right, whatever its form.
        assert_eq!(
            judged("que predicaba", &["predicando", "que predicaba"], true),
            Verdict::Right
        );
    }

    #[test]
    fn a_translation_is_right_in_the_form_of_the_sentence_and_its_base_form_is_no_answer() {
        let base = list(&["remover", "agitar"]);
        let how = (("es", true), Spelling::of(false));
        // "stirred": the sentence has the word in another form.
        let judged = |answer: &str, hints: &[&str]| {
            recognition(answer, (&base, &base), (&list(hints), true), how)
        };
        assert_eq!(judged("removió", &["removió"]), Verdict::Right);
        // Any of the translations in that form, once they are listed.
        assert_eq!(judged("Agitó.", &["removió", "agitó"]), Verdict::Right);
        // The base form says nothing of the form: one more try.
        assert_eq!(judged("Remover", &["removió"]), Verdict::WrongForm);
        assert_eq!(judged("agitar", &["removió", "agitó"]), Verdict::WrongForm);
        assert_eq!(judged("mezclar", &["removió"]), Verdict::Miss);
        assert_eq!(judged("", &["removió"]), Verdict::Miss);
        // Any other form is right, listed or not, and the form of the
        // sentence is pointed out: a past is not one form in Spanish.
        assert_eq!(judged("removía", &["removió"]), Verdict::RightBase);
        assert_eq!(judged("removido", &["removió"]), Verdict::RightBase);
        assert_eq!(judged("agitó", &["removió"]), Verdict::RightBase);
        // A hint that is a base translation is no other form: any is right.
        assert_eq!(judged("remover", &["remover"]), Verdict::Right);
        assert_eq!(judged("agitar", &["remover"]), Verdict::Right);

        // "stir": the sentence has the base form, and so may the answer.
        let plain = |answer: &str, hints: &[&str]| {
            recognition(answer, (&base, &base), (&list(hints), false), how)
        };
        assert_eq!(plain("remover", &["remueve"]), Verdict::RightBase);
        assert_eq!(plain("agitar", &["remover"]), Verdict::Right);
        assert_eq!(plain("agitados", &[]), Verdict::Right);

        // The translation of the sentence has the word in a form of its
        // own, an infinitive for "bridged": no base form is the wrong one.
        let bridge = list(&["salvar", "cerrar"]);
        let judged = |answer: &str| {
            let hints = list(&["salvarse", "cerrarse"]);
            recognition(answer, (&bridge, &bridge), (&hints, true), how)
        };
        assert_eq!(judged("salvarse"), Verdict::Right);
        assert_eq!(judged("salvar"), Verdict::Right);
        assert_eq!(judged("cerrar"), Verdict::Right);
        assert_eq!(judged("salvada"), Verdict::Right);
        assert_eq!(judged("guardada"), Verdict::Miss);
        // Nor when the verb the translation chose is not one of them.
        let judged = |answer: &str| {
            let hints = list(&["cruzarse"]);
            recognition(answer, (&bridge, &bridge), (&hints, true), how)
        };
        assert_eq!(judged("salvar"), Verdict::Right);
        assert_eq!(judged("cruzarse"), Verdict::Right);

        // A translation a dispute upheld is accepted, not one it is shown
        // as: written as it is, it is right.
        let upheld = list(&["remover", "agitar", "menear"]);
        let judged =
            |answer: &str| recognition(answer, (&upheld, &base), (&list(&["removió"]), true), how);
        assert_eq!(judged("menear"), Verdict::RightBase);
        assert_eq!(judged("remover"), Verdict::WrongForm);

        let rested = list(&["descansar", "reposar", "estar apoyado"]);
        let judged = |answer: &str| {
            recognition(
                answer,
                (&rested, &rested),
                (&list(&["reposaba"]), true),
                how,
            )
        };
        assert_eq!(judged("reposaba"), Verdict::Right);
        assert_eq!(judged("apoyado"), Verdict::RightBase);
        assert_eq!(judged("estaba apoyado"), Verdict::RightBase);
        assert_eq!(judged("estar apoyado"), Verdict::WrongForm);
        assert_eq!(judged("colgado"), Verdict::Miss);
        // A noun too: its base form where the sentence has the plural.
        let hedge = list(&["seto"]);
        let judged = |answer: &str| {
            let how = (("es", false), how.1);
            recognition(answer, (&hedge, &hedge), (&list(&["setos"]), true), how)
        };
        assert_eq!(judged("setos"), Verdict::Right);
        assert_eq!(judged("el seto"), Verdict::WrongForm);
        assert_eq!(judged("seta"), Verdict::Miss);
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

    #[test]
    fn only_the_form_of_the_sentence_fills_its_blank() {
        let other = list(&["stir", "stirs", "stirred"]);
        let judged = |answer: &str, upheld: &[String]| {
            production(answer, "stirred", (&other, upheld), Spelling::of(false))
        };
        assert_eq!(judged("Stirred", &[]), Verdict::Right);
        assert_eq!(judged("stir", &[]), Verdict::WrongForm);
        assert_eq!(judged("to stir", &[]), Verdict::WrongForm);
        // A form neither the book nor the bank has is not known to be one.
        assert_eq!(judged("stirring", &[]), Verdict::Miss);
        assert_eq!(judged("mixed", &[]), Verdict::Miss);
        assert_eq!(judged("mixed", &list(&["mixed"])), Verdict::Right);
        assert_eq!(judged("", &[]), Verdict::Miss);
    }

    #[test]
    fn another_word_for_what_was_shown_is_no_miss_and_no_answer() {
        let other = list(&["notion", "notions"]);
        let rivals = list(&["ideas", "thoughts", "to think"]);
        let judged = |answer: &str| {
            let spelling = Spelling::of(false);
            let verdict = production(answer, "notions", (&other, &[]), spelling);
            or_other(verdict, answer, &rivals, spelling)
        };
        assert_eq!(judged("Ideas"), Verdict::OtherWord);
        assert_eq!(judged("the thoughts."), Verdict::OtherWord);
        assert_eq!(judged("think"), Verdict::OtherWord);
        // The word itself is judged as before, whatever the rivals say.
        assert_eq!(judged("notions"), Verdict::Right);
        assert_eq!(judged("notion"), Verdict::WrongForm);
        assert_eq!(judged("images"), Verdict::Miss);
        assert_eq!(judged(""), Verdict::Miss);
        let right = or_other(Verdict::Right, "ideas", &rivals, Spelling::of(false));
        assert_eq!(right, Verdict::Right);
    }

    #[test]
    fn the_reflexive_pronoun_of_a_form_is_the_sentences_not_the_words() {
        let other = list(&["distance", "distanced himself", "distance yourself"]);
        let judged = |answer: &str| {
            production(
                answer,
                "distancing herself",
                (&other, &[]),
                Spelling::of(false),
            )
        };
        assert_eq!(judged("distancing herself"), Verdict::Right);
        // "distanciándose" does not say whose: any of them, or none.
        assert_eq!(judged("distancing himself"), Verdict::Right);
        assert_eq!(judged("Distancing oneself"), Verdict::Right);
        assert_eq!(judged("distancing"), Verdict::Right);
        // Another form is still another form, with or without one.
        assert_eq!(judged("distance"), Verdict::WrongForm);
        assert_eq!(judged("distanced"), Verdict::WrongForm);
        assert_eq!(judged("distance herself"), Verdict::WrongForm);
        assert_eq!(judged("herself"), Verdict::Miss);
        assert_eq!(judged("moving herself"), Verdict::Miss);
        // A pronoun that is the word itself stays.
        let alone = |answer: &str| production(answer, "himself", (&[], &[]), Spelling::of(false));
        assert_eq!(alone("himself"), Verdict::Right);
        assert_eq!(alone("herself"), Verdict::Miss);
    }
}
