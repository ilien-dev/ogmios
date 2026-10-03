//! Sessions, their turns, and what a session leaves behind: vocabulary, best
//! sentences, challenges and practice days.

use std::collections::BTreeSet;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{found, new_id, parse_ts, parse_ts_opt, ts};
use crate::domain::{Cefr, Report, Role, SessionMetrics, SessionSetup, Turn, VocabItem};
use crate::error::Result;

#[derive(Debug, Clone, PartialEq)]
pub struct SessionRow {
    pub id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub setup: SessionSetup,
    pub provider_ref: Option<String>,
    pub speech_minutes: f64,
    pub target_notified: bool,
    pub estimated_cefr: Option<Cefr>,
    pub metrics: Option<SessionMetrics>,
    pub report: Option<Report>,
}

const SESSION_COLUMNS: &str = "id, started_at, ended_at, setup, provider_ref, speech_minutes,
    target_notified, estimated_cefr, metrics, report";

/// A row before its JSON and timestamp columns are decoded, which happens
/// outside the rusqlite closure so those errors keep their own kind.
struct RawSession {
    id: String,
    started_at: String,
    ended_at: Option<String>,
    setup: String,
    provider_ref: Option<String>,
    speech_minutes: f64,
    target_notified: bool,
    estimated_cefr: Option<Cefr>,
    metrics: Option<String>,
    report: Option<String>,
}

fn session_row(row: &Row<'_>) -> rusqlite::Result<RawSession> {
    Ok(RawSession {
        id: row.get(0)?,
        started_at: row.get(1)?,
        ended_at: row.get(2)?,
        setup: row.get(3)?,
        provider_ref: row.get(4)?,
        speech_minutes: row.get(5)?,
        target_notified: row.get(6)?,
        estimated_cefr: row.get(7)?,
        metrics: row.get(8)?,
        report: row.get(9)?,
    })
}

fn decode(raw: RawSession) -> Result<SessionRow> {
    Ok(SessionRow {
        id: raw.id,
        started_at: parse_ts(&raw.started_at)?,
        ended_at: parse_ts_opt(raw.ended_at.as_deref())?,
        setup: serde_json::from_str(&raw.setup)?,
        provider_ref: raw.provider_ref,
        speech_minutes: raw.speech_minutes,
        target_notified: raw.target_notified,
        estimated_cefr: raw.estimated_cefr,
        metrics: raw
            .metrics
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?,
        report: raw
            .report
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?,
    })
}

pub fn insert_session(
    conn: &Connection,
    setup: &SessionSetup,
    now: DateTime<Utc>,
) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO sessions (id, started_at, setup, topic, level, mode)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            ts(now),
            serde_json::to_string(setup)?,
            setup.topic,
            setup.level,
            setup.mode
        ],
    )?;
    Ok(id)
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    Ok(())
}

pub fn get_session(conn: &Connection, id: &str) -> Result<SessionRow> {
    let raw = found(
        conn.query_row(
            &format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id = ?1"),
            [id],
            session_row,
        ),
        "session",
    )?;
    decode(raw)
}

/// Every session, newest first.
pub fn list_sessions(conn: &Connection) -> Result<Vec<SessionRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS} FROM sessions ORDER BY started_at DESC, rowid DESC"
    ))?;
    let raw = stmt
        .query_map([], session_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    raw.into_iter().map(decode).collect()
}

pub fn set_provider_ref(conn: &Connection, id: &str, provider_ref: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET provider_ref = ?2 WHERE id = ?1",
        params![id, provider_ref],
    )?;
    Ok(())
}

pub fn set_speech(conn: &Connection, id: &str, minutes: f64, target_notified: bool) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET speech_minutes = ?2, target_notified = ?3 WHERE id = ?1",
        params![id, minutes, target_notified],
    )?;
    Ok(())
}

pub fn save_analysis(conn: &Connection, id: &str, analysis: &str) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET analysis = ?2 WHERE id = ?1",
        params![id, analysis],
    )?;
    Ok(())
}

/// Records what the memory update decided; see `commands::session::end`.
pub fn save_applied(conn: &Connection, id: &str, applied: &str) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET applied = ?2 WHERE id = ?1",
        params![id, applied],
    )?;
    Ok(())
}

/// The stored analysis and what was applied from it, once both exist.
pub fn get_applied(conn: &Connection, id: &str) -> Result<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT analysis, applied FROM sessions
             WHERE id = ?1 AND analysis IS NOT NULL AND applied IS NOT NULL",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

pub fn finish_session(
    conn: &Connection,
    id: &str,
    ended_at: DateTime<Utc>,
    cefr: Option<Cefr>,
    metrics: &SessionMetrics,
    report: &Report,
) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET ended_at = ?2, estimated_cefr = ?3, metrics = ?4, report = ?5
         WHERE id = ?1",
        params![
            id,
            ts(ended_at),
            cefr,
            serde_json::to_string(metrics)?,
            serde_json::to_string(report)?
        ],
    )?;
    Ok(())
}

// ── Turns ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct NewTurn<'a> {
    pub session_id: &'a str,
    pub role: Role,
    pub said_text: Option<&'a str>,
    pub sent_text: &'a str,
    pub audio_id: Option<&'a str>,
    pub speech_seconds: Option<f64>,
    pub words: u32,
}

pub fn insert_turn(conn: &Connection, turn: &NewTurn<'_>, now: DateTime<Utc>) -> Result<Turn> {
    let id = new_id();
    conn.execute(
        "INSERT INTO turns (id, session_id, idx, role, said_text, sent_text, audio_id,
                            speech_seconds, words, created_at)
         VALUES (?1, ?2,
                 (SELECT COALESCE(MAX(idx), -1) + 1 FROM turns WHERE session_id = ?2),
                 ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            turn.session_id,
            turn.role,
            turn.said_text,
            turn.sent_text,
            turn.audio_id,
            turn.speech_seconds,
            turn.words,
            ts(now)
        ],
    )?;
    Ok(Turn {
        id,
        role: turn.role,
        sent_text: turn.sent_text.to_owned(),
        said_text: turn.said_text.map(str::to_owned),
        speech_seconds: turn.speech_seconds,
        words: turn.words,
    })
}

/// A session's turns in order.
pub fn list_turns(conn: &Connection, session_id: &str) -> Result<Vec<Turn>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, sent_text, said_text, speech_seconds, words
         FROM turns WHERE session_id = ?1 ORDER BY idx",
    )?;
    let turns = stmt
        .query_map([session_id], |row| {
            Ok(Turn {
                id: row.get(0)?,
                role: row.get(1)?,
                sent_text: row.get(2)?,
                said_text: row.get(3)?,
                speech_seconds: row.get(4)?,
                words: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(turns)
}

/// The partner's opening line in each session started before `before`,
/// newest first.
pub fn recent_openings(
    conn: &Connection,
    before: DateTime<Utc>,
    limit: u32,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.sent_text FROM turns t JOIN sessions s ON s.id = t.session_id
         WHERE t.idx = 0 AND s.started_at < ?1
         ORDER BY s.started_at DESC, s.rowid DESC LIMIT ?2",
    )?;
    let openings = stmt
        .query_map(params![ts(before), limit], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(openings)
}

/// Id and topic of the latest session started before `before` in which the
/// learner said something: an abandoned one is nothing to continue.
pub fn previous_conversation(
    conn: &Connection,
    before: DateTime<Utc>,
) -> Result<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT s.id, s.topic FROM sessions s
             WHERE s.started_at < ?1
               AND EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id AND t.role = ?2)
             ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1",
            params![ts(before), Role::User],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

/// Audio ids of one session, or of every session.
pub fn audio_ids(conn: &Connection, session_id: Option<&str>) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT audio_id FROM turns
         WHERE audio_id IS NOT NULL AND (?1 IS NULL OR session_id = ?1)",
    )?;
    let ids = stmt
        .query_map([session_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

pub fn clear_audio(conn: &Connection, session_id: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE turns SET audio_id = NULL WHERE ?1 IS NULL OR session_id = ?1",
        [session_id],
    )?;
    Ok(())
}

// ── Vocabulary and best sentences ─────────────────────────────────────────

pub fn insert_vocab(
    conn: &Connection,
    session_id: &str,
    item: &VocabItem,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO vocab (id, session_id, asked, english, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            new_id(),
            session_id,
            item.asked,
            item.english,
            item.note,
            ts(now)
        ],
    )?;
    Ok(())
}

/// Oldest first, for one session or for all of them.
pub fn list_vocab(
    conn: &Connection,
    session_id: Option<&str>,
) -> Result<Vec<(VocabItem, DateTime<Utc>)>> {
    let mut stmt = conn.prepare(
        "SELECT asked, english, note, created_at FROM vocab
         WHERE ?1 IS NULL OR session_id = ?1 ORDER BY created_at, rowid",
    )?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok((
                VocabItem {
                    asked: row.get(0)?,
                    english: row.get(1)?,
                    note: row.get(2)?,
                },
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(item, at)| Ok((item, parse_ts(&at)?)))
        .collect()
}

pub fn insert_best_sentence(
    conn: &Connection,
    session_id: &str,
    turn_id: Option<&str>,
    text: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO best_sentences (id, session_id, turn_id, text, created_at)
         VALUES (?1, ?2, (SELECT id FROM turns WHERE id = ?3), ?4, ?5)",
        params![new_id(), session_id, turn_id, text, ts(now)],
    )?;
    Ok(())
}

pub fn list_best_sentences(conn: &Connection) -> Result<Vec<(String, DateTime<Utc>)>> {
    let mut stmt =
        conn.prepare("SELECT text, created_at FROM best_sentences ORDER BY created_at, rowid")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(text, at)| Ok((text, parse_ts(&at)?)))
        .collect()
}

// ── Challenges ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Challenge {
    pub id: String,
    pub pattern_id: Option<String>,
    pub text: String,
}

/// The newest challenge not yet checked by an analysis.
pub fn active_challenge(conn: &Connection) -> Result<Option<Challenge>> {
    Ok(conn
        .query_row(
            "SELECT c.id, c.pattern_id, c.text FROM challenges c
             JOIN sessions s ON s.id = c.created_session_id
             WHERE c.checked = 0 ORDER BY s.started_at DESC, c.rowid DESC LIMIT 1",
            [],
            |row| {
                Ok(Challenge {
                    id: row.get(0)?,
                    pattern_id: row.get(1)?,
                    text: row.get(2)?,
                })
            },
        )
        .optional()?)
}

pub fn insert_challenge(
    conn: &Connection,
    session_id: &str,
    pattern_id: Option<&str>,
    text: &str,
    target_count: u32,
) -> Result<()> {
    conn.execute(
        "INSERT INTO challenges (id, created_session_id, pattern_id, text, target_count)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), session_id, pattern_id, text, target_count],
    )?;
    Ok(())
}

pub fn close_challenge(conn: &Connection, id: &str, achieved_in: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE challenges SET checked = 1, achieved_session_id = ?2 WHERE id = ?1",
        params![id, achieved_in],
    )?;
    Ok(())
}

// ── Practice days ─────────────────────────────────────────────────────────

pub fn mark_practice(conn: &Connection, day: NaiveDate) -> Result<()> {
    conn.execute(
        "INSERT INTO practice_days (date, sessions) VALUES (?1, 1)
         ON CONFLICT (date) DO UPDATE SET sessions = sessions + 1",
        [day.to_string()],
    )?;
    Ok(())
}

/// Takes back one session's `mark_practice`; a day left with none is no
/// longer a practised one.
pub fn unmark_practice(conn: &Connection, day: NaiveDate) -> Result<()> {
    let day = day.to_string();
    conn.execute(
        "UPDATE practice_days SET sessions = sessions - 1 WHERE date = ?1",
        [&day],
    )?;
    conn.execute(
        "DELETE FROM practice_days WHERE date = ?1 AND sessions <= 0",
        [&day],
    )?;
    Ok(())
}

pub fn practice_days(conn: &Connection) -> Result<BTreeSet<NaiveDate>> {
    let mut stmt = conn.prepare("SELECT date FROM practice_days")?;
    let days = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(days.iter().filter_map(|d| d.parse().ok()).collect())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::domain::{FocusMode, Level, Mode, Personality, ReportCard};

    pub fn setup() -> SessionSetup {
        SessionSetup {
            topic: "My job".into(),
            level: Level::Intermediate,
            mode: Mode::Casual,
            personality: Personality::CuriousFriend,
            focus_mode: FocusMode::Free,
            target_minutes: Some(10.0),
            material: None,
            continue_previous: false,
        }
    }

    fn turn<'a>(session_id: &'a str, role: Role, text: &'a str) -> NewTurn<'a> {
        NewTurn {
            session_id,
            role,
            said_text: None,
            sent_text: text,
            audio_id: None,
            speech_seconds: None,
            words: 2,
        }
    }

    #[test]
    fn session_and_turns_round_trip() {
        let conn = open_in_memory().expect("db");
        let now = Utc::now();
        let id = insert_session(&conn, &setup(), now).expect("insert");
        insert_turn(&conn, &turn(&id, Role::Assistant, "Hi there"), now).expect("t0");
        let mut voiced = turn(&id, Role::User, "Hello you");
        voiced.said_text = Some("Hallo you");
        voiced.audio_id = Some("a1");
        voiced.speech_seconds = Some(1.5);
        insert_turn(&conn, &voiced, now).expect("t1");
        let turns = list_turns(&conn, &id).expect("turns");
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[1].said_text.as_deref(), Some("Hallo you"));
        assert_eq!(audio_ids(&conn, Some(&id)).expect("audio"), ["a1"]);
        clear_audio(&conn, None).expect("clear");
        assert_eq!(audio_ids(&conn, None).expect("audio"), [] as [String; 0]);

        set_speech(&conn, &id, 2.5, true).expect("speech");
        let report = Report {
            session_id: id.clone(),
            cards: vec![ReportCard::Vocabulary { items: vec![] }],
        };
        let metrics = crate::metrics::compute(&[], 0, &crate::metrics::AnalysisCounts::default());
        finish_session(&conn, &id, now, Some(Cefr::B1), &metrics, &report).expect("finish");
        let row = get_session(&conn, &id).expect("row");
        assert!(row.target_notified);
        assert!((row.speech_minutes - 2.5).abs() < 1e-9);
        assert_eq!(row.estimated_cefr, Some(Cefr::B1));
        assert_eq!(row.report, Some(report));
        assert_eq!(row.setup, setup());
        assert_eq!(
            get_session(&conn, "nope").expect_err("missing").kind(),
            "notFound"
        );
    }

    #[test]
    fn recent_openings_are_newest_first_and_stop_before_the_session() {
        let conn = open_in_memory().expect("db");
        let t0 = Utc::now();
        let at = |minutes: i64| t0 + chrono::Duration::minutes(minutes);
        for (minutes, opening) in [(0, "First?"), (1, "Second?"), (2, "Third?")] {
            let id = insert_session(&conn, &setup(), at(minutes)).expect("session");
            insert_turn(&conn, &turn(&id, Role::Assistant, opening), at(minutes)).expect("t0");
            insert_turn(&conn, &turn(&id, Role::User, "An answer"), at(minutes)).expect("t1");
        }
        assert_eq!(
            recent_openings(&conn, at(3), 2).expect("openings"),
            ["Third?", "Second?"]
        );
        // The session started at `before` is the one being talked in.
        assert_eq!(
            recent_openings(&conn, at(2), 5).expect("openings"),
            ["Second?", "First?"]
        );
    }

    #[test]
    fn the_previous_conversation_is_the_latest_one_the_learner_spoke_in() {
        let conn = open_in_memory().expect("db");
        let t0 = Utc::now();
        let at = |minutes: i64| t0 + chrono::Duration::minutes(minutes);
        assert_eq!(previous_conversation(&conn, at(9)).expect("none"), None);
        let mut spoken = setup();
        spoken.topic = "Films".into();
        let first = insert_session(&conn, &spoken, at(0)).expect("session");
        insert_turn(&conn, &turn(&first, Role::Assistant, "Hi?"), at(0)).expect("t0");
        insert_turn(&conn, &turn(&first, Role::User, "Hello"), at(0)).expect("t1");
        // Left after the opening question.
        let left = insert_session(&conn, &setup(), at(1)).expect("session");
        insert_turn(&conn, &turn(&left, Role::Assistant, "Hi?"), at(1)).expect("t0");
        assert_eq!(
            previous_conversation(&conn, at(2)).expect("previous"),
            Some((first, "Films".to_owned()))
        );
        assert_eq!(previous_conversation(&conn, at(0)).expect("none"), None);
    }

    #[test]
    fn challenges_open_and_close() {
        let conn = open_in_memory().expect("db");
        let id = insert_session(&conn, &setup(), Utc::now()).expect("session");
        insert_challenge(&conn, &id, None, "Use it twice", 2).expect("insert");
        let open = active_challenge(&conn).expect("query").expect("open");
        assert_eq!(open.text, "Use it twice");
        close_challenge(&conn, &open.id, Some(&id)).expect("close");
        assert_eq!(active_challenge(&conn).expect("query"), None);
    }

    #[test]
    fn practice_days_count_sessions() {
        let conn = open_in_memory().expect("db");
        let day = NaiveDate::from_ymd_opt(2026, 9, 24).expect("date");
        mark_practice(&conn, day).expect("first");
        mark_practice(&conn, day).expect("second");
        let days = || {
            practice_days(&conn)
                .expect("days")
                .into_iter()
                .collect::<Vec<_>>()
        };
        assert_eq!(days(), [day]);
        unmark_practice(&conn, day).expect("one left");
        assert_eq!(days(), [day]);
        unmark_practice(&conn, day).expect("none left");
        assert_eq!(days(), []);
        unmark_practice(&conn, day).expect("never marked");
        assert_eq!(days(), []);
    }
}
