//! Applies an analysis to the stored memory: events, state steps, the
//! report's picks and the review schedule, all in one pass at session end.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::Connection;

use super::{
    advance_review, is_active, keep_error, next_state, priority, select, state_after_dispute,
    stats, Candidate, Event, EventKind, ScoreInput,
};
use crate::agent::protocol::{Analysis, AnalysisError, EditType};
use crate::db::patterns::{self, ErrorEvent, NewEvent, NewPattern, PatternRow};
use crate::db::sessions;
use crate::domain::{Goal, PatternState};
use crate::error::Result;

/// "Appeared in N of your last M conversations" looks this far back.
pub const RECURRENCE_WINDOW: usize = 6;
/// Below this many sessions a recurrence line says nothing.
const RECURRENCE_MIN: u32 = 2;

/// A pattern picked for the report, with the error that shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct Pick {
    pub pattern: PatternRow,
    pub event: ErrorEvent,
    /// Sessions with this error out of the last ones, when it keeps coming.
    pub recurrence: Option<(u32, u32)>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Outcome {
    pub focus: Option<Pick>,
    pub minors: Vec<Pick>,
    /// The pattern the next challenge is about: this report's focus, or the
    /// primary focus carried over from earlier sessions.
    pub challenge_pattern: Option<(PatternRow, Option<ErrorEvent>)>,
}

/// SPEC §8: records the session's events, steps every touched pattern,
/// picks 1 focus and up to 2 minors, and moves review schedules along.
/// Every event and state change carries `now`, the analysis time.
pub fn apply(
    conn: &Connection,
    session_id: &str,
    analysis: &Analysis,
    goal: Goal,
    now: DateTime<Utc>,
) -> Result<Outcome> {
    let mut rows: HashMap<String, PatternRow> = patterns::list_patterns(conn)?
        .into_iter()
        .map(|p| (p.id.clone(), p))
        .collect();
    let was_active: HashSet<String> = rows
        .values()
        .filter(|p| is_active(p.state))
        .map(|p| p.id.clone())
        .collect();

    let (with_errors, touched) = record_events(conn, session_id, analysis, &mut rows, now)?;
    let events = patterns::events_by_pattern(conn)?;

    let mut changed: HashSet<String> = HashSet::new();
    for id in &touched {
        let Some(row) = rows.get_mut(id) else {
            continue;
        };
        let state = next_state(&row.facts(), events.get(id).map_or(&[][..], Vec::as_slice));
        if state != row.state {
            row.set_state(state, now);
            changed.insert(id.clone());
        }
    }

    let errors = patterns::error_events(conn, None)?;
    let session_errors: Vec<&ErrorEvent> = errors
        .iter()
        .filter(|e| e.session_id.as_deref() == Some(session_id))
        .collect();
    let candidates = score(&with_errors, &rows, &errors, session_id, &events, goal);
    let primary = rows
        .values()
        .find(|p| p.is_primary && matches!(p.state, PatternState::Focus | PatternState::Relapse))
        .map(|p| p.id.clone());
    let active_count = rows.values().filter(|p| is_active(p.state)).count();
    let selection = select(&candidates, primary.as_deref(), active_count);

    for id in selection.focus.iter().chain(&selection.minors) {
        if let Some(row) = rows.get_mut(id) {
            if row.state == PatternState::Detected {
                row.set_state(PatternState::Focus, now);
                changed.insert(id.clone());
            }
        }
    }
    let primary = primary.or_else(|| selection.focus.clone());
    if let Some(row) = primary.as_ref().and_then(|id| rows.get_mut(id)) {
        row.is_primary = true;
    }

    // A conversation that included an already-scheduled pattern counts as a
    // review of it.
    for id in touched
        .iter()
        .filter(|id| was_active.contains(*id) && !changed.contains(*id))
    {
        if let Some(row) = rows.get_mut(id) {
            if let Some((step, due)) = advance_review(row.review_step, row.next_review_at, now) {
                row.review_step = step;
                row.next_review_at = Some(due);
            }
        }
    }

    for row in rows.values() {
        patterns::update_pattern(conn, row)?;
    }

    let recent = recent_sessions(conn, session_id)?;
    let pick = |id: &String| -> Option<Pick> {
        let row = rows.get(id)?;
        let mine: Vec<&&ErrorEvent> = session_errors
            .iter()
            .filter(|e| &e.pattern_id == id)
            .collect();
        let event = mine.iter().find(|e| e.global).or_else(|| mine.first())?;
        Some(Pick {
            pattern: row.clone(),
            event: (**event).clone(),
            recurrence: recurrence(&errors, id, &recent),
        })
    };
    let focus = selection.focus.as_ref().and_then(pick);
    let minors = selection.minors.iter().filter_map(pick).collect();
    let challenge_pattern = primary.and_then(|id| rows.get(&id)).map(|row| {
        let example = errors.iter().find(|e| e.pattern_id == row.id).cloned();
        (row.clone(), example)
    });
    Ok(Outcome {
        focus,
        minors,
        challenge_pattern,
    })
}

/// SPEC §8.4 scores for the patterns with errors in this session.
fn score(
    with_errors: &[String],
    rows: &HashMap<String, PatternRow>,
    errors: &[ErrorEvent],
    session_id: &str,
    events: &HashMap<String, Vec<Event>>,
    goal: Goal,
) -> Vec<Candidate> {
    with_errors
        .iter()
        .filter_map(|id| rows.get(id))
        .map(|row| {
            let mine: Vec<&ErrorEvent> = errors
                .iter()
                .filter(|e| e.pattern_id == row.id && e.session_id.as_deref() == Some(session_id))
                .collect();
            let sessions_with_error: HashSet<&str> = errors
                .iter()
                .filter(|e| e.pattern_id == row.id)
                .filter_map(|e| e.session_id.as_deref())
                .collect();
            let input = ScoreInput {
                global: mine.iter().any(|e| e.global),
                sessions_with_error: u32::try_from(sessions_with_error.len()).unwrap_or(u32::MAX),
                rate: stats(events.get(&row.id).into_iter().flatten()).rate(),
                rule_based: row.rule_based,
                kind: row.kind,
                goal,
                above_level: !mine.is_empty() && mine.iter().all(|e| e.above_level),
                state: row.state,
            };
            Candidate {
                id: row.id.clone(),
                state: row.state,
                score: priority(&input),
            }
        })
        .collect()
}

/// Stores the analysis as events. Returns the patterns with kept errors in
/// this session and every pattern that got any event.
fn record_events(
    conn: &Connection,
    session_id: &str,
    analysis: &Analysis,
    rows: &mut HashMap<String, PatternRow>,
    now: DateTime<Utc>,
) -> Result<(Vec<String>, HashSet<String>)> {
    let mut with_errors: Vec<String> = Vec::new();
    let mut touched: HashSet<String> = HashSet::new();
    for error in analysis.errors.iter().filter(|e| keep_error(e)) {
        let Some(id) = resolve_pattern(conn, error, rows, session_id, now)? else {
            continue;
        };
        let event = NewEvent {
            pattern_id: &id,
            session_id: Some(session_id),
            turn_id: Some(&error.turn_id),
            kind: EventKind::Error,
            global: error.global,
            above_level: error.above_level,
            original: Some(&error.original),
            corrected: Some(&error.corrected),
        };
        patterns::insert_event(conn, &event, now)?;
        if !with_errors.contains(&id) {
            with_errors.push(id.clone());
        }
        touched.insert(id);
    }

    let positives = analysis
        .correct_uses
        .iter()
        .map(|u| {
            (
                u.pattern_id.as_str(),
                u.turn_id.as_str(),
                EventKind::CorrectUse,
            )
        })
        .chain(
            analysis
                .edits
                .iter()
                .filter(|e| e.kind == EditType::SelfCorrection)
                .filter_map(|e| {
                    Some((
                        e.pattern_id.as_deref()?,
                        e.turn_id.as_str(),
                        EventKind::SelfCorrected,
                    ))
                }),
        );
    for (pattern_id, turn_id, kind) in positives {
        if !rows.contains_key(pattern_id) {
            continue;
        }
        let event = NewEvent {
            pattern_id,
            session_id: Some(session_id),
            turn_id: Some(turn_id),
            kind,
            global: false,
            above_level: false,
            original: None,
            corrected: None,
        };
        patterns::insert_event(conn, &event, now)?;
        touched.insert(pattern_id.to_owned());
    }

    for id in &touched {
        if let Some(row) = rows.get_mut(id) {
            session_id.clone_into(&mut row.last_seen_session);
        }
    }
    Ok((with_errors, touched))
}

/// The stored pattern an error belongs to: the one the model named if it
/// exists, else the one with its new key, created on first sight.
fn resolve_pattern(
    conn: &Connection,
    error: &AnalysisError,
    rows: &mut HashMap<String, PatternRow>,
    session_id: &str,
    now: DateTime<Utc>,
) -> Result<Option<String>> {
    if let Some(id) = error
        .pattern
        .existing_id
        .as_ref()
        .filter(|id| rows.contains_key(*id))
    {
        return Ok(Some(id.clone()));
    }
    let Some(key) = error.pattern.new_key.as_deref() else {
        return Ok(None);
    };
    if let Some(row) = patterns::find_by_key(conn, key)? {
        let id = row.id.clone();
        rows.entry(id.clone()).or_insert(row);
        return Ok(Some(id));
    }
    let new = NewPattern {
        key,
        description: &error.pattern.description,
        kind: error.kind,
        rule_based: error.rule_based,
        session_id,
    };
    let id = patterns::insert_pattern(conn, &new, now)?;
    rows.insert(id.clone(), patterns::get_pattern(conn, &id)?);
    Ok(Some(id))
}

/// This session and the finished ones before it, newest first.
fn recent_sessions(conn: &Connection, session_id: &str) -> Result<Vec<String>> {
    Ok(sessions::list_sessions(conn)?
        .into_iter()
        .filter(|s| s.id == session_id || s.ended_at.is_some())
        .take(RECURRENCE_WINDOW)
        .map(|s| s.id)
        .collect())
}

fn recurrence(errors: &[ErrorEvent], pattern_id: &str, recent: &[String]) -> Option<(u32, u32)> {
    let hit: HashSet<&str> = errors
        .iter()
        .filter(|e| e.pattern_id == pattern_id)
        .filter_map(|e| e.session_id.as_deref())
        .filter(|s| recent.iter().any(|r| r == s))
        .collect();
    let hits = u32::try_from(hit.len()).unwrap_or(u32::MAX);
    let window = u32::try_from(recent.len()).unwrap_or(u32::MAX);
    (hits >= RECURRENCE_MIN).then_some((hits, window))
}

/// "No estoy de acuerdo": the event stops counting and the pattern's state
/// is worked out again without it.
pub fn dispute(conn: &Connection, event_id: &str, now: DateTime<Utc>) -> Result<()> {
    let event = patterns::get_error_event(conn, event_id)?;
    patterns::set_disputed(conn, event_id)?;
    let mut row = patterns::get_pattern(conn, &event.pattern_id)?;
    let events = patterns::events_for(conn, &row.id)?;
    let state = state_after_dispute(&row.facts(), &events);
    row.set_state(state, now);
    patterns::update_pattern(conn, &row)
}

/// A drill counts as a review; see `advance_review` for why only a due one
/// moves the schedule.
pub fn record_drill(
    conn: &Connection,
    pattern_id: &str,
    correct: bool,
    now: DateTime<Utc>,
) -> Result<()> {
    let kind = if correct {
        EventKind::DrillOk
    } else {
        EventKind::DrillFail
    };
    let event = NewEvent {
        pattern_id,
        session_id: None,
        turn_id: None,
        kind,
        global: false,
        above_level: false,
        original: None,
        corrected: None,
    };
    patterns::insert_event(conn, &event, now)?;
    let mut row = patterns::get_pattern(conn, pattern_id)?;
    row.last_drill_at = Some(now);
    patterns::update_pattern(conn, &row)
}

/// Moves a drilled pattern's review schedule once the drill is complete.
pub fn review_done(conn: &Connection, pattern_id: &str, now: DateTime<Utc>) -> Result<()> {
    let mut row = patterns::get_pattern(conn, pattern_id)?;
    if let Some((step, due)) = advance_review(row.review_step, row.next_review_at, now) {
        row.review_step = step;
        row.next_review_at = Some(due);
        patterns::update_pattern(conn, &row)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, sessions::tests::setup};
    use chrono::Duration;
    use serde_json::json;

    fn analysis(errors: &serde_json::Value, correct: &serde_json::Value) -> Analysis {
        serde_json::from_value(json!({
            "errors": errors, "correctUses": correct, "edits": [], "couldHaveSaid": [],
            "nativeRewrite": null, "strengths": [], "bestSentenceTurnId": null,
            "bestSentence": null,
            "complexity": {"clausesPerUnit": null, "subordinationRatio": null},
            "cefr": {"range": "B1", "accuracy": "B1", "fluency": "B1", "interaction": "B1",
                     "coherence": "B1", "overall": "B1"},
            "profileFacts": [], "partnerVocabulary": [], "challengeAchieved": null
        }))
        .expect("valid analysis")
    }

    fn error(key: &str, global: bool, confidence: f64) -> serde_json::Value {
        json!({
            "turnId": "t", "original": format!("wrong {key}"), "corrected": format!("right {key}"),
            "kind": "grammarRule", "global": global, "ruleBased": true, "aboveLevel": false,
            "pattern": {"existingId": null, "newKey": key, "description": key},
            "confidence": confidence, "asrSuspect": false
        })
    }

    fn session(conn: &Connection, now: DateTime<Utc>) -> String {
        let id = sessions::insert_session(conn, &setup(), now).expect("session");
        conn.execute(
            "UPDATE sessions SET ended_at = started_at WHERE id = ?1",
            [&id],
        )
        .expect("end");
        id
    }

    #[test]
    fn first_session_picks_focus_and_minors_within_limits() {
        let conn = open_in_memory().expect("db");
        let now = Utc::now();
        let s = session(&conn, now);
        let errors = json!([
            error("a", false, 0.9),
            error("b", true, 0.9),
            error("c", false, 0.9),
            error("d", false, 0.9),
            error("low", true, 0.3)
        ]);
        let out =
            apply(&conn, &s, &analysis(&errors, &json!([])), Goal::Travel, now).expect("apply");
        let focus = out.focus.expect("focus");
        assert_eq!(focus.pattern.key, "b", "global scores highest");
        assert_eq!(focus.event.original, "wrong b");
        assert_eq!(out.minors.len(), 2);
        let all = patterns::list_patterns(&conn).expect("patterns");
        assert_eq!(all.len(), 4, "low-confidence error dropped");
        let active: Vec<&PatternRow> = all.iter().filter(|p| is_active(p.state)).collect();
        assert_eq!(active.len(), 3);
        assert_eq!(all.iter().filter(|p| p.is_primary).count(), 1);
        assert_eq!(out.challenge_pattern.expect("challenge").0.key, "b");
    }

    #[test]
    fn the_focus_stays_and_improves_then_a_new_one_takes_over() {
        let conn = open_in_memory().expect("db");
        let t0 = Utc::now();
        let s0 = session(&conn, t0);
        apply(
            &conn,
            &s0,
            &analysis(&json!([error("a", false, 0.9)]), &json!([])),
            Goal::Work,
            t0,
        )
        .expect("s0");
        let a = patterns::find_by_key(&conn, "a").expect("q").expect("a");
        assert!(a.is_primary);

        // Next session: a new, higher-scoring error does not steal the focus.
        let t1 = t0 + Duration::days(1);
        let s1 = session(&conn, t1);
        let errors = json!([
            error("b", true, 0.9),
            {"turnId": "t", "original": "x", "corrected": "y", "kind": "grammarRule",
             "global": false, "ruleBased": true, "aboveLevel": false,
             "pattern": {"existingId": a.id, "newKey": null, "description": "a"},
             "confidence": 0.9, "asrSuspect": false}
        ]);
        let out = apply(&conn, &s1, &analysis(&errors, &json!([])), Goal::Work, t1).expect("s1");
        assert_eq!(out.focus.expect("focus").pattern.id, a.id);
        assert_eq!(out.minors[0].pattern.key, "b");
        assert_eq!(out.minors[0].recurrence, None);
        let a1 = patterns::get_pattern(&conn, &a.id).expect("a");
        assert_eq!(a1.review_step, 1, "a due review was taken");

        // Two correct uses of `a`: it improves and stops being primary.
        let t2 = t1 + Duration::days(1);
        let s2 = session(&conn, t2);
        let uses = json!([{"turnId": "t", "patternId": a.id}, {"turnId": "u", "patternId": a.id}]);
        let out = apply(&conn, &s2, &analysis(&json!([]), &uses), Goal::Work, t2).expect("s2");
        assert_eq!(out.focus, None);
        let a2 = patterns::get_pattern(&conn, &a.id).expect("a");
        assert_eq!(a2.state, PatternState::Improving);
        assert!(!a2.is_primary);

        // `b` (already active as a minor) now becomes the focus.
        let t3 = t2 + Duration::days(1);
        let s3 = session(&conn, t3);
        let out = apply(
            &conn,
            &s3,
            &analysis(&json!([error("b", false, 0.9)]), &json!([])),
            Goal::Work,
            t3,
        )
        .expect("s3");
        let focus = out.focus.expect("focus");
        assert_eq!(focus.pattern.key, "b");
        assert!(focus.pattern.is_primary);
        assert_eq!(focus.recurrence, Some((2, 4)));
    }

    #[test]
    fn dispute_reverts_a_focus_built_on_one_error() {
        let conn = open_in_memory().expect("db");
        let now = Utc::now();
        let s = session(&conn, now);
        let out = apply(
            &conn,
            &s,
            &analysis(&json!([error("a", false, 0.9)]), &json!([])),
            Goal::Other,
            now,
        )
        .expect("apply");
        let focus = out.focus.expect("focus");
        dispute(&conn, &focus.event.id, now).expect("dispute");
        let row = patterns::get_pattern(&conn, &focus.pattern.id).expect("row");
        assert_eq!(row.state, PatternState::Detected);
        assert!(!row.is_primary);
        assert_eq!(row.next_review_at, None);
    }

    #[test]
    fn drills_record_events_and_move_a_due_review() {
        let conn = open_in_memory().expect("db");
        let now = Utc::now();
        let s = session(&conn, now);
        let out = apply(
            &conn,
            &s,
            &analysis(&json!([error("a", false, 0.9)]), &json!([])),
            Goal::Other,
            now,
        )
        .expect("apply");
        let id = out.focus.expect("focus").pattern.id;
        record_drill(&conn, &id, true, now).expect("drill");
        review_done(&conn, &id, now).expect("not due");
        assert_eq!(
            patterns::get_pattern(&conn, &id).expect("row").review_step,
            0
        );
        let later = now + Duration::days(2);
        review_done(&conn, &id, later).expect("due");
        let row = patterns::get_pattern(&conn, &id).expect("row");
        assert_eq!(row.review_step, 1);
        assert_eq!(
            row.last_drill_at.map(|t| t.timestamp_millis()),
            Some(now.timestamp_millis())
        );
        let kinds: Vec<EventKind> = patterns::events_for(&conn, &id)
            .expect("events")
            .iter()
            .map(|e| e.kind)
            .collect();
        assert_eq!(kinds, [EventKind::Error, EventKind::DrillOk]);
    }
}
