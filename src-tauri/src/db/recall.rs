//! The daily recall: the learned words, what happened to each since it was
//! learned, the runs that ask them, and the notes the learner keeps on the
//! ones that slip. How a word stands is counted from its events by
//! `memory::recall`, never kept.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::practice::NOT_KNOWN;
use super::{found, new_id, parse_ts, ts};
use crate::books::vocab;
use crate::domain::{Direction, Strength, Ways};
use crate::error::Result;
use crate::memory::recall::{is_stubborn, standing, strength, Event, Mark, Standing};

/// Where a learned word came from: what asking it needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// A word of a book, finished in the chapter this row of it is from:
    /// the first one it was finished in.
    Book { word_id: String },
    /// A word asked for in a conversation ("How do I say…?"), as the
    /// learner wrote it in their language.
    Chat { asked: String },
}

/// A learned word the learner has not said they know, and how it stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecallWord {
    pub key: String,
    /// Its base form in English.
    pub english: String,
    /// Every way it is written: the base form, and the forms of the book.
    pub forms: Vec<String>,
    pub learned_at: DateTime<Utc>,
    pub source: Source,
    /// It keeps slipping (`memory::recall::is_stubborn`).
    pub stubborn: bool,
    pub standing: Standing,
}

/// Misses in practice and in the refresh, by the word's key, in any chapter.
fn practice_misses(conn: &Connection) -> Result<HashMap<String, u32>> {
    let mut stmt = conn.prepare(
        "SELECT w.key, COUNT(*) FROM word_answers a
         JOIN chapter_words w ON w.id = a.word_id
         WHERE NOT a.correct GROUP BY w.key",
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every word's events, oldest first, by its key.
fn events(conn: &Connection) -> Result<HashMap<String, Vec<Event>>> {
    let mut stmt = conn.prepare("SELECT key, kind, created_at FROM word_events ORDER BY seq")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut all: HashMap<String, Vec<Event>> = HashMap::new();
    for (key, kind, at) in rows {
        if let Some(mark) = Mark::parse(&kind) {
            all.entry(key).or_default().push(Event {
                mark,
                at: parse_ts(&at)?,
            });
        }
    }
    Ok(all)
}

/// A learned word before it is known how it stands.
struct Found {
    key: String,
    english: String,
    forms: Vec<String>,
    learned_at: DateTime<Utc>,
    source: Source,
}

/// The words finished in a chapter, once each: as the first chapter that
/// finished them has them.
fn book_words(conn: &Connection) -> Result<Vec<Found>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT w.key, w.id, w.lemma, w.forms, w.learned_at FROM chapter_words w
         WHERE w.learned_at IS NOT NULL AND {NOT_KNOWN}
         ORDER BY w.learned_at, w.id"
    ))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut seen = HashSet::new();
    let mut words = Vec::new();
    for (key, word_id, lemma, forms, learned_at) in rows {
        if !seen.insert(key.clone()) {
            continue;
        }
        let mut forms: Vec<String> = serde_json::from_str(&forms)?;
        if !forms.contains(&lemma) {
            forms.push(lemma.clone());
        }
        words.push(Found {
            key,
            english: lemma,
            forms,
            learned_at: parse_ts(&learned_at)?,
            source: Source::Book { word_id },
        });
    }
    Ok(words)
}

/// The words asked for in conversations, once each, from the first time.
/// One the partner used has no translation to ask it by, and is not here.
fn chat_words(conn: &Connection) -> Result<Vec<Found>> {
    let mut stmt = conn.prepare(
        "SELECT asked, english, created_at FROM vocab
         WHERE asked IS NOT NULL ORDER BY created_at, rowid",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(asked, english, at)| {
            Ok(Found {
                key: vocab::key(&english),
                forms: vec![english.clone()],
                english,
                learned_at: parse_ts(&at)?,
                source: Source::Chat { asked },
            })
        })
        .collect()
}

fn known_keys(conn: &Connection) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT key FROM known_words")?;
    let keys = stmt.query_map([], |row| row.get(0))?;
    Ok(keys.collect::<rusqlite::Result<_>>()?)
}

/// Every learned word the learner has not said they know, with how it
/// stands: the words finished in the books, then the ones asked for in
/// conversations that no book has taught. In no order that matters.
pub fn words(conn: &Connection) -> Result<Vec<RecallWord>> {
    let misses = practice_misses(conn)?;
    let mut events = events(conn)?;
    let known = known_keys(conn)?;
    let mut seen = HashSet::new();
    let mut words = Vec::new();
    for word in book_words(conn)?.into_iter().chain(chat_words(conn)?) {
        if word.key.is_empty() || known.contains(&word.key) || !seen.insert(word.key.clone()) {
            continue;
        }
        let events = events.remove(&word.key).unwrap_or_default();
        let stubborn = is_stubborn(misses.get(&word.key).copied().unwrap_or(0), &events);
        words.push(RecallWord {
            standing: standing(word.learned_at, &events, stubborn),
            stubborn,
            key: word.key,
            english: word.english,
            forms: word.forms,
            learned_at: word.learned_at,
            source: word.source,
        });
    }
    Ok(words)
}

/// How strong each learned word is, by its key.
pub fn strengths(conn: &Connection) -> Result<HashMap<String, Strength>> {
    Ok(words(conn)?
        .into_iter()
        .map(|word| (word.key, strength(word.standing.step)))
        .collect())
}

/// A started run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRow {
    pub id: String,
    pub ways: Ways,
    /// It asked all it had to ask: it is over.
    pub finished: bool,
}

/// Starts a run that asks its words in `ways`; its id.
pub fn start(conn: &Connection, ways: Ways, now: DateTime<Utc>) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO recall_sittings (id, ways, started_at) VALUES (?1, ?2, ?3)",
        params![id, ways, ts(now)],
    )?;
    Ok(id)
}

pub fn run(conn: &Connection, id: &str) -> Result<RunRow> {
    let (ways, finished) = found(
        conn.query_row(
            "SELECT ways, finished_at IS NOT NULL FROM recall_sittings WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
        "recall",
    )?;
    Ok(RunRow {
        id: id.to_owned(),
        ways,
        finished,
    })
}

pub fn finish(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE recall_sittings SET finished_at = COALESCE(finished_at, ?2) WHERE id = ?1",
        params![id, ts(now)],
    )?;
    Ok(())
}

/// The answers of a run: how many were right, and how many were misses.
pub fn answered(conn: &Connection, run_id: &str) -> Result<(u32, u32)> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(kind = 'right'), 0), COALESCE(SUM(kind = 'miss'), 0)
         FROM word_events WHERE sitting_id = ?1",
        [run_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?)
}

/// Keeps one answer of a run.
pub fn record(
    conn: &Connection,
    run_id: &str,
    (key, direction): (&str, Direction),
    (answer, correct): (&str, bool),
    (sentence_id, now): (Option<&str>, DateTime<Utc>),
) -> Result<i64> {
    let mark = if correct { Mark::Right } else { Mark::Miss };
    conn.execute(
        "INSERT INTO word_events
           (key, kind, direction, answer, sitting_id, sentence_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            key,
            mark.as_str(),
            direction,
            answer,
            run_id,
            sentence_id,
            ts(now)
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// The sentence the last answer of a run was given to, when `seq` is that
/// answer and it was given to one.
pub fn latest_sentence(conn: &Connection, run_id: &str, seq: i64) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT sentence_id FROM word_events
             WHERE seq = ?2 AND sitting_id = ?1
               AND seq = (SELECT MAX(seq) FROM word_events WHERE sitting_id = ?1)",
            params![run_id, seq],
            |row| row.get(0),
        )
        .optional()?
        .flatten())
}

/// Takes an answer of a run back as if it had never been given, and with
/// it the end of the run, if it had ended.
pub fn void(conn: &Connection, run_id: &str, seq: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM word_events WHERE seq = ?2 AND sitting_id = ?1",
        params![run_id, seq],
    )?;
    conn.execute(
        "UPDATE recall_sittings SET finished_at = NULL WHERE id = ?1",
        [run_id],
    )?;
    Ok(())
}

/// The learner used the word in a conversation: once for each one.
pub fn used(conn: &Connection, key: &str, session_id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO word_events (key, kind, session_id, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![key, Mark::Used.as_str(), session_id, ts(now)],
    )?;
    Ok(())
}

/// The learner's note on a word, if they wrote one.
pub fn note(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT note FROM word_notes WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

/// Keeps the note of a word; an empty one takes it away.
pub fn save_note(conn: &Connection, key: &str, note: &str, now: DateTime<Utc>) -> Result<()> {
    let note = note.trim();
    if note.is_empty() {
        conn.execute("DELETE FROM word_notes WHERE key = ?1", [key])?;
    } else {
        conn.execute(
            "INSERT INTO word_notes (key, note, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (key) DO UPDATE SET note = ?2, updated_at = ?3",
            params![key, note, ts(now)],
        )?;
    }
    Ok(())
}

/// Fixes the learned words a conversation's partner is given, in order.
pub fn set_session_words(conn: &Connection, session_id: &str, words: &[RecallWord]) -> Result<()> {
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO session_words (session_id, key, english, rank)
         VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (rank, word) in words.iter().enumerate() {
        let rank = i64::try_from(rank).unwrap_or(i64::MAX);
        stmt.execute(params![session_id, word.key, word.english, rank])?;
    }
    Ok(())
}

/// The words a conversation's partner was given, in order.
pub fn session_words(conn: &Connection, session_id: &str) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT english FROM session_words WHERE session_id = ?1 ORDER BY rank")?;
    let words = stmt.query_map([session_id], |row| row.get(0))?;
    Ok(words.collect::<rusqlite::Result<_>>()?)
}

/// The forms of the learned words a chapter has, the ones the learner has
/// not said they know: what is marked where the book's English is shown.
pub fn learned_forms(conn: &Connection, chapter_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT w.lemma, w.forms FROM chapter_words w
         WHERE w.chapter_id = ?1 AND {NOT_KNOWN}
           AND w.key IN (SELECT key FROM chapter_words WHERE learned_at IS NOT NULL)"
    ))?;
    let rows = stmt
        .query_map([chapter_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut all = Vec::new();
    for (lemma, forms) in rows {
        all.push(lemma);
        all.extend(serde_json::from_str::<Vec<String>>(&forms)?);
    }
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::db::words::tests::{book, mark_known, word};
    use crate::db::words::{finish as prepare, list};
    use crate::domain::Depth;

    /// A word finished in its chapter at `at`.
    fn learn(conn: &Connection, chapter: &str, key: &str, at: &str) {
        let changed = conn
            .execute(
                "UPDATE chapter_words SET done_at = ?3, learned_at = ?3
                 WHERE chapter_id = ?1 AND key = ?2",
                params![chapter, key, at],
            )
            .expect("learned");
        assert_eq!(changed, 1);
    }

    #[test]
    fn a_chapter_marks_its_learned_words_and_says_how_strong_each_is() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one", "two"]);
        let mut peep = word("peep", &["asomarse"], 2);
        peep.forms = vec!["peeped".into()];
        let list_of = [
            peep,
            word("bank", &["orilla"], 1),
            word("hedge", &["seto"], 1),
        ];
        for chapter in &chapters {
            prepare(&conn, chapter, Depth::Most, &list_of, Utc::now()).expect("words");
        }
        learn(&conn, &chapters[0], "peep", "2026-03-01T10:00:00.000Z");
        learn(&conn, &chapters[0], "hedge", "2026-03-01T10:00:00.000Z");
        mark_known(&conn, "hedge");
        used(&conn, "peep", "none", Utc::now()).expect_err("no such conversation");
        conn.execute(
            "INSERT INTO word_events (key, kind, created_at)
             VALUES ('peep', 'right', '2026-03-02T10:00:00.000Z')",
            [],
        )
        .expect("event");

        // Learned in one chapter, marked in every chapter that has it.
        for chapter in &chapters {
            let mut forms = learned_forms(&conn, chapter).expect("forms");
            forms.sort();
            assert_eq!(forms, ["peep", "peeped"]);
        }
        let strong: Vec<(String, Option<Strength>)> = list(&conn, &chapters[1])
            .expect("list")
            .into_iter()
            .map(|word| (word.lemma, word.strength))
            .collect();
        assert_eq!(
            strong,
            [
                ("peep".to_owned(), Some(Strength::Settling)),
                ("bank".to_owned(), None),
                ("hedge".to_owned(), None)
            ]
        );
    }
}
