//! The bank of sentences each word is asked with, by the word's key. How
//! often one was shown is counted from the answers that name it; which one
//! comes next is `books::sentences`.

use chrono::{DateTime, Utc};
use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::practice::NOT_KNOWN;
use super::{new_id, ts};
use crate::books::vocab;
use crate::domain::PartOfSpeech;
use crate::error::Result;

/// One sentence of a word's bank.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sentence {
    pub id: String,
    pub key: String,
    /// From the book, not written by the model.
    pub book: bool,
    /// The sentence, in English.
    pub text: String,
    /// The word as the sentence writes it: what fills its blank.
    pub form: String,
    /// That form in the learner's language.
    pub hint: String,
    /// The sentence in the learner's language.
    pub translation: String,
    /// Times it was shown: the answers given to it, anywhere.
    pub shows: u32,
    /// The other English words its hint could be answered with, as the
    /// second look listed them; none while it has not been labelled.
    pub also: Vec<String>,
}

const SENTENCE: &str = "SELECT s.id, s.key, s.source = 'book', s.sentence, s.form, s.hint,
            s.translation,
            (SELECT COUNT(*) FROM word_answers a WHERE a.sentence_id = s.id)
              + (SELECT COUNT(*) FROM word_events e WHERE e.sentence_id = s.id),
            COALESCE(s.also, '[]')
     FROM word_sentences s";

fn sentence(row: &Row<'_>) -> rusqlite::Result<Sentence> {
    let also: String = row.get(8)?;
    let also = serde_json::from_str(&also)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(8, Type::Text, error.into()))?;
    Ok(Sentence {
        id: row.get(0)?,
        key: row.get(1)?,
        book: row.get(2)?,
        text: row.get(3)?,
        form: row.get(4)?,
        hint: row.get(5)?,
        translation: row.get(6)?,
        shows: row.get(7)?,
        also,
    })
}

/// The sentences a word can be asked with: looked at and found good, and
/// not called bad since. The oldest first.
pub fn bank(conn: &Connection, key: &str) -> Result<Vec<Sentence>> {
    let mut stmt = conn.prepare(&format!(
        "{SENTENCE} WHERE s.key = ?1 AND s.reviewed AND NOT s.discarded
         ORDER BY s.created_at, s.rowid"
    ))?;
    let rows = stmt.query_map([key], sentence)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// One sentence a word can be asked with; none for one that is not in its
/// bank any more, or never was.
pub fn usable(conn: &Connection, id: &str) -> Result<Option<Sentence>> {
    Ok(conn
        .query_row(
            &format!("{SENTENCE} WHERE s.id = ?1 AND s.reviewed AND NOT s.discarded"),
            [id],
            sentence,
        )
        .optional()?)
}

/// A sentence and the form the word has in it, whatever became of it since
/// it was asked with.
pub fn text(conn: &Connection, id: &str) -> Result<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT sentence, form FROM word_sentences WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

/// The other English words the hint of a sentence could be answered with,
/// whatever became of the sentence since it was asked with.
pub fn also(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let kept: Option<String> = conn
        .query_row(
            "SELECT COALESCE(also, '[]') FROM word_sentences WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(kept
        .map(|json| serde_json::from_str(&json))
        .transpose()?
        .unwrap_or_default())
}

/// Every form the word has in a sentence it was ever given.
pub fn forms(conn: &Connection, key: &str) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT form FROM word_sentences WHERE key = ?1 AND form != ''")?;
    let rows = stmt.query_map([key], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Whether the word was ever given a sentence, whatever came of it: one
/// that was is not asked about again.
pub fn given(conn: &Connection, key: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM word_sentences WHERE key = ?1)",
        [key],
        |row| row.get(0),
    )?)
}

/// What a sentence is kept with.
pub struct NewSentence<'a> {
    pub key: &'a str,
    pub book: bool,
    pub sentence: &'a str,
    pub form: &'a str,
    pub hint: &'a str,
    pub translation: &'a str,
}

/// Keeps a sentence, to be looked at before it is used. One the word
/// already has is left as it is.
pub fn add(conn: &Connection, new: &NewSentence<'_>, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO word_sentences
           (id, key, source, sentence, form, hint, translation, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            new_id(),
            new.key,
            if new.book { "book" } else { "model" },
            new.sentence,
            new.form,
            new.hint,
            new.translation,
            ts(now)
        ],
    )?;
    Ok(())
}

/// A sentence that is never to be asked with, kept so that it is not
/// asked about again: one whose gloss the code refused.
pub fn refuse(conn: &Connection, key: &str, sentence: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO word_sentences
           (id, key, source, sentence, form, hint, translation, reviewed, discarded, created_at)
         VALUES (?1, ?2, 'model', ?3, '', '', '', 1, 1, ?4)",
        params![new_id(), key, sentence, ts(now)],
    )?;
    Ok(())
}

/// The sentences waiting to be looked at, the oldest first.
pub fn unreviewed(conn: &Connection) -> Result<Vec<Sentence>> {
    let mut stmt = conn.prepare(&format!(
        "{SENTENCE} WHERE NOT s.reviewed ORDER BY s.created_at, s.rowid"
    ))?;
    let rows = stmt.query_map([], sentence)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A sentence was looked at: a good one can be asked with from now on.
/// `also` is the other English words its hint could be answered with.
pub fn review(conn: &Connection, id: &str, good: bool, also: &[String]) -> Result<()> {
    conn.execute(
        "UPDATE word_sentences SET reviewed = 1, discarded = ?2, also = ?3 WHERE id = ?1",
        params![id, !good, serde_json::to_string(also)?],
    )?;
    Ok(())
}

/// The sentences asked with that were looked at before the other English
/// words for their hint were asked for, the oldest first.
pub fn unlabelled(conn: &Connection) -> Result<Vec<Sentence>> {
    let mut stmt = conn.prepare(&format!(
        "{SENTENCE} WHERE s.reviewed AND NOT s.discarded AND s.also IS NULL
         ORDER BY s.created_at, s.rowid"
    ))?;
    let rows = stmt.query_map([], sentence)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The other English words the hint of a sentence could be answered with.
pub fn label(conn: &Connection, id: &str, also: &[String]) -> Result<()> {
    conn.execute(
        "UPDATE word_sentences SET also = ?2 WHERE id = ?1",
        params![id, serde_json::to_string(also)?],
    )?;
    Ok(())
}

/// The other words the learner has that are shown as one of these
/// `translations`, in every form their chapters write them: what a learner
/// asked for the word of `key` in English may well type instead of it.
pub fn rivals(conn: &Connection, key: &str, translations: &[String]) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT w.lemma, w.forms FROM chapter_words w
         JOIN word_translations t ON t.word_id = w.id AND t.source = 'extraction'
         WHERE w.key != ?1 AND t.text IN (SELECT value FROM json_each(?2))
         ORDER BY w.created_at, w.id",
    )?;
    let rows = stmt
        .query_map(params![key, serde_json::to_string(translations)?], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
    let mut all = Vec::new();
    for (lemma, forms) in rows {
        all.push(lemma);
        all.extend(serde_json::from_str::<Vec<String>>(&forms)?);
    }
    Ok(all)
}

/// The learner called the sentence bad: it is not asked with again.
pub fn discard(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE word_sentences SET discarded = 1 WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// What kind of word a chapter's word is, when the chapter says.
pub fn part_of_speech(conn: &Connection, word_id: &str) -> Result<Option<PartOfSpeech>> {
    Ok(conn.query_row(
        "SELECT part_of_speech FROM chapter_words WHERE id = ?1",
        [word_id],
        |row| row.get(0),
    )?)
}

/// The words of a chapter the learner has not said they know, each with its
/// key: the ones still to learn first, most frequent first.
pub fn chapter_keys(conn: &Connection, chapter_id: &str) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT w.id, w.key FROM chapter_words w
         WHERE w.chapter_id = ?1 AND {NOT_KNOWN}
         ORDER BY w.done_at IS NOT NULL, w.occurrences DESC, w.key"
    ))?;
    let rows = stmt.query_map([chapter_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The text of every chapter of a chapter's book: its own first, then the
/// others in reading order.
pub fn book_texts(conn: &Connection, chapter_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT c.text FROM book_chapters c
         WHERE c.book_id = (SELECT book_id FROM book_chapters WHERE id = ?1)
         ORDER BY c.id != ?1, c.idx",
    )?;
    let rows = stmt.query_map([chapter_id], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What a word is called and what it means, by its key: as the first
/// chapter that has it says, the translation the learner answers with most
/// first, or, for a word of a conversation, as it was asked for there. A key
/// nothing has any more is its own name.
pub fn meaning(conn: &Connection, key: &str) -> Result<(String, Vec<String>)> {
    let of_book: Option<(String, String)> = conn
        .query_row(
            "SELECT id, lemma FROM chapter_words WHERE key = ?1 ORDER BY created_at, id LIMIT 1",
            [key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((word_id, lemma)) = of_book {
        let shown = super::words::extracted(conn, &word_id)?;
        let part = part_of_speech(conn, &word_id)?;
        let used = super::words::Used::load(conn, Some(key))?;
        return Ok((lemma, used.order(key, part, shown)));
    }
    let mut stmt = conn.prepare(
        "SELECT english, asked FROM vocab WHERE asked IS NOT NULL ORDER BY created_at, rowid",
    )?;
    let asked = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(asked
        .into_iter()
        .find(|(english, _)| vocab::key(english) == key)
        .map_or_else(
            || (key.to_owned(), Vec::new()),
            |(english, asked)| (english, vec![asked]),
        ))
}
