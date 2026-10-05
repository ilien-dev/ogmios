//! The daily recall: a short run over the learned words that are due today,
//! of every book and every conversation, each asked once and checked by code
//! like an answer of practice. A right answer sends the word further away
//! and a miss brings it back sooner (`memory::recall`).
//!
//! Its answers are events of the word, never answers of a chapter: a miss
//! here does not reopen the word where it was learned. A run keeps no words
//! of its own: it asks the most overdue ones as they stand, in an order
//! drawn for it, until it has asked `memory::recall::SIZE` or none is due.
//! No request to the model is made.

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::practice::{
    another, asked_with, climb, clue, in_place, item, judged, next_sentence, plain, shown_sentence,
    whole, Judged, Meaning, Shown, Tries,
};
use super::profile::require_profile;
use super::run;
use crate::books::practice::{accepts_english, pass_progress, pick, seed};
use crate::books::sentences::{or_other, Verdict};
use crate::books::spelling::Spelling;
use crate::db::recall::{self, RecallWord, RunRow, Source};
use crate::db::sentences::{self, Sentence};
use crate::db::{practice, profile};
use crate::domain::{
    Direction, PracticeItem, Recall, RecallAnswer, RecallState, RecallStep, RecallSummary,
    SentencePart, Strength, Ways, WordHint,
};
use crate::error::{Error, Result};
use crate::memory::recall::{direction, strength, SIZE};
use crate::Ctx;

/// Whether a run of these `ways` asks the word. One asked for in a
/// conversation is only ever asked towards English: what the learner wrote
/// then is what it is asked by, not a translation to check an answer with.
fn asks(word: &RecallWord, ways: Ways) -> bool {
    match word.source {
        Source::Book { .. } => true,
        Source::Chat { .. } => ways != Ways::Recognition,
    }
}

/// Which way a run of these `ways` asks the word as it stands.
fn way(word: &RecallWord, ways: Ways) -> Direction {
    match word.source {
        Source::Book { .. } => direction(word.standing.step, ways),
        Source::Chat { .. } => Direction::Production,
    }
}

/// The learned words due by `now` that a run of these `ways` asks, the most
/// overdue first.
fn due(conn: &Connection, ways: Ways, now: DateTime<Utc>) -> Result<Vec<RecallWord>> {
    let mut due: Vec<RecallWord> = recall::words(conn)?
        .into_iter()
        .filter(|word| word.standing.due_at <= now && asks(word, ways))
        .collect();
    due.sort_by(|a, b| (a.standing.due_at, &a.key).cmp(&(b.standing.due_at, &b.key)));
    Ok(due)
}

/// What fixes the sense of a word: the sentence its chapter has it in, or
/// what the learner asked for in a conversation.
fn sense(conn: &Connection, word: &RecallWord) -> Result<String> {
    Ok(match &word.source {
        Source::Book { word_id } => practice::word(conn, word_id)?.sentence,
        Source::Chat { asked } => asked.clone(),
    })
}

/// The word as a run asks it. It goes by its key: it is of no chapter.
/// With a bank it comes in one of its sentences, a different one each time
/// (`commands::practice::next_sentence`); until it has one, as it was
/// learned.
fn asked(
    conn: &Connection,
    word: &RecallWord,
    direction: Direction,
    run_id: &str,
) -> Result<PracticeItem> {
    let own = sense(conn, word)?;
    if let Some(sentence) = next_sentence(conn, (&word.key, &own), run_id)? {
        let (part_of_speech, needs_context) = match &word.source {
            Source::Book { word_id } => {
                let row = practice::word(conn, word_id)?;
                (row.part_of_speech, row.needs_context)
            }
            Source::Chat { .. } => (None, false),
        };
        return Ok(asked_with(
            (word.key.clone(), part_of_speech),
            &sentence,
            direction,
            needs_context,
        ));
    }
    Ok(match &word.source {
        Source::Book { word_id } => PracticeItem {
            word_id: word.key.clone(),
            ..item(practice::word(conn, word_id)?, direction)
        },
        Source::Chat { asked } => PracticeItem {
            word_id: word.key.clone(),
            direction,
            prompt: asked.clone(),
            part_of_speech: None,
            context: None,
            sentence_id: None,
        },
    })
}

/// What the run shows next: one of the due words, drawn among the most
/// overdue it still has room for, or its summary when it has asked its
/// share or none is due. That is its end, and it is stamped.
fn step(conn: &Connection, run: &RunRow, now: DateTime<Utc>) -> Result<RecallStep> {
    let (right, missed) = recall::answered(conn, &run.id)?;
    let answered = right.saturating_add(missed);
    let due = due(conn, run.ways, now)?;
    let turn = usize::try_from(answered).unwrap_or(usize::MAX);
    let room = if run.finished {
        0
    } else {
        SIZE.saturating_sub(turn).min(due.len())
    };
    let drawn = pick(seed(&run.id), turn, room).and_then(|at| due.get(at));
    let Some(word) = drawn else {
        recall::finish(conn, &run.id, now)?;
        return Ok(RecallStep::Summary {
            summary: RecallSummary {
                right,
                missed,
                left: u32::try_from(due.len()).unwrap_or(u32::MAX),
            },
            progress: pass_progress(answered, 0),
        });
    };
    Ok(RecallStep::Item {
        item: asked(conn, word, way(word, run.ways), &run.id)?,
        progress: pass_progress(answered, room),
    })
}

/// How many learned words are due by `now`, in any way.
pub(super) fn due_count(conn: &Connection, now: DateTime<Utc>) -> Result<u32> {
    let due = due(conn, Ways::Both, now)?.len();
    Ok(u32::try_from(due).unwrap_or(u32::MAX))
}

/// What is due today, and how strong the learned words are.
pub fn state(ctx: Ctx<'_>, now: DateTime<Utc>) -> Result<RecallState> {
    let words = recall::words(&*ctx.conn()?)?;
    let count = |of: &dyn Fn(&RecallWord) -> bool| {
        u32::try_from(words.iter().filter(|word| of(word)).count()).unwrap_or(u32::MAX)
    };
    let strong = |level: Strength| count(&|word| strength(word.standing.step) == level);
    Ok(RecallState {
        due: count(&|word| word.standing.due_at <= now),
        fresh: strong(Strength::New),
        settling: strong(Strength::Settling),
        firm: strong(Strength::Firm),
    })
}

/// Starts a run in these `ways` and gives its first word, or its summary
/// when nothing is due.
pub fn start(ctx: Ctx<'_>, ways: Ways, now: DateTime<Utc>) -> Result<Recall> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let run = recall::run(&tx, &recall::start(&tx, ways, now)?)?;
    let step = step(&tx, &run, now)?;
    tx.commit()?;
    Ok(Recall { id: run.id, step })
}

/// Judges an answer to the word asked in a direction: against the sentence
/// it was asked with, when there is one, and otherwise as it was learned.
/// Towards English, another word the learner has for what was shown is no
/// miss, whatever the word is from (`books::sentences::or_other`).
fn check(
    conn: &Connection,
    word: &RecallWord,
    sentence: Option<&Sentence>,
    (direction, answer): (Direction, &str),
    (native_lang, spelling): (&str, Spelling),
) -> Result<Judged> {
    let how = (native_lang, spelling);
    match (&word.source, sentence) {
        (Source::Book { word_id }, Some(sentence)) => {
            let row = practice::word(conn, word_id)?;
            let meaning = Meaning::of(conn, &row)?;
            judged(conn, &meaning, sentence, (direction, answer), how)
        }
        (Source::Book { word_id }, None) => {
            let row = practice::word(conn, word_id)?;
            plain(conn, &row, (direction, answer), how)
        }
        (Source::Chat { asked }, Some(sentence)) => {
            let shown = std::slice::from_ref(asked);
            let meaning = Meaning {
                translations: shown,
                shown,
                forms: word.forms.clone(),
                upheld: &[],
                rivals: sentences::rivals(conn, &word.key, shown)?,
                inflects: false,
            };
            judged(conn, &meaning, sentence, (direction, answer), how)
        }
        (Source::Chat { asked }, None) => {
            let verdict = if accepts_english(answer, &word.english, &[], spelling) {
                Verdict::Right
            } else {
                Verdict::Miss
            };
            let rivals = sentences::rivals(conn, &word.key, std::slice::from_ref(asked))?;
            Ok(Judged {
                verdict: or_other(verdict, answer, &rivals, spelling),
                accepted: vec![word.english.clone()],
                exact: None,
            })
        }
    }
}

/// What a hint to the word is made of (`commands::practice::clue`). A word
/// of a conversation is asked for its English: the hint is to that, after
/// the sentence of its bank it is asked with, if any.
fn clue_of(
    conn: &Connection,
    word: &RecallWord,
    sentence: Option<&Sentence>,
    direction: Direction,
) -> Result<(String, Option<Vec<SentencePart>>)> {
    Ok(match &word.source {
        Source::Book { word_id } => clue(&practice::word(conn, word_id)?, sentence, direction),
        Source::Chat { .. } => (
            sentence.map_or_else(|| word.english.clone(), |each| each.form.clone()),
            sentence.and_then(|each| in_place(each, direction)),
        ),
    })
}

/// Checks one answer of a run, keeps it, and says what comes next. The word
/// has to be one the run can ask: due, and asked in its ways. An empty
/// answer is "I don't know": a miss like any other. For a word that keeps
/// slipping the verdict carries the learner's own note on it.
#[cfg(test)]
pub fn answer(
    ctx: Ctx<'_>,
    run_id: &str,
    key: &str,
    answer: &str,
    now: DateTime<Utc>,
) -> Result<RecallAnswer> {
    answer_shown(ctx, run_id, key, (answer, Shown::default()), now)
}

/// [`answer`], for a word asked with a sentence of its bank: the answer
/// names that sentence and is checked against it, with one more try for
/// the word in a form that does not fill the blank, or for another word
/// for what was shown (`commands::practice::answer_shown`).
pub fn answer_shown(
    ctx: Ctx<'_>,
    run_id: &str,
    key: &str,
    (answer, shown): (&str, Shown<'_>),
    now: DateTime<Utc>,
) -> Result<RecallAnswer> {
    let mut conn = ctx.conn()?;
    let native_lang = require_profile(&conn)?.native_lang;
    let spelling = profile::spelling(&conn)?;
    let tx = conn.transaction()?;
    let run = recall::run(&tx, run_id)?;
    let word = due(&tx, run.ways, now)?
        .into_iter()
        .find(|word| word.key == key)
        .filter(|_| !run.finished)
        .ok_or_else(|| Error::Invalid("this word is not being asked".into()))?;
    let direction = way(&word, run.ways);
    let sentence = shown_sentence(&tx, key, shown)?;
    let judged = check(
        &tx,
        &word,
        sentence.as_ref(),
        (direction, answer),
        (&native_lang, spelling),
    )?;
    if judged.is_no_answer() && !shown.second {
        let told = if judged.verdict == Verdict::OtherWord {
            let (answer, context) = clue_of(&tx, &word, sentence.as_ref(), direction)?;
            Some(another(&answer, context))
        } else {
            None
        };
        return Ok(RecallAnswer {
            correct: false,
            accepted: Vec::new(),
            step: step(&tx, &run, now)?,
            stubborn: false,
            note: None,
            answer_id: 0,
            again: true,
            another: told,
            helped: false,
            exact: None,
            sentence: None,
        });
    }
    let correct = judged.is_right();
    let answer_id = recall::record(
        &tx,
        &run.id,
        (key, direction),
        (answer.trim(), correct),
        (sentence.as_ref().map(|each| each.id.as_str()), now),
    )?;
    // This answer may be the miss that makes it one that keeps slipping.
    let stubborn = recall::words(&tx)?
        .iter()
        .any(|after| after.key == key && after.stubborn);
    let note = recall::note(&tx, key)?;
    let step = step(&tx, &run, now)?;
    tx.commit()?;
    Ok(RecallAnswer {
        correct,
        accepted: judged.accepted,
        step,
        stubborn,
        note,
        answer_id,
        again: false,
        another: None,
        helped: correct && shown.helped(),
        exact: judged.exact,
        sentence: sentence.as_ref().map(whole),
    })
}

/// The hint the learner asked for on the word a run is showing
/// ([`clue_of`]). Nothing is kept.
pub fn hint(
    ctx: Ctx<'_>,
    run_id: &str,
    key: &str,
    (sentence_id, asked): (Option<&str>, usize),
    now: DateTime<Utc>,
) -> Result<WordHint> {
    let conn = ctx.conn()?;
    let run = recall::run(&conn, run_id)?;
    let word = due(&conn, run.ways, now)?
        .into_iter()
        .find(|word| word.key == key)
        .filter(|_| !run.finished)
        .ok_or_else(|| Error::Invalid("this word is not being asked".into()))?;
    let shown = Shown {
        sentence_id,
        ..Shown::default()
    };
    let sentence = shown_sentence(&conn, key, shown)?;
    let direction = way(&word, run.ways);
    let (answer, context) = clue_of(&conn, &word, sentence.as_ref(), direction)?;
    Ok(climb(&answer, context, asked))
}

/// "This sentence is bad" on the answer just given in a run: the sentence
/// is never asked with again and the answer is taken back, so the word is
/// due as it was. Only the last answer of the run can be.
pub fn discard(
    ctx: Ctx<'_>,
    run_id: &str,
    answer_id: i64,
    now: DateTime<Utc>,
) -> Result<RecallStep> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let Some(sentence_id) = recall::latest_sentence(&tx, run_id, answer_id)? else {
        return Err(Error::Invalid("this answer cannot be taken back".into()));
    };
    sentences::discard(&tx, &sentence_id)?;
    recall::void(&tx, run_id, answer_id)?;
    let step = step(&tx, &recall::run(&tx, run_id)?, now)?;
    tx.commit()?;
    Ok(step)
}

/// Keeps the learner's note on a word; an empty one takes it away.
pub fn save_note(ctx: Ctx<'_>, key: &str, note: &str, now: DateTime<Utc>) -> Result<()> {
    recall::save_note(&*ctx.conn()?, key, note, now)
}

#[tauri::command]
pub async fn recall_state(app: AppHandle) -> Result<RecallState> {
    run(app, |_, ctx| state(ctx, Utc::now())).await
}

#[tauri::command]
pub async fn start_recall(app: AppHandle, ways: Ways) -> Result<Recall> {
    run(app, move |_, ctx| start(ctx, ways, Utc::now())).await
}

#[tauri::command]
pub async fn answer_recall(
    app: AppHandle,
    sitting_id: String,
    word_id: String,
    answer: String,
    sentence_id: Option<String>,
    tries: Option<Tries>,
) -> Result<RecallAnswer> {
    run(app, move |_, ctx| {
        let shown = Shown::of(sentence_id.as_deref(), tries);
        answer_shown(ctx, &sitting_id, &word_id, (&answer, shown), Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn hint_recall(
    app: AppHandle,
    sitting_id: String,
    word_id: String,
    sentence_id: Option<String>,
    asked: u32,
) -> Result<WordHint> {
    run(app, move |_, ctx| {
        let asked = usize::try_from(asked).unwrap_or(usize::MAX);
        hint(
            ctx,
            &sitting_id,
            &word_id,
            (sentence_id.as_deref(), asked),
            Utc::now(),
        )
    })
    .await
}

#[tauri::command]
pub async fn discard_recall_sentence(
    app: AppHandle,
    sitting_id: String,
    answer_id: i64,
) -> Result<RecallStep> {
    run(app, move |_, ctx| {
        discard(ctx, &sitting_id, answer_id, Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn save_word_note(app: AppHandle, word_id: String, note: String) -> Result<()> {
    run(app, move |_, ctx| {
        save_note(ctx, &word_id, &note, Utc::now())
    })
    .await
}

#[cfg(test)]
mod tests {
    use chrono::TimeDelta;

    use super::*;
    use crate::commands::practice::tests::{numbered, t0, translation, Desk};
    use crate::db::sessions;
    use crate::db::words;
    use crate::domain::{SittingProgress, VocabItem};
    use crate::memory::recall::DAYS;

    fn days(n: i64) -> DateTime<Utc> {
        t0() + TimeDelta::days(n)
    }

    /// A chapter of `count` numbered words, each learned at `t0`.
    fn learned(desk: &Desk, book: &str, count: u32) -> String {
        let chapter = desk.chapter(book, &numbered(count));
        let (_, summary) = desk.play(&chapter, t0());
        assert_eq!(summary.open, 0, "every word is done");
        chapter
    }

    fn shown(step: &RecallStep) -> &PracticeItem {
        match step {
            RecallStep::Item { item, .. } => item,
            RecallStep::Summary { .. } => panic!("the run is over"),
        }
    }

    fn bar(step: &RecallStep) -> (u32, u32) {
        let (RecallStep::Item { progress, .. } | RecallStep::Summary { progress, .. }) = step;
        (progress.value, progress.total)
    }

    /// The right answer to a numbered word, whichever way it is asked.
    fn right(item: &PracticeItem) -> String {
        match item.direction {
            Direction::Recognition => translation(&item.word_id),
            Direction::Production => item.word_id.clone(),
        }
    }

    /// Answers the word the step shows; right, or with a miss.
    fn reply(
        desk: &Desk,
        run: &Recall,
        step: &RecallStep,
        hit: bool,
        now: DateTime<Utc>,
    ) -> RecallAnswer {
        let item = shown(step);
        let text = if hit { right(item) } else { "nope".to_owned() };
        let result = answer(desk.ctx(), &run.id, &item.word_id, &text, now).expect("answer");
        assert_eq!(result.correct, hit, "{}", item.prompt);
        result
    }

    /// A run answered right to its summary; the keys asked, in order.
    fn play(desk: &Desk, ways: Ways, now: DateTime<Utc>) -> (Vec<String>, RecallSummary) {
        let run = start(desk.ctx(), ways, now).expect("start");
        let mut step = run.step.clone();
        let mut keys = Vec::new();
        loop {
            if let RecallStep::Summary { summary, .. } = step {
                return (keys, summary);
            }
            keys.push(shown(&step).word_id.clone());
            step = reply(desk, &run, &step, true, now).step;
        }
    }

    fn due_now(desk: &Desk, now: DateTime<Utc>) -> u32 {
        state(desk.ctx(), now).expect("state").due
    }

    #[test]
    fn a_learned_word_is_due_a_day_later_and_not_before() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 3);
        assert_eq!(
            state(desk.ctx(), t0()).expect("state"),
            RecallState {
                due: 0,
                fresh: 3,
                settling: 0,
                firm: 0
            }
        );
        assert_eq!(due_now(&desk, days(1)), 3);

        // Nothing due: the run is over as it starts.
        let early = start(desk.ctx(), Ways::Both, t0()).expect("start");
        assert_eq!(
            early.step,
            RecallStep::Summary {
                summary: RecallSummary {
                    right: 0,
                    missed: 0,
                    left: 0
                },
                progress: SittingProgress { value: 0, total: 0 },
            }
        );
    }

    #[test]
    fn a_right_answer_sends_the_word_away_and_a_miss_brings_it_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 2);
        let run = start(desk.ctx(), Ways::Both, days(1)).expect("start");
        assert_eq!(bar(&run.step), (0, 2));
        // Just learned: asked English → native first.
        assert_eq!(shown(&run.step).direction, Direction::Recognition);
        let hit = shown(&run.step).word_id.clone();
        let first = reply(&desk, &run, &run.step, true, days(1));
        assert_eq!(first.accepted, [translation(&hit)]);
        assert_eq!(bar(&first.step), (1, 2));
        let last = reply(&desk, &run, &first.step, false, days(1));
        assert_eq!(
            last.step,
            RecallStep::Summary {
                summary: RecallSummary {
                    right: 1,
                    missed: 1,
                    left: 0
                },
                progress: SittingProgress { value: 2, total: 2 },
            }
        );

        // The miss is due the next day; the hit only after its three days.
        assert_eq!(due_now(&desk, days(2)), 1);
        assert_eq!(due_now(&desk, days(1 + DAYS[1])), 2);
        let again = state(desk.ctx(), days(2)).expect("state");
        assert_eq!((again.fresh, again.settling), (1, 1));

        // The chapter is as ready as it was: a miss here reopens nothing.
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM chapter_words WHERE done_at IS NULL"),
            0
        );
    }

    #[test]
    fn a_run_asks_ten_words_at_most_each_once_in_an_order_of_its_own() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 14);
        let (first, summary) = play(&desk, Ways::Both, days(1));
        assert_eq!(first.len(), SIZE);
        assert_eq!(
            summary,
            RecallSummary {
                right: 10,
                missed: 0,
                left: 4
            }
        );
        let mut once = first.clone();
        once.sort();
        once.dedup();
        assert_eq!(once.len(), SIZE, "no word twice");
        assert_ne!(first, once, "not in the order of the list");

        // The next run takes the four left, and a third has nothing.
        let (rest, summary) = play(&desk, Ways::Both, days(1));
        assert_eq!(rest.len(), 4);
        assert_eq!(summary.left, 0);
        assert!(rest.iter().all(|key| !first.contains(key)));
        assert_eq!(play(&desk, Ways::Both, days(1)).0, Vec::<String>::new());
    }

    #[test]
    fn a_run_of_both_ways_asks_a_word_from_the_other_side_the_next_time() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 1);
        play(&desk, Ways::Both, days(1));
        let run = start(desk.ctx(), Ways::Both, days(5)).expect("start");
        let item = shown(&run.step);
        assert_eq!(item.direction, Direction::Production);
        assert_eq!(item.prompt, translation("w00"));
        assert_eq!(
            reply(&desk, &run, &run.step, true, days(5)).accepted,
            ["w00"]
        );

        // A run of one way keeps to it.
        let run = start(desk.ctx(), Ways::Production, days(30)).expect("start");
        assert_eq!(shown(&run.step).direction, Direction::Production);
    }

    #[test]
    fn a_known_word_is_not_asked() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = learned(&desk, "b", 2);
        {
            let conn = desk.db.lock().expect("db");
            let id = words::id_by_key(&conn, &chapter, "w00")
                .expect("id")
                .expect("word");
            words::set_known(&conn, &id, true, t0()).expect("known");
        }
        assert_eq!(play(&desk, Ways::Both, days(1)).0, ["w01"]);
    }

    #[test]
    fn a_word_only_one_run_can_ask_is_refused_by_another() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 1);
        let run = start(desk.ctx(), Ways::Both, days(1)).expect("start");
        let refused = answer(desk.ctx(), &run.id, "w99", "x", days(1));
        assert!(matches!(refused, Err(Error::Invalid(_))));
        reply(&desk, &run, &run.step, true, days(1));
        // Answered: it is not due, and the run is over.
        let twice = answer(desk.ctx(), &run.id, "w00", &translation("w00"), days(1));
        assert!(matches!(twice, Err(Error::Invalid(_))));
    }

    #[test]
    fn a_word_that_keeps_slipping_says_so_and_carries_the_learners_note() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 1);
        let mut now = days(1);
        for miss in 1..=3 {
            let run = start(desk.ctx(), Ways::Recognition, now).expect("start");
            let result = reply(&desk, &run, &run.step, false, now);
            assert_eq!(result.stubborn, miss == 3, "miss {miss}");
            assert_eq!(result.note, None);
            now += TimeDelta::days(1);
        }
        save_note(desk.ctx(), "w00", "  sounds like wool  ", now).expect("note");
        let run = start(desk.ctx(), Ways::Recognition, now).expect("start");
        let result = reply(&desk, &run, &run.step, false, now);
        assert!(result.stubborn);
        assert_eq!(result.note.as_deref(), Some("sounds like wool"));

        save_note(desk.ctx(), "w00", " ", now).expect("cleared");
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_notes"), 0);
    }

    #[test]
    fn a_word_asked_for_in_a_conversation_is_asked_towards_english() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 1);
        {
            let conn = desk.db.lock().expect("db");
            let setup = sessions::tests::setup();
            let session = sessions::insert_session(&conn, &setup, t0()).expect("session");
            let asked = |asked: Option<&str>, english: &str| VocabItem {
                asked: asked.map(str::to_owned),
                english: english.to_owned(),
                note: None,
            };
            for item in [
                asked(Some("relajarse"), "to wind down"),
                // The partner's word has nothing to ask it by.
                asked(None, "to unwind"),
                // A book taught this one: it is asked as the book's word.
                asked(Some("palabra"), "w00"),
            ] {
                sessions::insert_vocab(&conn, &session, &item, t0()).expect("vocab");
            }
        }
        assert_eq!(due_now(&desk, days(1)), 2);
        // Towards the learner's language alone, only the book's word.
        assert_eq!(play(&desk, Ways::Recognition, days(1)).0, ["w00"]);

        let run = start(desk.ctx(), Ways::Both, days(1)).expect("start");
        let item = shown(&run.step);
        assert_eq!(
            (item.word_id.as_str(), item.direction, item.prompt.as_str()),
            ("wind down", Direction::Production, "relajarse")
        );
        let result =
            answer(desk.ctx(), &run.id, "wind down", "Wind down", days(1)).expect("answer");
        assert!(result.correct);
        assert_eq!(result.accepted, ["to wind down"]);
    }
}
