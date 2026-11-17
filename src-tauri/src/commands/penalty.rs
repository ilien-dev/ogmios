//! The penalty review in a session of practice (`books::penalty`): once a
//! word of the chapter is missed too many times in a row, the session asks
//! nothing else until the word is answered right every time in a row, each
//! way, in an order drawn at random. What it asks is read off the word's
//! row and its answers (`db::penalty`); its answers are kept there, never
//! among the word's answers: a penalty answered through finishes no word.

use chrono::{DateTime, Local, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::practice::{all_small, item, plain, small, Tries};
use super::profile::require_profile;
use super::run;
use crate::books::penalty::{after_clean, after_slip, order, raised, reps, Standing};
use crate::books::practice::seed;
use crate::db::penalty::{self, Due};
use crate::db::practice::{self, SittingRow};
use crate::db::profile;
use crate::domain::{Direction, PenaltyAnswer, PenaltyStep, PracticeStep, SittingProgress};
use crate::error::{Error, Result};
use crate::Ctx;

/// The penalty the sitting's chapter has due, as this sitting stands with
/// it. One under way is answered through in a single sitting: read in
/// another sitting than the one it was answered in last, it starts over.
fn standing(conn: &Connection, sitting: &SittingRow) -> Result<Option<Due>> {
    let Some(mut due) = penalty::due(conn, &sitting.chapter_id)? else {
        return Ok(None);
    };
    if due.row.position > 0 && due.row.sitting_id.as_deref() != Some(sitting.id.as_str()) {
        due.row.position = 0;
        due.row.restarts += 1;
        due.row.sitting_id = Some(sitting.id.clone());
        penalty::save(conn, &due.row)?;
    }
    Ok(Some(due))
}

/// The rung a penalty is asked on, and its order: drawn for the word, the
/// miss it is due for and how often it started over.
fn drawn(due: &Due) -> (u32, Vec<Direction>) {
    let rung = raised(due.row.standing.rung);
    let key = format!("{}{}{}", due.row.word_id, due.trigger, due.row.restarts);
    (rung, order(seed(&key), reps(rung)))
}

/// The question the penalty asks now, and the ways it was answered in.
fn at(due: &Due, order: &[Direction]) -> (Direction, Vec<Direction>) {
    let done = usize::try_from(due.row.position)
        .unwrap_or(usize::MAX)
        .min(order.len().saturating_sub(1));
    (order[done], order[..done].to_vec())
}

/// What a sitting shows while its chapter has a penalty due, with `progress`
/// for its bar, which stays where the session was; none when none is due.
pub(super) fn step(
    conn: &Connection,
    sitting: &SittingRow,
    progress: SittingProgress,
) -> Result<Option<PracticeStep>> {
    let Some(due) = standing(conn, sitting)? else {
        return Ok(None);
    };
    let (rung, order) = drawn(&due);
    let (direction, answered) = at(&due, &order);
    let word = practice::word(conn, &due.row.word_id)?;
    let english = small(&word.lemma);
    let native = small(&word.shown_as().join(", "));
    Ok(Some(PracticeStep::Penalty {
        penalty: PenaltyStep {
            rung,
            reps: reps(rung),
            answered,
            english,
            native,
            item: item(word, direction),
        },
        progress,
    }))
}

/// Whether the chapter has a penalty due: nothing else is asked until it is
/// answered through.
pub(super) fn refuse_while_due(conn: &Connection, chapter_id: &str) -> Result<()> {
    if penalty::due(conn, chapter_id)?.is_some() {
        return Err(Error::Invalid("a penalty is due".into()));
    }
    Ok(())
}

/// An answer just kept, of a word in a sitting of practice or a pass of the
/// refresh, as the word's rung counts it. The first answer to the word in a
/// sitting, right and `clean` (with no hint and on the first try), is a clean
/// session; a miss, or a first answer that was helped, starts the count over.
pub(super) fn counted(
    conn: &Connection,
    (word_id, seq): (&str, i64),
    (correct, clean): (bool, bool),
    now: DateTime<Utc>,
) -> Result<()> {
    let mut row = penalty::row(conn, word_id)?;
    if row.standing.rung == 0 {
        return Ok(());
    }
    let first = penalty::is_first_in_sitting(conn, word_id, seq)?;
    row.standing = if first && correct && clean {
        after_clean(row.standing, now.with_timezone(&Local).date_naive())
    } else if first || !correct {
        after_slip(row.standing)
    } else {
        return Ok(());
    };
    penalty::save(conn, &row)
}

/// Checks one answer to the penalty a session is showing and says what
/// comes next. Right, the penalty goes one on; the last one right puts the
/// word on its rung and the session goes on. A miss starts it over, in a new
/// order: "I don't know", an empty answer, is one. The word in another form,
/// or another word for what was shown, is no answer the first time.
pub fn answer(
    ctx: Ctx<'_>,
    sitting_id: &str,
    (word_id, direction): (&str, Direction),
    (text, tries): (&str, Tries),
    now: DateTime<Utc>,
) -> Result<PenaltyAnswer> {
    let mut conn = ctx.conn()?;
    let native_lang = require_profile(&conn)?.native_lang;
    let spelling = profile::spelling(&conn)?;
    let tx = conn.transaction()?;
    let sitting = practice::sitting(&tx, sitting_id)?;
    let not_asked = || Error::Invalid("this penalty is not being asked".into());
    if sitting.refresh || sitting.finished {
        return Err(not_asked());
    }
    let Some(mut due) = standing(&tx, &sitting)?.filter(|due| due.row.word_id == word_id) else {
        return Err(not_asked());
    };
    let (rung, order) = drawn(&due);
    if at(&due, &order).0 != direction {
        return Err(not_asked());
    }
    let word = practice::word(&tx, word_id)?;
    let judged = plain(&tx, &word, (direction, text), (&native_lang, spelling))?;
    let accepted = all_small(&judged.accepted);
    if judged.is_no_answer() && !tries.second {
        let step = super::practice::step(&tx, &sitting, now)?;
        return Ok(PenaltyAnswer {
            correct: false,
            accepted: Vec::new(),
            again: true,
            restarted: false,
            finished: false,
            step,
        });
    }
    let correct = judged.is_right();
    due.row.trigger_seq = Some(due.trigger);
    due.row.sitting_id = Some(sitting.id.clone());
    let finished = correct && due.row.position + 1 >= 2 * reps(rung);
    if finished {
        due.row = penalty::PenaltyRow {
            word_id: due.row.word_id,
            standing: Standing {
                rung,
                ..Standing::default()
            },
            since_seq: due.trigger,
            ..penalty::PenaltyRow::default()
        };
    } else if correct {
        due.row.position += 1;
    } else {
        due.row.position = 0;
        due.row.restarts += 1;
    }
    penalty::save(&tx, &due.row)?;
    let step = super::practice::step(&tx, &sitting, now)?;
    tx.commit()?;
    Ok(PenaltyAnswer {
        correct,
        accepted,
        again: false,
        restarted: !correct,
        finished,
        step,
    })
}

#[tauri::command]
pub async fn answer_penalty(
    app: AppHandle,
    sitting_id: String,
    word_id: String,
    direction: Direction,
    answer: String,
    tries: Option<Tries>,
) -> Result<PenaltyAnswer> {
    run(app, move |_, ctx| {
        self::answer(
            ctx,
            &sitting_id,
            (&word_id, direction),
            (&answer, tries.unwrap_or_default()),
            Utc::now(),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use chrono::TimeDelta;

    use super::*;
    use crate::commands::practice::tests::{item as asked, numbered, right, Desk};
    use crate::commands::practice::{self as sitting, Shown};
    use crate::domain::{AnswerResult, PracticeItem, Sitting, Ways};

    fn penalty_of(step: &PracticeStep) -> &PenaltyStep {
        match step {
            PracticeStep::Penalty { penalty, .. } => penalty,
            other => panic!("no penalty: {other:?}"),
        }
    }

    fn is_penalty(step: &PracticeStep) -> bool {
        matches!(step, PracticeStep::Penalty { .. })
    }

    fn miss(
        desk: &Desk,
        sitting: &Sitting,
        step: &PracticeStep,
        now: DateTime<Utc>,
    ) -> AnswerResult {
        desk.answer(sitting, asked(step), "", now)
    }

    /// Misses whatever the session asks, three times: the third one's step.
    fn three_misses(desk: &Desk, sitting: &Sitting, now: DateTime<Utc>) -> PracticeStep {
        let mut step = sitting.step.clone();
        for _ in 0..3 {
            step = miss(desk, sitting, &step, now).step;
        }
        step
    }

    fn give(
        desk: &Desk,
        sitting: &Sitting,
        item: &PracticeItem,
        text: &str,
        now: DateTime<Utc>,
    ) -> Result<PenaltyAnswer> {
        answer(
            desk.ctx(),
            &sitting.id,
            (&item.word_id, item.direction),
            (text, Tries::default()),
            now,
        )
    }

    /// Answers the penalty right through; the step after it.
    fn through(
        desk: &Desk,
        sitting: &Sitting,
        step: PracticeStep,
        now: DateTime<Utc>,
    ) -> PracticeStep {
        let mut step = step;
        loop {
            let item = penalty_of(&step).item.clone();
            let result = give(desk, sitting, &item, &right(&item), now).expect("answer");
            assert!(result.correct, "{}", item.prompt);
            if result.finished {
                return result.step;
            }
            step = result.step;
        }
    }

    #[test]
    fn three_misses_in_a_row_make_a_penalty_the_next_step() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let first = miss(&desk, &sitting, &sitting.step, now).step;
        let second = miss(&desk, &sitting, &first, now).step;
        assert!(!is_penalty(&second), "two misses are not enough");
        let third = miss(&desk, &sitting, &second, now).step;
        let penalty = penalty_of(&third);
        assert_eq!((penalty.rung, penalty.reps), (1, 3));
        assert_eq!(penalty.answered, Vec::<Direction>::new());
        assert_eq!(penalty.english, "w00");
        assert_eq!(penalty.native, "w00es");
        assert_eq!(
            penalty.item.sentence_id, None,
            "asked as its chapter has it"
        );
    }

    #[test]
    fn a_right_answer_between_the_misses_breaks_the_streak() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let step = miss(&desk, &sitting, &sitting.step, now).step;
        let step = miss(&desk, &sitting, &step, now).step;
        let shown = asked(&step).clone();
        let step = desk.answer(&sitting, &shown, &right(&shown), now).step;
        let step = miss(&desk, &sitting, &step, now).step;
        assert!(!is_penalty(&step));
    }

    #[test]
    fn the_penalty_asks_three_each_way_and_then_the_session_goes_on() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(2));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let mut step = sitting.step.clone();
        let target = asked(&step).word_id.clone();
        // Miss the first word every time it comes, and answer the other.
        while !is_penalty(&step) {
            let shown = asked(&step).clone();
            let text = if shown.word_id == target {
                String::new()
            } else {
                right(&shown)
            };
            step = desk.answer(&sitting, &shown, &text, now).step;
        }
        let answers = desk.count("SELECT COUNT(*) FROM word_answers");
        let mut ways = Vec::new();
        loop {
            let penalty = penalty_of(&step).clone();
            assert_eq!(penalty.item.word_id, target);
            assert_eq!(penalty.answered, ways, "it says what was answered");
            ways.push(penalty.item.direction);
            let result =
                give(&desk, &sitting, &penalty.item, &right(&penalty.item), now).expect("answer");
            step = result.step;
            if result.finished {
                break;
            }
        }
        assert_eq!(ways.len(), 6);
        assert_eq!(
            ways.iter()
                .filter(|way| **way == Direction::Recognition)
                .count(),
            3
        );
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM word_answers"),
            answers,
            "a penalty's answers are not the word's"
        );
        assert!(
            matches!(step, PracticeStep::Item { .. }),
            "the session goes on"
        );
        assert_eq!(desk.count("SELECT rung FROM word_penalties"), 1);
    }

    #[test]
    fn a_miss_starts_the_penalty_over_in_a_new_order() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let mut step = three_misses(&desk, &sitting, now);
        for _ in 0..4 {
            let item = penalty_of(&step).item.clone();
            step = give(&desk, &sitting, &item, &right(&item), now)
                .expect("right")
                .step;
        }
        assert_eq!(penalty_of(&step).answered.len(), 4);
        let item = penalty_of(&step).item.clone();
        let result = give(&desk, &sitting, &item, "", now).expect("miss");
        assert!(result.restarted && !result.correct);
        assert!(!result.accepted.is_empty(), "what was asked for is shown");
        let again = penalty_of(&result.step);
        assert_eq!(again.answered, Vec::<Direction>::new(), "back to the first");
        assert_eq!(again.rung, 1, "on the same rung");
        assert_eq!(desk.count("SELECT restarts FROM word_penalties"), 1);
    }

    #[test]
    fn nothing_else_is_asked_while_a_penalty_is_due() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(2));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let mut step = sitting.step.clone();
        let target = asked(&step).word_id.clone();
        let mut other = None;
        while !is_penalty(&step) {
            let shown = asked(&step).clone();
            if shown.word_id != target {
                other = Some(shown.clone());
            }
            let text = if shown.word_id == target {
                String::new()
            } else {
                right(&shown)
            };
            step = desk.answer(&sitting, &shown, &text, now).step;
        }
        let item = penalty_of(&step).item.clone();
        let refused = sitting::answer(
            desk.ctx(),
            &sitting.id,
            (&item.word_id, item.direction),
            "x",
            now,
        );
        assert!(
            refused.is_err(),
            "the word itself is asked by the penalty alone"
        );
        if let Some(other) = other {
            let refused = sitting::answer_shown(
                desk.ctx(),
                &sitting.id,
                (&other.word_id, other.direction),
                ("x", Shown::default()),
                now,
            );
            assert!(refused.is_err());
        }
        let wrong_way = match item.direction {
            Direction::Recognition => Direction::Production,
            Direction::Production => Direction::Recognition,
        };
        let refused = answer(
            desk.ctx(),
            &sitting.id,
            (&item.word_id, wrong_way),
            ("x", Tries::default()),
            now,
        );
        assert!(refused.is_err(), "only the question it asks now");
        assert!(sitting::know(desk.ctx(), &sitting.id, &item.word_id, now).is_err());
    }

    #[test]
    fn left_halfway_the_penalty_starts_over_in_the_next_session() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let mut step = three_misses(&desk, &sitting, now);
        for _ in 0..2 {
            let item = penalty_of(&step).item.clone();
            step = give(&desk, &sitting, &item, &right(&item), now)
                .expect("right")
                .step;
        }
        assert_eq!(penalty_of(&step).answered.len(), 2);
        let ended = sitting::end(desk.ctx(), &chapter, now)
            .expect("end")
            .expect("summary");
        assert!(
            matches!(ended, PracticeStep::Summary { .. }),
            "End shows the summary"
        );
        let next = desk.start(&chapter, now);
        let penalty = penalty_of(&next.step);
        assert_eq!(
            penalty.answered,
            Vec::<Direction>::new(),
            "from the first again"
        );
        assert_eq!(penalty.rung, 1);
    }

    #[test]
    fn a_penalty_due_on_the_last_question_comes_before_the_summary() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let step = three_misses(&desk, &sitting, now);
        let after = through(&desk, &sitting, step, now);
        // The word still owes its answers: the session goes on with it.
        assert!(matches!(after, PracticeStep::Item { .. }));
        let (_, summary) = desk.finish(
            &Sitting {
                id: sitting.id.clone(),
                step: after,
            },
            now,
        );
        assert_eq!(summary.done, 1);
    }

    #[test]
    fn each_new_streak_climbs_a_rung_up_to_twenty_four() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let mut seen = Vec::new();
        let mut step = sitting.step.clone();
        for _ in 0..5 {
            for _ in 0..3 {
                step = miss(&desk, &sitting, &step, now).step;
            }
            seen.push(penalty_of(&step).reps);
            step = through(&desk, &sitting, step, now);
        }
        assert_eq!(seen, [3, 6, 12, 24, 24]);
        assert_eq!(desk.count("SELECT rung FROM word_penalties"), 4);
    }

    #[test]
    fn a_miss_taken_back_before_the_penalty_starts_makes_none_due() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let step = three_misses(&desk, &sitting, now);
        assert!(is_penalty(&step));
        desk.db
            .lock()
            .expect("db")
            .execute(
                "UPDATE word_answers SET correct = 1
                 WHERE seq = (SELECT MAX(seq) FROM word_answers)",
                [],
            )
            .expect("upheld");
        let now_step = sitting::current(desk.ctx(), &sitting.id, now).expect("step");
        assert!(
            !is_penalty(&now_step),
            "the miss is undone, and so is the penalty"
        );
    }

    #[test]
    fn a_penalty_under_way_stays_due_whatever_happens_to_its_miss() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let now = Utc::now();
        let sitting = desk.start(&chapter, now);
        let step = three_misses(&desk, &sitting, now);
        let item = penalty_of(&step).item.clone();
        give(&desk, &sitting, &item, &right(&item), now).expect("right");
        desk.db
            .lock()
            .expect("db")
            .execute("UPDATE word_answers SET correct = 1", [])
            .expect("upheld");
        let now_step = sitting::current(desk.ctx(), &sitting.id, now).expect("step");
        assert_eq!(penalty_of(&now_step).answered.len(), 1);
    }

    /// One word on rung 1, its penalty answered through on `now`.
    fn on_a_rung(desk: &Desk, now: DateTime<Utc>) -> String {
        let chapter = desk.chapter("b", &numbered(1));
        let sitting = desk.start(&chapter, now);
        let step = three_misses(desk, &sitting, now);
        through(desk, &sitting, step, now);
        sitting::end(desk.ctx(), &chapter, now).expect("end");
        chapter
    }

    /// A session of every word of the chapter in `ways`, its first answer
    /// right or missed, and the session ended.
    fn session(desk: &Desk, chapter: &str, first_right: bool, now: DateTime<Utc>) {
        let sitting = sitting::start(desk.ctx(), chapter, (None, Ways::Both), now).expect("start");
        let shown = asked(&sitting.step).clone();
        let text = if first_right {
            right(&shown)
        } else {
            String::new()
        };
        desk.answer(&sitting, &shown, &text, now);
        sitting::end(desk.ctx(), chapter, now).expect("end");
    }

    #[test]
    fn two_clean_sessions_on_different_days_take_the_rung_back() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let now = Utc::now();
        let chapter = on_a_rung(&desk, now);
        assert_eq!(desk.count("SELECT rung FROM word_penalties"), 1);
        session(&desk, &chapter, true, now + TimeDelta::days(1));
        session(&desk, &chapter, true, now + TimeDelta::days(1));
        assert_eq!(
            desk.count("SELECT clean FROM word_penalties"),
            1,
            "one a day"
        );
        session(&desk, &chapter, true, now + TimeDelta::days(3));
        assert_eq!(desk.count("SELECT rung FROM word_penalties"), 0);
    }

    #[test]
    fn a_miss_starts_the_clean_sessions_over() {
        let dir = tempfile::tempdir().expect("dir");
        let desk = Desk::new(&dir);
        let now = Utc::now();
        let chapter = on_a_rung(&desk, now);
        session(&desk, &chapter, true, now + TimeDelta::days(1));
        session(&desk, &chapter, false, now + TimeDelta::days(2));
        session(&desk, &chapter, true, now + TimeDelta::days(3));
        assert_eq!(desk.count("SELECT rung FROM word_penalties"), 1);
        assert_eq!(desk.count("SELECT clean FROM word_penalties"), 1);
    }
}
