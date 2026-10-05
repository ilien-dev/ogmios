//! Listening: a chapter read aloud from where it was left, and dictations
//! of its sentences. Everything here is code's: the sentences are the
//! book's own, cut as they are for translating, and what the learner typed
//! is compared with them word by word (`listening`). The model is asked
//! nothing.
//!
//! A dictation left is paused and can be gone on with; one finished says
//! how it went and may suggest another pace. A missed sentence comes back
//! once at the end of its session. The sentence itself never reaches the
//! webview before it is answered: it is only heard.

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};

use super::profile::require_profile;
use super::translate::cut;
use super::{run, tts};
use crate::books::practice::{mark, seed};
use crate::db::listening::{self as db, Answer, Answered, ItemRow, NewItem};
use crate::db::{books, new_id, recall, structures};
use crate::domain::{
    ChapterListening, ChapterReading, Dictation, DictationInfo, DictationItem, DictationResult,
    DictationSummary, HeardWord, ListeningChapter, ListeningState, Pace, StructureVerdict,
};
use crate::error::{Error, Result};
use crate::listening::{
    compare, hint, missed, offered, pace_of, plan, reinforced, standings, understood, verdict,
    Heard, WINDOW,
};
use crate::{AppState, Ctx};

fn count(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

/// The sentences of a chapter, one after another.
fn sentences(conn: &Connection, chapter_id: &str) -> Result<Vec<String>> {
    Ok(cut(conn, chapter_id)?.into_iter().flatten().collect())
}

fn answered(items: &[ItemRow]) -> u32 {
    count(items.iter().filter(|item| item.answered.is_some()).count())
}

/// How a finished dictation went.
fn summary(conn: &Connection, items: &[ItemRow], chosen: Pace) -> Result<DictationSummary> {
    let session: Vec<Heard> = items
        .iter()
        .filter_map(|item| Some(item.answered?.heard))
        .collect();
    let worth = |verdict: StructureVerdict| {
        count(
            items
                .iter()
                .filter(|item| item.answered.is_some_and(|was| was.verdict == verdict))
                .count(),
        )
    };
    let log = db::heard(conn)?;
    Ok(DictationSummary {
        correct: worth(StructureVerdict::Correct),
        partial: worth(StructureVerdict::Partial),
        wrong: worth(StructureVerdict::Wrong),
        right: session.iter().map(|heard| heard.right).sum(),
        total: session.iter().map(|heard| heard.total).sum(),
        pace: pace_of(&session).unwrap_or(chosen),
        hint: hint(&session, &log),
        understood: understood(&standings(&log, WINDOW)),
    })
}

/// A dictation as it stands.
fn view(conn: &Connection, id: &str) -> Result<Dictation> {
    let row = db::sitting(conn, id)?;
    let items = db::items(conn, id)?;
    let next = items
        .iter()
        .find(|item| item.answered.is_none())
        .filter(|_| !row.finished)
        .map(|next| DictationItem {
            index: next.index,
            listens: next.listens,
            pace: next.paces.map(|(_, slowest)| slowest),
            retry: next.item.retry_of.is_some(),
        });
    Ok(Dictation {
        done: answered(&items),
        total: count(items.len()),
        item: next,
        summary: if row.finished {
            Some(summary(conn, &items, row.pace)?)
        } else {
            None
        },
        id: row.id,
        chapter_id: row.chapter_id,
        pace: row.pace,
    })
}

/// The chapter the listening is on, with where its reading was left.
fn chapter_view(conn: &Connection, chapter_id: &str) -> Result<ListeningChapter> {
    let total = count(sentences(conn, chapter_id)?.len());
    Ok(ListeningChapter {
        book_id: db::book_of(conn, chapter_id)?.0,
        book_title: structures::book_title(conn, chapter_id)?,
        chapter: books::get_chapter(conn, chapter_id)?,
        sentences: total,
        place: db::place(conn, chapter_id)?.min(total.saturating_sub(1)),
    })
}

/// The menu: the pace understood, how each pace stands, the words that
/// escape the ear, the dictations left unfinished, and the chapter asked
/// for, or the one the learner is on.
pub fn state(ctx: Ctx<'_>, chapter_id: Option<&str>) -> Result<ListeningState> {
    let conn = ctx.conn()?;
    let stand = standings(&db::heard(&conn)?, WINDOW);
    let held = understood(&stand);
    let words = db::words(&conn)?;
    let mut paused = Vec::new();
    for row in db::unfinished(&conn)? {
        let items = db::items(&conn, &row.id)?;
        paused.push(DictationInfo {
            done: answered(&items),
            total: count(items.len()),
            id: row.id,
            started_at: row.started_at,
        });
    }
    let on = match chapter_id {
        Some(id) => Some(id.to_owned()),
        None => structures::current_chapter(&conn)?,
    };
    Ok(ListeningState {
        understood: held,
        pace: offered(held),
        standings: stand,
        missed: missed(&words),
        reinforced: reinforced(&words),
        paused,
        chapter: match on {
            Some(id) => Some(chapter_view(&conn, &id)?),
            None => None,
        },
    })
}

/// A chapter to listen to: its sentences by paragraph, the words learned
/// marked in them as when it is translated, and where it was left.
pub fn reading(ctx: Ctx<'_>, chapter_id: &str) -> Result<ChapterReading> {
    let conn = ctx.conn()?;
    let on = chapter_view(&conn, chapter_id)?;
    let learned = recall::learned_forms(&conn, chapter_id)?;
    Ok(ChapterReading {
        book_id: on.book_id,
        book_title: on.book_title,
        chapter: on.chapter,
        paragraphs: cut(&conn, chapter_id)?
            .iter()
            .map(|paragraph| {
                paragraph
                    .iter()
                    .map(|sentence| mark(sentence, &learned))
                    .collect()
            })
            .collect(),
        place: on.place,
    })
}

/// Starts a dictation on a chapter at `pace`: its sentences, and a few
/// from anywhere in the book for the words being reinforced.
pub fn start(ctx: Ctx<'_>, chapter_id: &str, pace: Pace, now: DateTime<Utc>) -> Result<Dictation> {
    let mut conn = ctx.conn()?;
    require_profile(&conn)?;
    let chapter = sentences(&conn, chapter_id)?;
    let mut book = Vec::new();
    for id in db::book_of(&conn, chapter_id)?.1 {
        book.extend(sentences(&conn, &id)?);
    }
    let id = new_id();
    let items: Vec<NewItem> = plan(
        &chapter,
        &book,
        &db::asked(&conn)?,
        &reinforced(&db::words(&conn)?),
        seed(&id),
    )
    .into_iter()
    .map(|planned| NewItem {
        planned,
        retry_of: None,
    })
    .collect();
    if items.is_empty() {
        return Err(Error::Invalid(
            "the chapter has no sentence to dictate".into(),
        ));
    }
    let tx = conn.transaction()?;
    db::start(&tx, &id, chapter_id, pace, &items, now)?;
    tx.commit()?;
    view(&conn, &id)
}

pub fn get(ctx: Ctx<'_>, sitting_id: &str) -> Result<Dictation> {
    view(&*ctx.conn()?, sitting_id)
}

/// The learner listens to the sentence at `index` at `pace`: it is counted,
/// and what there is to say is handed back for the voice alone.
pub fn hear(ctx: Ctx<'_>, sitting_id: &str, index: u32, pace: Pace) -> Result<String> {
    let conn = ctx.conn()?;
    if db::sitting(&conn, sitting_id)?.finished {
        return Err(Error::Invalid("the dictation is finished".into()));
    }
    db::listen(&conn, sitting_id, index, pace)?;
    db::items(&conn, sitting_id)?
        .into_iter()
        .find(|item| item.index == index)
        .map(|item| item.item.planned.sentence)
        .ok_or_else(|| Error::NotFound("sentence not found".into()))
}

/// Compares what was typed with the sentence at `index`. One answered
/// without listening counts at `pace`, the one chosen; one heard, at the
/// slowest pace it was heard at. A missed sentence is dictated again at
/// the end, once; with the last one answered the dictation is finished.
pub fn answer(
    ctx: Ctx<'_>,
    sitting_id: &str,
    (index, text, pace): (u32, &str, Pace),
    now: DateTime<Utc>,
) -> Result<DictationResult> {
    let mut conn = ctx.conn()?;
    if db::sitting(&conn, sitting_id)?.finished {
        return Err(Error::Invalid("the dictation is finished".into()));
    }
    let items = db::items(&conn, sitting_id)?;
    let item = items
        .iter()
        .find(|item| item.index == index && item.answered.is_none())
        .ok_or_else(|| Error::Invalid("no sentence to answer".into()))?;
    let sentence = &item.item.planned.sentence;
    let compared = compare(sentence, text);
    let heard: Vec<bool> = compared
        .words
        .iter()
        .filter(|word| word.key.is_some())
        .map(|word| word.heard)
        .collect();
    let (pace, slowed) = item
        .paces
        .map_or((pace, false), |(first, slowest)| (slowest, slowest < first));
    let worth = verdict(compared.whole, item.listens, slowed);

    let tx = conn.transaction()?;
    db::answer(
        &tx,
        sitting_id,
        index,
        &Answer {
            text,
            answered: Answered {
                verdict: worth,
                heard: Heard {
                    pace,
                    right: count(heard.iter().filter(|heard| **heard).count()),
                    total: count(heard.len()),
                },
            },
            words: &compared.words,
        },
        now,
    )?;
    let back = worth == StructureVerdict::Wrong && item.item.retry_of.is_none();
    if back {
        let again = NewItem {
            planned: item.item.planned.clone(),
            retry_of: Some(index),
        };
        db::append(&tx, sitting_id, &again)?;
    } else if items
        .iter()
        .all(|other| other.index == index || other.answered.is_some())
    {
        db::finish(&tx, sitting_id, now)?;
    }
    tx.commit()?;
    Ok(DictationResult {
        verdict: worth,
        sentence: sentence.clone(),
        words: compared
            .words
            .into_iter()
            .map(|word| HeardWord {
                text: word.text,
                heard: word.heard,
            })
            .collect(),
        listens: item.listens,
        slowed,
    })
}

/// Leaves a dictation: paused, to go on with, or `finished` as it is. One
/// with nothing answered is not kept at all.
pub fn close(ctx: Ctx<'_>, sitting_id: &str, finished: bool, now: DateTime<Utc>) -> Result<()> {
    let conn = ctx.conn()?;
    if answered(&db::items(&conn, sitting_id)?) == 0 {
        db::delete(&conn, sitting_id)
    } else if finished {
        db::finish(&conn, sitting_id, now)
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn listening_state(app: AppHandle, chapter_id: Option<String>) -> Result<ListeningState> {
    run(app, move |_, ctx| state(ctx, chapter_id.as_deref())).await
}

#[tauri::command]
pub async fn chapter_reading(app: AppHandle, chapter_id: String) -> Result<ChapterReading> {
    run(app, move |_, ctx| reading(ctx, &chapter_id)).await
}

/// Reads the chapter aloud from the sentence at `from`, reporting
/// `chapter-listening` as each one starts and keeping the place. Resolves
/// to whether it was heard to its end; false when it was stopped or
/// something else was said over it.
#[tauri::command]
pub async fn listen_chapter(
    app: AppHandle,
    chapter_id: String,
    from: u32,
    pace: Pace,
) -> Result<bool> {
    run(app, move |app, ctx| {
        let sentences = sentences(&*ctx.conn()?, &chapter_id)?;
        let variant = tts::variant(ctx)?;
        let keep = |sentence: u32| -> Result<()> {
            db::set_place(&*ctx.conn()?, &chapter_id, sentence, Utc::now())
        };
        let from = usize::try_from(from).unwrap_or(usize::MAX);
        let ended = app
            .state::<AppState>()
            .tts
            .read(&sentences, from, variant, pace, |at| {
                let sentence = count(at);
                // A place not kept is a place found again by hand.
                let _ = keep(sentence);
                // A closed window is the only way this fails.
                let _ = app.emit(
                    "chapter-listening",
                    ChapterListening {
                        chapter_id: chapter_id.clone(),
                        sentence,
                    },
                );
            })?;
        if ended {
            // Heard whole, it starts from the top next time.
            keep(0)?;
        }
        Ok(ended)
    })
    .await
}

#[tauri::command]
pub async fn start_dictation(app: AppHandle, chapter_id: String, pace: Pace) -> Result<Dictation> {
    run(app, move |_, ctx| start(ctx, &chapter_id, pace, Utc::now())).await
}

#[tauri::command]
pub async fn get_dictation(app: AppHandle, sitting_id: String) -> Result<Dictation> {
    run(app, move |_, ctx| get(ctx, &sitting_id)).await
}

/// Plays the sentence at `index` at `pace`, counting the listen. Resolves
/// to the dictation once it has been heard.
#[tauri::command]
pub async fn hear_dictation(
    app: AppHandle,
    sitting_id: String,
    index: u32,
    pace: Pace,
) -> Result<Dictation> {
    run(app, move |app, ctx| {
        let speech = &app.state::<AppState>().tts;
        let variant = tts::variant(ctx)?;
        if !speech.status(variant)?.downloaded {
            return Err(Error::Stt("the voice is not downloaded yet".into()));
        }
        let sentence = hear(ctx, &sitting_id, index, pace)?;
        speech.speak(&sentence, variant, pace)?;
        get(ctx, &sitting_id)
    })
    .await
}

#[tauri::command]
pub async fn answer_dictation(
    app: AppHandle,
    sitting_id: String,
    index: u32,
    answer: String,
    pace: Pace,
) -> Result<DictationResult> {
    run(app, move |_, ctx| {
        self::answer(ctx, &sitting_id, (index, answer.trim(), pace), Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn close_dictation(app: AppHandle, sitting_id: String, finished: bool) -> Result<()> {
    run(app, move |_, ctx| {
        close(ctx, &sitting_id, finished, Utc::now())
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::agent::Agent;
    use crate::db::{open_in_memory, profile};
    use crate::domain::PaceHint;
    use crate::listening::SIZE;

    struct World {
        db: Mutex<Connection>,
        agent: Agent,
        dir: tempfile::TempDir,
    }

    fn line(at: usize) -> String {
        format!("The cat number {at} sat by the old red door.")
    }

    impl World {
        /// With a book of two chapters: twelve sentences to dictate and a
        /// short one, and a second chapter with a word of its own.
        fn new() -> Self {
            let conn = open_in_memory().expect("db");
            profile::save_profile(&conn, &profile::tests::profile()).expect("profile");
            let first: Vec<String> = (0..12).map(line).collect();
            conn.execute(
                "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01')",
                [],
            )
            .expect("book");
            let mut insert = conn
                .prepare(
                    "INSERT INTO book_chapters (id, book_id, idx, title, words, text)
                     VALUES (?1, 'b', ?2, ?3, 9, ?4)",
                )
                .expect("chapters");
            insert
                .execute(("c", 0, "I", format!("{}\nToo short.", first.join("\n"))))
                .expect("first");
            insert
                .execute(("d", 1, "II", "Nobody in the whole town had ever seen them."))
                .expect("second");
            drop(insert);
            Self {
                db: Mutex::new(conn),
                agent: Agent::new(None),
                dir: tempfile::tempdir().expect("tempdir"),
            }
        }

        fn ctx(&self) -> Ctx<'_> {
            Ctx {
                db: &self.db,
                agent: &self.agent,
                data_dir: self.dir.path(),
            }
        }

        /// The sentence a dictation is on, read from the rows.
        fn sentence(&self, sitting: &Dictation) -> (u32, String) {
            let index = sitting.item.as_ref().expect("a sentence").index;
            let conn = self.db.lock().expect("db");
            let items = db::items(&conn, &sitting.id).expect("items");
            let item = items.iter().find(|item| item.index == index).expect("item");
            (index, item.item.planned.sentence.clone())
        }

        /// Answers every sentence left as `typed` says, heard once at `pace`.
        fn run(&self, id: &str, pace: Pace, typed: impl Fn(&str) -> String) -> Dictation {
            let ctx = self.ctx();
            let now = Utc::now();
            loop {
                let sitting = get(ctx, id).expect("get");
                if sitting.item.is_none() {
                    return sitting;
                }
                let (index, sentence) = self.sentence(&sitting);
                hear(ctx, id, index, pace).expect("hear");
                answer(ctx, id, (index, &typed(&sentence), pace), now).expect("answer");
            }
        }
    }

    #[test]
    fn a_chapter_is_read_by_its_sentences_from_where_it_was_left() {
        let world = World::new();
        let ctx = world.ctx();
        let read = reading(ctx, "c").expect("reading");
        assert_eq!(read.book_title, "Alice");
        assert_eq!(read.paragraphs.len(), 13);
        let [first] = read.paragraphs[0].as_slice() else {
            panic!("a sentence to a paragraph");
        };
        let text: String = first.iter().map(|part| part.text.as_str()).collect();
        assert_eq!(text, line(0));
        assert!(first.iter().all(|part| !part.marked));
        assert_eq!(read.place, 0);

        db::set_place(&world.db.lock().expect("db"), "c", 7, Utc::now()).expect("place");
        assert_eq!(reading(ctx, "c").expect("reading").place, 7);
        let on = state(ctx, Some("c"))
            .expect("state")
            .chapter
            .expect("chapter");
        assert_eq!((on.sentences, on.place, on.book_id.as_str()), (13, 7, "b"));
        // A place past the end of a text that changed is its last sentence.
        db::set_place(&world.db.lock().expect("db"), "c", 99, Utc::now()).expect("place");
        assert_eq!(reading(ctx, "c").expect("reading").place, 12);
    }

    #[test]
    fn the_menu_is_on_the_chapter_opened_last_until_another_is_asked_for() {
        let world = World::new();
        let ctx = world.ctx();
        let fresh = state(ctx, None).expect("state");
        assert_eq!(fresh.chapter, None);
        assert_eq!((fresh.understood, fresh.pace), (None, Pace::Normal));
        assert_eq!(fresh.standings.len(), 3);

        structures::mark_opened(&world.db.lock().expect("db"), "d", Utc::now()).expect("open");
        let on = state(ctx, None).expect("state").chapter.expect("chapter");
        assert_eq!(on.chapter.id, "d");
        let asked = state(ctx, Some("c"))
            .expect("state")
            .chapter
            .expect("chapter");
        assert_eq!(asked.chapter.id, "c");
    }

    #[test]
    fn a_dictation_plays_ten_sentences_and_says_how_it_went() {
        let world = World::new();
        let ctx = world.ctx();
        let now = Utc::now();
        let sitting = start(ctx, "c", Pace::Normal, now).expect("start");
        assert_eq!((sitting.done, sitting.total), (0, 10));
        let first = sitting.item.clone().expect("a sentence");
        assert_eq!((first.listens, first.pace, first.retry), (0, None, false));

        // Heard twice, typed whole: green.
        let (index, sentence) = world.sentence(&sitting);
        hear(ctx, &sitting.id, index, Pace::Normal).expect("hear");
        assert_eq!(
            hear(ctx, &sitting.id, index, Pace::Normal).expect("hear"),
            sentence
        );
        let heard = get(ctx, &sitting.id).expect("get").item.expect("item");
        assert_eq!((heard.listens, heard.pace), (2, Some(Pace::Normal)));
        let right =
            answer(ctx, &sitting.id, (index, &sentence, Pace::Normal), now).expect("answer");
        assert_eq!(right.verdict, StructureVerdict::Correct);
        assert_eq!(right.sentence, sentence);
        assert!(right.words.iter().all(|word| word.heard));
        assert!(matches!(
            answer(ctx, &sitting.id, (index, &sentence, Pace::Normal), now),
            Err(Error::Invalid(_))
        ));

        // Slowed down once heard: whole, but with help, and it counts as slow.
        let next = get(ctx, &sitting.id).expect("get");
        let (index, sentence) = world.sentence(&next);
        hear(ctx, &sitting.id, index, Pace::Normal).expect("hear");
        hear(ctx, &sitting.id, index, Pace::Slow).expect("hear");
        let helped =
            answer(ctx, &sitting.id, (index, &sentence, Pace::Normal), now).expect("answer");
        assert_eq!(
            (helped.verdict, helped.slowed),
            (StructureVerdict::Partial, true)
        );

        // Not heard at all and not known: missed, at the pace chosen, and back at the end.
        let next = get(ctx, &sitting.id).expect("get");
        let (index, missed_sentence) = world.sentence(&next);
        let lost = answer(ctx, &sitting.id, (index, "", Pace::Fast), now).expect("answer");
        assert_eq!(lost.verdict, StructureVerdict::Wrong);
        assert!(lost.words.iter().all(|word| !word.heard));
        assert_eq!(get(ctx, &sitting.id).expect("get").total, 11);

        let paused = state(ctx, None).expect("state").paused;
        assert_eq!(paused.len(), 1);
        assert_eq!((paused[0].done, paused[0].total), (3, 11));

        let done = world.run(&sitting.id, Pace::Normal, str::to_owned);
        let summary = done.summary.expect("finished");
        assert_eq!((summary.correct, summary.partial, summary.wrong), (9, 1, 1));
        assert_eq!(summary.pace, Pace::Normal);
        assert_eq!(summary.hint, None);
        assert_eq!(state(ctx, None).expect("state").paused, []);

        let conn = world.db.lock().expect("db");
        let items = db::items(&conn, &sitting.id).expect("items");
        let back = items.last().expect("the one that came back");
        assert_eq!(back.item.planned.sentence, missed_sentence);
        assert_eq!(back.item.retry_of, Some(index));
        let paces: Vec<Pace> = db::heard(&conn)
            .expect("heard")
            .iter()
            .map(|heard| heard.pace)
            .collect();
        assert_eq!(paces.iter().filter(|pace| **pace == Pace::Slow).count(), 1);
        assert_eq!(paces.iter().filter(|pace| **pace == Pace::Fast).count(), 1);
    }

    #[test]
    fn a_missed_sentence_comes_back_once_and_no_more() {
        let world = World::new();
        let ctx = world.ctx();
        let sitting = start(ctx, "c", Pace::Normal, Utc::now()).expect("start");
        let done = world.run(&sitting.id, Pace::Normal, |_| "no idea".to_owned());
        assert_eq!(done.total, 20);
        let summary = done.summary.expect("finished");
        assert_eq!((summary.wrong, summary.right), (20, 0));
        assert_eq!(summary.hint, Some(PaceHint::Slower));
    }

    #[test]
    fn two_dictations_understood_make_the_pace_held_and_offer_the_next() {
        let world = World::new();
        let ctx = world.ctx();
        let now = Utc::now();
        let first = start(ctx, "c", Pace::Normal, now).expect("start");
        let one = world.run(&first.id, Pace::Normal, str::to_owned);
        let summary = one.summary.expect("finished");
        assert_eq!(
            (summary.hint, summary.understood),
            (None, Some(Pace::Normal))
        );

        let second = start(ctx, "c", Pace::Normal, now).expect("start");
        let two = world.run(&second.id, Pace::Normal, str::to_owned);
        assert_eq!(two.summary.expect("finished").hint, Some(PaceHint::Faster));

        let menu = state(ctx, None).expect("state");
        assert_eq!(
            (menu.understood, menu.pace),
            (Some(Pace::Normal), Pace::Fast)
        );
        assert_eq!(menu.standings[1].sentences, 20);
        assert_eq!(menu.missed, []);
    }

    #[test]
    fn a_word_missed_again_and_again_gets_sentences_from_the_whole_book() {
        let world = World::new();
        let ctx = world.ctx();
        let sitting = start(ctx, "d", Pace::Normal, Utc::now()).expect("start");
        assert_eq!(sitting.total, 1);
        // "them" is never typed: missed in the sentence and again when it is back.
        let without = |sentence: &str| sentence.replace(" them", "");
        world.run(&sitting.id, Pace::Normal, without);
        let again = start(ctx, "d", Pace::Normal, Utc::now()).expect("start");
        world.run(&again.id, Pace::Normal, without);

        let menu = state(ctx, None).expect("state");
        assert_eq!(menu.reinforced, ["them"]);
        assert_eq!(menu.missed[0].word, "them");
        assert_eq!(menu.missed[0].times, 4);

        // A dictation on the other chapter keeps a sentence for it.
        let next = start(ctx, "c", Pace::Normal, Utc::now()).expect("start");
        assert_eq!(next.total, count(SIZE));
        let conn = world.db.lock().expect("db");
        let kept: Vec<String> = db::items(&conn, &next.id)
            .expect("items")
            .into_iter()
            .filter(|item| item.item.planned.reinforces.as_deref() == Some("them"))
            .map(|item| item.item.planned.sentence)
            .collect();
        assert_eq!(kept, ["Nobody in the whole town had ever seen them."]);
    }

    #[test]
    fn a_dictation_left_with_nothing_answered_is_not_kept() {
        let world = World::new();
        let ctx = world.ctx();
        let now = Utc::now();
        let empty = start(ctx, "c", Pace::Slow, now).expect("start");
        close(ctx, &empty.id, false, now).expect("close");
        assert!(matches!(get(ctx, &empty.id), Err(Error::NotFound(_))));

        let begun = start(ctx, "c", Pace::Slow, now).expect("start");
        let (index, sentence) = world.sentence(&begun);
        answer(ctx, &begun.id, (index, &sentence, Pace::Slow), now).expect("answer");
        close(ctx, &begun.id, false, now).expect("pause");
        assert_eq!(get(ctx, &begun.id).expect("get").summary, None);
        close(ctx, &begun.id, true, now).expect("finish");
        let ended = get(ctx, &begun.id).expect("get");
        assert_eq!(ended.item, None);
        let summary = ended.summary.expect("finished");
        assert_eq!((summary.correct, summary.pace), (1, Pace::Slow));
        assert!(matches!(
            hear(ctx, &begun.id, 1, Pace::Slow),
            Err(Error::Invalid(_))
        ));
    }

    #[test]
    fn a_chapter_without_a_sentence_to_dictate_starts_nothing() {
        let world = World::new();
        world
            .db
            .lock()
            .expect("db")
            .execute("UPDATE book_chapters SET text = 'Too short.'", [])
            .expect("text");
        assert!(matches!(
            start(world.ctx(), "c", Pace::Normal, Utc::now()),
            Err(Error::Invalid(_))
        ));
    }
}
