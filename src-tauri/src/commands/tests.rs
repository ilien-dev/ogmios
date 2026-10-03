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
        effort: None,
        api_key: Some("fake".into()),
        claude_path: None,
    });
    agent
}

#[test]
#[ignore = "needs bun; run with `cargo test -- --ignored`"]
fn lists_the_providers_models() {
    let models = fake_agent().models().expect("models");
    assert!(models
        .iter()
        .any(|m| m.id == "haiku" && m.efforts.is_empty()));
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
    assert!(
        set.items.iter().all(|item| item.focus == focus.description),
        "every item names what it drills"
    );
    let miss = drill::answer(ctx, &set.id, 0, "Yesterday I goed").expect("miss");
    assert!(!miss.correct);
    let retry = miss.retry.expect("one retry");
    assert_eq!(retry.index, 5);
    assert_eq!(retry.focus, focus.description);
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
    assert_eq!(
        sessions::audio_ids(&ctx.conn().expect("conn"), None).expect("ids"),
        [] as [String; 0]
    );
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
        effort: None,
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
    assert_eq!(
        sessions::list_sessions(&ctx.conn().expect("conn")).expect("list"),
        [] as [sessions::SessionRow; 0]
    );
}

/// A chapter of the fixture book, prepared through the real sidecar.
#[test]
#[ignore = "needs bun; run with `cargo test -- --ignored`"]
fn a_chapter_is_prepared_once_and_a_deeper_depth_adds_to_it() {
    use super::{book, chapter};
    use crate::domain::{ChapterProgress, ChapterWords, Depth};

    let dir = tempfile::tempdir().expect("tempdir");
    let db = Mutex::new(open_in_memory().expect("db"));
    let agent = fake_agent();
    let ctx = Ctx {
        db: &db,
        agent: &agent,
        data_dir: dir.path(),
    };
    profile::save_profile(&ctx.conn().expect("conn"), &profile::tests::profile()).expect("profile");
    let path = dir.path().join("alice.epub");
    std::fs::write(&path, crate::books::epub::fixtures::alice()).expect("book file");
    let imported = book::import(ctx, &path).expect("import");
    let first = &imported.chapters[2];
    assert_eq!(first.prepared, None);

    let steps = Mutex::new(Vec::new());
    let hear = |p: ChapterProgress| steps.lock().expect("steps").push((p.done, p.total));
    let listed = |found: &ChapterWords| -> Vec<(String, u32)> {
        found
            .words
            .iter()
            .map(|w| (w.lemma.clone(), w.count))
            .collect()
    };
    let found = chapter::prepare(
        ctx,
        &first.id,
        Depth::Relevant,
        &mut |params| agent.vocab_extract(params),
        &hear,
    )
    .expect("prepare");
    // The fake calls "Rabbit-Hole" a name; Rust drops it and counts the rest.
    assert_eq!(
        listed(&found),
        [
            ("conversations".to_owned(), 2),
            ("pictures".to_owned(), 2),
            ("beginning".to_owned(), 1),
        ]
    );
    assert_eq!(found.words[0].translations, ["conversations (es)"]);
    assert_eq!(found.chapter.prepared, Some(Depth::Relevant));
    assert_eq!(*steps.lock().expect("steps"), [(0, 1), (1, 1)]);
    assert_eq!(
        chapter::chapter_words(ctx, &first.id).expect("stored"),
        found
    );

    // A second call has no sidecar to ask: any request would fail it.
    let silent = Agent::new(None);
    let again = chapter::prepare(
        ctx,
        &first.id,
        Depth::Relevant,
        &mut |params| silent.vocab_extract(params),
        &hear,
    )
    .expect("no request");
    assert_eq!(again, found);
    assert_eq!(steps.lock().expect("steps").len(), 2, "no progress either");

    let deeper = chapter::prepare(
        ctx,
        &first.id,
        Depth::Most,
        &mut |params| agent.vocab_extract(params),
        &hear,
    )
    .expect("deeper");
    assert_eq!(deeper.chapter.prepared, Some(Depth::Most));
    assert_eq!(deeper.words.len(), 11);
    assert!(found.words.iter().all(|word| deeper.words.contains(word)));
    assert!(listed(&deeper).contains(&("sister".to_owned(), 2)));

    let conn = ctx.conn().expect("conn");
    for table in ["patterns", "pattern_events"] {
        let rows: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(rows, 0, "book words never touch {table}");
    }
}

/// A chapter of the fixture book from the file to "ready to read": prepared
/// through the real sidecar, then every word answered right both ways.
#[test]
#[ignore = "needs bun; run with `cargo test -- --ignored`"]
fn a_chapter_practised_to_the_end_is_ready_and_its_words_are_in_progress() {
    use super::{book, chapter, refresh};
    use crate::books::practice::READY;
    use crate::domain::{Depth, RefreshStep, RefreshSummary};

    let dir = tempfile::tempdir().expect("tempdir");
    let db = Mutex::new(open_in_memory().expect("db"));
    let agent = fake_agent();
    let ctx = Ctx {
        db: &db,
        agent: &agent,
        data_dir: dir.path(),
    };
    profile::save_profile(&ctx.conn().expect("conn"), &profile::tests::profile()).expect("profile");
    let rows = |table: &str| -> i64 {
        ctx.conn()
            .expect("conn")
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count")
    };
    let memory = || (rows("patterns"), rows("pattern_events"));
    let before = memory();

    let path = dir.path().join("alice.epub");
    std::fs::write(&path, crate::books::epub::fixtures::alice()).expect("book file");
    let imported = book::import(ctx, &path).expect("import");
    let first = imported.chapters[2].id.clone();
    assert_eq!(imported.chapters[2].readiness, None, "not prepared yet");
    let found = chapter::prepare(
        ctx,
        &first,
        Depth::Most,
        &mut |params| agent.vocab_extract(params),
        &|_| {},
    )
    .expect("prepare");
    assert_eq!(found.chapter.readiness, Some(0));
    assert_eq!(found.words.len(), 11);

    let answers = practise_to_the_end(ctx, &found);
    assert_eq!(
        answers,
        found.words.len() * 4,
        "two right answers in a row each way"
    );

    let ready = chapter::chapter_words(ctx, &first).expect("words");
    assert_eq!(ready.chapter.readiness, Some(READY));
    assert!(ready.words.iter().all(|word| word.done && !word.known));
    let shelf = book::list(ctx).expect("books");
    let shown: Vec<_> = shelf[0].chapters.iter().map(|c| c.readiness).collect();
    assert_eq!(shown[2], Some(READY));
    assert_eq!(shown.iter().filter(|r| r.is_some()).count(), 1);

    // Every word is in the progress vocabulary with its translation.
    let vocabulary = progress::progress(ctx, Local::now().date_naive())
        .expect("progress")
        .vocabulary;
    assert_eq!(vocabulary.len(), found.words.len());
    for word in &found.words {
        let entry = vocabulary.iter().find(|entry| entry.english == word.lemma);
        let entry = entry.unwrap_or_else(|| panic!("{} is listed", word.lemma));
        assert_eq!(entry.asked.as_ref(), word.translations.first());
    }

    // The refresh before reading: every done word once, one of them missed.
    let pass = refresh::start(ctx, &first, Utc::now()).expect("refresh");
    let mut step = pass.step.clone();
    let mut asked = 0;
    while let RefreshStep::Item { item, .. } = step {
        let word = found.words.iter().find(|word| word.id == item.word_id);
        let right = word.expect("a word of the chapter").translations[0].clone();
        let text = if asked == 0 { "" } else { right.as_str() };
        step = refresh::answer(ctx, &pass.id, &item.word_id, text, Utc::now())
            .expect("answer")
            .step;
        asked += 1;
    }
    assert_eq!(asked, found.words.len());
    let summary = RefreshSummary {
        solid: 10,
        reopened: 1,
    };
    let RefreshStep::Summary {
        summary: told,
        progress,
    } = step
    else {
        panic!("a pass ends with its summary");
    };
    assert_eq!(told, summary);
    assert_eq!(progress.value, progress.total, "every word was asked");
    let slipped = chapter::chapter_words(ctx, &first).expect("words");
    assert_eq!(slipped.chapter.readiness, Some(90));
    assert_eq!(slipped.words.iter().filter(|word| !word.done).count(), 1);

    assert_eq!(memory(), before, "book words never touch the patterns");
    assert_eq!(before, (0, 0));
}

/// Answers every word of the chapter right, both ways, sitting after sitting
/// and each a day later, until one has nothing left to ask; how many answers
/// that took.
fn practise_to_the_end(ctx: Ctx<'_>, chapter: &crate::domain::ChapterWords) -> usize {
    use std::collections::HashMap;

    use chrono::TimeDelta;

    use super::practice;
    use crate::domain::{Direction, PracticeStep};

    // The right answer to each word, each way, as the word list gives it.
    let right: HashMap<(&str, Direction), &str> = chapter
        .words
        .iter()
        .flat_map(|word| {
            [
                (
                    (word.id.as_str(), Direction::Recognition),
                    word.translations[0].as_str(),
                ),
                (
                    (word.id.as_str(), Direction::Production),
                    word.lemma.as_str(),
                ),
            ]
        })
        .collect();

    let mut now = Utc::now();
    let mut answers = 0;
    for _ in 0..20 {
        let sitting = practice::start(ctx, &chapter.chapter.id, None, now).expect("sitting");
        let mut step = sitting.step;
        while let PracticeStep::Item { item, .. } = step {
            let asked = (item.word_id.as_str(), item.direction);
            let result =
                practice::answer(ctx, &sitting.id, asked, right[&asked], now).expect("answer");
            assert!(result.correct, "{}", item.prompt);
            answers += 1;
            step = result.step;
        }
        let PracticeStep::Summary { summary, .. } = step else {
            panic!("a sitting ends with its summary");
        };
        if summary.open == 0 {
            return answers;
        }
        now += TimeDelta::days(1);
    }
    panic!("the chapter is never finished");
}

/// "I was right" through the real sidecar: the fake upholds an answer that
/// begins with "also " and no other. Code decides what each verdict changes.
#[test]
#[ignore = "needs bun; run with `cargo test -- --ignored`"]
fn a_disputed_miss_is_judged_by_the_sidecar_and_an_upheld_one_is_accepted() {
    use super::{book, chapter, dispute, practice};
    use crate::domain::{Depth, Direction, PracticeStep};

    let dir = tempfile::tempdir().expect("tempdir");
    let db = Mutex::new(open_in_memory().expect("db"));
    let agent = fake_agent();
    let ctx = Ctx {
        db: &db,
        agent: &agent,
        data_dir: dir.path(),
    };
    profile::save_profile(&ctx.conn().expect("conn"), &profile::tests::profile()).expect("profile");
    let path = dir.path().join("alice.epub");
    std::fs::write(&path, crate::books::epub::fixtures::alice()).expect("book file");
    let imported = book::import(ctx, &path).expect("import");
    let found = chapter::prepare(
        ctx,
        &imported.chapters[2].id,
        Depth::Relevant,
        &mut |params| agent.vocab_extract(params),
        &|_| {},
    )
    .expect("prepare");
    let now = Utc::now();
    let sitting = practice::start(ctx, &found.chapter.id, None, now).expect("sitting");
    let PracticeStep::Item { item, .. } = sitting.step else {
        panic!("a prepared chapter has a word to ask");
    };
    let asked = (item.word_id.as_str(), Direction::Recognition);
    let say = |text: &str| practice::answer(ctx, &sitting.id, asked, text, now).expect("answer");
    let judge = |answer_id: i64| {
        dispute::dispute(ctx, answer_id, &mut |params| agent.vocab_judge(params), now)
    };

    // Rejected: the reason comes back and the miss stands.
    let miss = say("charlas");
    assert!(!miss.correct);
    let rejected = judge(miss.answer_id).expect("rejected");
    assert!(!rejected.upheld);
    assert_eq!(
        rejected.reason,
        r#""charlas" does not fit "conversations" (es)."#
    );
    assert!(!say("charlas").correct);

    // Upheld: from then on code accepts the answer, with no one to ask.
    let miss = say("also charlas");
    assert!(!miss.correct);
    let upheld = judge(miss.answer_id).expect("upheld");
    assert!(upheld.upheld);
    assert_eq!(
        upheld.reason,
        r#""also charlas" fits "conversations" (es)."#
    );
    assert!(say("Also charlas").correct);
    assert_eq!(judge(miss.answer_id).expect_err("once").kind(), "invalid");

    // Two misses stand and the third was undone: with the right answer after
    // it that is two in a row, so the word is finished English → native and
    // owes only the other way.
    let queue =
        crate::db::practice::queue(&ctx.conn().expect("conn"), &found.chapter.id).expect("queue");
    let owed: Vec<_> = queue
        .iter()
        .filter(|queued| queued.word_id == asked.0)
        .map(|queued| (queued.direction, queued.owed))
        .collect();
    assert_eq!(owed, [(Direction::Production, 2)]);
    let conn = ctx.conn().expect("conn");
    for table in ["patterns", "pattern_events"] {
        let rows: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(rows, 0, "book words never touch {table}");
    }
}
