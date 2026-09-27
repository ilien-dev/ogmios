//! The error memory (SPEC §8, §9.3): pattern states, priority, the limits on
//! what is active, and the review schedule. The model labels, this code
//! decides; everything here is a pure function of the stored events.

pub mod update;

use chrono::{DateTime, Duration, Utc};

use crate::agent::protocol::AnalysisError;
use crate::domain::{ErrorKind, Goal, PatternState};

/// Errors the model is less sure of than this are dropped.
pub const MIN_CONFIDENCE: f64 = 0.6;
/// Spontaneous correct rate that moves focus (or relapse) to improving.
pub const IMPROVING_RATE: f64 = 0.40;
/// Contexts needed before a rate says anything.
pub const IMPROVING_MIN_CONTEXTS: f64 = 2.0;
/// Mastered: this correct rate…
pub const MASTERED_RATE: f64 = 0.80;
/// …across this many distinct conversations…
pub const MASTERED_SESSIONS: usize = 3;
/// …with this many obligatory contexts (errors plus correct uses)…
pub const MASTERED_CONTEXTS: u32 = 5;
/// …the last of them at least this long after the last drill.
pub const MASTERED_DAYS_AFTER_DRILL: i64 = 7;
/// A self-correction is half a correct use (SPEC §6.5).
pub const SELF_CORRECTED_CREDIT: f64 = 0.5;
/// "Ready" patterns, sometimes right and sometimes wrong, score higher.
pub const READY_MIN: f64 = 0.20;
pub const READY_MAX: f64 = 0.79;
/// Recurrence stops adding to the score after this many sessions.
pub const RECURRENCE_CAP: u32 = 4;
/// At most this many patterns in focus, improving or relapse.
pub const MAX_ACTIVE: usize = 3;
/// Minor corrections per report, besides the focus.
pub const MAX_MINORS: usize = 2;
/// Days until the next review, by step (SPEC §9.3).
pub const REVIEW_DAYS: [i64; 4] = [1, 3, 7, 21];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Error,
    CorrectUse,
    SelfCorrected,
    DrillOk,
    DrillFail,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Error => "error",
            EventKind::CorrectUse => "correctUse",
            EventKind::SelfCorrected => "selfCorrected",
            EventKind::DrillOk => "drillOk",
            EventKind::DrillFail => "drillFail",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "error" => EventKind::Error,
            "correctUse" => EventKind::CorrectUse,
            "selfCorrected" => EventKind::SelfCorrected,
            "drillOk" => EventKind::DrillOk,
            "drillFail" => EventKind::DrillFail,
            _ => return None,
        })
    }

    /// Drills train; only conversation proves (SPEC §3.6).
    fn is_spontaneous(self) -> bool {
        matches!(
            self,
            EventKind::Error | EventKind::CorrectUse | EventKind::SelfCorrected
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub kind: EventKind,
    pub session_id: Option<String>,
    /// Every event of a session carries the session's analysis time, which is
    /// also when the states it caused changed.
    pub at: DateTime<Utc>,
    pub disputed: bool,
}

/// What the memory knows about a pattern besides its events.
#[derive(Debug, Clone, PartialEq)]
pub struct PatternFacts {
    pub state: PatternState,
    pub state_changed_at: DateTime<Utc>,
    pub focus_at: Option<DateTime<Utc>>,
    pub last_drill_at: Option<DateTime<Utc>>,
}

pub fn is_active(state: PatternState) -> bool {
    matches!(
        state,
        PatternState::Focus | PatternState::Improving | PatternState::Relapse
    )
}

/// SPEC §8.4: low confidence and suspected transcription errors are ignored.
pub fn keep_error(error: &AnalysisError) -> bool {
    error.confidence >= MIN_CONFIDENCE && !error.asr_suspect
}

/// Counts over undisputed conversation events.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Stats {
    pub correct: f64,
    pub contexts: f64,
    /// Errors plus correct uses: the obligatory contexts of SPEC §8.2.
    pub obligatory: u32,
    pub sessions: usize,
    pub last: Option<DateTime<Utc>>,
}

impl Stats {
    pub fn rate(&self) -> Option<f64> {
        (self.contexts > 0.0).then(|| self.correct / self.contexts)
    }
}

pub fn stats<'a>(events: impl IntoIterator<Item = &'a Event>) -> Stats {
    let mut stats = Stats::default();
    let mut sessions: Vec<&str> = Vec::new();
    for event in events {
        if event.disputed || !event.kind.is_spontaneous() {
            continue;
        }
        stats.contexts += 1.0;
        match event.kind {
            EventKind::CorrectUse => {
                stats.correct += 1.0;
                stats.obligatory += 1;
            }
            EventKind::SelfCorrected => stats.correct += SELF_CORRECTED_CREDIT,
            _ => stats.obligatory += 1,
        }
        if let Some(session) = event.session_id.as_deref() {
            if !sessions.contains(&session) {
                sessions.push(session);
            }
        }
        stats.last = stats.last.max(Some(event.at));
    }
    stats.sessions = sessions.len();
    stats
}

/// Events strictly after `since`: progress is measured on the conversations
/// that followed the change, not on the one that caused it.
fn after(events: &[Event], since: Option<DateTime<Utc>>) -> impl Iterator<Item = &Event> {
    events
        .iter()
        .filter(move |e| since.is_none_or(|t| e.at > t))
}

/// One step of SPEC §8.2 after new events. Detected patterns move only when a
/// report picks them (`select`).
pub fn next_state(facts: &PatternFacts, events: &[Event]) -> PatternState {
    match facts.state {
        PatternState::Detected => PatternState::Detected,
        PatternState::Mastered => {
            let relapsed = after(events, Some(facts.state_changed_at))
                .any(|e| e.kind == EventKind::Error && !e.disputed);
            if relapsed {
                PatternState::Relapse
            } else {
                PatternState::Mastered
            }
        }
        PatternState::Focus | PatternState::Relapse => {
            let s = stats(after(events, facts.focus_at));
            if s.contexts >= IMPROVING_MIN_CONTEXTS && s.rate() >= Some(IMPROVING_RATE) {
                PatternState::Improving
            } else {
                facts.state
            }
        }
        PatternState::Improving => {
            if is_mastered(&stats(after(events, facts.focus_at)), facts.last_drill_at) {
                PatternState::Mastered
            } else {
                PatternState::Improving
            }
        }
    }
}

fn is_mastered(s: &Stats, last_drill: Option<DateTime<Utc>>) -> bool {
    let long_after_drill = match (s.last, last_drill) {
        (Some(last), Some(drill)) => last >= drill + Duration::days(MASTERED_DAYS_AFTER_DRILL),
        (Some(_), None) => true,
        (None, _) => false,
    };
    s.rate() >= Some(MASTERED_RATE)
        && s.sessions >= MASTERED_SESSIONS
        && s.obligatory >= MASTERED_CONTEXTS
        && long_after_drill
}

/// The state once a correction is disputed: a relapse or a focus that only
/// the disputed error caused is undone; otherwise the usual step applies.
pub fn state_after_dispute(facts: &PatternFacts, events: &[Event]) -> PatternState {
    let undisputed_errors = |since: Option<DateTime<Utc>>| {
        events
            .iter()
            .filter(|e| e.kind == EventKind::Error && !e.disputed)
            .any(|e| since.is_none_or(|t| e.at >= t))
    };
    match facts.state {
        PatternState::Relapse if !undisputed_errors(facts.focus_at) => PatternState::Mastered,
        PatternState::Focus if !undisputed_errors(None) => PatternState::Detected,
        _ => next_state(facts, events),
    }
}

/// Inputs to the SPEC §8.4 score for one candidate pattern.
#[derive(Debug, Clone, PartialEq)]
pub struct ScoreInput {
    /// Any of this session's errors impeded understanding.
    pub global: bool,
    pub sessions_with_error: u32,
    /// Spontaneous correct rate over the pattern's whole history.
    pub rate: Option<f64>,
    pub rule_based: bool,
    pub kind: ErrorKind,
    pub goal: Goal,
    /// Every error this session was well above the learner's level.
    pub above_level: bool,
    pub state: PatternState,
}

/// Register matters at work; naturalness (words, collocations) socially.
pub fn goal_weight(kind: ErrorKind, goal: Goal) -> f64 {
    let weighted = match goal {
        Goal::Work => matches!(kind, ErrorKind::Register | ErrorKind::Collocation),
        Goal::Social => matches!(kind, ErrorKind::Lexical | ErrorKind::Collocation),
        Goal::Travel | Goal::Exams | Goal::Other => false,
    };
    if weighted {
        1.0
    } else {
        0.0
    }
}

pub fn priority(input: &ScoreInput) -> f64 {
    let flag = |b: bool| if b { 1.0 } else { 0.0 };
    let ready = input
        .rate
        .is_some_and(|r| (READY_MIN..=READY_MAX).contains(&r));
    3.0 * flag(input.global)
        + 2.0 * f64::from(input.sessions_with_error.min(RECURRENCE_CAP)) / f64::from(RECURRENCE_CAP)
        + 2.0 * flag(ready)
        + flag(input.rule_based)
        + goal_weight(input.kind, input.goal)
        + 3.0 * flag(input.state == PatternState::Relapse)
        - 3.0 * flag(input.above_level)
}

/// A pattern with errors in this session, after its state step.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub id: String,
    pub state: PatternState,
    pub score: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Selection {
    pub focus: Option<String>,
    pub minors: Vec<String>,
}

/// SPEC §8.3. The primary focus stays until it improves: it is this report's
/// focus if it came up, and no other pattern takes its place meanwhile. New
/// patterns join only while fewer than `MAX_ACTIVE` are active.
pub fn select(candidates: &[Candidate], primary: Option<&str>, active_count: usize) -> Selection {
    let mut ranked: Vec<&Candidate> = candidates.iter().collect();
    ranked.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    let mut active = active_count;
    let mut admit = |c: &Candidate| {
        if is_active(c.state) {
            true
        } else if active < MAX_ACTIVE {
            active += 1;
            true
        } else {
            false
        }
    };
    let focus = match primary {
        Some(id) => ranked.iter().find(|c| c.id == id).map(|c| c.id.clone()),
        None => ranked
            .iter()
            .filter(|c| c.state != PatternState::Improving)
            .find(|c| admit(c))
            .map(|c| c.id.clone()),
    };
    let minors = ranked
        .iter()
        .filter(|c| Some(&c.id) != focus.as_ref())
        .filter(|c| admit(c))
        .take(MAX_MINORS)
        .map(|c| c.id.clone())
        .collect();
    Selection { focus, minors }
}

/// The first review after a pattern enters focus.
pub fn first_review(now: DateTime<Utc>) -> (u32, DateTime<Utc>) {
    (0, now + Duration::days(REVIEW_DAYS[0]))
}

/// The schedule after a drill or conversation that included the pattern.
/// Only a review at or after its due time moves the pattern up a step, so
/// several drills in one day do not jump it to three weeks.
pub fn advance_review(
    step: u32,
    next_review_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Option<(u32, DateTime<Utc>)> {
    let due = next_review_at?;
    if due > now {
        return None;
    }
    let last = u32::try_from(REVIEW_DAYS.len() - 1).unwrap_or(0);
    let step = (step + 1).min(last);
    let days = REVIEW_DAYS[usize::try_from(step).unwrap_or(0)];
    Some((step, now + Duration::days(days)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-9, "{actual} != {expected}");
    }
    use chrono::TimeZone;

    fn day(n: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0)
            .single()
            .expect("valid date")
            + Duration::days(n)
    }

    fn ev(kind: EventKind, session: u32, at: i64) -> Event {
        Event {
            kind,
            session_id: Some(format!("s{session}")),
            at: day(at),
            disputed: false,
        }
    }

    fn facts(state: PatternState, focus_at: i64) -> PatternFacts {
        PatternFacts {
            state,
            state_changed_at: day(focus_at),
            focus_at: Some(day(focus_at)),
            last_drill_at: None,
        }
    }

    use EventKind::{CorrectUse, DrillOk, Error, SelfCorrected};

    #[test]
    fn self_corrections_are_half_a_correct_use() {
        let s = stats(&[ev(Error, 1, 0), ev(SelfCorrected, 1, 0), ev(DrillOk, 1, 0)]);
        assert_eq!(s.obligatory, 1);
        assert_eq!(s.rate(), Some(0.25));
    }

    #[test]
    fn focus_improves_at_forty_percent_after_focus() {
        let f = facts(PatternState::Focus, 1);
        // Day-1 errors caused the focus and do not count.
        let mut events = vec![
            ev(Error, 1, 1),
            ev(Error, 1, 1),
            ev(Error, 2, 3),
            ev(Error, 2, 3),
        ];
        assert_eq!(next_state(&f, &events), PatternState::Focus);
        events.push(ev(CorrectUse, 3, 5));
        assert_eq!(next_state(&f, &events), PatternState::Focus, "1 of 3");
        events.push(ev(CorrectUse, 3, 5));
        assert_eq!(next_state(&f, &events), PatternState::Improving, "2 of 4");
    }

    #[test]
    fn one_lucky_use_is_not_enough() {
        let f = facts(PatternState::Focus, 1);
        assert_eq!(next_state(&f, &[ev(CorrectUse, 2, 2)]), PatternState::Focus);
    }

    #[test]
    fn disputed_events_do_not_count() {
        let f = facts(PatternState::Focus, 1);
        let mut e = ev(Error, 2, 2);
        e.disputed = true;
        let events = [
            ev(CorrectUse, 2, 2),
            ev(Error, 2, 2),
            ev(CorrectUse, 3, 3),
            e,
        ];
        assert_close(stats(&events).contexts, 3.0);
        assert_eq!(next_state(&f, &events), PatternState::Improving);
    }

    fn mastery_events() -> Vec<Event> {
        vec![
            ev(CorrectUse, 2, 10),
            ev(CorrectUse, 2, 10),
            ev(CorrectUse, 3, 12),
            ev(CorrectUse, 3, 12),
            ev(CorrectUse, 4, 14),
        ]
    }

    #[test]
    fn mastery_needs_rate_sessions_and_contexts() {
        let f = facts(PatternState::Improving, 1);
        assert_eq!(next_state(&f, &mastery_events()), PatternState::Mastered);

        let two_sessions: Vec<Event> = mastery_events()
            .into_iter()
            .filter(|e| e.session_id.as_deref() != Some("s4"))
            .collect();
        assert_eq!(
            next_state(&f, &two_sessions),
            PatternState::Improving,
            "2 sessions"
        );

        let mut low = mastery_events();
        low.push(ev(Error, 4, 14));
        low.push(ev(Error, 4, 14));
        assert_eq!(
            next_state(&f, &low),
            PatternState::Improving,
            "5 of 7 < 80%"
        );

        let four = &mastery_events()[1..];
        assert_eq!(next_state(&f, four), PatternState::Improving, "4 contexts");
    }

    #[test]
    fn mastery_waits_a_week_after_the_last_drill() {
        let mut f = facts(PatternState::Improving, 1);
        f.last_drill_at = Some(day(8));
        assert_eq!(next_state(&f, &mastery_events()), PatternState::Improving);
        f.last_drill_at = Some(day(7));
        assert_eq!(next_state(&f, &mastery_events()), PatternState::Mastered);
    }

    #[test]
    fn drills_never_master() {
        let f = facts(PatternState::Improving, 1);
        let drills: Vec<Event> = (0..10).map(|i| ev(DrillOk, i, 20)).collect();
        assert_eq!(next_state(&f, &drills), PatternState::Improving);
    }

    #[test]
    fn mastered_relapses_on_a_new_error_and_a_dispute_undoes_it() {
        let mut f = facts(PatternState::Mastered, 1);
        f.state_changed_at = day(20);
        let old = ev(Error, 1, 5);
        assert_eq!(
            next_state(&f, std::slice::from_ref(&old)),
            PatternState::Mastered
        );
        let events = vec![old, ev(Error, 9, 30)];
        assert_eq!(next_state(&f, &events), PatternState::Relapse);

        let relapse = facts(PatternState::Relapse, 30);
        let mut disputed = events.clone();
        disputed[1].disputed = true;
        assert_eq!(
            state_after_dispute(&relapse, &disputed),
            PatternState::Mastered
        );
        assert_eq!(
            state_after_dispute(&relapse, &events),
            PatternState::Relapse
        );
    }

    #[test]
    fn a_focus_built_on_a_disputed_error_goes_back_to_detected() {
        let f = facts(PatternState::Focus, 1);
        let mut e = ev(Error, 1, 1);
        e.disputed = true;
        assert_eq!(state_after_dispute(&f, &[e]), PatternState::Detected);
        assert_eq!(
            state_after_dispute(&f, &[ev(Error, 1, 1)]),
            PatternState::Focus
        );
    }

    #[test]
    fn relapse_improves_like_focus() {
        let f = facts(PatternState::Relapse, 1);
        let events = [ev(CorrectUse, 2, 2), ev(Error, 2, 2)];
        assert_eq!(next_state(&f, &events), PatternState::Improving);
    }

    fn input() -> ScoreInput {
        ScoreInput {
            global: false,
            sessions_with_error: 0,
            rate: None,
            rule_based: false,
            kind: ErrorKind::Other,
            goal: Goal::Travel,
            above_level: false,
            state: PatternState::Detected,
        }
    }

    #[test]
    fn priority_follows_the_spec_formula() {
        assert_close(priority(&input()), 0.0);
        let full = ScoreInput {
            global: true,
            sessions_with_error: 9,
            rate: Some(0.5),
            rule_based: true,
            kind: ErrorKind::Register,
            goal: Goal::Work,
            above_level: false,
            state: PatternState::Relapse,
        };
        assert_close(priority(&full), 3.0 + 2.0 + 2.0 + 1.0 + 1.0 + 3.0);
        assert_close(
            priority(&ScoreInput {
                sessions_with_error: 2,
                ..input()
            }),
            1.0,
        );
        assert_close(
            priority(&ScoreInput {
                above_level: true,
                ..input()
            }),
            -3.0,
        );
        assert_close(
            priority(&ScoreInput {
                rate: Some(0.8),
                ..input()
            }),
            0.0,
        );
        assert_close(
            priority(&ScoreInput {
                rate: Some(0.2),
                ..input()
            }),
            2.0,
        );
    }

    #[test]
    fn goal_weights_register_for_work_and_words_for_social() {
        assert_close(goal_weight(ErrorKind::Register, Goal::Work), 1.0);
        assert_close(goal_weight(ErrorKind::Collocation, Goal::Social), 1.0);
        assert_close(goal_weight(ErrorKind::Lexical, Goal::Social), 1.0);
        assert_close(goal_weight(ErrorKind::Lexical, Goal::Work), 0.0);
        assert_close(goal_weight(ErrorKind::GrammarRule, Goal::Exams), 0.0);
    }

    fn cand(id: &str, state: PatternState, score: f64) -> Candidate {
        Candidate {
            id: id.into(),
            state,
            score,
        }
    }

    #[test]
    fn picks_the_top_scorer_as_focus_and_two_minors() {
        let c = [
            cand("a", PatternState::Detected, 1.0),
            cand("b", PatternState::Detected, 5.0),
            cand("c", PatternState::Detected, 3.0),
            cand("d", PatternState::Detected, 4.0),
        ];
        let s = select(&c, None, 0);
        assert_eq!(s.focus.as_deref(), Some("b"));
        assert_eq!(s.minors, ["d", "c"]);
    }

    #[test]
    fn keeps_the_primary_focus_while_it_is_active() {
        let c = [
            cand("new", PatternState::Detected, 9.0),
            cand("old", PatternState::Focus, 1.0),
        ];
        let s = select(&c, Some("old"), 1);
        assert_eq!(s.focus.as_deref(), Some("old"));
        assert_eq!(s.minors, ["new"]);

        // The primary did not come up: no other pattern becomes the focus.
        let s = select(&c[..1], Some("old"), 1);
        assert_eq!(s.focus, None);
        assert_eq!(s.minors, ["new"]);
    }

    #[test]
    fn never_more_than_three_active() {
        let c = [
            cand("x", PatternState::Detected, 9.0),
            cand("y", PatternState::Improving, 1.0),
            cand("z", PatternState::Detected, 8.0),
        ];
        // Two active already (y and the primary p): room for one new pattern.
        let s = select(&c, Some("p"), 2);
        assert_eq!(s.focus, None);
        assert_eq!(s.minors, ["x", "y"]);
        let s = select(&c, Some("p"), 3);
        assert_eq!(s.minors, ["y"], "only already-active patterns");
    }

    #[test]
    fn an_improving_pattern_is_not_made_the_focus_again() {
        let c = [
            cand("i", PatternState::Improving, 9.0),
            cand("d", PatternState::Detected, 1.0),
        ];
        let s = select(&c, None, 1);
        assert_eq!(s.focus.as_deref(), Some("d"));
        assert_eq!(s.minors, ["i"]);
    }

    #[test]
    fn reviews_follow_one_three_seven_twenty_one() {
        let (step, due) = first_review(day(0));
        assert_eq!((step, due), (0, day(1)));
        assert_eq!(advance_review(step, Some(due), day(0)), None, "not due yet");
        let (step, due) = advance_review(step, Some(due), day(1)).expect("due");
        assert_eq!((step, due), (1, day(4)));
        let (step, due) = advance_review(step, Some(due), day(4)).expect("due");
        assert_eq!((step, due), (2, day(11)));
        let (step, due) = advance_review(step, Some(due), day(11)).expect("due");
        assert_eq!((step, due), (3, day(32)));
        let (step, due) = advance_review(step, Some(due), day(40)).expect("due");
        assert_eq!((step, due), (3, day(61)), "stays at 21 days");
        assert_eq!(advance_review(0, None, day(0)), None, "unscheduled");
    }

    #[test]
    fn keeps_only_confident_non_asr_errors() {
        let mut e: AnalysisError = serde_json::from_value(serde_json::json!({
            "turnId": "t", "original": "a", "corrected": "b", "kind": "lexical",
            "global": false, "ruleBased": false, "aboveLevel": false,
            "pattern": {"existingId": null, "newKey": "k", "description": "d"},
            "confidence": 0.6, "asrSuspect": false
        }))
        .expect("valid error");
        assert!(keep_error(&e));
        e.confidence = 0.59;
        assert!(!keep_error(&e));
        e.confidence = 0.9;
        e.asr_suspect = true;
        assert!(!keep_error(&e));
    }
}
