//! Error patterns, their events, and the report items that point at them.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{found, new_id, parse_ts, parse_ts_opt, ts};
use crate::agent::protocol::Example;
use crate::domain::{CorrectionRole, ErrorKind, PatternState, PatternView};
use crate::error::{Error, Result};
use crate::memory::{self, Event, EventKind, PatternFacts};

#[derive(Debug, Clone, PartialEq)]
pub struct PatternRow {
    pub id: String,
    pub key: String,
    pub description: String,
    pub kind: ErrorKind,
    pub rule_based: bool,
    pub state: PatternState,
    pub last_seen_session: String,
    pub state_changed_at: DateTime<Utc>,
    pub focus_at: Option<DateTime<Utc>>,
    pub is_primary: bool,
    pub last_drill_at: Option<DateTime<Utc>>,
    pub next_review_at: Option<DateTime<Utc>>,
    pub review_step: u32,
}

impl PatternRow {
    pub fn facts(&self) -> PatternFacts {
        PatternFacts {
            state: self.state,
            state_changed_at: self.state_changed_at,
            focus_at: self.focus_at,
            last_drill_at: self.last_drill_at,
        }
    }

    /// Moves to `state` at `now`, keeping the bookkeeping that goes with it:
    /// entering focus or relapse starts a measurement window and a review
    /// schedule; leaving the active states ends both.
    pub fn set_state(&mut self, state: PatternState, now: DateTime<Utc>) {
        if state == self.state {
            return;
        }
        if matches!(state, PatternState::Focus | PatternState::Relapse) {
            self.focus_at = Some(now);
            let (step, due) = memory::first_review(now);
            self.review_step = step;
            self.next_review_at = Some(due);
        }
        if !memory::is_active(state) {
            self.next_review_at = None;
            self.review_step = 0;
        }
        if state != PatternState::Focus && state != PatternState::Relapse {
            self.is_primary = false;
        }
        self.state = state;
        self.state_changed_at = now;
    }
}

const PATTERN_COLUMNS: &str = "id, key, description, kind, rule_based, state, last_seen_session,
    state_changed_at, focus_at, is_primary, last_drill_at, next_review_at, review_step";

type RawPattern = (
    PatternRow,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn pattern_row(row: &Row<'_>) -> rusqlite::Result<RawPattern> {
    let epoch = DateTime::<Utc>::UNIX_EPOCH;
    Ok((
        PatternRow {
            id: row.get(0)?,
            key: row.get(1)?,
            description: row.get(2)?,
            kind: row.get(3)?,
            rule_based: row.get(4)?,
            state: row.get(5)?,
            last_seen_session: row.get(6)?,
            state_changed_at: epoch,
            focus_at: None,
            is_primary: row.get(9)?,
            last_drill_at: None,
            next_review_at: None,
            review_step: row.get(12)?,
        },
        row.get(7)?,
        row.get(8)?,
        row.get(10)?,
        row.get(11)?,
    ))
}

fn decode((mut row, changed, focus, drill, review): RawPattern) -> Result<PatternRow> {
    row.state_changed_at = parse_ts(&changed)?;
    row.focus_at = parse_ts_opt(focus.as_deref())?;
    row.last_drill_at = parse_ts_opt(drill.as_deref())?;
    row.next_review_at = parse_ts_opt(review.as_deref())?;
    Ok(row)
}

pub fn list_patterns(conn: &Connection) -> Result<Vec<PatternRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PATTERN_COLUMNS} FROM patterns ORDER BY rowid"
    ))?;
    let raw = stmt
        .query_map([], pattern_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    raw.into_iter().map(decode).collect()
}

pub fn get_pattern(conn: &Connection, id: &str) -> Result<PatternRow> {
    let raw = found(
        conn.query_row(
            &format!("SELECT {PATTERN_COLUMNS} FROM patterns WHERE id = ?1"),
            [id],
            pattern_row,
        ),
        "pattern",
    )?;
    decode(raw)
}

pub fn find_by_key(conn: &Connection, key: &str) -> Result<Option<PatternRow>> {
    let raw = conn
        .query_row(
            &format!("SELECT {PATTERN_COLUMNS} FROM patterns WHERE key = ?1"),
            [key],
            pattern_row,
        )
        .optional()?;
    raw.map(decode).transpose()
}

pub struct NewPattern<'a> {
    pub key: &'a str,
    pub description: &'a str,
    pub kind: ErrorKind,
    pub rule_based: bool,
    pub session_id: &'a str,
}

pub fn insert_pattern(
    conn: &Connection,
    new: &NewPattern<'_>,
    now: DateTime<Utc>,
) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO patterns (id, key, description, kind, rule_based, state, first_seen_session,
                               last_seen_session, state_changed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)",
        params![
            id,
            new.key,
            new.description,
            new.kind,
            new.rule_based,
            PatternState::Detected,
            new.session_id,
            ts(now)
        ],
    )?;
    Ok(id)
}

/// Writes every field that changes after creation.
pub fn update_pattern(conn: &Connection, p: &PatternRow) -> Result<()> {
    conn.execute(
        "UPDATE patterns SET state = ?2, last_seen_session = ?3, state_changed_at = ?4,
            focus_at = ?5, is_primary = ?6, last_drill_at = ?7, next_review_at = ?8,
            review_step = ?9
         WHERE id = ?1",
        params![
            p.id,
            p.state,
            p.last_seen_session,
            ts(p.state_changed_at),
            p.focus_at.map(ts),
            p.is_primary,
            p.last_drill_at.map(ts),
            p.next_review_at.map(ts),
            p.review_step
        ],
    )?;
    Ok(())
}

// ── Events ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct NewEvent<'a> {
    pub pattern_id: &'a str,
    pub session_id: Option<&'a str>,
    pub turn_id: Option<&'a str>,
    pub kind: EventKind,
    pub global: bool,
    pub above_level: bool,
    pub original: Option<&'a str>,
    pub corrected: Option<&'a str>,
}

pub fn insert_event(conn: &Connection, e: &NewEvent<'_>, at: DateTime<Utc>) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO pattern_events (id, pattern_id, session_id, turn_id, kind, global,
                                     above_level, original, corrected, created_at)
         VALUES (?1, ?2, ?3, (SELECT id FROM turns WHERE id = ?4), ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            e.pattern_id,
            e.session_id,
            e.turn_id,
            e.kind.as_str(),
            e.global,
            e.above_level,
            e.original,
            e.corrected,
            ts(at)
        ],
    )?;
    Ok(id)
}

/// An error event with what the report needs to show it.
#[derive(Debug, Clone, PartialEq)]
pub struct ErrorEvent {
    pub id: String,
    pub pattern_id: String,
    pub session_id: Option<String>,
    pub original: String,
    pub corrected: String,
    pub global: bool,
    pub above_level: bool,
}

const ERROR_EVENT_COLUMNS: &str = "id, pattern_id, session_id, COALESCE(original, ''),
    COALESCE(corrected, ''), global, above_level";

fn error_event_row(row: &Row<'_>) -> rusqlite::Result<ErrorEvent> {
    Ok(ErrorEvent {
        id: row.get(0)?,
        pattern_id: row.get(1)?,
        session_id: row.get(2)?,
        original: row.get(3)?,
        corrected: row.get(4)?,
        global: row.get(5)?,
        above_level: row.get(6)?,
    })
}

pub fn get_error_event(conn: &Connection, id: &str) -> Result<ErrorEvent> {
    found(
        conn.query_row(
            &format!("SELECT {ERROR_EVENT_COLUMNS} FROM pattern_events WHERE id = ?1"),
            [id],
            error_event_row,
        ),
        "event",
    )
}

/// Undisputed error events, newest first, across patterns or for one.
pub fn error_events(conn: &Connection, pattern_id: Option<&str>) -> Result<Vec<ErrorEvent>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ERROR_EVENT_COLUMNS} FROM pattern_events
         WHERE kind = 'error' AND disputed = 0 AND (?1 IS NULL OR pattern_id = ?1)
         ORDER BY created_at DESC, rowid DESC"
    ))?;
    let events = stmt
        .query_map([pattern_id], error_event_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(events)
}

pub fn examples(conn: &Connection, pattern_id: &str, limit: usize) -> Result<Vec<Example>> {
    Ok(error_events(conn, Some(pattern_id))?
        .into_iter()
        .filter(|e| !e.original.is_empty())
        .take(limit)
        .map(|e| Example {
            original: e.original,
            corrected: e.corrected,
        })
        .collect())
}

/// Every event, grouped by pattern, oldest first.
pub fn events_by_pattern(conn: &Connection) -> Result<HashMap<String, Vec<Event>>> {
    let mut stmt = conn.prepare(
        "SELECT pattern_id, kind, session_id, created_at, disputed FROM pattern_events
         ORDER BY created_at, rowid",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut map: HashMap<String, Vec<Event>> = HashMap::new();
    for (pattern_id, kind, session_id, at, disputed) in rows {
        let kind = EventKind::parse(&kind)
            .ok_or_else(|| Error::Internal(format!("unknown event kind {kind}")))?;
        map.entry(pattern_id).or_default().push(Event {
            kind,
            session_id,
            at: parse_ts(&at)?,
            disputed,
        });
    }
    Ok(map)
}

pub fn events_for(conn: &Connection, pattern_id: &str) -> Result<Vec<Event>> {
    Ok(events_by_pattern(conn)?
        .remove(pattern_id)
        .unwrap_or_default())
}

pub fn set_disputed(conn: &Connection, event_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE pattern_events SET disputed = 1 WHERE id = ?1",
        [event_id],
    )?;
    Ok(())
}

pub fn view(row: &PatternRow, events: &[Event]) -> PatternView {
    let sessions: HashSet<&str> = events
        .iter()
        .filter(|e| !e.disputed && !matches!(e.kind, EventKind::DrillOk | EventKind::DrillFail))
        .filter_map(|e| e.session_id.as_deref())
        .collect();
    PatternView {
        id: row.id.clone(),
        description: row.description.clone(),
        kind: row.kind,
        state: row.state,
        correct_rate: memory::stats(events).rate(),
        sessions_seen: u32::try_from(sessions.len()).unwrap_or(u32::MAX),
        next_review_at: row.next_review_at.map(ts),
    }
}

// ── Report items ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct ReportItem {
    pub id: String,
    pub session_id: String,
    pub pattern_id: String,
    pub event_id: String,
    pub role: CorrectionRole,
}

pub fn insert_report_item(conn: &Connection, item: &ReportItem) -> Result<()> {
    conn.execute(
        "INSERT INTO report_items (id, session_id, pattern_id, event_id, role)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            item.id,
            item.session_id,
            item.pattern_id,
            item.event_id,
            item.role
        ],
    )?;
    Ok(())
}

pub fn get_report_item(conn: &Connection, id: &str) -> Result<ReportItem> {
    found(
        conn.query_row(
            "SELECT id, session_id, pattern_id, event_id, role FROM report_items WHERE id = ?1",
            [id],
            |row| {
                Ok(ReportItem {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    pattern_id: row.get(2)?,
                    event_id: row.get(3)?,
                    role: row.get(4)?,
                })
            },
        ),
        "report item",
    )
}

pub fn record_attempt(conn: &Connection, id: &str, solved: bool) -> Result<()> {
    conn.execute(
        "UPDATE report_items SET attempts = attempts + 1, solved = MAX(solved, ?2) WHERE id = ?1",
        params![id, solved],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, sessions};

    #[test]
    fn patterns_events_and_items_round_trip() {
        let conn = open_in_memory().expect("db");
        let now = Utc::now();
        let session = sessions::insert_session(&conn, &sessions::tests::setup(), now).expect("s");
        let new = NewPattern {
            key: "present-perfect",
            description: "Present perfect",
            kind: ErrorKind::GrammarRule,
            rule_based: true,
            session_id: &session,
        };
        let id = insert_pattern(&conn, &new, now).expect("pattern");
        let mut row = find_by_key(&conn, "present-perfect")
            .expect("query")
            .expect("found");
        assert_eq!(row.state, PatternState::Detected);

        row.set_state(PatternState::Focus, now);
        row.is_primary = true;
        update_pattern(&conn, &row).expect("update");
        let back = get_pattern(&conn, &id).expect("read");
        assert_eq!(back.state, PatternState::Focus);
        assert!(back.is_primary);
        assert_eq!(back.review_step, 0);
        assert!(back.next_review_at.is_some());

        let event = NewEvent {
            pattern_id: &id,
            session_id: Some(&session),
            turn_id: Some("not-a-turn"),
            kind: EventKind::Error,
            global: true,
            above_level: false,
            original: Some("I have went"),
            corrected: Some("I went"),
        };
        let event_id = insert_event(&conn, &event, now).expect("event");
        assert_eq!(
            examples(&conn, &id, 3).expect("examples")[0].corrected,
            "I went"
        );

        let item = ReportItem {
            id: new_id(),
            session_id: session.clone(),
            pattern_id: id.clone(),
            event_id: event_id.clone(),
            role: CorrectionRole::Focus,
        };
        insert_report_item(&conn, &item).expect("item");
        assert_eq!(get_report_item(&conn, &item.id).expect("item"), item);
        record_attempt(&conn, &item.id, false).expect("attempt");

        set_disputed(&conn, &event_id).expect("dispute");
        assert!(error_events(&conn, Some(&id)).expect("errors").is_empty());
        let events = events_for(&conn, &id).expect("events");
        assert!(events[0].disputed);
        let view = view(&back, &events);
        assert_eq!(view.correct_rate, None);
        assert_eq!(view.sessions_seen, 0);
    }

    #[test]
    fn leaving_the_active_states_clears_the_schedule_and_primary() {
        let now = Utc::now();
        let mut row = PatternRow {
            id: "p".into(),
            key: "k".into(),
            description: "d".into(),
            kind: ErrorKind::Lexical,
            rule_based: false,
            state: PatternState::Detected,
            last_seen_session: "s".into(),
            state_changed_at: now,
            focus_at: None,
            is_primary: false,
            last_drill_at: None,
            next_review_at: None,
            review_step: 0,
        };
        row.set_state(PatternState::Focus, now);
        row.is_primary = true;
        row.set_state(PatternState::Improving, now);
        assert!(!row.is_primary);
        assert!(row.next_review_at.is_some());
        row.set_state(PatternState::Mastered, now);
        assert_eq!(row.next_review_at, None);
    }
}
