//! SQLite: one file in the app data directory, migrated on open.

pub mod books;
pub mod drills;
pub mod patterns;
pub mod practice;
pub mod profile;
pub mod refresh;
pub mod sessions;
pub mod words;

use std::path::Path;

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::Connection;

use crate::error::{Error, Result};

/// Ordered migrations. Append only; never edit one that has shipped.
const MIGRATIONS: &[&str] = &[
    include_str!("schema.sql"),
    include_str!("books.sql"),
    include_str!("vocab.sql"),
    include_str!("practice.sql"),
    include_str!("dispute.sql"),
    include_str!("refresh.sql"),
    include_str!("session.sql"),
    include_str!("chapters.sql"),
    include_str!("review.sql"),
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    prepare(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    prepare(&conn)?;
    Ok(conn)
}

fn prepare(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrate(conn)
}

fn migrate(conn: &Connection) -> Result<()> {
    let applied: usize = conn
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map(|v| usize::try_from(v).unwrap_or(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(applied) {
        conn.execute_batch(&format!("BEGIN; {sql} COMMIT;"))?;
        conn.pragma_update(
            None,
            "user_version",
            i64::try_from(index + 1).unwrap_or(i64::MAX),
        )?;
    }
    Ok(())
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Fixed-width RFC 3339, so timestamps sort as text in SQL.
pub fn ts(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn parse_ts(text: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|e| Error::Internal(format!("bad timestamp {text}: {e}")))
}

pub fn parse_ts_opt(text: Option<&str>) -> Result<Option<DateTime<Utc>>> {
    text.map(parse_ts).transpose()
}

/// Turns "no rows" into a `NotFound` naming what was missing.
pub fn found<T>(result: rusqlite::Result<T>, what: &str) -> Result<T> {
    match result {
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(Error::NotFound(format!("{what} not found")))
        }
        other => Ok(other?),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_a_fresh_database_and_is_idempotent() {
        let conn = open_in_memory().expect("open");
        migrate(&conn).expect("migrate again");
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version");
        assert_eq!(version, i64::try_from(MIGRATIONS.len()).expect("small"));
    }

    #[test]
    fn migration_seven_closes_the_sittings_that_had_no_words_of_their_own() {
        let conn = Connection::open_in_memory().expect("open");
        // As the database stood when a sitting was ended by the clock.
        for sql in &MIGRATIONS[..6] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 6)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, '', 1, 'text');
             INSERT INTO practice_sittings (id, chapter_id, started_at)
               VALUES ('old', 'c', '2026-03-01T10:00:00.000Z');
             INSERT INTO practice_sittings (id, chapter_id, started_at, kind)
               VALUES ('pass', 'c', '2026-03-02T10:00:00.000Z', 'refresh');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let finished = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT finished_at FROM practice_sittings WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("sitting")
        };
        assert_eq!(finished("old").as_deref(), Some("2026-03-01T10:00:00.000Z"));
        assert_eq!(finished("pass"), None, "a refresh is not touched");
        assert_eq!(practice::unfinished(&conn, "c").expect("unfinished"), None);
    }

    #[test]
    fn migration_nine_takes_the_words_done_before_as_learned() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..8] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 8)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, '', 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, done_at,
                created_at)
             VALUES ('done', 'c', 'peep', 'peep', '[]', 'She peeped.', 1, 'most',
                     '2026-03-01T10:00:00.000Z', '2026-01-01'),
                    ('open', 'c', 'bank', 'bank', '[]', 'The bank.', 1, 'most', NULL,
                     '2026-01-01');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let learned = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT learned_at FROM chapter_words WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("word")
        };
        assert_eq!(learned("done").as_deref(), Some("2026-03-01T10:00:00.000Z"));
        assert_eq!(learned("open"), None);
    }

    #[test]
    fn migration_eight_drops_the_front_matter_stored_before_with_what_hung_on_it() {
        let conn = Connection::open_in_memory().expect("open");
        conn.pragma_update(None, "foreign_keys", "ON")
            .expect("foreign keys");
        // As the database stood when a book kept its cover and its contents.
        for sql in &MIGRATIONS[..7] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 7)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO books VALUES ('f', 'Leaflet', NULL, 'epub', 'i', 'g', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, front_matter, words, text) VALUES
               ('cover', 'b', 0, '', 1, 1, 'text'),
               ('one', 'b', 1, 'I', 0, 1, 'text'),
               ('contents', 'b', 2, 'Contents', 1, 1, 'text'),
               ('two', 'b', 3, 'II', 0, 1, 'text'),
               ('only', 'f', 0, 'Cover', 1, 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, created_at)
             VALUES ('w', 'contents', 'string', 'string', '[]', 'Strings', 1, 'most', '2026-01-01'),
                    ('kept', 'two', 'peep', 'peep', '[]', 'She peeped.', 1, 'most', '2026-01-01');
             INSERT INTO practice_sittings (id, chapter_id, started_at)
               VALUES ('s', 'contents', '2026-03-01T10:00:00.000Z');
             INSERT INTO word_answers (word_id, direction, sitting_id, answer, correct, created_at)
               VALUES ('w', 'recognition', 's', 'cadena', 0, '2026-03-01T10:00:00.000Z');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let mut stmt = conn
            .prepare("SELECT book_id, idx, id FROM book_chapters ORDER BY book_id, idx")
            .expect("chapters");
        let left = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("rows")
            .collect::<rusqlite::Result<Vec<(String, i64, String)>>>()
            .expect("chapters");
        let left: Vec<_> = left
            .iter()
            .map(|(book, idx, id)| (book.as_str(), *idx, id.as_str()))
            .collect();
        // A book of nothing but front matter keeps what it has.
        assert_eq!(left, [("b", 0, "one"), ("b", 1, "two"), ("f", 0, "only")]);
        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count")
        };
        assert_eq!(count("chapter_words"), 1);
        assert_eq!(count("practice_sittings"), 0);
        assert_eq!(count("word_answers"), 0);
        assert_eq!(books::get_book(&conn, "b").expect("book").chapters.len(), 2);
    }
}
