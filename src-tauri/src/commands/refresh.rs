//! The quick refresh before reading: one pass, English → native, over the
//! done words of a chapter that is ready to read, in an order drawn for the
//! pass, each asked once and checked by code like any other answer.
//!
//! The pass keeps no progress of its own. Its answers are answers like those
//! of practice, so a right one changes nothing and a miss makes the word start
//! over, owing two in a row in both directions (`books::practice::owed`): the
//! word is back in the chapter's queue, and the chapter is not ready until it
//! is done again.
//!
//! Leaving at any moment keeps what was answered. The next refresh goes on
//! with the same pass: it asks the done words this pass has not asked yet.
//! Once a pass has asked them all it is finished, and the refresh after it
//! starts over with every done word. No request to the model is made, and
//! neither "I know this" nor "I was right" is part of a refresh.

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::practice::item;
use super::profile::require_profile;
use super::run;
use crate::books::practice::{accepts_native, inflects, pass_progress, pick, seed, READY};
use crate::db::practice::{self, SittingRow};
use crate::db::{books, profile, refresh};
use crate::domain::{Direction, Refresh, RefreshAnswer, RefreshStep};
use crate::error::{Error, Result};
use crate::Ctx;

/// What the pass shows next: one of its words not asked yet, or the summary
/// when none is left. Which one is drawn for the pass and for how far it is
/// (`books::practice::pick`): no two passes come in the same order, and one
/// left and gone on with shows the word it was showing. A pass with none
/// left is finished. Either way the step says how far the pass is: the words
/// it has asked, out of those and the ones left, so a pass gone on with has
/// its bar where it was.
fn step(conn: &Connection, pass: &SittingRow, now: DateTime<Utc>) -> Result<RefreshStep> {
    let left = refresh::left(conn, pass)?;
    let asked = refresh::asked(conn, pass)?;
    let progress = pass_progress(asked, left.len());
    let turn = usize::try_from(asked).unwrap_or(usize::MAX);
    let drawn = pick(seed(&pass.id), turn, left.len()).and_then(|at| left.get(at));
    let Some(word_id) = drawn else {
        refresh::finish(conn, &pass.id, now)?;
        return Ok(RefreshStep::Summary {
            summary: refresh::summary(conn, pass)?,
            progress,
        });
    };
    Ok(RefreshStep::Item {
        item: item(practice::word(conn, word_id)?, Direction::Recognition),
        progress,
    })
}

/// The chapter's pass to go on with: the one left unfinished, while it still
/// has a word to ask; otherwise a new one.
fn pass(conn: &Connection, chapter_id: &str, now: DateTime<Utc>) -> Result<SittingRow> {
    if let Some(id) = refresh::unfinished(conn, chapter_id)? {
        let held = practice::sitting(conn, &id)?;
        if !refresh::left(conn, &held)?.is_empty() {
            return Ok(held);
        }
        // Its last words were marked as known since: it has nothing to add.
        refresh::finish(conn, &id, now)?;
    }
    practice::sitting(conn, &refresh::start(conn, chapter_id, now)?)
}

/// Starts the refresh of a chapter that is ready to read, or goes on with
/// the pass left halfway, and gives its first word. A chapter still being
/// practised is refused: its words are asked by practice.
pub fn start(ctx: Ctx<'_>, chapter_id: &str, now: DateTime<Utc>) -> Result<Refresh> {
    let mut conn = ctx.conn()?;
    if books::get_chapter(&conn, chapter_id)?.readiness != Some(READY) {
        return Err(Error::Invalid("this chapter is not ready to read".into()));
    }
    let tx = conn.transaction()?;
    let pass = pass(&tx, chapter_id, now)?;
    let step = step(&tx, &pass, now)?;
    tx.commit()?;
    Ok(Refresh { id: pass.id, step })
}

/// Checks one answer of a pass, keeps it, and says what comes next. The
/// word has to be one the pass has yet to ask: done, not known, not answered
/// in it. An empty answer is "I don't know": a miss like any other.
pub fn answer(
    ctx: Ctx<'_>,
    sitting_id: &str,
    word_id: &str,
    answer: &str,
    now: DateTime<Utc>,
) -> Result<RefreshAnswer> {
    let mut conn = ctx.conn()?;
    let native_lang = require_profile(&conn)?.native_lang;
    let spelling = profile::spelling(&conn)?;
    let tx = conn.transaction()?;
    let pass = practice::sitting(&tx, sitting_id)?;
    if !pass.refresh {
        return Err(Error::Invalid("this sitting is not a refresh".into()));
    }
    let word = practice::word(&tx, word_id)?;
    if !refresh::left(&tx, &pass)?.contains(&word.id) {
        return Err(Error::Invalid("this word is not being asked".into()));
    }
    let correct = accepts_native(
        answer,
        &word.translations,
        (&native_lang, inflects(word.part_of_speech)),
        spelling,
    );
    practice::record(
        &tx,
        &pass.id,
        (word_id, Direction::Recognition),
        (answer.trim(), correct),
        now,
    )?;
    let step = step(&tx, &pass, now)?;
    tx.commit()?;
    Ok(RefreshAnswer {
        correct,
        accepted: word.shown,
        step,
    })
}

#[tauri::command]
pub async fn start_refresh(app: AppHandle, chapter_id: String) -> Result<Refresh> {
    run(app, move |_, ctx| start(ctx, &chapter_id, Utc::now())).await
}

#[tauri::command]
pub async fn answer_refresh(
    app: AppHandle,
    sitting_id: String,
    word_id: String,
    answer: String,
) -> Result<RefreshAnswer> {
    run(app, move |_, ctx| {
        self::answer(ctx, &sitting_id, &word_id, &answer, Utc::now())
    })
    .await
}

#[cfg(test)]
mod tests {
    use chrono::TimeDelta;

    use super::*;
    use crate::books::vocab::Word;
    use crate::commands::dispute::dispute;
    use crate::commands::practice::tests::{numbered, owes, shown, t0, translation, Desk};
    use crate::commands::practice::{self as sitting, know};
    use crate::db::words;
    use crate::db::words::tests::word;
    use crate::domain::{
        PracticeItem, PracticeStep, RefreshSummary, SittingProgress, SittingSummary,
    };

    /// A chapter of these words, every one practised until it is done.
    fn ready(desk: &Desk, list: &[Word]) -> String {
        let chapter = desk.chapter("b", list);
        let (_, summary) = desk.play(&chapter, t0());
        assert_eq!(summary.open, 0, "every word is done");
        assert_eq!(readiness(desk, &chapter), Some(READY));
        chapter
    }

    fn readiness(desk: &Desk, chapter: &str) -> Option<u32> {
        books::get_chapter(&desk.db.lock().expect("db"), chapter)
            .expect("chapter")
            .readiness
    }

    fn asked(step: &RefreshStep) -> &PracticeItem {
        match step {
            RefreshStep::Item { item, .. } => item,
            RefreshStep::Summary { .. } => panic!("the pass is over"),
        }
    }

    /// The summary of a pass that asked `asked` words: its bar is full.
    fn over(solid: u32, reopened: u32, asked: u32) -> RefreshStep {
        RefreshStep::Summary {
            summary: RefreshSummary { solid, reopened },
            progress: SittingProgress {
                value: asked,
                total: asked,
            },
        }
    }

    /// How far the pass is as the step says: (value, total).
    fn bar(step: &RefreshStep) -> (u32, u32) {
        let (RefreshStep::Item { progress, .. } | RefreshStep::Summary { progress, .. }) = step;
        (progress.value, progress.total)
    }

    fn begin(desk: &Desk, chapter: &str) -> Refresh {
        start(desk.ctx(), chapter, t0()).expect("refresh")
    }

    /// The right answer to the word the pass shows.
    fn good(step: &RefreshStep) -> String {
        translation(&asked(step).prompt)
    }

    /// Answers the word the pass shows; what comes next.
    fn say(desk: &Desk, pass: &Refresh, step: &RefreshStep, text: &str) -> RefreshAnswer {
        answer(desk.ctx(), &pass.id, &asked(step).word_id, text, t0()).expect("answer")
    }

    fn done_words(desk: &Desk) -> i64 {
        desk.count("SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL")
    }

    fn answers(desk: &Desk) -> i64 {
        desk.count("SELECT COUNT(*) FROM word_answers")
    }

    fn word_id(desk: &Desk, lemma: &str) -> String {
        desk.db
            .lock()
            .expect("db")
            .query_row(
                "SELECT id FROM chapter_words WHERE lemma = ?1",
                [lemma],
                |row| row.get(0),
            )
            .expect("word")
    }

    #[test]
    fn a_refresh_asks_each_done_word_once_and_no_known_word() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let bank = Word {
            needs_context: true,
            forms: vec!["w01".into()],
            sentence: "She sat on the W01.".into(),
            ..word("w01", &["w01es"], 99)
        };
        let mut list = numbered(4);
        list[1] = bank;
        let chapter = ready(&desk, &list);
        let known = word_id(&desk, "w02");
        words::set_known(&desk.db.lock().expect("db"), &known, true, t0()).expect("known");
        let before = answers(&desk);
        let dates = desk.count("SELECT COUNT(DISTINCT done_at) FROM chapter_words");

        let pass = begin(&desk, &chapter);
        let mut step = pass.step.clone();
        let mut prompts = Vec::new();
        while let RefreshStep::Item { item, .. } = &step {
            assert_eq!(item.direction, Direction::Recognition);
            if item.prompt == "w01" {
                assert_eq!(
                    shown(item),
                    [("She sat on the ", false), ("W01", true), (".", false)],
                    "a word flagged for context shows its sentence"
                );
            } else {
                assert_eq!(item.context, None);
            }
            prompts.push(item.prompt.clone());
            // Case, accents, punctuation and a leading article do not count.
            let text = format!(" La {}. ", translation(&item.prompt).to_uppercase());
            let result = say(&desk, &pass, &step, &text);
            assert!(result.correct, "{text}");
            step = result.step;
        }
        prompts.sort();
        assert_eq!(
            prompts,
            ["w00", "w01", "w03"],
            "each once, the known one never"
        );
        assert_eq!(step, over(3, 0, 3));

        // Right answers change nothing: every word is done as it was, and
        // nothing is in the queue.
        assert_eq!(answers(&desk), before + 3);
        assert_eq!(done_words(&desk), 4);
        assert_eq!(
            desk.count("SELECT COUNT(DISTINCT done_at) FROM chapter_words"),
            dates
        );
        assert_eq!(readiness(&desk, &chapter), Some(READY));
        let queue = practice::queue(&desk.db.lock().expect("db"), &chapter).expect("queue");
        assert_eq!(queue, []);
        // Practice has nothing owed to ask: any way is an extra review.
        let offered =
            crate::commands::practice::options(desk.ctx(), &chapter, t0()).expect("options");
        assert_eq!(offered.extra.len(), 3);
        for table in ["patterns", "pattern_events"] {
            let rows = desk.count(&format!("SELECT COUNT(*) FROM {table}"));
            assert_eq!(rows, 0, "book words never touch {table}");
        }

        // The pass is finished: a later refresh starts over.
        let later = start(desk.ctx(), &chapter, t0() + TimeDelta::days(3)).expect("again");
        assert_ne!(later.id, pass.id);
        assert_eq!(bar(&later.step), (0, 3));
    }

    #[test]
    fn a_miss_reopens_the_word_owing_two_in_a_row_and_the_chapter_is_not_ready() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = ready(&desk, &numbered(3));
        let pass = begin(&desk, &chapter);
        let first = asked(&pass.step).clone();

        let miss = say(&desk, &pass, &pass.step, "something else");
        assert!(!miss.correct);
        assert_eq!(miss.accepted, [translation(&first.prompt)]);
        assert_eq!(
            owes(&desk, &chapter, &first.word_id),
            [(Direction::Recognition, 2)],
            "two in a row English → native, and the other way after it"
        );
        assert_eq!(done_words(&desk), 2);
        assert_eq!(readiness(&desk, &chapter), Some(66));

        // "I don't know" is a miss too; the pass goes on to the end.
        let second = asked(&miss.step).prompt.clone();
        let unknown = say(&desk, &pass, &miss.step, "  ");
        assert!(!unknown.correct);
        let last = say(&desk, &pass, &unknown.step, &good(&unknown.step));
        assert!(last.correct);
        assert_eq!(last.step, over(1, 2, 3));
        assert_eq!(readiness(&desk, &chapter), Some(33));
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM word_answers WHERE answer = ''"),
            1
        );

        // The chapter is practised again: only the two missed words, both
        // ways, two answers each way, and then it is ready.
        let refused = start(desk.ctx(), &chapter, t0()).expect_err("not ready");
        assert_eq!(refused.kind(), "invalid");
        let (mut again, summary) = desk.play(&chapter, t0());
        again.sort();
        let mut missed = vec![first.prompt; 4];
        missed.extend(vec![second; 4]);
        missed.sort();
        assert_eq!(again, missed);
        assert_eq!(summary, SittingSummary { done: 2, open: 0 });
        assert_eq!(readiness(&desk, &chapter), Some(READY));
    }

    #[test]
    fn a_missed_word_left_done_by_the_older_rule_owes_again() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = ready(&desk, &numbered(2));
        let pass = begin(&desk, &chapter);
        let missed = asked(&pass.step).word_id.clone();
        assert!(!say(&desk, &pass, &pass.step, "no").correct);
        // The older rule took two right answers English → native for done.
        let conn = desk.db.lock().expect("db");
        conn.execute(
            "UPDATE chapter_words SET done_at = '2026-01-01T00:00:00Z'",
            [],
        )
        .expect("done");
        drop(conn);
        assert_eq!(done_words(&desk), 2);

        sitting::options(desk.ctx(), &chapter, t0()).expect("options");
        assert_eq!(done_words(&desk), 1);
        assert_eq!(
            owes(&desk, &chapter, &missed),
            [(Direction::Recognition, 2)]
        );
    }

    #[test]
    fn leaving_halfway_keeps_the_answers_and_the_next_refresh_goes_on() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = ready(&desk, &numbered(5));
        let before = answers(&desk);

        // One right, one missed, and the learner leaves on the third word.
        let pass = begin(&desk, &chapter);
        let right = say(&desk, &pass, &pass.step, &good(&pass.step));
        assert!(!say(&desk, &pass, &right.step, "no").correct);
        let gone = [
            asked(&pass.step).prompt.clone(),
            asked(&right.step).prompt.clone(),
        ];
        assert_eq!(answers(&desk), before + 2, "kept as they were given");
        let missed = asked(&right.step).word_id.clone();
        assert_eq!(
            owes(&desk, &chapter, &missed),
            [(Direction::Recognition, 2)]
        );
        assert_eq!(readiness(&desk, &chapter), Some(80));

        // Practised back to done, the chapter offers the refresh again: the
        // same pass, on the words it has not asked.
        desk.play(&chapter, t0());
        let later = t0() + TimeDelta::days(1);
        let resumed = start(desk.ctx(), &chapter, later).expect("goes on");
        assert_eq!(resumed.id, pass.id);
        let mut step = resumed.step.clone();
        let mut prompts = Vec::new();
        while let RefreshStep::Item { item, .. } = &step {
            prompts.push(item.prompt.clone());
            let text = translation(&item.prompt);
            step = answer(desk.ctx(), &resumed.id, &item.word_id, &text, later)
                .expect("answer")
                .step;
        }
        assert_eq!(prompts.len(), 3);
        assert!(prompts.iter().all(|prompt| !gone.contains(prompt)));
        // The missed word was done again since: it is not back in practice.
        assert_eq!(step, over(4, 0, 5));
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM practice_sittings WHERE kind = 'refresh'"),
            1
        );

        // A pass whose last words became known has nothing to go on with.
        let third = start(desk.ctx(), &chapter, later).expect("a new pass");
        let answered = asked(&third.step).prompt.clone();
        say(&desk, &third, &third.step, &good(&third.step));
        for lemma in ["w00", "w01", "w02", "w03", "w04"] {
            if lemma != answered {
                let id = word_id(&desk, lemma);
                words::set_known(&desk.db.lock().expect("db"), &id, true, later).expect("known");
            }
        }
        let fresh = start(desk.ctx(), &chapter, later).expect("starts over");
        assert_ne!(fresh.id, third.id);
        assert_eq!(asked(&fresh.step).prompt, answered);
    }

    #[test]
    fn every_step_of_a_pass_says_how_many_of_its_words_it_has_asked() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = ready(&desk, &numbered(3));
        let pass = begin(&desk, &chapter);
        assert_eq!(bar(&pass.step), (0, 3));
        let right = say(&desk, &pass, &pass.step, &good(&pass.step));
        assert_eq!(bar(&right.step), (1, 3));

        // Left and gone on with, the bar is where it was.
        let resumed = begin(&desk, &chapter);
        assert_eq!(resumed.id, pass.id);
        assert_eq!(bar(&resumed.step), (1, 3));

        // A miss is a word asked like any other: the bar only goes forward,
        // and is full when the summary comes.
        let miss = say(&desk, &pass, &resumed.step, "no");
        assert!(!miss.correct);
        assert_eq!(bar(&miss.step), (2, 3));
        let last = say(&desk, &pass, &miss.step, &good(&miss.step));
        assert_eq!(last.step, over(2, 1, 3));
        assert_eq!(bar(&last.step), (3, 3));
    }

    #[test]
    fn a_refresh_and_practice_do_not_answer_each_other() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = ready(&desk, &numbered(3));
        let open = desk.chapter("c", &[word("peep", &["asomarse"], 2)]);
        let sat = desk.start(&open, t0());
        let PracticeStep::Item { item: peep, .. } = sat.step.clone() else {
            panic!("a word to practise");
        };
        let before = answers(&desk);

        let unready = start(desk.ctx(), &open, t0()).expect_err("still practised");
        assert_eq!(unready.kind(), "invalid");
        let nowhere = start(desk.ctx(), "nowhere", t0()).expect_err("no chapter");
        assert_eq!(nowhere.kind(), "notFound");

        let pass = begin(&desk, &chapter);
        let first = asked(&pass.step).clone();
        let known = word_id(&desk, if first.prompt == "w02" { "w01" } else { "w02" });
        words::set_known(&desk.db.lock().expect("db"), &known, true, t0()).expect("known");
        let refuse = |pass: &str, word: &str| {
            answer(desk.ctx(), pass, word, "x", t0())
                .expect_err("refused")
                .kind()
        };
        assert_eq!(refuse(&pass.id, &known), "invalid", "a known word");
        assert_eq!(
            refuse(&pass.id, &peep.word_id),
            "invalid",
            "another chapter"
        );
        assert_eq!(refuse(&sat.id, &first.word_id), "invalid", "not a refresh");
        assert_eq!(refuse(&pass.id, "nowhere"), "notFound");
        assert_eq!(refuse("nowhere", &first.word_id), "notFound");

        // Practice does not take a pass for a sitting of its own.
        let as_practice = sitting::answer(
            desk.ctx(),
            &pass.id,
            (&peep.word_id, Direction::Recognition),
            "asomarse",
            t0(),
        )
        .expect_err("a refresh");
        assert_eq!(as_practice.kind(), "invalid");
        let knowing = know(desk.ctx(), &pass.id, &first.word_id, t0()).expect_err("a refresh");
        assert_eq!(knowing.kind(), "invalid");
        let stepping = sitting::current(desk.ctx(), &pass.id, t0()).expect_err("a refresh");
        assert_eq!(stepping.kind(), "invalid");
        assert_eq!(answers(&desk), before);

        // A word is asked once in a pass, and its miss is not put to Claude.
        let miss = say(&desk, &pass, &pass.step, "otra cosa");
        assert_eq!(refuse(&pass.id, &first.word_id), "invalid", "asked already");
        let seq = desk.count("SELECT MAX(seq) FROM word_answers");
        let disputed = dispute(
            desk.ctx(),
            seq,
            &mut |_| panic!("the model is not asked"),
            t0(),
        )
        .expect_err("a refresh");
        assert_eq!(disputed.kind(), "invalid");
        assert_ne!(asked(&miss.step).prompt, first.prompt);
    }
}
