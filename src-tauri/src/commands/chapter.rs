//! Preparing a chapter: its text goes to the sidecar in pieces, and what
//! comes back becomes the chapter's word list.

use chrono::{DateTime, Utc};
use tauri::{AppHandle, Emitter};

use super::profile::{agent, require_profile};
use super::run;
use crate::agent::protocol::{Vocab, VocabExtractParams};
use crate::books::vocab::{chunks, looks_english, merge, CHUNK_CHARS};
use crate::books::{refused, NOT_ENGLISH};
use crate::db::{books, words};
use crate::domain::{ChapterProgress, ChapterWords, Depth, KnownWord};
use crate::error::Result;
use crate::Ctx;

fn count(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

/// A chapter with the words it has so far; none before it is prepared.
pub fn chapter_words(ctx: Ctx<'_>, chapter_id: &str) -> Result<ChapterWords> {
    let conn = ctx.conn()?;
    Ok(ChapterWords {
        chapter: books::get_chapter(&conn, chapter_id)?,
        words: words::list(&conn, chapter_id)?,
    })
}

/// Marks a word as known already, or takes that back; the word's chapter as
/// it stands after it. Known, the word is asked nowhere and counts towards
/// the readiness of every chapter that has it.
pub fn set_known(
    ctx: Ctx<'_>,
    word_id: &str,
    known: bool,
    now: DateTime<Utc>,
) -> Result<ChapterWords> {
    let chapter_id = words::set_known(&*ctx.conn()?, word_id, known, now)?;
    chapter_words(ctx, &chapter_id)
}

/// Keeps that a word was left to learn while sorting the list, or takes that
/// back; the word's chapter as it stands after it.
pub fn set_sorted(
    ctx: Ctx<'_>,
    word_id: &str,
    sorted: bool,
    now: DateTime<Utc>,
) -> Result<ChapterWords> {
    let chapter_id = words::set_sorted(&*ctx.conn()?, word_id, sorted, now)?;
    chapter_words(ctx, &chapter_id)
}

/// Has the chapter's list to be sorted again from its first word; the
/// chapter as it stands after it.
pub fn sort_again(ctx: Ctx<'_>, chapter_id: &str) -> Result<ChapterWords> {
    words::unsort(&*ctx.conn()?, chapter_id)?;
    chapter_words(ctx, chapter_id)
}

/// Takes the chapter's words at `depth`. `extract` asks the model about one
/// piece; `progress` hears how many pieces are in.
///
/// A chapter already prepared this deep, or deeper, is answered from the
/// database without a request. Each piece is stored as it arrives, so after
/// a failure the next call asks only for the pieces still missing. A deeper
/// depth adds words and leaves the ones already there untouched.
pub fn prepare(
    ctx: Ctx<'_>,
    chapter_id: &str,
    depth: Depth,
    extract: &mut dyn FnMut(&VocabExtractParams) -> Result<Vocab>,
    progress: &dyn Fn(ChapterProgress),
) -> Result<ChapterWords> {
    let prepared = books::get_chapter(&*ctx.conn()?, chapter_id)?.prepared;
    if prepared.is_some_and(|prepared| prepared >= depth) {
        return chapter_words(ctx, chapter_id);
    }
    let (text, profile) = {
        let conn = ctx.conn()?;
        let text = books::chapter_text(&conn, chapter_id)?;
        if !looks_english(&text) {
            return Err(refused(NOT_ENGLISH));
        }
        (text, require_profile(&conn)?)
    };
    let pieces = chunks(&text, CHUNK_CHARS);
    let total = count(pieces.len());
    let mut answers = words::stored_chunks(&*ctx.conn()?, chapter_id, depth, total)?;
    let report = |done: usize| {
        progress(ChapterProgress {
            chapter_id: chapter_id.to_owned(),
            done: count(done),
            total,
        });
    };
    report(answers.len());

    for (idx, piece) in pieces.iter().enumerate() {
        let idx = count(idx);
        if answers.contains_key(&idx) {
            continue;
        }
        // The database is not held while the model answers: that takes long.
        let vocab = extract(&VocabExtractParams {
            native_lang: profile.native_lang.clone(),
            level: profile.level,
            depth,
            text: (*piece).to_owned(),
        })?;
        words::store_chunk(&*ctx.conn()?, chapter_id, depth, (idx, total), &vocab.items)?;
        answers.insert(idx, vocab.items);
        report(answers.len());
    }

    {
        let mut conn = ctx.conn()?;
        let tx = conn.transaction()?;
        let excluded = words::excluded(&tx, chapter_id)?;
        let answers: Vec<_> = answers.into_values().collect();
        let merged = merge(&answers, &text, &excluded);
        words::finish(&tx, chapter_id, depth, &merged, Utc::now())?;
        tx.commit()?;
    }
    chapter_words(ctx, chapter_id)
}

#[tauri::command]
pub async fn get_chapter_words(app: AppHandle, id: String) -> Result<ChapterWords> {
    run(app, move |_, ctx| {
        // Opening a chapter makes it the one the learner is on.
        crate::db::structures::mark_opened(&*ctx.conn()?, &id, Utc::now())?;
        chapter_words(ctx, &id)
    })
    .await
}

#[tauri::command]
pub async fn prepare_chapter(app: AppHandle, id: String, depth: Depth) -> Result<ChapterWords> {
    run(app, move |app, ctx| {
        prepare(
            ctx,
            &id,
            depth,
            &mut |params| agent(ctx)?.vocab_extract(params),
            &|progress| {
                // A closed window is the only way this fails; the work goes on.
                let _ = app.emit("chapter-progress", progress);
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn set_word_known(app: AppHandle, word_id: String, known: bool) -> Result<ChapterWords> {
    run(app, move |_, ctx| {
        set_known(ctx, &word_id, known, Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn set_word_sorted(
    app: AppHandle,
    word_id: String,
    sorted: bool,
) -> Result<ChapterWords> {
    run(app, move |_, ctx| {
        set_sorted(ctx, &word_id, sorted, Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn restart_sorting(app: AppHandle, id: String) -> Result<ChapterWords> {
    run(app, move |_, ctx| sort_again(ctx, &id)).await
}

#[tauri::command]
pub async fn list_known_words(app: AppHandle) -> Result<Vec<KnownWord>> {
    run(app, |_, ctx| words::known(&*ctx.conn()?)).await
}

/// Takes a known word back by its key; the words still known after it.
#[tauri::command]
pub async fn forget_known_word(app: AppHandle, key: String) -> Result<Vec<KnownWord>> {
    run(app, move |_, ctx| {
        let conn = ctx.conn()?;
        words::forget(&conn, &key)?;
        words::known(&conn)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::sync::Mutex;

    use super::*;
    use crate::agent::protocol::VocabItem;
    use crate::agent::Agent;
    use crate::books::practice::READY;
    use crate::db::words::tests::{book, mark_done, mark_known};
    use crate::db::{open_in_memory, practice, profile};
    use crate::domain::{Direction, Level};
    use crate::error::Error;

    /// A database with a learner, and no sidecar at all.
    struct Desk {
        dir: tempfile::TempDir,
        db: Mutex<rusqlite::Connection>,
        agent: Agent,
    }

    impl Desk {
        fn new() -> Self {
            let conn = open_in_memory().expect("db");
            profile::save_profile(&conn, &profile::tests::profile()).expect("profile");
            Self {
                dir: tempfile::tempdir().expect("tempdir"),
                db: Mutex::new(conn),
                agent: Agent::new(None),
            }
        }

        fn ctx(&self) -> Ctx<'_> {
            Ctx {
                db: &self.db,
                agent: &self.agent,
                data_dir: self.dir.path(),
            }
        }

        fn book(&self, id: &str, texts: &[&str]) -> Vec<String> {
            book(&self.db.lock().expect("db"), id, texts)
        }

        fn chunk_rows(&self) -> i64 {
            self.db
                .lock()
                .expect("db")
                .query_row("SELECT COUNT(*) FROM chapter_chunks", [], |row| row.get(0))
                .expect("count")
        }
    }

    /// The model as a stub: lists every word of the piece that is on the
    /// depth's list, a capitalised one as a proper noun, and counts requests.
    struct Stub {
        asked: RefCell<Vec<VocabExtractParams>>,
        /// The request, counted from 1, that fails.
        fail_on: Option<usize>,
    }

    impl Stub {
        fn new() -> Self {
            Self {
                asked: RefCell::new(Vec::new()),
                fail_on: None,
            }
        }

        fn requests(&self) -> usize {
            self.asked.borrow().len()
        }

        fn answer(&self, params: &VocabExtractParams) -> Result<Vocab> {
            self.asked.borrow_mut().push(params.clone());
            if self.fail_on == Some(self.requests()) {
                return Err(Error::Provider("Claude is busy".into()));
            }
            let listed: &[&str] = match params.depth {
                Depth::Hardest => &["peeped"],
                Depth::Relevant => &["peeped", "bank"],
                Depth::Most => &["peeped", "bank", "tired", "Alice", "1865"],
            };
            let items = params
                .text
                .split(|c: char| !c.is_alphanumeric())
                .filter(|form| listed.contains(form))
                .map(|form| VocabItem {
                    lemma: form.trim_end_matches("ed").to_lowercase(),
                    form: form.to_owned(),
                    sentence: params.text.clone(),
                    part_of_speech: crate::domain::PartOfSpeech::Other,
                    transitive: false,
                    translations: vec![format!("{form}-es")],
                    proper_noun: form.starts_with(char::is_uppercase),
                    needs_context: false,
                    verb_form: None,
                })
                .collect();
            Ok(Vocab { items })
        }
    }

    fn run(desk: &Desk, stub: &Stub, chapter: &str, depth: Depth) -> Result<Vec<(String, u32)>> {
        let found = prepare(
            desk.ctx(),
            chapter,
            depth,
            &mut |params| stub.answer(params),
            &|_| {},
        )?;
        assert_eq!(found.chapter.id, chapter);
        Ok(found
            .words
            .into_iter()
            .map(|word| (word.lemma, word.count))
            .collect())
    }

    fn named(words: &[(&str, u32)]) -> Vec<(String, u32)> {
        words
            .iter()
            .map(|(lemma, count)| ((*lemma).to_owned(), *count))
            .collect()
    }

    const CHAPTER: &str = "Alice was tired of the bank in 1865. She peeped at the bank.";

    /// A chapter long enough to be cut into several pieces.
    fn long_chapter() -> String {
        let filler = "It was the day that she had not been there with her sister. ";
        format!(
            "{}She peeped at the bank.\n{}Alice was tired of the bank.\n{}",
            filler.repeat(50),
            filler.repeat(50),
            filler.repeat(50)
        )
    }

    #[test]
    fn preparing_stores_the_words_and_a_second_call_asks_nothing() {
        let desk = Desk::new();
        let chapters = desk.book("b", &[CHAPTER]);
        let stub = Stub::new();

        let words = run(&desk, &stub, &chapters[0], Depth::Most).expect("prepare");
        // No name, no number; the bank twice.
        assert_eq!(words, named(&[("bank", 2), ("peep", 1), ("tir", 1)]));
        assert_eq!(stub.requests(), 1);
        let asked = stub.asked.borrow()[0].clone();
        assert_eq!(
            (asked.native_lang.as_str(), asked.level, asked.depth),
            ("es", Level::Intermediate, Depth::Most)
        );
        assert_eq!(asked.text, CHAPTER);
        assert_eq!(desk.chunk_rows(), 0, "pieces go once the words are in");

        let again = run(&desk, &stub, &chapters[0], Depth::Most).expect("again");
        assert_eq!(again, words);
        let shallower = run(&desk, &stub, &chapters[0], Depth::Hardest).expect("shallower");
        assert_eq!(shallower, words);
        assert_eq!(stub.requests(), 1, "no further request");

        let read = chapter_words(desk.ctx(), &chapters[0]).expect("read");
        assert_eq!(read.chapter.prepared, Some(Depth::Most));
        assert_eq!(read.words[0].translations, ["bank-es"]);
    }

    #[test]
    fn a_deeper_depth_adds_words_and_keeps_the_progress_of_the_others() {
        let desk = Desk::new();
        let chapters = desk.book("b", &[CHAPTER]);
        let stub = Stub::new();
        let first = run(&desk, &stub, &chapters[0], Depth::Hardest).expect("hardest");
        assert_eq!(first, named(&[("peep", 1)]));
        mark_done(&desk.db.lock().expect("db"), &chapters[0], "peep");
        let before = chapter_words(desk.ctx(), &chapters[0]).expect("read");

        let deeper = run(&desk, &stub, &chapters[0], Depth::Relevant).expect("relevant");
        assert_eq!(deeper, named(&[("bank", 2), ("peep", 1)]));
        assert_eq!(stub.requests(), 2);
        let after = chapter_words(desk.ctx(), &chapters[0]).expect("read");
        assert_eq!(after.chapter.prepared, Some(Depth::Relevant));
        assert_eq!(after.words[1], before.words[0]);
        let done: i64 = desk
            .db
            .lock()
            .expect("db")
            .query_row(
                "SELECT COUNT(*) FROM chapter_words WHERE key = 'peep' AND done_at IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .expect("done");
        assert_eq!(done, 1, "the finished word stays finished");
    }

    #[test]
    fn words_known_or_done_elsewhere_are_not_extracted_again() {
        let desk = Desk::new();
        let first = desk.book("b", &[CHAPTER, CHAPTER]);
        let other = desk.book("c", &[CHAPTER]);
        let stub = Stub::new();
        run(&desk, &stub, &first[0], Depth::Most).expect("first");
        {
            let conn = desk.db.lock().expect("db");
            mark_done(&conn, &first[0], "bank");
            mark_known(&conn, "Peep");
        }

        let next = run(&desk, &stub, &first[1], Depth::Most).expect("next chapter");
        assert_eq!(next, named(&[("tir", 1)]));
        let elsewhere = run(&desk, &stub, &other[0], Depth::Most).expect("other book");
        assert_eq!(elsewhere, named(&[("tir", 1)]));
    }

    /// The chapter's readiness, and the words still in its queue.
    fn standing(desk: &Desk, chapter: &str) -> (Option<u32>, Vec<(String, Direction, u32)>) {
        let conn = desk.db.lock().expect("db");
        let readiness = books::get_chapter(&conn, chapter)
            .expect("chapter")
            .readiness;
        let queue = practice::queue(&conn, chapter)
            .expect("queue")
            .into_iter()
            .map(|item| {
                let lemma = practice::word(&conn, &item.word_id).expect("word").lemma;
                (lemma, item.direction, item.owed)
            })
            .collect();
        (readiness, queue)
    }

    fn word_id(desk: &Desk, chapter: &str, lemma: &str) -> String {
        let listed = chapter_words(desk.ctx(), chapter).expect("words");
        let word = listed.words.iter().find(|word| word.lemma == lemma);
        word.expect("listed").id.clone()
    }

    #[test]
    fn a_known_word_leaves_the_queue_and_counts_towards_readiness_until_undone() {
        let desk = Desk::new();
        let plain = "It was the day that she had not been there with her sister.";
        let chapters = desk.book("b", &[CHAPTER, plain]);
        let chapter = &chapters[0];
        assert_eq!(standing(&desk, chapter).0, None, "not prepared yet");
        let stub = Stub::new();
        run(&desk, &stub, chapter, Depth::Most).expect("prepare");
        let empty = run(&desk, &stub, &chapters[1], Depth::Most).expect("no words");
        assert_eq!(empty, []);
        assert_eq!(
            standing(&desk, &chapters[1]).0,
            Some(READY),
            "a prepared chapter with nothing to learn is ready"
        );

        // One miss on "bank", so that it has answers to keep.
        let bank = word_id(&desk, chapter, "bank");
        {
            let conn = desk.db.lock().expect("db");
            let sitting = practice::start(&conn, chapter, crate::domain::Ways::Both, Utc::now())
                .expect("sitting");
            let asked = (bank.as_str(), Direction::Recognition);
            practice::record(&conn, &sitting, asked, ("banco", false), Utc::now()).expect("miss");
        }
        // A miss adds nothing: the word owes what a new one does.
        let (there, start) = (Direction::Recognition, 2);
        let before = (
            Some(0),
            vec![
                ("bank".to_owned(), there, start),
                ("peep".to_owned(), there, start),
                ("tir".to_owned(), there, start),
            ],
        );
        assert_eq!(standing(&desk, chapter), before);

        let marked = set_known(desk.ctx(), &bank, true, Utc::now()).expect("known");
        assert_eq!(marked.chapter.readiness, Some(33));
        let flags: Vec<_> = marked
            .words
            .iter()
            .map(|w| (&w.lemma[..], w.known))
            .collect();
        assert_eq!(flags, [("bank", true), ("peep", false), ("tir", false)]);
        let (readiness, queue) = standing(&desk, chapter);
        assert_eq!(readiness, Some(33));
        assert_eq!(queue, before.1[1..], "the known word is not asked");
        let again = set_known(desk.ctx(), &bank, true, Utc::now()).expect("twice");
        assert_eq!(again, marked, "knowing it twice changes nothing");

        // Done and known together are everything: ready to read.
        mark_done(&desk.db.lock().expect("db"), chapter, "peep");
        let tir = word_id(&desk, chapter, "tir");
        let ready = set_known(desk.ctx(), &tir, true, Utc::now()).expect("known");
        assert_eq!(ready.chapter.readiness, Some(READY));
        assert_eq!(standing(&desk, chapter).1, []);
        let book = books::get_book(&desk.db.lock().expect("db"), "b").expect("book");
        let shown: Vec<_> = book.chapters.iter().map(|c| c.readiness).collect();
        assert_eq!(shown, [Some(READY), Some(READY)]);

        // Undone, the word is back where it was, its miss included.
        let undone = set_known(desk.ctx(), &bank, false, Utc::now()).expect("undo");
        assert_eq!(undone.chapter.readiness, Some(66));
        assert!(undone.words.iter().all(|w| w.known == (w.lemma == "tir")));
        assert_eq!(standing(&desk, chapter).1, before.1[..1]);
        let missing = set_known(desk.ctx(), "nowhere", true, Utc::now());
        assert_eq!(missing.expect_err("no word").kind(), "notFound");
    }

    #[test]
    fn a_word_left_to_learn_stays_sorted_until_another_pass() {
        let desk = Desk::new();
        let chapters = desk.book("b", &[CHAPTER]);
        let chapter = &chapters[0];
        let stub = Stub::new();
        run(&desk, &stub, chapter, Depth::Hardest).expect("prepare");
        let sorted = |found: &ChapterWords| -> Vec<(String, bool)> {
            let words = found.words.iter();
            words.map(|w| (w.lemma.clone(), w.sorted)).collect()
        };
        let fresh = chapter_words(desk.ctx(), chapter).expect("read");
        assert_eq!(sorted(&fresh), [("peep".to_owned(), false)]);

        let peep = word_id(&desk, chapter, "peep");
        let left = set_sorted(desk.ctx(), &peep, true, Utc::now()).expect("sort");
        assert_eq!(sorted(&left), [("peep".to_owned(), true)]);
        let undone = set_sorted(desk.ctx(), &peep, false, Utc::now()).expect("undo");
        assert_eq!(sorted(&undone), [("peep".to_owned(), false)]);
        set_sorted(desk.ctx(), &peep, true, Utc::now()).expect("again");

        // A deeper depth adds words to sort and keeps the ones sorted.
        run(&desk, &stub, chapter, Depth::Relevant).expect("deeper");
        let deeper = chapter_words(desk.ctx(), chapter).expect("read");
        let mixed = [("bank".to_owned(), false), ("peep".to_owned(), true)];
        assert_eq!(sorted(&deeper), mixed);

        let again = sort_again(desk.ctx(), chapter).expect("another pass");
        assert!(again.words.iter().all(|word| !word.sorted));
        let missing = set_sorted(desk.ctx(), "nowhere", true, Utc::now());
        assert_eq!(missing.expect_err("no word").kind(), "notFound");
    }

    #[test]
    fn a_known_word_is_known_in_every_chapter_and_outlives_its_book() {
        let desk = Desk::new();
        let first = desk.book("b", &[CHAPTER, CHAPTER, CHAPTER]);
        let other = desk.book("c", &[CHAPTER, CHAPTER]);
        let stub = Stub::new();
        // Two chapters, of two books, already have the word when it is marked.
        run(&desk, &stub, &first[0], Depth::Most).expect("first");
        run(&desk, &stub, &other[0], Depth::Most).expect("other book");
        let bank = word_id(&desk, &first[0], "bank");
        set_known(desk.ctx(), &bank, true, Utc::now()).expect("known");

        for chapter in [&first[0], &other[0]] {
            let (readiness, queue) = standing(&desk, chapter);
            assert_eq!(readiness, Some(33));
            assert!(queue.iter().all(|(lemma, ..)| lemma != "bank"));
        }
        // A chapter prepared afterwards does not take it at all.
        let later = run(&desk, &stub, &first[1], Depth::Most).expect("later chapter");
        assert_eq!(later, named(&[("peep", 1), ("tir", 1)]));

        books::archive_book(&desk.db.lock().expect("db"), "b", Utc::now()).expect("delete");
        let kept: String = desk
            .db
            .lock()
            .expect("db")
            .query_row("SELECT key FROM known_words", [], |row| row.get(0))
            .expect("still known");
        assert_eq!(kept, "bank");
        assert_eq!(standing(&desk, &other[0]).0, Some(33));
        let after = run(&desk, &stub, &other[1], Depth::Most).expect("after the book went");
        assert_eq!(after, named(&[("peep", 1), ("tir", 1)]));

        // Taken back from the other book, it is asked there again.
        let there = word_id(&desk, &other[0], "bank");
        set_known(desk.ctx(), &there, false, Utc::now()).expect("undo");
        let (readiness, queue) = standing(&desk, &other[0]);
        assert_eq!(readiness, Some(0));
        assert_eq!(queue[0].0, "bank");
    }

    #[test]
    fn a_failed_extraction_keeps_its_finished_pieces_for_the_retry() {
        let desk = Desk::new();
        let text = long_chapter();
        let pieces = chunks(&text, CHUNK_CHARS).len();
        assert!(pieces >= 3, "the chapter is cut into several pieces");
        let chapters = desk.book("b", &[&text]);

        let failing = Stub {
            fail_on: Some(2),
            ..Stub::new()
        };
        let seen = RefCell::new(Vec::new());
        let failed = prepare(
            desk.ctx(),
            &chapters[0],
            Depth::Most,
            &mut |params| failing.answer(params),
            &|p| seen.borrow_mut().push((p.done, p.total)),
        );
        assert_eq!(failed.expect_err("fails").kind(), "provider");
        let total = count(pieces);
        assert_eq!(*seen.borrow(), [(0, total), (1, total)]);
        assert_eq!(desk.chunk_rows(), 1);
        let unprepared = chapter_words(desk.ctx(), &chapters[0]).expect("read");
        assert_eq!(
            (unprepared.chapter.prepared, unprepared.words.len()),
            (None, 0)
        );

        let stub = Stub::new();
        seen.borrow_mut().clear();
        let found = prepare(
            desk.ctx(),
            &chapters[0],
            Depth::Most,
            &mut |params| stub.answer(params),
            &|p| seen.borrow_mut().push((p.done, p.total)),
        )
        .expect("retry");
        assert_eq!(
            stub.requests(),
            pieces - 1,
            "the first piece is not asked again"
        );
        assert_eq!(seen.borrow().first(), Some(&(1, total)));
        assert_eq!(seen.borrow().last(), Some(&(total, total)));
        let words: Vec<_> = found
            .words
            .iter()
            .map(|w| (w.lemma.as_str(), w.count))
            .collect();
        assert_eq!(words, [("bank", 2), ("peep", 1), ("tir", 1)]);
        assert_eq!(desk.chunk_rows(), 0);
    }

    #[test]
    fn a_chapter_that_is_not_english_is_refused_without_a_request() {
        let desk = Desk::new();
        let spanish = "Alicia empezaba ya a cansarse de estar sentada con su hermana a la \
            orilla del río, sin tener nada que hacer: había echado un par de ojeadas al libro \
            que su hermana estaba leyendo, pero no tenía dibujos ni diálogos.";
        let chapters = desk.book("b", &[spanish]);
        let stub = Stub::new();

        let refusal = run(&desk, &stub, &chapters[0], Depth::Most).expect_err("refused");
        assert!(matches!(refusal, Error::Invalid(why) if why == NOT_ENGLISH));
        assert_eq!(stub.requests(), 0);
        let missing = run(&desk, &stub, "nowhere", Depth::Most).expect_err("missing");
        assert_eq!(missing.kind(), "notFound");
    }
}
