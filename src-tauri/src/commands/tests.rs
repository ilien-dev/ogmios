//! The whole learner loop against the sidecar's deterministic fake provider:
//! conversation, report, memory, drills and progress, on an in-memory
//! database.

use std::path::Path;
use std::sync::Mutex;

use chrono::{Local, Utc};

use super::{drill, progress, session};
use crate::agent::protocol::ConfigureParams;
use crate::agent::Agent;
use crate::db::{open_in_memory, patterns, profile, sessions};
use crate::domain::{
    AnalysisStep, CorrectionRole, PatternState, ProviderMode, Recording, ReportCard,
};
use crate::Ctx;

fn fake_agent() -> Agent {
    let main = Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar/main.ts");
    let agent = Agent::new(Some(vec![
        "env".into(),
        "OGMIOS_FAKE=1".into(),
        "bun".into(),
        main.to_string_lossy().into_owned(),
    ]));
    agent.configure(ConfigureParams {
        mode: ProviderMode::ApiKey,
        model: "claude-sonnet-5".into(),
        api_key: Some("fake".into()),
        claude_path: None,
    });
    agent
}

#[test]
#[ignore = "needs bun; run with `cargo test -- --ignored`"]
fn a_session_from_first_question_to_drill() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = Mutex::new(open_in_memory().expect("db"));
    let agent = fake_agent();
    let ctx = Ctx {
        db: &db,
        agent: &agent,
        data_dir: dir.path(),
    };
    profile::save_profile(&ctx.conn().expect("conn"), &profile::tests::profile()).expect("profile");

    let id = converse(ctx, dir.path());
    let item_id = check_report(ctx, &id);
    let check = session::check_attempt(ctx, &item_id, "I went there yesterday").expect("check");
    assert!(check.correct);
    let focus_id = check_home_and_drill(ctx);
    check_next_session_and_disputes(ctx, &focus_id, dir.path());
}

/// Opening question, a typed turn, a spoken one, and a help request.
fn converse(ctx: Ctx<'_>, dir: &Path) -> String {
    // Opening question, streamed under the new session's id.
    let mut streamed = Vec::new();
    let started = session::start(ctx, &sessions::tests::setup(), &mut |id, text| {
        streamed.push((id.to_owned(), text.to_owned()));
    })
    .expect("start");
    assert!(started.opening.sent_text.contains("My job"));
    assert!(streamed.iter().all(|(id, _)| *id == started.session_id));
    assert_eq!(started.turn_word_goal, session::INTERMEDIATE.min_words);
    let id = started.session_id;

    // A typed turn, then a spoken one whose audio is kept.
    let typed = session::send(
        ctx,
        &id,
        "Yesterday I go to the market",
        None,
        &mut |_, _| {},
    )
    .expect("typed turn");
    assert_eq!(typed.user_turn.words, 6);
    assert!((typed.speech_minutes - 0.06).abs() < 1e-9);
    std::fs::create_dir_all(dir.join("audio")).expect("audio dir");
    std::fs::write(dir.join("audio/a1.wav"), b"RIFF").expect("audio");
    let recording = Recording {
        text: "I buyed apples".into(),
        audio_id: "a1".into(),
        speech_seconds: 600.0,
    };
    let spoken = session::send(
        ctx,
        &id,
        "I bought apples",
        Some(&recording),
        &mut |_, _| {},
    )
    .expect("spoken turn");
    assert!(spoken.target_reached, "10 minutes reached");
    let again = session::send(ctx, &id, "And pears", None, &mut |_, _| {}).expect("third turn");
    assert!(!again.target_reached, "announced once");

    let options = session::help(ctx, &id, "tengo ganas").expect("help");
    assert_eq!(options[0].english, "I'm looking forward to it");
    id
}

/// The report, in SPEC §7 order; returns the focus correction's item id.
fn check_report(ctx: Ctx<'_>, id: &str) -> String {
    let steps = Mutex::new(Vec::new());
    let report =
        session::end(ctx, id, &|step| steps.lock().expect("steps").push(step)).expect("end");
    assert_eq!(
        *steps.lock().expect("steps"),
        [
            AnalysisStep::Analyzing,
            AnalysisStep::Composing,
            AnalysisStep::Done
        ]
    );
    let kinds: Vec<&str> = report
        .cards
        .iter()
        .map(|c| match c {
            ReportCard::Achievement { .. } => "achievement",
            ReportCard::Correction { .. } => "correction",
            ReportCard::CouldHaveSaid { .. } => "couldHaveSaid",
            ReportCard::Vocabulary { .. } => "vocabulary",
            ReportCard::Metrics { .. } => "metrics",
            ReportCard::Challenge { .. } => "challenge",
        })
        .collect();
    assert_eq!(
        kinds,
        [
            "achievement",
            "correction",
            "vocabulary",
            "metrics",
            "challenge"
        ]
    );
    let ReportCard::Correction {
        role,
        item_id,
        self_correct,
        ..
    } = &report.cards[1]
    else {
        panic!("second card is the focus correction");
    };
    assert_eq!(*role, CorrectionRole::Focus);
    assert!(*self_correct, "grammar rules ask for a self-correction");
    let ReportCard::Vocabulary { items } = &report.cards[2] else {
        panic!("vocabulary")
    };
    assert_eq!(items.len(), 2, "one asked, one from the partner");
    assert!(
        session::end(ctx, id, &|_| {}).expect("again") == report,
        "ending twice is a no-op"
    );
    item_id.clone()
}

/// Home shows the focus, the challenge and a practised day; then a drill.
fn check_home_and_drill(ctx: Ctx<'_>) -> String {
    let home = session::home(ctx, Utc::now()).expect("home");
    let focus = home.focus.expect("focus pattern");
    assert_eq!(focus.state, PatternState::Focus);
    assert_eq!(
        home.active_challenge.as_deref(),
        Some("Use the past simple twice next time.")
    );
    assert!(home.streak.practiced_today);

    // A drill: five items on the only pattern, one retry after a miss.
    let set = drill::start(ctx, None, None).expect("drill");
    assert_eq!(set.items.len(), 5);
    let miss = drill::answer(ctx, &set.id, 0, "Yesterday I goed").expect("miss");
    assert!(!miss.correct);
    let retry = miss.retry.expect("one retry");
    assert_eq!(retry.index, 5);
    assert_eq!(
        drill::answer(ctx, &set.id, 0, "x")
            .expect_err("twice")
            .kind(),
        "invalid"
    );
    let retry_miss = drill::answer(ctx, &set.id, 5, "nope").expect("retry miss");
    assert!(retry_miss.retry.is_none(), "a retry gets no retry");
    let hit = drill::answer(ctx, &set.id, 1, "Yesterday I went to the market.").expect("hit");
    assert!(hit.correct);

    let progress = progress::progress(ctx, Local::now().date_naive()).expect("progress");
    assert_eq!(progress.sessions.len(), 1);
    assert_eq!(progress.patterns.len(), 1);
    assert_eq!(progress.best_sentences.len(), 1);
    assert_eq!(progress.weekly_minutes.len(), 12);
    assert!(progress.weekly_minutes[11].minutes > 10.0);
    focus.id
}

/// The next session checks the challenge; disputes undo the pattern.
fn check_next_session_and_disputes(ctx: Ctx<'_>, focus_id: &str, dir: &Path) {
    let next = session::start(ctx, &sessions::tests::setup(), &mut |_, _| {}).expect("start 2");
    session::send(ctx, &next.session_id, "I go home", None, &mut |_, _| {}).expect("turn");
    let report = session::end(ctx, &next.session_id, &|_| {}).expect("end 2");
    let Some(ReportCard::Challenge {
        previous_achieved, ..
    }) = report.cards.last()
    else {
        panic!("challenge card last");
    };
    assert_eq!(*previous_achieved, Some(false));

    // Disputing every correction of the pattern takes it back to detected.
    let conn = ctx.conn().expect("conn");
    let items: Vec<String> = conn
        .prepare("SELECT id FROM report_items")
        .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
        .expect("items");
    drop(conn);
    for item in &items {
        session::dispute(ctx, item).expect("dispute");
    }
    let pattern = patterns::get_pattern(&ctx.conn().expect("conn"), focus_id).expect("pattern");
    assert_eq!(pattern.state, PatternState::Detected);

    session::delete_audio(ctx, None).expect("delete audio");
    assert!(!dir.join("audio/a1.wav").exists());
    assert!(sessions::audio_ids(&ctx.conn().expect("conn"), None)
        .expect("ids")
        .is_empty());
}

#[test]
fn a_session_without_learner_turns_ends_with_metrics_only() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = Mutex::new(open_in_memory().expect("db"));
    let agent = Agent::new(None);
    let ctx = Ctx {
        db: &db,
        agent: &agent,
        data_dir: dir.path(),
    };
    let id = {
        let conn = ctx.conn().expect("conn");
        profile::save_profile(&conn, &profile::tests::profile()).expect("profile");
        sessions::insert_session(&conn, &sessions::tests::setup(), Utc::now()).expect("session")
    };
    let report = session::end(ctx, &id, &|_| {}).expect("end");
    assert!(matches!(
        report.cards.as_slice(),
        [ReportCard::Metrics { .. }]
    ));
    let err = session::send(ctx, &id, "hello", None, &mut |_, _| {}).expect_err("ended");
    assert_eq!(err.kind(), "invalid");
}

#[test]
fn a_failed_opening_leaves_no_session_behind() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = Mutex::new(open_in_memory().expect("db"));
    let agent = Agent::new(None);
    agent.configure(ConfigureParams {
        mode: ProviderMode::ApiKey,
        model: "m".into(),
        api_key: Some("k".into()),
        claude_path: None,
    });
    let ctx = Ctx {
        db: &db,
        agent: &agent,
        data_dir: dir.path(),
    };
    profile::save_profile(&ctx.conn().expect("conn"), &profile::tests::profile()).expect("profile");
    let err = session::start(ctx, &sessions::tests::setup(), &mut |_, _| {}).expect_err("no agent");
    assert_eq!(err.kind(), "provider");
    assert!(sessions::list_sessions(&ctx.conn().expect("conn"))
        .expect("list")
        .is_empty());
}
