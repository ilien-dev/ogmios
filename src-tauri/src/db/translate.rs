//! The attempts at translating a chapter: what the learner wrote in each,
//! and what the model wrote for it: reviews, the versions translated back,
//! and the chapter's brief. Everything is kept by paragraph and sentence
//! number.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::{found, new_id, ts};
use crate::agent::protocol::ParagraphReview;
use crate::domain::{AttemptSummary, TranslationDirection};
use crate::error::Result;

/// One attempt as it is stored.
#[derive(Debug, Clone, PartialEq)]
pub struct AttemptRow {
    pub id: String,
    pub chapter_id: String,
    pub direction: TranslationDirection,
    pub started_at: String,
    /// It was finished: nothing more is written in it.
    pub finished: bool,
}

const ATTEMPT: &str = "SELECT id, chapter_id, direction, started_at, finished_at IS NOT NULL
     FROM translation_attempts";

fn attempt_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttemptRow> {
    Ok(AttemptRow {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        direction: row.get(2)?,
        started_at: row.get(3)?,
        finished: row.get(4)?,
    })
}

/// Whether the chapter's book keeps a paragraph a line: an EPUB does, a PDF
/// keeps the lines of its pages.
pub fn lines_are_blocks(conn: &Connection, chapter_id: &str) -> Result<bool> {
    let format: String = found(
        conn.query_row(
            "SELECT b.format FROM books b JOIN book_chapters c ON c.book_id = b.id
             WHERE c.id = ?1",
            [chapter_id],
            |row| row.get(0),
        ),
        "chapter",
    )?;
    Ok(format != "pdf")
}

/// Starts an attempt on a chapter; its id.
pub fn start(
    conn: &Connection,
    chapter_id: &str,
    direction: TranslationDirection,
    now: DateTime<Utc>,
) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO translation_attempts (id, chapter_id, direction, started_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, chapter_id, direction, ts(now)],
    )?;
    Ok(id)
}

pub fn attempt(conn: &Connection, id: &str) -> Result<AttemptRow> {
    found(
        conn.query_row(&format!("{ATTEMPT} WHERE id = ?1"), [id], attempt_row),
        "attempt",
    )
}

/// Every attempt at a chapter, the latest first.
pub fn attempts(conn: &Connection, chapter_id: &str) -> Result<Vec<AttemptRow>> {
    let mut stmt = conn.prepare(&format!(
        "{ATTEMPT} WHERE chapter_id = ?1 ORDER BY started_at DESC, rowid DESC"
    ))?;
    let rows = stmt.query_map([chapter_id], attempt_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The attempt is over; one already finished keeps the moment it was.
pub fn finish(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE translation_attempts SET finished_at = ?2
         WHERE id = ?1 AND finished_at IS NULL",
        params![id, ts(now)],
    )?;
    Ok(())
}

/// Forgets an attempt, and what was written in it.
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM translation_attempts WHERE id = ?1", [id])?;
    Ok(())
}

/// What the learner wrote in an attempt: by paragraph, its sentences in
/// order.
pub fn written(conn: &Connection, attempt_id: &str) -> Result<BTreeMap<u32, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT paragraph, text FROM attempt_sentences
         WHERE attempt_id = ?1 ORDER BY paragraph, sentence",
    )?;
    let rows = stmt.query_map([attempt_id], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut by_paragraph: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    for row in rows {
        let (paragraph, text) = row?;
        by_paragraph.entry(paragraph).or_default().push(text);
    }
    Ok(by_paragraph)
}

/// How many sentences of each paragraph the learner has written into their
/// own language, in the attempt that got furthest with it.
pub fn written_there(conn: &Connection, chapter_id: &str) -> Result<BTreeMap<u32, u32>> {
    let mut stmt = conn.prepare(
        "SELECT paragraph, MAX(sentences) FROM (
           SELECT s.paragraph AS paragraph, COUNT(*) AS sentences
           FROM attempt_sentences s JOIN translation_attempts a ON a.id = s.attempt_id
           WHERE a.chapter_id = ?1 AND a.direction = 'toNative'
           GROUP BY s.attempt_id, s.paragraph
         ) GROUP BY paragraph",
    )?;
    let rows = stmt.query_map([chapter_id], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, u32>(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Keeps one sentence; written again, the new text takes its place.
pub fn write(
    conn: &Connection,
    attempt_id: &str,
    (paragraph, sentence): (u32, u32),
    text: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO attempt_sentences (attempt_id, paragraph, sentence, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (attempt_id, paragraph, sentence)
         DO UPDATE SET text = excluded.text, created_at = excluded.created_at",
        params![attempt_id, paragraph, sentence, text, ts(now)],
    )?;
    Ok(())
}

/// The reviews of an attempt, by paragraph.
pub fn reviews(conn: &Connection, attempt_id: &str) -> Result<BTreeMap<u32, ParagraphReview>> {
    let mut stmt =
        conn.prepare("SELECT paragraph, review FROM attempt_reviews WHERE attempt_id = ?1")?;
    let rows = stmt.query_map([attempt_id], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut by_paragraph = BTreeMap::new();
    for row in rows {
        let (paragraph, review) = row?;
        by_paragraph.insert(paragraph, serde_json::from_str(&review)?);
    }
    Ok(by_paragraph)
}

/// Keeps the review of a paragraph. Asked twice at once, the first to
/// arrive is the one kept.
pub fn store_review(
    conn: &Connection,
    attempt_id: &str,
    paragraph: u32,
    review: &ParagraphReview,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO attempt_reviews (attempt_id, paragraph, review, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            attempt_id,
            paragraph,
            serde_json::to_string(review)?,
            ts(now)
        ],
    )?;
    Ok(())
}

/// The summary of an attempt, once it is written.
pub fn summary(conn: &Connection, attempt_id: &str) -> Result<Option<AttemptSummary>> {
    let kept: Option<String> = conn
        .query_row(
            "SELECT summary FROM attempt_summaries WHERE attempt_id = ?1",
            [attempt_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(kept.map(|json| serde_json::from_str(&json)).transpose()?)
}

/// Keeps the summary of an attempt; the first one stored stays.
pub fn store_summary(
    conn: &Connection,
    attempt_id: &str,
    summary: &AttemptSummary,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO attempt_summaries (attempt_id, summary, created_at)
         VALUES (?1, ?2, ?3)",
        params![attempt_id, serde_json::to_string(summary)?, ts(now)],
    )?;
    Ok(())
}

/// The paragraphs that have a version in this language, sentence by sentence.
pub fn versions(
    conn: &Connection,
    chapter_id: &str,
    native_lang: &str,
) -> Result<BTreeMap<u32, Vec<String>>> {
    let mut stmt = conn.prepare(
        "SELECT paragraph, sentences FROM paragraph_versions
         WHERE chapter_id = ?1 AND native_lang = ?2",
    )?;
    let rows = stmt.query_map(params![chapter_id, native_lang], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut by_paragraph = BTreeMap::new();
    for row in rows {
        let (paragraph, sentences) = row?;
        by_paragraph.insert(paragraph, serde_json::from_str(&sentences)?);
    }
    Ok(by_paragraph)
}

/// Keeps the version of a paragraph; the first one stored stays.
pub fn store_version(
    conn: &Connection,
    chapter_id: &str,
    native_lang: &str,
    paragraph: u32,
    sentences: &[String],
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO paragraph_versions
           (chapter_id, native_lang, paragraph, sentences, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            chapter_id,
            native_lang,
            paragraph,
            serde_json::to_string(sentences)?,
            ts(now)
        ],
    )?;
    Ok(())
}

pub fn brief(conn: &Connection, chapter_id: &str, native_lang: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT brief FROM chapter_briefs WHERE chapter_id = ?1 AND native_lang = ?2",
            params![chapter_id, native_lang],
            |row| row.get(0),
        )
        .optional()?)
}

/// Keeps the chapter's brief; the first one stored stays.
pub fn store_brief(
    conn: &Connection,
    chapter_id: &str,
    native_lang: &str,
    brief: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO chapter_briefs (chapter_id, native_lang, brief, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![chapter_id, native_lang, brief, ts(now)],
    )?;
    Ok(())
}
