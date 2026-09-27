//! SQLite: one file in the app data directory, migrated on open.

pub mod drills;
pub mod patterns;
pub mod profile;
pub mod sessions;

use std::path::Path;

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::Connection;

use crate::error::{Error, Result};

/// Ordered migrations. Append only; never edit one that has shipped.
const MIGRATIONS: &[&str] = &[include_str!("schema.sql")];

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
}
