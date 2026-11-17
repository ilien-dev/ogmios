//! Where each word stands with its penalties (`books::penalty`), and which
//! one a chapter has due. Due is counted from the answers, not kept: a miss
//! taken back ("This sentence is bad", or "I was right" upheld) is no miss
//! towards a streak. Once a penalty has its first answer it is under way,
//! and stays due until it is answered through.

use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};

use crate::books::penalty::{streak, Standing, STREAK};
use crate::error::{Error, Result};

/// A word's row, or the one it would have: nothing behind it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PenaltyRow {
    pub word_id: String,
    pub standing: Standing,
    /// Answers up to this one make no streak: they were before the last
    /// penalty, or before there were penalties.
    pub since_seq: i64,
    /// The miss that made the penalty under way due; none while none is.
    pub trigger_seq: Option<i64>,
    /// Answers right in a row in the penalty under way.
    pub position: u32,
    /// How often it started over: each time is a new order.
    pub restarts: u32,
    /// The sitting it was last answered in.
    pub sitting_id: Option<String>,
}

/// A penalty a chapter has due: the word's row, and the miss it is due for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Due {
    pub row: PenaltyRow,
    pub trigger: i64,
}

fn day(text: Option<String>) -> Result<Option<NaiveDate>> {
    text.map(|text| {
        NaiveDate::parse_from_str(&text, "%Y-%m-%d")
            .map_err(|e| Error::Internal(format!("bad day {text}: {e}")))
    })
    .transpose()
}

/// The word's row, or a fresh one for a word that has none.
pub fn row(conn: &Connection, word_id: &str) -> Result<PenaltyRow> {
    let found = conn
        .query_row(
            "SELECT rung, clean, clean_on, since_seq, trigger_seq, position, restarts, sitting_id
             FROM word_penalties WHERE word_id = ?1",
            [word_id],
            |row| {
                Ok((
                    (row.get(0)?, row.get(1)?, row.get::<_, Option<String>>(2)?),
                    (row.get(3)?, row.get(4)?),
                    (row.get(5)?, row.get(6)?, row.get(7)?),
                ))
            },
        )
        .optional()?;
    let Some(((rung, clean, clean_on), (since_seq, trigger_seq), (position, restarts, sitting_id))) =
        found
    else {
        return Ok(PenaltyRow {
            word_id: word_id.to_owned(),
            ..PenaltyRow::default()
        });
    };
    Ok(PenaltyRow {
        word_id: word_id.to_owned(),
        standing: Standing {
            rung,
            clean,
            clean_on: day(clean_on)?,
        },
        since_seq,
        trigger_seq,
        position,
        restarts,
        sitting_id,
    })
}

/// Keeps the word's row as it is now.
pub fn save(conn: &Connection, row: &PenaltyRow) -> Result<()> {
    conn.execute(
        "INSERT INTO word_penalties
           (word_id, rung, clean, clean_on, since_seq, trigger_seq, position, restarts, sitting_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (word_id) DO UPDATE SET
           rung = ?2, clean = ?3, clean_on = ?4, since_seq = ?5, trigger_seq = ?6,
           position = ?7, restarts = ?8, sitting_id = ?9",
        params![
            row.word_id,
            row.standing.rung,
            row.standing.clean,
            row.standing
                .clean_on
                .map(|day| day.format("%Y-%m-%d").to_string()),
            row.since_seq,
            row.trigger_seq,
            row.position,
            row.restarts,
            row.sitting_id,
        ],
    )?;
    Ok(())
}

/// The misses in a row a word's answers in practice end on, given after
/// `since`, and the last of them: what a streak is counted from. A pass of
/// the refresh is no practice: it asks done words, and makes no penalty.
fn streak_of(conn: &Connection, word_id: &str, since: i64) -> Result<(u32, Option<i64>)> {
    let mut stmt = conn.prepare(
        "SELECT a.seq, a.correct FROM word_answers a
         JOIN practice_sittings s ON s.id = a.sitting_id
         WHERE a.word_id = ?1 AND a.seq > ?2 AND s.kind = 'practice'
         ORDER BY a.seq",
    )?;
    let answers = stmt
        .query_map(params![word_id, since], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, bool>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let correct: Vec<bool> = answers.iter().map(|(_, right)| *right).collect();
    let last = answers
        .last()
        .filter(|(_, right)| !right)
        .map(|(seq, _)| *seq);
    Ok((streak(&correct), last))
}

/// The penalty the chapter has due, if one is: one under way before any
/// other, then the one due longest. A word the learner said they know has
/// none.
pub fn due(conn: &Connection, chapter_id: &str) -> Result<Option<Due>> {
    let under_way: Option<String> = conn
        .query_row(
            "SELECT p.word_id FROM word_penalties p
             JOIN chapter_words w ON w.id = p.word_id
             WHERE w.chapter_id = ?1 AND p.trigger_seq IS NOT NULL
             ORDER BY p.trigger_seq LIMIT 1",
            [chapter_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(word_id) = under_way {
        let row = row(conn, &word_id)?;
        let trigger = row.trigger_seq.unwrap_or_default();
        return Ok(Some(Due { row, trigger }));
    }
    // A word whose last answer in practice is a miss given since its last
    // penalty: only those can end on a streak.
    let mut stmt = conn.prepare(
        "SELECT w.id FROM chapter_words w
         LEFT JOIN word_penalties p ON p.word_id = w.id
         WHERE w.chapter_id = ?1
           AND w.key NOT IN (SELECT key FROM known_words)
           AND EXISTS (
             SELECT 1 FROM word_answers a JOIN practice_sittings s ON s.id = a.sitting_id
             WHERE a.word_id = w.id AND s.kind = 'practice' AND NOT a.correct
               AND a.seq > COALESCE(p.since_seq, 0)
           )",
    )?;
    let words = stmt
        .query_map([chapter_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut found: Option<Due> = None;
    for word_id in words {
        let row = row(conn, &word_id)?;
        let (misses, last) = streak_of(conn, &word_id, row.since_seq)?;
        let Some(trigger) = last.filter(|_| misses >= STREAK) else {
            continue;
        };
        if found.as_ref().is_none_or(|held| trigger < held.trigger) {
            found = Some(Due { row, trigger });
        }
    }
    Ok(found)
}

/// Whether the answer `seq` is the first the word was given in its sitting.
pub fn is_first_in_sitting(conn: &Connection, word_id: &str, seq: i64) -> Result<bool> {
    let earlier: i64 = conn.query_row(
        "SELECT COUNT(*) FROM word_answers a
         WHERE a.word_id = ?1 AND a.seq < ?2
           AND a.sitting_id = (SELECT sitting_id FROM word_answers WHERE seq = ?2)",
        params![word_id, seq],
        |row| row.get(0),
    )?;
    Ok(earlier == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn a_word_with_no_row_stands_on_no_rung() {
        let conn = open_in_memory().expect("db");
        let fresh = row(&conn, "w").expect("row");
        assert_eq!(fresh.standing, Standing::default());
        assert_eq!(fresh.trigger_seq, None);
    }
}
