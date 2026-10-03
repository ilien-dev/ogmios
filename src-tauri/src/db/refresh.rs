//! Passes of the refresh before reading: a sitting of its own kind over a
//! chapter's done words. Which words a pass has asked is read off its
//! answers, like everything else about a word.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use super::practice::{SittingRow, NOT_KNOWN};
use super::{new_id, ts};
use crate::domain::RefreshSummary;
use crate::error::Result;

/// Starts a pass on a chapter; its id.
pub fn start(conn: &Connection, chapter_id: &str, now: DateTime<Utc>) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO practice_sittings (id, chapter_id, started_at, kind)
         VALUES (?1, ?2, ?3, 'refresh')",
        params![id, chapter_id, ts(now)],
    )?;
    Ok(id)
}

/// The chapter's latest pass, if it was left before it ran out of words.
pub fn unfinished(conn: &Connection, chapter_id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT id, finished_at IS NULL FROM practice_sittings
         WHERE chapter_id = ?1 AND kind = 'refresh'
         ORDER BY started_at DESC, rowid DESC LIMIT 1",
    )?;
    let mut rows = stmt.query_map([chapter_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
    })?;
    let latest = rows.next().transpose()?;
    Ok(latest.and_then(|(id, open)| open.then_some(id)))
}

/// The pass ran out of words: the next refresh starts over.
pub fn finish(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE practice_sittings SET finished_at = ?2 WHERE id = ?1",
        params![id, ts(now)],
    )?;
    Ok(())
}

/// The words the pass has yet to ask, most frequent in the chapter first:
/// the chapter's done words the learner has not said they know, less those
/// already answered in this pass. A word missed in the pass is not done, and
/// one practised back to done was answered in it: neither is asked twice.
pub fn left(conn: &Connection, pass: &SittingRow) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT w.id FROM chapter_words w
         WHERE w.chapter_id = ?1 AND w.done_at IS NOT NULL AND {NOT_KNOWN}
           AND w.id NOT IN (SELECT word_id FROM word_answers WHERE sitting_id = ?2)
         ORDER BY w.occurrences DESC, w.key"
    ))?;
    let ids = stmt
        .query_map(params![pass.chapter_id, pass.id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

/// How many words the pass has asked: each one it has an answer to.
pub fn asked(conn: &Connection, pass: &SittingRow) -> Result<u32> {
    Ok(conn.query_row(
        "SELECT COUNT(DISTINCT word_id) FROM word_answers WHERE sitting_id = ?1",
        [&pass.id],
        |row| row.get(0),
    )?)
}

/// How the pass stands: the words answered right in it, and the words
/// missed in it that are still back in practice, neither done again nor
/// known. A miss undone since is in neither.
pub fn summary(conn: &Connection, pass: &SittingRow) -> Result<RefreshSummary> {
    let solid = conn.query_row(
        "SELECT COUNT(DISTINCT word_id) FROM word_answers WHERE sitting_id = ?1 AND correct",
        [&pass.id],
        |row| row.get(0),
    )?;
    let reopened = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM chapter_words w
             WHERE w.done_at IS NULL AND {NOT_KNOWN}
               AND w.id IN (SELECT word_id FROM word_answers
                            WHERE sitting_id = ?1 AND NOT correct)"
        ),
        [&pass.id],
        |row| row.get(0),
    )?;
    Ok(RefreshSummary { solid, reopened })
}
