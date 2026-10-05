//! The sentences a word is asked with: which one comes next, whether one
//! can be used, and what an answer given to one is worth. A word is given
//! [`GIVEN`] of them, once; a bank kept before that has more, each shown
//! [`SHOWS`] times before another is drawn. Nothing here touches the
//! database, the clock or the model.

use super::practice::{accepts, accepts_native, articles, mark};
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

/// What an answer given to a word in a sentence is worth.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Right,
    /// Right, with the word's base translation where the sentence has it in
    /// another form: it counts, and the form it has there is pointed out.
    RightBase,
    /// The word, in a form that does not fill the blank: no answer yet.
    WrongForm,
    /// Another English word for what was shown, not the one asked for: no
    /// answer yet. What was shown did not say which of them was meant.
    OtherWord,
    Miss,
}

/// An answer in the learner's language to a word shown in its sentence. The
/// `base` translations are accepted, and so is the `hint`: the translation
/// in the form the sentence has the word in. Any of them is right in
/// another form too, for a word that inflects (`accepts_native`): the hint
/// itself is then pointed out.
pub fn recognition(
    answer: &str,
    base: &[String],
    hint: Option<&str>,
    (native, spelling): ((&str, bool), Spelling),
) -> Verdict {
    let articles = articles(native.0);
    let hint: Vec<String> = hint.map(str::to_owned).into_iter().collect();
    if accepts(answer, &hint, articles, spelling) {
        return Verdict::Right;
    }
    let either = [base, hint.as_slice()].concat();
    if !accepts_native(answer, &either, native, spelling) {
        return Verdict::Miss;
    }
    // A hint that is one of the base translations is no other form.
    match hint.first() {
        Some(exact) if !accepts(exact, base, articles, spelling) => Verdict::RightBase,
        _ => Verdict::Right,
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
    fn a_translation_is_right_in_the_base_form_or_in_the_form_of_the_sentence() {
        let base = list(&["remover", "agitar"]);
        let how = (("es", true), Spelling::of(false));
        let judged = |answer: &str, hint: Option<&str>| recognition(answer, &base, hint, how);
        assert_eq!(judged("removió", Some("removió")), Verdict::Right);
        assert_eq!(judged("Remover", Some("removió")), Verdict::RightBase);
        assert_eq!(judged("mezclar", Some("removió")), Verdict::Miss);
        // No other form to point out.
        assert_eq!(judged("remover", Some("remover")), Verdict::Right);
        assert_eq!(judged("agitar", None), Verdict::Right);
        assert_eq!(judged("", Some("removió")), Verdict::Miss);
        // Another form of any of them is right, and the form of the sentence
        // is pointed out.
        assert_eq!(judged("removido", Some("removió")), Verdict::RightBase);
        assert_eq!(judged("agitaba", Some("removió")), Verdict::RightBase);
        assert_eq!(judged("agitados", None), Verdict::Right);
        let rested = list(&["descansar", "reposar", "estar apoyado"]);
        let judged = |answer: &str| recognition(answer, &rested, Some("reposaba"), how);
        assert_eq!(judged("reposaba"), Verdict::Right);
        assert_eq!(judged("apoyado"), Verdict::RightBase);
        assert_eq!(judged("estaba apoyado"), Verdict::RightBase);
        assert_eq!(judged("colgado"), Verdict::Miss);
        // A noun is taken in the form of its sentence or in its base form.
        let hedge = list(&["seto"]);
        let judged =
            |answer: &str| recognition(answer, &hedge, Some("setos"), (("es", false), how.1));
        assert_eq!(judged("setos"), Verdict::Right);
        assert_eq!(judged("el seto"), Verdict::RightBase);
        assert_eq!(judged("seta"), Verdict::Miss);
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
