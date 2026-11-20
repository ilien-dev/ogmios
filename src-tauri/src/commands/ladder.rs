//! The steps a word written alike to another one in another sense is asked
//! in (`db::spellings::rivals`). It comes alone, with no sentence. An answer
//! that is what a rival means is no miss: the learner is told which word it
//! was and the kind of word asked for. A miss after that brings the
//! sentence. Right with the sentence, the word was understood but not
//! known: it is neither right nor a miss, and it comes back. Wrong with the
//! sentence is a miss like any other. No step asks the model for anything.

use rusqlite::Connection;

use crate::books::practice::{accepts_native, inflects, mark};
use crate::books::spelling::Spelling;
use crate::db::practice::WordRow;
use crate::db::sentences::Sentence;
use crate::db::spellings::{self, Rival};
use crate::domain::{Direction, Ladder, SenseHint, SenseTip};
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

/// What tells the learner which word was meant: what the rival means, where
/// it is from, and both kinds of word.
fn hint(word: &WordRow, rival: &Rival, meaning: &str) -> SenseHint {
    SenseHint {
        meaning: meaning.to_owned(),
        book: (!rival.same_book).then(|| rival.book.clone()),
        chapter: rival.chapter_index.saturating_add(1),
        chapter_title: rival.chapter_title.clone(),
        asked: word.part_of_speech,
        given: rival.part_of_speech,
    }
}

/// The sentence the word is shown with on the last step: the one it was
/// asked with, or its chapter's.
fn context(word: &WordRow, sentence: Option<&Sentence>) -> Vec<crate::domain::SentencePart> {
    sentence
        .and_then(|each| in_place(each, Direction::Recognition))
        .unwrap_or_else(|| mark(&word.sentence, &word.forms))
}

/// Whether the word has a rival: then it is asked on the steps.
pub fn on_steps(conn: &Connection, word: &WordRow) -> Result<bool> {
    Ok(!spellings::rivals(conn, &word.id)?.is_empty())
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
                Climb::Up(Ladder {
                    rung: TOLD,
                    hint: Some(hint(word, rival, meaning)),
                    context: None,
                })
            }),
        TOLD if right => Climb::Off,
        TOLD => Climb::Up(Ladder {
            rung: SHOWN,
            hint: None,
            context: Some(context(word, sentence)),
        }),
        _ if right => Climb::Understood(SenseTip {
            kind: word.part_of_speech,
            kinds_differ: rivals.iter().any(|rival| {
                matches!(
                    (word.part_of_speech, rival.part_of_speech),
                    (Some(mine), Some(theirs)) if mine != theirs
                )
            }),
        }),
        _ => Climb::Off,
    })
}
