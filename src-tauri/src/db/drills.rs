//! Drills. Items keep their model answers here, server side; the webview
//! only ever sees them after grading.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::{found, new_id, ts};
use crate::agent::protocol::GeneratedDrillItem;
use crate::domain::DrillFormat;
use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredItem {
    pub item: GeneratedDrillItem,
    /// The index of the missed item this one replaces.
    pub retry_of: Option<u32>,
    pub correct: Option<bool>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DrillRow {
    pub id: String,
    pub pattern_id: Option<String>,
    pub format: DrillFormat,
    pub items: Vec<StoredItem>,
}

pub fn insert_drill(
    conn: &Connection,
    pattern_id: &str,
    format: DrillFormat,
    items: &[StoredItem],
    now: DateTime<Utc>,
) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO drills (id, pattern_id, format, created_at, items)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            pattern_id,
            format,
            ts(now),
            serde_json::to_string(items)?
        ],
    )?;
    Ok(id)
}

pub fn get_drill(conn: &Connection, id: &str) -> Result<DrillRow> {
    let (row, items) = found(
        conn.query_row(
            "SELECT id, pattern_id, format, items FROM drills WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    DrillRow {
                        id: row.get(0)?,
                        pattern_id: row.get(1)?,
                        format: row.get(2)?,
                        items: Vec::new(),
                    },
                    row.get::<_, String>(3)?,
                ))
            },
        ),
        "drill",
    )?;
    Ok(DrillRow {
        items: serde_json::from_str(&items)?,
        ..row
    })
}

pub fn save_items(conn: &Connection, id: &str, items: &[StoredItem]) -> Result<()> {
    conn.execute(
        "UPDATE drills SET items = ?2 WHERE id = ?1",
        params![id, serde_json::to_string(items)?],
    )?;
    Ok(())
}

/// Drills done on a pattern, to rotate through the formats.
pub fn count_for(conn: &Connection, pattern_id: &str) -> Result<u32> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM drills WHERE pattern_id = ?1",
        [pattern_id],
        |row| row.get(0),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn drills_round_trip() {
        let conn = open_in_memory().expect("db");
        conn.execute(
            "INSERT INTO patterns (id, key, description, kind, rule_based, state,
                                   first_seen_session, last_seen_session, state_changed_at)
             VALUES ('p', 'k', 'd', 'lexical', 0, 'focus', 's', 's', 'x')",
            [],
        )
        .expect("pattern");
        let item = StoredItem {
            item: GeneratedDrillItem {
                format: DrillFormat::Transformation,
                pattern_id: "p".into(),
                prompt: "I go there yesterday.".into(),
                instruction: "Pásala a pasado".into(),
                options: vec![],
                answer: "I went there yesterday.".into(),
            },
            retry_of: None,
            correct: None,
        };
        let id = insert_drill(
            &conn,
            "p",
            DrillFormat::Transformation,
            std::slice::from_ref(&item),
            Utc::now(),
        )
        .expect("insert");
        let mut row = get_drill(&conn, &id).expect("read");
        assert_eq!(row.items, [item]);
        row.items[0].correct = Some(true);
        save_items(&conn, &id, &row.items).expect("save");
        assert_eq!(
            get_drill(&conn, &id).expect("read").items[0].correct,
            Some(true)
        );
        assert_eq!(count_for(&conn, "p").expect("count"), 1);
    }
}
