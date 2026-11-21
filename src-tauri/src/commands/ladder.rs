//! The steps a word written alike to another one in another sense is asked
//! in (`db::spellings::rivals`). When its tag tells it from every rival
//! (another kind of word, or a verb in another form) it comes alone, with
//! no sentence. An answer that is what a rival means is no miss: the
//! learner is told which word it was and the kind of word asked for, and
//! for a verb the form. A miss after that brings the sentence. Right with
//! the sentence, the word was understood but not known: it is neither right
//! nor a miss, and it comes back.
//!
//! When its tag cannot tell it from a rival ([`tied`]: "fair", blond, and
//! "fair", just, both adjectives), the word alone has no one answer, so it
//! always comes with the few words of its sentence that fix its sense
//! (`books::sentences::fragment`). An answer that is what a rival means
//! goes straight to the whole sentence, with no step between: more tries
//! would let the learner get there by elimination. Right with it is again
//! neither right nor a miss, and the word comes back, with its few words.
//! Wrong with the sentence is a miss like any other. No step asks the model
//! for anything.

use rusqlite::Connection;

use crate::books::practice::{accepts_native, inflects, mark};
use crate::books::sentences::{few_words, fragment};
use crate::books::spelling::Spelling;
use crate::db::practice::WordRow;
use crate::db::sentences::Sentence;
use crate::db::spellings::{self, Rival};
use crate::domain::{Direction, Ladder, PartOfSpeech, SenseHint, SenseTip, VerbForm};
use crate::error::Result;

use super::practice::in_place;

/// The step the learner is on: alone, told the kind of word, or shown the
/// sentence.
pub const ALONE: u8 = 0;
pub const TOLD: u8 = 1;
pub const SHOWN: u8 = 2;

/// What comes of an answer on the steps.
#[derive(Debug, Clone, PartialEq)]
pub enum Climb {
    /// Off the steps: the answer is judged as any other.
    Off,
    /// No answer yet: the next step, with its help.
    Up(Ladder),
    /// Right only with the sentence: neither right nor a miss.
    Understood(SenseTip),
}

/// Whether `kind` is a verb, whose form tells it apart too.
fn verb(kind: Option<PartOfSpeech>) -> bool {
    matches!(kind, Some(PartOfSpeech::Verb | PartOfSpeech::PhrasalVerb))
}

/// Whether the tag of a word of kind `kind`, asked in the form `form`,
/// tells it from a rival: another kind of word, or a verb in another form.
/// A kind or a form nobody said tells nothing apart.
fn told_apart((kind, form): (Option<PartOfSpeech>, Option<VerbForm>), rival: &Rival) -> bool {
    match (kind, rival.part_of_speech) {
        (Some(mine), Some(theirs)) if mine != theirs => true,
        (Some(_), Some(_)) if verb(kind) => {
            matches!((form, rival.verb_form), (Some(mine), Some(theirs)) if mine != theirs)
        }
        _ => false,
    }
}

/// Whether the word, asked in the form `form`, has a rival its tag cannot
/// tell it from: then the word alone has no one answer, and it is asked with
/// the words of its sentence that fix its sense.
pub fn tied(conn: &Connection, word: &WordRow, form: Option<VerbForm>) -> Result<bool> {
    let form = form.or(word.verb_form);
    Ok(spellings::rivals(conn, &word.id)?
        .iter()
        .any(|rival| !told_apart((word.part_of_speech, form), rival)))
}

/// The few words a word its tag cannot tell apart is asked with
/// (`books::sentences::fragment`): of the sentence it is asked with, by the
/// words the second look said fix its sense, or of its chapter's sentence.
/// None only when the sentence does not have the word as written.
pub fn short_of(
    word: &WordRow,
    sentence: Option<&Sentence>,
) -> Option<Vec<crate::domain::SentencePart>> {
    match sentence {
        Some(each) => fragment(
            &each.text,
            &each.form,
            each.cue.as_deref().unwrap_or_default(),
        ),
        None => few_words(&word.sentence, &word.forms, &[]),
    }
}

/// What tells the learner which word was meant: what the rival means, where
/// it is from, both kinds of word and, for verbs, both forms.
fn hint(word: &WordRow, form: Option<VerbForm>, rival: &Rival, meaning: &str) -> SenseHint {
    SenseHint {
        meaning: meaning.to_owned(),
        book: (!rival.same_book).then(|| rival.book.clone()),
        chapter: rival.chapter_index.saturating_add(1),
        chapter_title: rival.chapter_title.clone(),
        asked: word.part_of_speech,
        given: rival.part_of_speech,
        asked_form: form.filter(|_| verb(word.part_of_speech)),
        given_form: rival.verb_form.filter(|_| verb(rival.part_of_speech)),
    }
}

/// The sentence the word is shown with on the last step: the one it was
/// asked with, or its chapter's.
fn context(word: &WordRow, sentence: Option<&Sentence>) -> Vec<crate::domain::SentencePart> {
    sentence
        .and_then(|each| in_place(each, Direction::Recognition))
        .unwrap_or_else(|| mark(&word.sentence, &word.forms))
}

/// What an answer on step `rung` comes to. Only English → native is on the
/// steps: a rival is told apart by what it means.
pub fn rise(
    conn: &Connection,
    (word, sentence): (&WordRow, Option<&Sentence>),
    (direction, answer, rung): (Direction, &str, u8),
    right: bool,
    (lang, spelling): (&str, Spelling),
) -> Result<Climb> {
    if direction != Direction::Recognition {
        return Ok(Climb::Off);
    }
    let rivals = spellings::rivals(conn, &word.id)?;
    if rivals.is_empty() {
        return Ok(Climb::Off);
    }
    let native = (lang, inflects(word.part_of_speech));
    let form = sentence.and_then(|each| each.verb_form).or(word.verb_form);
    let tied = rivals
        .iter()
        .any(|rival| !told_apart((word.part_of_speech, form), rival));
    // Asked with its few words (`commands::practice::tie`), or with its
    // whole sentence, where those are not known.
    let short = tied && short_of(word, sentence).is_some();
    Ok(match rung {
        ALONE if right || answer.trim().is_empty() => Climb::Off,
        ALONE => rivals
            .iter()
            .find_map(|rival| {
                rival
                    .translations
                    .iter()
                    .find(|meaning| {
                        accepts_native(answer, std::slice::from_ref(*meaning), native, spelling)
                    })
                    .map(|meaning| (rival, meaning))
            })
            .map_or(Climb::Off, |(rival, meaning)| {
                Climb::Up(if tied {
                    Ladder {
                        rung: SHOWN,
                        hint: None,
                        context: Some(context(word, sentence)),
                        short,
                    }
                } else {
                    Ladder {
                        rung: TOLD,
                        hint: Some(hint(word, form, rival, meaning)),
                        context: None,
                        short: false,
                    }
                })
            }),
        TOLD if right => Climb::Off,
        TOLD => Climb::Up(Ladder {
            rung: SHOWN,
            hint: None,
            context: Some(context(word, sentence)),
            short: false,
        }),
        _ if right => Climb::Understood(SenseTip {
            kind: word.part_of_speech,
            kinds_differ: rivals.iter().any(|rival| {
                matches!(
                    (word.part_of_speech, rival.part_of_speech),
                    (Some(mine), Some(theirs)) if mine != theirs
                )
            }),
            tied,
            short,
        }),
        _ => Climb::Off,
    })
}
