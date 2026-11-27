//! The words written alike, in any chapter of any book: those called the
//! same, whose cards read the same. A word's *rivals* are those written
//! alike that are of another sense (`db::senses`): another kind of word, or
//! the same kind with nothing in common in what it means. A word with
//! rivals is asked so that the learner can tell which one is meant, and
//! one its tag cannot tell from a rival is the only kind of word the model
//! writes sentences for.

use rusqlite::Connection;

use super::senses;

use crate::domain::{PartOfSpeech, VerbForm};
use crate::error::Result;

/// The other words written alike: called the same, so that their cards
/// read the same ("found", to found, and "found", the past of "find"). A
/// word that only starts as another does, or shares a form with it, is
/// another word, asked by what it is called: "boss" is not "boss fight",
/// and "feet" is not "foot".
pub fn alike(conn: &Connection, word_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT b.id FROM chapter_words a JOIN chapter_words b ON b.key = a.key AND b.id != a.id
         WHERE a.id = ?1 ORDER BY b.id",
    )?;
    let rows = stmt.query_map([word_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A word written alike that means something else, as the learner is told
/// of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rival {
    pub word_id: String,
    pub chapter_id: String,
    /// The title of its book, and whether it is the book of the word asked.
    pub book: String,
    pub same_book: bool,
    /// Its chapter's place in the book, from 0, and its title.
    pub chapter_index: u32,
    pub chapter_title: String,
    pub part_of_speech: Option<PartOfSpeech>,
    /// The form a verb has in its chapter, when one said.
    pub verb_form: Option<VerbForm>,
    /// What it means, as its chapter has it.
    pub translations: Vec<String>,
}

/// The words written alike to `word_id` that are of another sense
/// (`db::senses`): another kind of word, a verb in another form, or the
/// same with nothing in common in what it means. One of each sense, the
/// first that was found. Two lists that share a translation are one
/// meaning, and no rivals.
pub fn rivals(conn: &Connection, word_id: &str) -> Result<Vec<Rival>> {
    senses::fill(conn)?;
    let own = senses::of(conn, word_id)?;
    let book: String = conn.query_row(
        "SELECT c.book_id FROM chapter_words w JOIN book_chapters c ON c.id = w.chapter_id
         WHERE w.id = ?1",
        [word_id],
        |row| row.get(0),
    )?;
    let mut found = Vec::new();
    for id in alike(conn, word_id)? {
        let Some(sense) = senses::of(conn, &id)? else {
            continue;
        };
        if Some(&sense) == own.as_ref() {
            continue;
        }
        let theirs: Option<PartOfSpeech> = conn.query_row(
            "SELECT part_of_speech FROM chapter_words WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )?;
        let mut stmt = conn.prepare(
            "SELECT w.chapter_id, b.title, c.book_id, c.idx, c.title, w.created_at, w.verb_form
             FROM chapter_words w JOIN book_chapters c ON c.id = w.chapter_id
             JOIN books b ON b.id = c.book_id WHERE w.id = ?1",
        )?;
        let (chapter_id, title, book_id, index, chapter_title, created, verb_form): (
            String,
            String,
            String,
            u32,
            String,
            String,
            Option<VerbForm>,
        ) = stmt.query_row([&id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })?;
        let translations = senses::glosses(conn, &sense)?;
        found.push((
            (created, sense),
            Rival {
                word_id: id,
                chapter_id,
                book: title,
                same_book: book_id == book,
                chapter_index: index,
                chapter_title,
                part_of_speech: theirs,
                verb_form,
                translations,
            },
        ));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    // One of each sense: the words of one sense mean the same.
    let mut kept: Vec<Rival> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for ((_, sense), rival) in found {
        if !seen.contains(&sense) {
            seen.push(sense);
            kept.push(rival);
        }
    }
    Ok(kept)
}
