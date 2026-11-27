//! What the learner said they know already: a word in one sense
//! (`db::senses`), not every word written like it. "bug", the insect, known,
//! is asked nowhere and taken for no later chapter; "bug", the error, is a
//! word to learn.
//!
//! A mark keeps what tells its sense apart, so it outlives the book it was
//! made in: a word of a later book that means the same is of that sense
//! again (`senses::siblings`), and is known.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::{senses, ts};
use crate::domain::PartOfSpeech;
use crate::error::Result;

/// A row `w` of `chapter_words` the learner said they know.
pub(crate) const KNOWN: &str = "EXISTS (SELECT 1 FROM known_words k WHERE k.sense_id = w.sense_id)";

/// The sense a mark made before senses were is kept under until a word of
/// its key gives it one ([`bind`], [`claim`]).
fn unbound(key: &str) -> String {
    format!("key:{key}")
}

/// Whether the learner said they know the word, in its sense.
pub fn is(conn: &Connection, word_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        &format!("SELECT EXISTS (SELECT 1 FROM chapter_words w WHERE w.id = ?1 AND {KNOWN})"),
        [word_id],
        |row| row.get(0),
    )?)
}

/// Whether the learner said they know this sense.
pub fn has(conn: &Connection, sense_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM known_words WHERE sense_id = ?1)",
        [sense_id],
        |row| row.get(0),
    )?)
}

/// Keeps `sense` as known, told apart by what `word_id` is and by what the
/// sense means now. A sense known already is left as it is.
fn keep(conn: &Connection, sense: &str, word_id: &str, since: &str) -> Result<()> {
    let means = serde_json::to_string(&senses::glosses(conn, sense)?)?;
    conn.execute(
        "INSERT INTO known_words
           (sense_id, key, lemma, part_of_speech, glosses, created_at)
         SELECT ?1, key, lemma, part_of_speech, ?2, ?3
         FROM chapter_words WHERE id = ?4
         ON CONFLICT (sense_id) DO NOTHING",
        params![sense, means, since, word_id],
    )?;
    Ok(())
}

/// The learner knows the word: in the sense it has, wherever it is.
pub fn mark(conn: &Connection, word_id: &str, now: DateTime<Utc>) -> Result<()> {
    if senses::of(conn, word_id)?.is_none() {
        senses::assign(conn, word_id)?;
    }
    if let Some(sense) = senses::of(conn, word_id)? {
        keep(conn, &sense, word_id, &ts(now))?;
    }
    Ok(())
}

/// Takes back that the learner knows the word, in its sense.
pub fn unmark(conn: &Connection, word_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM known_words
         WHERE sense_id = (SELECT sense_id FROM chapter_words WHERE id = ?1)",
        [word_id],
    )?;
    Ok(())
}

/// Takes back that the learner knows a sense, by the id it is listed with.
/// One that is not known changes nothing.
pub fn forget(conn: &Connection, sense_id: &str) -> Result<()> {
    conn.execute("DELETE FROM known_words WHERE sense_id = ?1", [sense_id])?;
    Ok(())
}

/// A known sense of a key: its id, its kind, and what it meant when it was
/// marked or last had a word.
pub type Sense = (String, Option<PartOfSpeech>, Vec<String>);

/// The senses of a key the learner knows, the oldest mark first: a word of
/// no chapter may be all that is left of one.
pub fn senses_of(conn: &Connection, key: &str) -> Result<Vec<Sense>> {
    let mut stmt = conn.prepare_cached(
        "SELECT sense_id, part_of_speech, glosses FROM known_words
         WHERE key = ?1 AND glosses IS NOT NULL ORDER BY created_at, sense_id",
    )?;
    let rows = stmt
        .query_map([key], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<Vec<(String, _, String)>>>()?;
    rows.into_iter()
        .map(|(sense, kind, means)| Ok((sense, kind, serde_json::from_str(&means)?)))
        .collect()
}

/// What a known sense meant when it was marked or last had a word; nothing
/// for a mark that has no sense yet.
pub fn meant(conn: &Connection, sense_id: &str) -> Result<Vec<String>> {
    let means: Option<String> = conn
        .query_row(
            "SELECT glosses FROM known_words WHERE sense_id = ?1",
            [sense_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    Ok(means
        .map(|means| serde_json::from_str(&means))
        .transpose()?
        .unwrap_or_default())
}

/// Two senses became one (`senses::merge`): known in either, the word is
/// known in the one that is left, with what it means now.
pub fn moved(conn: &Connection, into: &str, from: &str) -> Result<()> {
    conn.execute(
        "UPDATE OR IGNORE known_words SET sense_id = ?1 WHERE sense_id = ?2",
        params![into, from],
    )?;
    forget(conn, from)?;
    let means = senses::glosses(conn, into)?;
    if !means.is_empty() {
        conn.execute(
            "UPDATE known_words SET glosses = ?2 WHERE sense_id = ?1",
            params![into, serde_json::to_string(&means)?],
        )?;
    }
    Ok(())
}

/// Whether a word just given its sense is one the learner knows. A mark
/// made before senses were, of a word no chapter had any more, is of the
/// first sense that comes: this one.
pub fn claim(conn: &Connection, word_id: &str) -> Result<bool> {
    if is(conn, word_id)? {
        return Ok(true);
    }
    let found: (String, Option<String>) = conn.query_row(
        "SELECT key, sense_id FROM chapter_words WHERE id = ?1",
        [word_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (key, Some(sense)) = found else {
        return Ok(false);
    };
    let since: Option<String> = conn
        .query_row(
            "DELETE FROM known_words WHERE sense_id = ?1 RETURNING created_at",
            [unbound(&key)],
            |row| row.get(0),
        )
        .optional()?;
    let Some(since) = since else {
        return Ok(false);
    };
    keep(conn, &sense, word_id, &since)?;
    Ok(true)
}

/// Gives every mark made before senses were the senses its key has, the
/// oldest word of each telling it apart; how many marks those were. The
/// learner said they knew the word, so they know all it means so far. A
/// mark no chapter has a word for waits for one ([`claim`]).
pub fn bind(conn: &Connection) -> Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT sense_id, key, created_at FROM known_words WHERE glosses IS NULL ORDER BY key",
    )?;
    let waiting = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<Vec<(String, String, String)>>>()?;
    let mut words = conn.prepare(
        "SELECT id, sense_id FROM chapter_words
         WHERE key = ?1 AND sense_id IS NOT NULL ORDER BY created_at, id",
    )?;
    let mut bound = 0_usize;
    for (mark, key, since) in waiting {
        let found = words
            .query_map([&key], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
        if found.is_empty() {
            continue;
        }
        forget(conn, &mark)?;
        for (word_id, sense) in found {
            keep(conn, &sense, &word_id, &since)?;
        }
        bound = bound.saturating_add(1);
    }
    Ok(bound)
}
