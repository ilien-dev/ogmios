//! Listening: where the reading aloud of a chapter was left, and the
//! dictations, with every sentence played and every word typed or missed.
//! How the learner hears at each pace and which words escape them are
//! counted from these rows (`listening`); nothing is cached.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::{found, ts};
use crate::domain::{Pace, StructureVerdict};
use crate::error::{Error, Result};
use crate::listening::{Heard, Planned, Word};

/// One dictation as it is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SittingRow {
    pub id: String,
    pub chapter_id: Option<String>,
    /// The pace it was started at.
    pub pace: Pace,
    pub started_at: String,
    pub finished: bool,
}

const SITTING: &str = "SELECT id, chapter_id, pace, started_at, finished_at IS NOT NULL
     FROM dictation_sittings";

fn sitting_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SittingRow> {
    Ok(SittingRow {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        pace: row.get(2)?,
        started_at: row.get(3)?,
        finished: row.get(4)?,
    })
}

/// A sentence to dictate, before it is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    pub planned: Planned,
    /// The place of the missed sentence it repeats.
    pub retry_of: Option<u32>,
}

/// What an answered sentence was worth.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Answered {
    pub verdict: StructureVerdict,
    pub heard: Heard,
}

/// One sentence of a dictation as it is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemRow {
    pub index: u32,
    pub item: NewItem,
    pub listens: u32,
    /// The pace it was first heard at, and the slowest since; none unheard.
    pub paces: Option<(Pace, Pace)>,
    /// None until it is answered.
    pub answered: Option<Answered>,
}

/// Starts a dictation under the id its sentences were drawn from.
pub fn start(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
    pace: Pace,
    items: &[NewItem],
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO dictation_sittings (id, chapter_id, pace, started_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, chapter_id, pace, ts(now)],
    )?;
    for item in items {
        append(conn, id, item)?;
    }
    Ok(())
}

/// Adds a sentence at the end of a dictation; its place.
pub fn append(conn: &Connection, sitting_id: &str, item: &NewItem) -> Result<u32> {
    let index: u32 = conn.query_row(
        "SELECT COALESCE(MAX(idx) + 1, 0) FROM dictation_items WHERE sitting_id = ?1",
        [sitting_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO dictation_items (sitting_id, idx, sentence, reinforces, retry_of)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            sitting_id,
            index,
            item.planned.sentence,
            item.planned.reinforces,
            item.retry_of
        ],
    )?;
    Ok(index)
}

pub fn sitting(conn: &Connection, id: &str) -> Result<SittingRow> {
    found(
        conn.query_row(&format!("{SITTING} WHERE id = ?1"), [id], sitting_row),
        "dictation",
    )
}

/// The dictations left before their end, the latest first.
pub fn unfinished(conn: &Connection) -> Result<Vec<SittingRow>> {
    let mut stmt = conn.prepare(&format!(
        "{SITTING} WHERE finished_at IS NULL ORDER BY started_at DESC, rowid DESC"
    ))?;
    let rows = stmt.query_map([], sitting_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The sentences of a dictation, in the order they are played.
pub fn items(conn: &Connection, sitting_id: &str) -> Result<Vec<ItemRow>> {
    let mut stmt = conn.prepare(
        "SELECT idx, sentence, reinforces, retry_of, listens, first_pace, pace, verdict,
                right, total
         FROM dictation_items WHERE sitting_id = ?1 ORDER BY idx",
    )?;
    let rows = stmt.query_map([sitting_id], |row| {
        let first: Option<Pace> = row.get(5)?;
        let pace: Option<Pace> = row.get(6)?;
        let verdict: Option<StructureVerdict> = row.get(7)?;
        let counted: Option<(u32, u32)> = row
            .get::<_, Option<u32>>(8)?
            .zip(row.get::<_, Option<u32>>(9)?);
        Ok(ItemRow {
            index: row.get(0)?,
            item: NewItem {
                planned: Planned {
                    sentence: row.get(1)?,
                    reinforces: row.get(2)?,
                },
                retry_of: row.get(3)?,
            },
            listens: row.get(4)?,
            paces: first.zip(pace),
            answered: verdict
                .zip(pace)
                .zip(counted)
                .map(|((verdict, pace), (right, total))| Answered {
                    verdict,
                    heard: Heard { pace, right, total },
                }),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The sentence at `index` was played at `pace`: once more, and at the
/// slowest pace so far. Only one still to be answered.
pub fn listen(conn: &Connection, sitting_id: &str, index: u32, pace: Pace) -> Result<()> {
    let slowest: Option<Pace> = found(
        conn.query_row(
            "SELECT pace FROM dictation_items
             WHERE sitting_id = ?1 AND idx = ?2 AND verdict IS NULL",
            params![sitting_id, index],
            |row| row.get(0),
        ),
        "sentence to listen to",
    )?;
    conn.execute(
        "UPDATE dictation_items
         SET listens = listens + 1, first_pace = COALESCE(first_pace, ?3), pace = ?4
         WHERE sitting_id = ?1 AND idx = ?2",
        params![
            sitting_id,
            index,
            pace,
            slowest.map_or(pace, |was| was.min(pace))
        ],
    )?;
    Ok(())
}

/// What the learner typed for a sentence, and what it was worth.
pub struct Answer<'a> {
    pub text: &'a str,
    pub answered: Answered,
    pub words: &'a [Word],
}

/// Keeps the answer to the sentence at `index`, and each of its words.
pub fn answer(
    conn: &Connection,
    sitting_id: &str,
    index: u32,
    answer: &Answer<'_>,
    now: DateTime<Utc>,
) -> Result<()> {
    let Answered { verdict, heard } = answer.answered;
    let kept = conn.execute(
        "UPDATE dictation_items
         SET answer = ?3, verdict = ?4, pace = ?5, right = ?6, total = ?7, answered_at = ?8
         WHERE sitting_id = ?1 AND idx = ?2 AND verdict IS NULL",
        params![
            sitting_id,
            index,
            answer.text,
            verdict,
            heard.pace,
            heard.right,
            heard.total,
            ts(now)
        ],
    )?;
    if kept == 0 {
        return Err(Error::Invalid("no sentence to answer".into()));
    }
    let mut insert = conn.prepare(
        "INSERT INTO dictation_words (sitting_id, idx, at, word, heard)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    let keyed = answer
        .words
        .iter()
        .filter_map(|word| Some((word.key.as_deref()?, word.heard)));
    for (at, (word, heard)) in keyed.enumerate() {
        insert.execute(params![
            sitting_id,
            index,
            u32::try_from(at).unwrap_or(u32::MAX),
            word,
            heard
        ])?;
    }
    Ok(())
}

pub fn finish(conn: &Connection, sitting_id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE dictation_sittings SET finished_at = ?2
         WHERE id = ?1 AND finished_at IS NULL",
        params![sitting_id, ts(now)],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, sitting_id: &str) -> Result<()> {
    conn.execute("DELETE FROM dictation_sittings WHERE id = ?1", [sitting_id])?;
    Ok(())
}

/// Every sentence dictated so far, answered or not.
pub fn asked(conn: &Connection) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT DISTINCT sentence FROM dictation_items")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every sentence answered, the latest first.
pub fn heard(conn: &Connection) -> Result<Vec<Heard>> {
    let mut stmt = conn.prepare(
        "SELECT pace, right, total FROM dictation_items
         WHERE verdict IS NOT NULL ORDER BY answered_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Heard {
            pace: row.get(0)?,
            right: row.get(1)?,
            total: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every word dictated and whether it was typed, the oldest first.
pub fn words(conn: &Connection) -> Result<Vec<(String, bool)>> {
    let mut stmt = conn.prepare(
        "SELECT w.word, w.heard FROM dictation_words w
         JOIN dictation_items i ON i.sitting_id = w.sitting_id AND i.idx = w.idx
         ORDER BY i.answered_at, i.rowid, w.at",
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The sentence the reading aloud of a chapter was left at; the first
/// before it was ever listened to.
pub fn place(conn: &Connection, chapter_id: &str) -> Result<u32> {
    Ok(conn
        .query_row(
            "SELECT sentence FROM listening_places WHERE chapter_id = ?1",
            [chapter_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0))
}

pub fn set_place(
    conn: &Connection,
    chapter_id: &str,
    sentence: u32,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO listening_places (chapter_id, sentence, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (chapter_id) DO UPDATE SET sentence = ?2, updated_at = ?3",
        params![chapter_id, sentence, ts(now)],
    )?;
    Ok(())
}

/// The book a chapter is of, and every chapter of it, in order.
pub fn book_of(conn: &Connection, chapter_id: &str) -> Result<(String, Vec<String>)> {
    let book_id: String = found(
        conn.query_row(
            "SELECT book_id FROM book_chapters WHERE id = ?1",
            [chapter_id],
            |row| row.get(0),
        ),
        "chapter",
    )?;
    let mut stmt = conn.prepare("SELECT id FROM book_chapters WHERE book_id = ?1 ORDER BY idx")?;
    let chapters = stmt
        .query_map([&book_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok((book_id, chapters))
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;
    use crate::db::open_in_memory;
    use crate::listening::compare;

    fn db() -> Connection {
        let conn = open_in_memory().expect("db");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, 'I', 3, 'He ran home.'), ('d', 'b', 1, 'II', 1, 'Yes.');",
        )
        .expect("rows");
        conn
    }

    fn item(sentence: &str) -> NewItem {
        NewItem {
            planned: Planned {
                sentence: sentence.into(),
                reinforces: None,
            },
            retry_of: None,
        }
    }

    #[test]
    fn a_dictation_keeps_its_sentences_how_they_were_heard_and_what_was_typed() {
        let conn = db();
        let now = Utc::now();
        let sentences = [item("He ran all the way home."), item("She did not.")];
        start(&conn, "s", "c", Pace::Fast, &sentences, now).expect("start");
        assert_eq!(sitting(&conn, "s").expect("row").pace, Pace::Fast);
        assert_eq!(unfinished(&conn).expect("open").len(), 1);

        // Heard fast, then slowed down, then fast again: the slowest stays.
        for pace in [Pace::Fast, Pace::Slow, Pace::Fast] {
            listen(&conn, "s", 0, pace).expect("listen");
        }
        let first = &items(&conn, "s").expect("items")[0];
        assert_eq!(first.listens, 3);
        assert_eq!(first.paces, Some((Pace::Fast, Pace::Slow)));
        assert_eq!(first.answered, None);

        let compared = compare("He ran all the way home.", "he ran the way home");
        let answered = Answered {
            verdict: StructureVerdict::Wrong,
            heard: Heard {
                pace: Pace::Slow,
                right: 5,
                total: 6,
            },
        };
        let kept = Answer {
            text: "he ran the way home",
            answered,
            words: &compared.words,
        };
        answer(&conn, "s", 0, &kept, now).expect("answer");
        assert_eq!(
            items(&conn, "s").expect("items")[0].answered,
            Some(answered)
        );
        assert!(matches!(
            listen(&conn, "s", 0, Pace::Slow),
            Err(Error::NotFound(_))
        ));
        assert!(matches!(
            answer(&conn, "s", 0, &kept, now),
            Err(Error::Invalid(_))
        ));
        assert_eq!(heard(&conn).expect("heard"), [answered.heard]);
        let typed = words(&conn).expect("words");
        assert_eq!(typed.len(), 6);
        assert_eq!(typed[2], ("all".to_owned(), false));
        assert!(asked(&conn).expect("asked").contains("She did not."));

        let back = append(
            &conn,
            "s",
            &NewItem {
                retry_of: Some(0),
                ..item("He ran all the way home.")
            },
        )
        .expect("append");
        assert_eq!(back, 2);

        finish(&conn, "s", now + Duration::minutes(1)).expect("finish");
        assert!(sitting(&conn, "s").expect("row").finished);
        assert_eq!(unfinished(&conn).expect("open"), []);

        // The book goes; what was heard stays.
        conn.execute("DELETE FROM books", []).expect("delete");
        assert_eq!(sitting(&conn, "s").expect("row").chapter_id, None);
        assert_eq!(heard(&conn).expect("heard").len(), 1);

        delete(&conn, "s").expect("delete");
        assert_eq!(words(&conn).expect("words"), []);
    }

    #[test]
    fn the_place_in_a_chapter_is_the_last_one_kept() {
        let conn = db();
        assert_eq!(place(&conn, "c").expect("place"), 0);
        set_place(&conn, "c", 4, Utc::now()).expect("set");
        set_place(&conn, "c", 9, Utc::now()).expect("set");
        assert_eq!(place(&conn, "c").expect("place"), 9);
        assert_eq!(place(&conn, "d").expect("place"), 0);
        assert_eq!(
            book_of(&conn, "d").expect("book"),
            ("b".to_owned(), vec!["c".to_owned(), "d".to_owned()])
        );
    }
}
