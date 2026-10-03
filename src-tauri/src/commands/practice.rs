//! A session of practice on a chapter: a number of its open words, fixed
//! when it starts, asked one question at a time until each is finished in
//! both directions or known. Every answer is checked at once and kept at
//! once, so leaving at any moment loses nothing: "Practice" then goes on
//! with the same session and the same words. Nothing ends it but its words
//! running out. No request to the model is made.
//!
//! Which question comes next is `books::practice::next`, read off the
//! session's words and the answers given in it; spacing counts those
//! answers alone, so it carries on across a leave as if there had been none.

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::profile::require_profile;
use super::run;
use crate::books::practice::{
    accepts, accepts_english, articles, blank, mark, next, open_questions, pace, progress,
    progress_over, sizes, SIZES,
};
use crate::db::practice::{self, SittingRow, WordRow};
use crate::db::{books, words};
use crate::domain::{
    AnswerResult, Direction, PracticeItem, PracticeOptions, PracticeStep, Sitting,
};
use crate::error::{Error, Result};
use crate::Ctx;

/// What the session shows next: the question the rule picks among its words,
/// or the summary when none of them has anything left to ask. That is its
/// end, and it is stamped: a session that is over stays over, and shows its
/// summary whatever happens to its words afterwards.
///
/// Every step of a session is built here, from the session's words
/// (`db::practice::session_words`) and its log: whatever else a step is to
/// say about the session is read off those two, in this function. How far
/// the session is, for the bar at its top, is: every step carries it, so the
/// first one of a session gone on with has the bar where it was left.
pub(super) fn step(
    conn: &Connection,
    sitting: &SittingRow,
    now: DateTime<Utc>,
) -> Result<PracticeStep> {
    let words = practice::session_words(conn, &sitting.id)?;
    let log = practice::session_log(conn, &sitting.id)?;
    let asked = if sitting.finished {
        None
    } else {
        next(&words, &log)
    };
    let Some(question) = asked else {
        practice::finish(conn, &sitting.id, now)?;
        return Ok(PracticeStep::Summary {
            summary: practice::summary(conn, sitting)?,
            progress: progress_over(&words),
        });
    };
    let word = practice::word(conn, question.word_id)?;
    Ok(PracticeStep::Item {
        item: item(word, question.direction),
        progress: progress(&words),
    })
}

/// The word as it is asked in a direction. English → native shows the base
/// form, and the sentence with the word marked. Native → English shows the
/// translations, and the sentence with the word taken out: nothing of the
/// item holds the English word. A translation a dispute upheld is accepted,
/// not shown: the prompt is the translations the chapter was prepared with.
pub(super) fn item(word: WordRow, direction: Direction) -> PracticeItem {
    let (prompt, context) = match direction {
        Direction::Recognition => (
            word.lemma.clone(),
            word.needs_context
                .then(|| mark(&word.sentence, &word.forms)),
        ),
        Direction::Production => (
            word.shown.join(", "),
            word.needs_context
                .then(|| blank(&word.sentence, &english(&word)))
                .flatten(),
        ),
    };
    PracticeItem {
        word_id: word.id,
        direction,
        prompt,
        context,
    }
}

/// Every way the book writes the word, its base form included.
fn english(word: &WordRow) -> Vec<String> {
    let mut forms = word.forms.clone();
    if !forms.contains(&word.lemma) {
        forms.push(word.lemma.clone());
    }
    forms
}

/// The chapter's session to go on with: the one left unfinished, while it
/// still has a question to ask. One whose words were all finished or marked
/// as known since has nothing to go on with, and is closed here.
///
/// The chapter's words are brought up to date first: one whose answers read
/// as done, given under an older rule, is finished before anything is
/// counted or taken into a session.
fn held(conn: &Connection, chapter_id: &str, now: DateTime<Utc>) -> Result<Option<SittingRow>> {
    practice::sync_chapter(conn, chapter_id, now)?;
    let Some(id) = practice::unfinished(conn, chapter_id)? else {
        return Ok(None);
    };
    let words = practice::session_words(conn, &id)?;
    if next(&words, &practice::session_log(conn, &id)?).is_some() {
        return Ok(Some(practice::sitting(conn, &id)?));
    }
    practice::finish(conn, &id, now)?;
    Ok(None)
}

/// What "Practice" on a chapter can do now: go on with the session left
/// unfinished, or start one in any of the sizes on offer, each with about
/// how long it takes at the learner's pace.
pub fn options(ctx: Ctx<'_>, chapter_id: &str, now: DateTime<Utc>) -> Result<PracticeOptions> {
    let mut conn = ctx.conn()?;
    books::get_chapter(&conn, chapter_id)?;
    let tx = conn.transaction()?;
    let resume = held(&tx, chapter_id, now)?.is_some();
    let (answers, gaps) = practice::pace_sample(&tx)?;
    let sizes = sizes(practice::open_words(&tx, chapter_id)?, pace(answers, &gaps));
    tx.commit()?;
    Ok(PracticeOptions { resume, sizes })
}

/// Starts a session on a chapter and gives its first question: `size` of
/// the chapter's open words, most frequent first, or all of them. While a
/// session of the chapter is unfinished it is that one that is gone on with,
/// with the words it had, whatever `size` says. A chapter with nothing left
/// to ask answers with the summary straight away.
pub fn start(
    ctx: Ctx<'_>,
    chapter_id: &str,
    size: Option<u32>,
    now: DateTime<Utc>,
) -> Result<Sitting> {
    if size.is_some_and(|size| !SIZES.contains(&size)) {
        return Err(Error::Invalid("this is not a size of session".into()));
    }
    let mut conn = ctx.conn()?;
    books::get_chapter(&conn, chapter_id)?;
    let tx = conn.transaction()?;
    let sitting = if let Some(left) = held(&tx, chapter_id, now)? {
        left
    } else {
        let id = practice::start(&tx, chapter_id, now)?;
        practice::fix_words(&tx, &id, chapter_id, size)?;
        practice::sitting(&tx, &id)?
    };
    let step = step(&tx, &sitting, now)?;
    tx.commit()?;
    Ok(Sitting {
        id: sitting.id,
        step,
    })
}

/// The sitting as "Practice" runs it. A pass of the refresh is not one: it
/// has its own commands (`commands::refresh`).
fn practising(conn: &Connection, sitting_id: &str) -> Result<SittingRow> {
    let sitting = practice::sitting(conn, sitting_id)?;
    if sitting.refresh {
        return Err(Error::Invalid("this sitting is a refresh".into()));
    }
    Ok(sitting)
}

/// What a running session shows next as things stand now. A verdict on an
/// answer of an earlier session can finish a word this one is showing; this
/// is how the session is brought up to date. No answer is changed; a session
/// found with nothing left to ask is closed.
pub fn current(ctx: Ctx<'_>, sitting_id: &str, now: DateTime<Utc>) -> Result<PracticeStep> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let step = step(&tx, &practising(&tx, sitting_id)?, now)?;
    tx.commit()?;
    Ok(step)
}

/// Checks one answer, keeps it, and says what comes next. The question has
/// to be one the session has open: of one of its words, in a direction that
/// still owes something. An empty answer is "I don't know": a miss like any
/// other, kept as an empty text.
pub fn answer(
    ctx: Ctx<'_>,
    sitting_id: &str,
    (word_id, direction): (&str, Direction),
    answer: &str,
    now: DateTime<Utc>,
) -> Result<AnswerResult> {
    let mut conn = ctx.conn()?;
    let native_lang = require_profile(&conn)?.native_lang;
    let tx = conn.transaction()?;
    let sitting = practising(&tx, sitting_id)?;
    let word = practice::word(&tx, word_id)?;
    let asked = !sitting.finished
        && open_questions(&practice::session_words(&tx, &sitting.id)?)
            .iter()
            .any(|open| open.word_id == word.id && open.direction == direction);
    if !asked {
        return Err(Error::Invalid("this word is not being asked".into()));
    }
    let correct = match direction {
        Direction::Recognition => accepts(answer, &word.translations, articles(&native_lang)),
        Direction::Production => {
            let forms = [word.forms.as_slice(), word.english.as_slice()].concat();
            accepts_english(answer, &word.lemma, &forms)
        }
    };
    let answer_id = practice::record(
        &tx,
        &sitting.id,
        (word_id, direction),
        (answer.trim(), correct),
        now,
    )?;
    let step = step(&tx, &sitting, now)?;
    tx.commit()?;
    Ok(AnswerResult {
        answer_id,
        correct,
        accepted: match direction {
            Direction::Recognition => word.shown,
            Direction::Production => vec![word.lemma],
        },
        step,
    })
}

/// "I know this" on the word a session is showing: the word is marked as
/// known, which takes it out of the session, and the session goes on to what
/// comes next. Nothing is recorded as an answer.
pub fn know(
    ctx: Ctx<'_>,
    sitting_id: &str,
    word_id: &str,
    now: DateTime<Utc>,
) -> Result<PracticeStep> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let sitting = practising(&tx, sitting_id)?;
    if practice::word(&tx, word_id)?.chapter_id != sitting.chapter_id {
        return Err(Error::Invalid("this word is not being asked".into()));
    }
    words::set_known(&tx, word_id, true, now)?;
    let step = step(&tx, &sitting, now)?;
    tx.commit()?;
    Ok(step)
}

#[tauri::command]
pub async fn practice_options(app: AppHandle, chapter_id: String) -> Result<PracticeOptions> {
    run(app, move |_, ctx| options(ctx, &chapter_id, Utc::now())).await
}

#[tauri::command]
pub async fn start_sitting(
    app: AppHandle,
    chapter_id: String,
    size: Option<u32>,
) -> Result<Sitting> {
    run(app, move |_, ctx| start(ctx, &chapter_id, size, Utc::now())).await
}

#[tauri::command]
pub async fn sitting_step(app: AppHandle, sitting_id: String) -> Result<PracticeStep> {
    run(app, move |_, ctx| current(ctx, &sitting_id, Utc::now())).await
}

#[tauri::command]
pub async fn answer_word(
    app: AppHandle,
    sitting_id: String,
    word_id: String,
    direction: Direction,
    answer: String,
) -> Result<AnswerResult> {
    run(app, move |_, ctx| {
        self::answer(ctx, &sitting_id, (&word_id, direction), &answer, Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn know_word(
    app: AppHandle,
    sitting_id: String,
    word_id: String,
) -> Result<PracticeStep> {
    run(app, move |_, ctx| {
        know(ctx, &sitting_id, &word_id, Utc::now())
    })
    .await
}

#[cfg(test)]
pub mod tests {
    use std::path::Path;
    use std::sync::Mutex;

    use chrono::TimeDelta;

    use super::*;
    use crate::agent::Agent;
    use crate::books::vocab::Word;
    use crate::db::words::tests::{book, word};
    use crate::db::{self, profile};
    use crate::domain::{Depth, PracticeOptions, SentencePart, SittingProgress, SittingSummary};

    /// A database in a file with a Spanish-speaking learner, and no sidecar.
    pub struct Desk {
        pub db: Mutex<Connection>,
        agent: Agent,
    }

    impl Desk {
        fn open(path: &Path) -> Self {
            Self {
                db: Mutex::new(db::open(path).expect("db")),
                agent: Agent::new(None),
            }
        }

        pub fn new(dir: &tempfile::TempDir) -> Self {
            let desk = Self::open(&dir.path().join("ogmios.sqlite"));
            profile::save_profile(&desk.db.lock().expect("db"), &profile::tests::profile())
                .expect("profile");
            desk
        }

        pub fn ctx(&self) -> Ctx<'_> {
            Ctx {
                db: &self.db,
                agent: &self.agent,
                data_dir: Path::new("."),
            }
        }

        /// A book of one prepared chapter with these words; the chapter's id.
        pub fn chapter(&self, id: &str, list: &[Word]) -> String {
            let conn = self.db.lock().expect("db");
            let chapter = book(&conn, id, &["text"]).remove(0);
            words::finish(&conn, &chapter, Depth::Most, list, Utc::now()).expect("words");
            chapter
        }

        pub fn count(&self, sql: &str) -> i64 {
            self.db
                .lock()
                .expect("db")
                .query_row(sql, [], |row| row.get(0))
                .expect("count")
        }

        /// Every open word of the chapter, or the session left unfinished.
        pub fn start(&self, chapter: &str, now: DateTime<Utc>) -> Sitting {
            start(self.ctx(), chapter, None, now).expect("start")
        }

        /// A session of `size` words, or the session left unfinished.
        pub fn sized(&self, chapter: &str, size: u32, now: DateTime<Utc>) -> Sitting {
            start(self.ctx(), chapter, Some(size), now).expect("start")
        }

        pub fn answer(
            &self,
            sitting: &Sitting,
            item: &PracticeItem,
            text: &str,
            now: DateTime<Utc>,
        ) -> AnswerResult {
            answer(
                self.ctx(),
                &sitting.id,
                (&item.word_id, item.direction),
                text,
                now,
            )
            .expect("answer")
        }

        /// A session of every open word, or the one left unfinished,
        /// answered right until the summary ([`Desk::finish`]).
        pub fn play(&self, chapter: &str, now: DateTime<Utc>) -> (Vec<String>, SittingSummary) {
            self.finish(&self.start(chapter, now), now)
        }

        /// Answers every question right until the summary; the base forms
        /// of the words as asked, in either direction.
        pub fn finish(
            &self,
            sitting: &Sitting,
            now: DateTime<Utc>,
        ) -> (Vec<String>, SittingSummary) {
            let mut step = sitting.step.clone();
            let mut asked = Vec::new();
            loop {
                let item = match step {
                    PracticeStep::Item { item, .. } => item,
                    PracticeStep::Summary { summary, .. } => return (asked, summary),
                };
                let result = self.answer(sitting, &item, &right(&item), now);
                assert!(result.correct, "{}", item.prompt);
                asked.push(lemma(&item));
                step = result.step;
            }
        }
    }

    pub fn translation(lemma: &str) -> String {
        format!("{lemma}es")
    }

    /// The base form of a numbered word, whichever way it is asked.
    fn lemma(item: &PracticeItem) -> String {
        match item.direction {
            Direction::Recognition => item.prompt.clone(),
            Direction::Production => item
                .prompt
                .strip_suffix("es")
                .expect("its translation")
                .to_owned(),
        }
    }

    /// The right answer to a numbered word, whichever way it is asked.
    fn right(item: &PracticeItem) -> String {
        match item.direction {
            Direction::Recognition => translation(&item.prompt),
            Direction::Production => lemma(item),
        }
    }

    pub fn shown(item: &PracticeItem) -> Vec<(&str, bool)> {
        item.context
            .as_deref()
            .expect("flagged for context")
            .iter()
            .map(|SentencePart { text, marked }| (text.as_str(), *marked))
            .collect()
    }

    /// `count` words, the first the most frequent: w00, w01, …
    pub fn numbered(count: u32) -> Vec<Word> {
        (0..count)
            .map(|n| {
                let lemma = format!("w{n:02}");
                word(&lemma, &[&translation(&lemma)], 100 - n)
            })
            .collect()
    }

    pub fn item(step: &PracticeStep) -> &PracticeItem {
        match step {
            PracticeStep::Item { item, .. } => item,
            PracticeStep::Summary { .. } => panic!("the sitting is over"),
        }
    }

    /// How far the sitting is as the step says: (value, total).
    pub fn bar(step: &PracticeStep) -> (u32, u32) {
        let (PracticeStep::Item { progress, .. } | PracticeStep::Summary { progress, .. }) = step;
        (progress.value, progress.total)
    }

    /// The summary of a session that counted `words` words when it ended:
    /// its bar is full.
    pub fn ended(done: u32, open: u32, words: u32) -> PracticeStep {
        let total = 4 * words;
        PracticeStep::Summary {
            summary: SittingSummary { done, open },
            progress: SittingProgress {
                value: total,
                total,
            },
        }
    }

    pub fn t0() -> DateTime<Utc> {
        db::parse_ts("2026-03-01T10:00:00.000Z").expect("time")
    }

    #[test]
    fn a_sitting_asks_checks_and_finishes_words() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let bank = Word {
            needs_context: true,
            forms: vec!["bank".into(), "banks".into()],
            sentence: "She sat on the Bank.".into(),
            ..word("bank", &["orilla", "la ribera"], 5)
        };
        let chapter = desk.chapter("b", &[word("peep", &["asomarse"], 2), bank]);
        let now = t0();

        let sitting = desk.start(&chapter, now);
        let first = item(&sitting.step).clone();
        assert_eq!(first.prompt, "bank", "the most frequent word first");
        assert_eq!(first.direction, Direction::Recognition);
        assert_eq!(
            shown(&first),
            [("She sat on the ", false), ("Bank", true), (".", false)]
        );

        let miss = desk.answer(&sitting, &first, "banco", now);
        assert!(!miss.correct);
        assert_eq!(miss.accepted, ["orilla", "la ribera"]);
        let second = item(&miss.step).clone();
        assert_eq!((second.prompt.as_str(), &second.context), ("peep", &None));

        // The miss added nothing: bank owes 2 English → native and peep 1.
        // Two in a row that way open the other way. The two words alternate
        // until both are done.
        let mut step = desk.answer(&sitting, &second, " Asomarse. ", now).step;
        let mut asked = Vec::new();
        while let PracticeStep::Item { item, .. } = step {
            let (word, text) = match item.prompt.as_str() {
                "bank" => ("bank", "La Orilla"),
                "peep" => ("peep", "asomarse"),
                "orilla, la ribera" => ("bank", "The Banks."),
                "asomarse" => ("peep", "to peep"),
                other => panic!("{other} is not asked"),
            };
            if (word, item.direction) == ("bank", Direction::Production) {
                assert_eq!(
                    shown(&item),
                    [("She sat on the ", false), ("", true), (".", false)],
                    "the word is taken out of its sentence"
                );
            }
            let result = desk.answer(&sitting, &item, text, now);
            assert!(result.correct, "{text}");
            asked.push((word, item.direction));
            step = result.step;
        }
        let (there, other) = (Direction::Recognition, Direction::Production);
        assert_eq!(
            asked,
            [
                ("bank", there),
                ("peep", there),
                ("bank", there),
                ("peep", other),
                ("bank", other),
                ("peep", other),
                ("bank", other),
            ]
        );
        assert_eq!(step, ended(2, 0, 2));
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL"),
            2
        );
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 9);
        for table in ["patterns", "pattern_events"] {
            let rows = desk.count(&format!("SELECT COUNT(*) FROM {table}"));
            assert_eq!(rows, 0, "book words never touch {table}");
        }

        // Nothing left: a new sitting is over before it begins.
        let empty = desk.start(&chapter, now);
        assert_eq!(empty.step, ended(0, 0, 0));
        let late = desk_error(&desk, &sitting.id, &first.word_id);
        assert_eq!(late.kind(), "invalid", "a finished word is not asked");
    }

    fn desk_error(desk: &Desk, sitting: &str, word: &str) -> Error {
        answer(
            desk.ctx(),
            sitting,
            (word, Direction::Recognition),
            "x",
            t0(),
        )
        .expect_err("refused")
    }

    /// The numbered words w`from` up to, not including, w`to`.
    fn range(from: u32, to: u32) -> Vec<String> {
        (from..to).map(|n| format!("w{n:02}")).collect()
    }

    /// The words that were asked, once each, in order.
    fn distinct(asked: &[String]) -> Vec<String> {
        let mut words = asked.to_vec();
        words.sort();
        words.dedup();
        words
    }

    fn offered(desk: &Desk, chapter: &str, now: DateTime<Utc>) -> PracticeOptions {
        options(desk.ctx(), chapter, now).expect("options")
    }

    /// (size, words, minutes) of each size on offer.
    fn sizes_of(options: &PracticeOptions) -> Vec<(Option<u32>, u32, u32)> {
        let sizes = options.sizes.iter();
        sizes
            .map(|size| (size.size, size.words, size.minutes))
            .collect()
    }

    #[test]
    fn a_session_of_ten_asks_only_its_ten_most_frequent_words_and_the_next_takes_the_following() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(30));

        let first = desk.sized(&chapter, 10, t0());
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM practice_session_words"),
            10
        );
        let (asked, summary) = desk.finish(&first, t0());
        assert_eq!(distinct(&asked), range(0, 10), "the ten most frequent");
        assert_eq!(asked[..10], range(0, 10), "most frequent first");
        assert_eq!(asked.len(), 40, "two right answers each way");
        assert_eq!(summary, SittingSummary { done: 10, open: 20 });
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL"),
            10
        );
        // It is over: its words are not asked in it any more.
        let over = current(desk.ctx(), &first.id, t0()).expect("step");
        assert_eq!(over, ended(summary.done, summary.open, 10));
        assert!(!offered(&desk, &chapter, t0()).resume);

        // The next one takes the following words, as many as it is asked for.
        let second = desk.sized(&chapter, 10, t0());
        assert_ne!(second.id, first.id);
        let (asked, summary) = desk.finish(&second, t0());
        assert_eq!(distinct(&asked), range(10, 20));
        assert_eq!(summary, SittingSummary { done: 10, open: 10 });

        // "All" is what is left.
        let (asked, summary) = desk.play(&chapter, t0());
        assert_eq!(distinct(&asked), range(20, 30));
        assert_eq!(summary, SittingSummary { done: 10, open: 0 });
        assert_eq!(
            books::get_chapter(&desk.db.lock().expect("db"), &chapter)
                .expect("chapter")
                .readiness,
            Some(crate::books::practice::READY)
        );
    }

    #[test]
    fn no_time_ends_a_session_and_it_resumes_with_the_same_words_after_reopening() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ogmios.sqlite");
        let (chapter, id, pending, left_at) = {
            let desk = Desk::new(&dir);
            let chapter = desk.chapter("b", &numbered(30));
            let sitting = desk.sized(&chapter, 10, t0());
            let mut step = sitting.step.clone();
            // Eight answers, the third and the sixth wrong, hours apart;
            // then the learner leaves with a word on the screen.
            for turn in 1..=8 {
                let asked = item(&step).clone();
                let text = if turn % 3 == 0 {
                    "wrong".to_owned()
                } else {
                    right(&asked)
                };
                let now = t0() + TimeDelta::hours(turn);
                step = desk.answer(&sitting, &asked, &text, now).step;
            }
            (chapter, sitting.id, item(&step).clone(), bar(&step))
        };
        // Six right answers, and each miss fell on a word with no run.
        assert_eq!(left_at, (6, 40));

        let desk = Desk::open(&path);
        let later = t0() + TimeDelta::days(40);
        assert!(offered(&desk, &chapter, later).resume);
        // The size is not asked again, and says nothing if it is given.
        let resumed = start(desk.ctx(), &chapter, Some(20), later).expect("resumed");
        assert_eq!(resumed.id, id, "the same session");
        assert_eq!(item(&resumed.step), &pending, "the word left on the screen");
        assert_eq!(bar(&resumed.step), left_at, "the bar where it was");
        assert_eq!(pending.prompt, "w02", "missed five questions before");
        assert_eq!(desk.count("SELECT COUNT(*) FROM practice_sittings"), 1);
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 8);

        // Played out, it asked its ten words and no other.
        let (asked, summary) = desk.finish(&resumed, later);
        assert!(distinct(&asked)
            .iter()
            .all(|word| range(0, 10).contains(word)));
        assert_eq!(asked.len(), 10 * 4 + 2 - 8, "each miss cost its own answer");
        assert_eq!(summary, SittingSummary { done: 10, open: 20 });
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM practice_sittings WHERE finished_at IS NULL"),
            0
        );
    }

    #[test]
    fn the_sizes_come_with_an_estimate_at_the_learners_own_pace_after_thirty_answers() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(30));
        let small = desk.chapter("c", &numbered(10));

        let fresh = offered(&desk, &chapter, t0());
        assert!(!fresh.resume);
        assert_eq!(
            sizes_of(&fresh),
            [(Some(10), 10, 7), (Some(20), 20, 13), (None, 30, 20)],
            "eight seconds an answer"
        );
        assert_eq!(sizes_of(&offered(&desk, &small, t0())), [(None, 10, 7)]);

        // Twenty-nine answers three seconds apart, and one after a break.
        let sitting = desk.sized(&chapter, 10, t0());
        let mut step = sitting.step.clone();
        for turn in 0..29 {
            let asked = item(&step).clone();
            let now = t0() + TimeDelta::seconds(3 * turn);
            step = desk.answer(&sitting, &asked, &right(&asked), now).step;
        }
        let going = offered(&desk, &chapter, t0());
        assert!(going.resume);
        assert_eq!(sizes_of(&going)[0], (Some(10), 10, 7), "not thirty yet");
        let asked = item(&step).clone();
        let after_a_break = t0() + TimeDelta::hours(2);
        desk.answer(&sitting, &asked, &right(&asked), after_a_break);
        assert_eq!(
            sizes_of(&offered(&desk, &chapter, after_a_break)),
            [(Some(10), 10, 3), (Some(20), 20, 5), (None, 30, 8)],
            "the median of the learner's own answers, the break left out"
        );
        // The pace is the learner's, whatever the chapter.
        assert_eq!(
            sizes_of(&offered(&desk, &small, after_a_break)),
            [(None, 10, 3)]
        );

        let missing = options(desk.ctx(), "nowhere", t0()).expect_err("no chapter");
        assert_eq!(missing.kind(), "notFound");
        let odd = start(desk.ctx(), &small, Some(7), t0()).expect_err("not a size");
        assert_eq!(odd.kind(), "invalid");
    }

    #[test]
    fn a_session_whose_words_were_all_settled_since_is_closed_and_the_sizes_are_offered_again() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(12));
        let sitting = desk.sized(&chapter, 10, t0());
        let first = item(&sitting.step).clone();
        desk.answer(&sitting, &first, &right(&first), t0());
        assert!(offered(&desk, &chapter, t0()).resume);

        // A word of the chapter the session does not have is not asked in it.
        let outside: String = desk
            .db
            .lock()
            .expect("db")
            .query_row(
                "SELECT id FROM chapter_words WHERE lemma = 'w11'",
                [],
                |row| row.get(0),
            )
            .expect("word");
        assert_eq!(desk_error(&desk, &sitting.id, &outside).kind(), "invalid");

        // Its ten words are marked as known from the word list.
        {
            let conn = desk.db.lock().expect("db");
            let mut stmt = conn
                .prepare("SELECT word_id FROM practice_session_words")
                .expect("words");
            let ids = stmt.query_map([], |row| row.get::<_, String>(0));
            for id in ids.expect("ids") {
                words::set_known(&conn, &id.expect("id"), true, t0()).expect("known");
            }
        }
        let after = offered(&desk, &chapter, t0());
        assert!(!after.resume, "nothing to go on with");
        assert_eq!(sizes_of(&after), [(None, 2, 1)]);
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM practice_sittings WHERE finished_at IS NOT NULL"),
            1
        );
        // The session that was on the screen says so, and takes no answer.
        let over = current(desk.ctx(), &sitting.id, t0()).expect("step");
        assert_eq!(over, ended(0, 2, 0), "none of its words is left to count");
        assert_eq!(desk_error(&desk, &sitting.id, &outside).kind(), "invalid");

        let next = desk.start(&chapter, t0());
        assert_ne!(next.id, sitting.id);
        let (asked, summary) = desk.finish(&next, t0());
        assert_eq!(distinct(&asked), range(10, 12));
        assert_eq!(summary, SittingSummary { done: 2, open: 0 });
    }

    #[test]
    fn a_word_whose_answers_read_as_done_is_finished_before_a_session_takes_its_words() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(3));
        // Answers kept under an older rule: the word reads as done, and was
        // never marked so. The sitting they were given in has no words.
        {
            let conn = desk.db.lock().expect("db");
            let old = practice::start(&conn, &chapter, t0()).expect("sitting");
            let id: String = conn
                .query_row(
                    "SELECT id FROM chapter_words WHERE lemma = 'w00'",
                    [],
                    |row| row.get(0),
                )
                .expect("word");
            for direction in [Direction::Recognition, Direction::Production] {
                for _ in 0..2 {
                    practice::record(&conn, &old, (&id, direction), ("x", true), t0())
                        .expect("answer");
                }
            }
            conn.execute("UPDATE chapter_words SET done_at = NULL", [])
                .expect("as it was");
        }
        let done = "SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL";
        assert_eq!(desk.count(done), 0);

        let found = offered(&desk, &chapter, t0());
        assert!(!found.resume, "a sitting without words is not gone on with");
        assert_eq!(sizes_of(&found), [(None, 2, 1)]);
        assert_eq!(desk.count(done), 1);
        let readiness = books::get_chapter(&desk.db.lock().expect("db"), &chapter)
            .expect("chapter")
            .readiness;
        assert_eq!(readiness, Some(33));

        // Starting does the same, without the options having been asked for.
        desk.db
            .lock()
            .expect("db")
            .execute("UPDATE chapter_words SET done_at = NULL", [])
            .expect("as it was");
        let (asked, summary) = desk.play(&chapter, t0());
        assert_eq!(distinct(&asked), range(1, 3));
        assert_eq!(summary, SittingSummary { done: 2, open: 0 });
        assert_eq!(desk.count(done), 3);
    }

    #[test]
    fn an_answer_to_nothing_being_asked_is_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(2));
        let other = desk.chapter("c", &numbered(2));
        let sitting = desk.start(&chapter, t0());
        let elsewhere = desk.start(&other, t0());
        let foreign = item(&elsewhere.step).word_id.clone();

        assert_eq!(desk_error(&desk, &sitting.id, &foreign).kind(), "invalid");
        assert_eq!(desk_error(&desk, &sitting.id, "nowhere").kind(), "notFound");
        assert_eq!(desk_error(&desk, "nowhere", &foreign).kind(), "notFound");
        let missing = start(desk.ctx(), "nowhere", None, t0()).expect_err("no chapter");
        assert_eq!(missing.kind(), "notFound");
        let production = answer(
            desk.ctx(),
            &sitting.id,
            (&item(&sitting.step).word_id, Direction::Production),
            "x",
            t0(),
        )
        .expect_err("not asked this way");
        assert_eq!(production.kind(), "invalid");
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 0);
    }

    #[test]
    fn the_step_of_a_running_sitting_is_read_again_as_things_stand() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(2));
        let sitting = desk.start(&chapter, t0());
        let first = item(&sitting.step).clone();

        let same = current(desk.ctx(), &sitting.id, t0()).expect("step");
        assert_eq!(same, sitting.step);
        // The word on the screen is settled from elsewhere: it gives way.
        words::set_known(&desk.db.lock().expect("db"), &first.word_id, true, t0()).expect("known");
        let moved = current(desk.ctx(), &sitting.id, t0()).expect("step");
        assert_eq!(item(&moved).prompt, "w01");
        // However late: no time ends a session.
        let late = t0() + TimeDelta::days(400);
        let still = current(desk.ctx(), &sitting.id, late).expect("step");
        assert_eq!(still, moved);
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 0);
        let missing = current(desk.ctx(), "nowhere", t0()).expect_err("no sitting");
        assert_eq!(missing.kind(), "notFound");
    }

    #[test]
    fn knowing_a_word_in_a_sitting_moves_on_without_an_answer() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(3));
        let other = desk.chapter("c", &numbered(3));
        let sitting = desk.start(&chapter, t0());
        let first = item(&sitting.step).clone();
        assert_eq!(first.prompt, "w00");

        let step = know(desk.ctx(), &sitting.id, &first.word_id, t0()).expect("known");
        assert_eq!(item(&step).prompt, "w01");
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 0);
        assert_eq!(desk.count("SELECT COUNT(*) FROM known_words"), 1);
        let late = desk_error(&desk, &sitting.id, &first.word_id);
        assert_eq!(late.kind(), "invalid", "a known word is not asked");

        // The same word in another book's chapter is known there too.
        let elsewhere = desk.start(&other, t0());
        assert_eq!(item(&elsewhere.step).prompt, "w01");
        let foreign = item(&elsewhere.step).word_id.clone();
        let refused = know(desk.ctx(), &sitting.id, &foreign, t0()).expect_err("other chapter");
        assert_eq!(refused.kind(), "invalid");
        let nowhere = know(desk.ctx(), "nowhere", &foreign, t0()).expect_err("no sitting");
        assert_eq!(nowhere.kind(), "notFound");

        // The rest played out, in the same session, nothing is open: the
        // known word left it and is not owed.
        let resumed = desk.start(&chapter, t0());
        assert_eq!(resumed.id, sitting.id);
        let (asked, summary) = desk.finish(&resumed, t0());
        assert_eq!(distinct(&asked), range(1, 3));
        assert_eq!(summary, SittingSummary { done: 2, open: 0 });
        let last = know(desk.ctx(), &sitting.id, &first.word_id, t0()).expect("again");
        assert_eq!(last, ended(summary.done, summary.open, 2));
        for table in ["patterns", "pattern_events"] {
            let rows = desk.count(&format!("SELECT COUNT(*) FROM {table}"));
            assert_eq!(rows, 0, "book words never touch {table}");
        }
    }

    #[test]
    fn every_step_says_how_far_the_session_is_and_only_its_summary_is_full() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(3));
        let sitting = desk.start(&chapter, t0());
        assert_eq!(bar(&sitting.step), (0, 12), "words never answered");
        let first = item(&sitting.step).clone();
        let id = first.word_id.clone();
        let (there, back) = (Direction::Recognition, Direction::Production);
        let say = |direction: Direction, text: &str| {
            let result = answer(desk.ctx(), &sitting.id, (&id, direction), text, t0());
            bar(&result.expect("answer").step)
        };

        assert_eq!(say(there, "wrong"), (0, 12), "a miss on a fresh word");
        assert_eq!(say(there, "w00es"), (1, 12), "a right answer");
        assert_eq!(say(there, ""), (0, 12), "a miss after one right answer");
        assert_eq!(say(there, "w00es"), (1, 12));
        assert_eq!(say(there, "w00es"), (2, 12));
        assert_eq!(say(back, "w00"), (3, 12));

        // Read again, or gone on with after leaving: the bar is where it was.
        let now = current(desk.ctx(), &sitting.id, t0()).expect("step");
        assert_eq!(bar(&now), (3, 12));
        let resumed = desk.start(&chapter, t0() + TimeDelta::days(2));
        assert_eq!(resumed.id, sitting.id);
        assert_eq!(bar(&resumed.step), (3, 12));

        // "I know this" takes the word's four steps out of the total, and
        // the one it had earned out of the value.
        let other = item(&resumed.step).clone();
        assert_eq!(other.prompt, "w01");
        let earned = desk.answer(&sitting, &other, "w01es", t0());
        assert_eq!(bar(&earned.step), (4, 12));
        let known = know(desk.ctx(), &sitting.id, &other.word_id, t0()).expect("known");
        assert_eq!(bar(&known), (3, 8));

        // Answered right to the end, it is one step an answer, and never
        // full while there is a word to ask.
        let mut step = known;
        let mut value = 3;
        while let PracticeStep::Item { item, .. } = step.clone() {
            assert_eq!(bar(&step), (value, 8));
            step = desk.answer(&sitting, &item, &right(&item), t0()).step;
            value += 1;
        }
        assert_eq!(value, 8);
        assert_eq!(step, ended(2, 0, 2));

        // A miss in a later sitting makes a word owe again; the session
        // that ended is over, and its bar stays full.
        {
            let conn = desk.db.lock().expect("db");
            let later = practice::start(&conn, &chapter, t0()).expect("sitting");
            practice::record(&conn, &later, (&id, there), ("no", false), t0()).expect("miss");
        }
        let over = current(desk.ctx(), &sitting.id, t0()).expect("step");
        assert_eq!(bar(&over), (8, 8));
        assert!(matches!(over, PracticeStep::Summary { .. }));
    }

    /// What the word owes in each direction it is asked in.
    pub fn owes(desk: &Desk, chapter: &str, word: &str) -> Vec<(Direction, u32)> {
        practice::queue(&desk.db.lock().expect("db"), chapter)
            .expect("queue")
            .into_iter()
            .filter(|item| item.word_id == word)
            .map(|item| (item.direction, item.owed))
            .collect()
    }

    #[test]
    fn native_to_english_waits_for_the_first_way_to_be_finished_and_has_its_own_run() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let run = Word {
            needs_context: true,
            forms: vec!["run".into(), "ran".into()],
            sentence: "He ran, and Ran again.".into(),
            ..word("run", &["correr", "huir"], 9)
        };
        let chapter = desk.chapter("b", &[run, word("give up", &["rendirse"], 1)]);
        let sitting = desk.start(&chapter, t0());
        let first = item(&sitting.step).clone();
        let id = first.word_id.clone();
        let (there, back) = (Direction::Recognition, Direction::Production);
        let say = |direction: Direction, text: &str| {
            answer(desk.ctx(), &sitting.id, (&id, direction), text, t0())
        };

        // A miss does not open the other way; neither does "I don't know".
        assert!(!say(there, "andar").expect("miss").correct);
        assert!(!say(there, "").expect("no idea").correct);
        // The misses add nothing: the word owes what a new one does.
        assert_eq!(owes(&desk, &chapter, &id), [(there, 2)]);
        assert_eq!(say(back, "run").expect_err("closed").kind(), "invalid");

        // Neither does one right answer: the first way is not finished yet.
        assert!(say(there, "Correr").expect("right").correct);
        assert_eq!(owes(&desk, &chapter, &id), [(there, 1)]);
        assert_eq!(say(back, "run").expect_err("closed").kind(), "invalid");

        // The second in a row finishes that way and opens the other, and a
        // finished way is not asked again.
        assert!(say(there, "huir").expect("right").correct);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 2)]);
        assert_eq!(
            say(there, "correr").expect_err("finished").kind(),
            "invalid"
        );
        // Finishing one way is not finishing the word.
        let done = "SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL";
        assert_eq!(desk.count(done), 0);

        // A miss this way shows the English word and adds nothing either.
        let miss = say(back, "walk").expect("miss");
        assert!(!miss.correct);
        assert_eq!(miss.accepted, ["run"]);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 2)]);
        let unknown = say(back, "  ").expect("no idea");
        assert!(!unknown.correct);
        assert_eq!(unknown.accepted, ["run"]);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 2)]);

        // A right answer followed by a miss is a run of none.
        assert!(say(back, "run").expect("right").correct);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 1)]);
        assert!(!say(back, "walk").expect("miss").correct);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 2)]);

        // "to" before the base form, or the form in the book: two in a row
        // finish this way too, and with it the word.
        for text in ["To run", "ran."] {
            assert!(say(back, text).expect("right").correct, "{text}");
        }
        assert_eq!(owes(&desk, &chapter, &id), []);
        assert_eq!(desk.count(done), 1);
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM word_answers WHERE answer = ''"),
            2,
            "not knowing is kept as an empty answer"
        );
    }

    fn word_in(desk: &Desk, chapter: &str, lemma: &str) -> String {
        desk.db
            .lock()
            .expect("db")
            .query_row(
                "SELECT id FROM chapter_words WHERE chapter_id = ?1 AND lemma = ?2",
                [chapter, lemma],
                |row| row.get(0),
            )
            .expect("word")
    }

    fn readiness(desk: &Desk, chapter: &str) -> Option<u32> {
        books::get_chapter(&desk.db.lock().expect("db"), chapter)
            .expect("chapter")
            .readiness
    }

    #[test]
    fn a_word_finished_in_another_chapter_is_asked_once_native_to_english() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let first = desk.chapter("b", &numbered(2));
        let second = desk.chapter("c", &numbered(2));
        let id = word_in(&desk, &second, "w00");
        let (there, back) = (Direction::Recognition, Direction::Production);
        // Until it is finished elsewhere it is a word like any other.
        assert_eq!(owes(&desk, &second, &id), [(there, 2)]);

        desk.play(&first, t0());
        assert_eq!(owes(&desk, &second, &id), [(back, 1)]);
        // Where it was finished it is not asked at all.
        let own = word_in(&desk, &first, "w00");
        assert_eq!(owes(&desk, &first, &own), []);

        let sitting = desk.start(&second, t0());
        let check = item(&sitting.step).clone();
        assert_eq!((check.prompt.as_str(), check.direction), ("w00es", back));
        let refused = answer(desk.ctx(), &sitting.id, (&id, there), "w00es", t0());
        assert_eq!(refused.expect_err("not asked").kind(), "invalid");

        let right = desk.answer(&sitting, &check, "w00", t0());
        assert!(right.correct);
        assert_eq!(owes(&desk, &second, &id), []);
        assert_eq!(readiness(&desk, &second), Some(50));
        let last = item(&right.step).clone();
        assert_eq!((last.prompt.as_str(), last.direction), ("w01es", back));
        let over = desk.answer(&sitting, &last, "w01", t0());
        assert!(matches!(
            over.step,
            PracticeStep::Summary {
                summary: SittingSummary { done: 2, open: 0 },
                ..
            }
        ));
        assert_eq!(
            readiness(&desk, &second),
            Some(crate::books::practice::READY)
        );
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 8 + 2);
    }

    #[test]
    fn a_missed_check_comes_back_spaced_until_two_in_a_row() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let first = desk.chapter("b", &numbered(1));
        let second = desk.chapter("c", &numbered(8));
        desk.play(&first, t0());
        let id = word_in(&desk, &second, "w00");
        let (there, back) = (Direction::Recognition, Direction::Production);

        let sitting = desk.start(&second, t0());
        let check = item(&sitting.step).clone();
        assert_eq!(
            (check.word_id.as_str(), check.direction),
            (id.as_str(), back)
        );
        let miss = desk.answer(&sitting, &check, "", t0());
        assert!(!miss.correct);
        assert_eq!(owes(&desk, &second, &id), [(back, 2)]);

        // Five other questions, and it is asked again the same way.
        let mut step = miss.step;
        for _ in 0..5 {
            let other = item(&step).clone();
            assert_ne!(other.word_id, id);
            assert_eq!(other.direction, there);
            step = desk.answer(&sitting, &other, &right(&other), t0()).step;
        }
        let again = item(&step).clone();
        assert_eq!(
            (again.word_id.as_str(), again.direction),
            (id.as_str(), back)
        );
        let once = desk.answer(&sitting, &again, "w00", t0());
        assert_eq!(owes(&desk, &second, &id), [(back, 1)]);

        // Played out, it took two in a row that way and nothing the other.
        let going = Sitting {
            id: sitting.id.clone(),
            step: once.step,
        };
        let (asked, summary) = desk.finish(&going, t0());
        assert_eq!(asked.iter().filter(|word| *word == "w00").count(), 1);
        assert_eq!(summary, SittingSummary { done: 8, open: 0 });
        let ways = "SELECT COUNT(*) FROM word_answers a JOIN chapter_words w ON w.id = a.word_id
                    WHERE w.lemma = 'w00' AND a.direction = 'recognition' AND a.sitting_id = ";
        assert_eq!(desk.count(&format!("{ways}'{}'", sitting.id)), 0);
    }

    #[test]
    fn a_miss_in_the_refresh_where_it_was_finished_leaves_it_a_review_word_elsewhere() {
        use crate::commands::refresh;

        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let first = desk.chapter("b", &numbered(1));
        let second = desk.chapter("c", &numbered(1));
        desk.play(&first, t0());
        let own = word_in(&desk, &first, "w00");
        let id = word_in(&desk, &second, "w00");
        let (there, back) = (Direction::Recognition, Direction::Production);

        let pass = refresh::start(desk.ctx(), &first, t0()).expect("refresh");
        let miss = refresh::answer(desk.ctx(), &pass.id, &own, "no", t0()).expect("answer");
        assert!(!miss.correct);
        // Where it was finished it follows the rule of any word.
        assert_eq!(owes(&desk, &first, &own), [(there, 2)]);
        assert_eq!(owes(&desk, &second, &id), [(back, 1)]);
        let (asked, summary) = desk.play(&second, t0());
        assert_eq!(asked, ["w00"]);
        assert_eq!(summary, SittingSummary { done: 1, open: 0 });
        // Checked in the second, it still owes what it owed in the first.
        assert_eq!(owes(&desk, &first, &own), [(there, 2)]);
    }

    #[test]
    fn a_chapter_prepared_ahead_keeps_its_answers_when_the_word_is_finished_elsewhere() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let first = desk.chapter("b", &numbered(1));
        let second = desk.chapter("c", &numbered(2));
        let id = word_in(&desk, &second, "w00");
        let (there, back) = (Direction::Recognition, Direction::Production);

        // In the second chapter: both words finished English → native, and
        // "w00" answered right once the other way. Then the learner leaves.
        let ahead = desk.start(&second, t0());
        let mut step = ahead.step.clone();
        for _ in 0..5 {
            let asked = item(&step).clone();
            step = desk.answer(&ahead, &asked, &right(&asked), t0()).step;
        }
        assert_eq!(owes(&desk, &second, &id), [(back, 1)]);
        let done = "SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL";
        assert_eq!(desk.count(done), 0);

        // Finished in the first, it has nothing left to ask in the second,
        // and is done there at once: the chapter's readiness is not waiting
        // for practice to be opened on it.
        desk.play(&first, t0());
        assert_eq!(desk.count(done), 2);
        assert_eq!(readiness(&desk, &second), Some(50));
        assert_eq!(owes(&desk, &second, &id), []);
        let other = word_in(&desk, &second, "w01");
        assert_eq!(owes(&desk, &second, &other), [(back, 2)], "not shared");
        assert_eq!(there, Direction::Recognition);
    }

    #[test]
    fn the_english_word_is_never_in_a_native_to_english_item() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let run = Word {
            needs_context: true,
            forms: vec!["run".into(), "ran".into()],
            sentence: "He ran, and Ran again.".into(),
            ..word("run", &["correr", "huir"], 9)
        };
        // Its sentence splits it: blanking would leave the word to be read.
        let split = Word {
            needs_context: true,
            forms: vec!["give up".into(), "gave up".into()],
            sentence: "She gave it up.".into(),
            ..word("give up", &["rendirse"], 5)
        };
        let chapter = desk.chapter("b", &[run, split, word("peep", &["asomarse"], 1)]);
        let sitting = desk.start(&chapter, t0());

        let mut step = sitting.step.clone();
        let mut back = Vec::new();
        while back.len() < 3 {
            let asked = item(&step).clone();
            let text = match asked.prompt.as_str() {
                "run" => "correr",
                "give up" => "rendirse",
                "peep" => "asomarse",
                _ => {
                    // Not known, it comes back: each item is kept once.
                    if !back.contains(&asked) {
                        back.push(asked.clone());
                    }
                    ""
                }
            };
            step = desk.answer(&sitting, &asked, text, t0()).step;
        }
        back.sort_by(|a, b| a.prompt.cmp(&b.prompt));

        assert_eq!(back[0].prompt, "asomarse");
        assert_eq!(back[0].context, None);
        assert_eq!(back[1].prompt, "correr, huir", "every translation");
        assert_eq!(
            shown(&back[1]),
            [
                ("He ", false),
                ("", true),
                (", and ", false),
                ("", true),
                (" again.", false)
            ]
        );
        assert_eq!(back[2].prompt, "rendirse");
        assert_eq!(back[2].context, None, "a sentence that cannot be blanked");
        for item in &back {
            assert_eq!(item.direction, Direction::Production);
            let wire = serde_json::to_string(item).expect("json").to_lowercase();
            for english in ["run", "ran", "gave", "give", "peep"] {
                assert!(!wire.contains(english), "{english} in {wire}");
            }
        }
    }
}
