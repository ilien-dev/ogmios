//! Practising structures: the learner picks some and a size, and writes a
//! sentence at a time. Each sentence is asked for by code: which structure,
//! about what, and with which word the learner has already met in a book or
//! learned. A sentence with a word is about nothing in particular: the
//! word is what it is built on, and one that will not fit can be dropped
//! at no cost. The model is asked two things only. It labels each sentence
//! written, and the verdict is decided here from its labels; and, once for
//! a chapter, it labels the structures the chapter's text uses, which are
//! counted and ranked here.
//!
//! A session left is paused and can be gone on with; one finished says how
//! each structure went, and a structure with enough right comes back later
//! each time (`structures::standing`). None of it makes a structure
//! mastered: that is earned in conversation. A missed sentence comes back
//! once at the end of its session, about something else.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use super::profile::{agent, require_profile};
use super::run;
use crate::agent::protocol::{
    StructureDetectParams, StructureGrade, StructureGradeParams, StructureRef, StructuresFound,
    Target,
};
use crate::books::practice::seed;
use crate::books::vocab::{chunks, CHUNK_CHARS};
use crate::db::structures::{self as db, Answer, Gloss, ItemRow, NewItem};
use crate::db::{books, new_id, recall};
use crate::domain::{
    ChapterProgress, ChapterStructures, StructureInfo, StructureItem, StructureResult,
    StructureSitting, StructureSittingInfo, StructureSummary, StructureTally, StructureVerdict,
    StructureWord, StructuresState, WordSource,
};
use crate::error::{Error, Result};
use crate::structures::{
    find, plan, rank, standing, strength, topic, verdict, word, Asked, Labels, Met, Structure,
    Written, CATALOGUE, CHAPTER_TOP, SCAN_PIECES, SIZES,
};
use crate::Ctx;

/// How many words of each origin a session draws from.
const POOL: u32 = 20;

/// The two things the model is asked for; a stub in the tests.
pub trait Model {
    fn grade(&mut self, params: &StructureGradeParams) -> Result<StructureGrade>;
    fn detect(&mut self, params: &StructureDetectParams) -> Result<StructuresFound>;
}

/// The model behind the sidecar.
pub(super) struct Sidecar<'a>(pub(super) Ctx<'a>);

impl Model for Sidecar<'_> {
    fn grade(&mut self, params: &StructureGradeParams) -> Result<StructureGrade> {
        agent(self.0)?.structure_grade(params)
    }

    fn detect(&mut self, params: &StructureDetectParams) -> Result<StructuresFound> {
        agent(self.0)?.structure_detect(params)
    }
}

fn count(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

/// A structure as the model is told it.
fn reference(structure: &Structure) -> StructureRef {
    StructureRef {
        key: structure.key.to_owned(),
        name: structure.name.to_owned(),
        form: structure.form.to_owned(),
        usage: structure.usage.to_owned(),
    }
}

fn known(key: &str) -> Result<&'static Structure> {
    find(key).ok_or_else(|| Error::Invalid(format!("unknown structure: {key}")))
}

/// The words a session asks for, of any kind. One on a chapter uses that
/// chapter's; any other, or one on a chapter without words, the words of
/// the chapter the learner is on and then the learned ones of the books,
/// the closest to slipping first.
fn words(conn: &Connection, chapter_id: Option<&str>) -> Result<Vec<Asked>> {
    let of_chapter = |id: &str| -> Result<Vec<Asked>> {
        Ok(db::chapter_words(conn, id, POOL)?
            .into_iter()
            .map(|english| Asked {
                english,
                source: WordSource::Chapter,
            })
            .collect())
    };
    if let Some(id) = chapter_id {
        let own = of_chapter(id)?;
        if !own.is_empty() {
            return Ok(own);
        }
    }
    let mut pool = match db::current_chapter(conn)? {
        Some(id) => of_chapter(&id)?,
        None => Vec::new(),
    };
    let word_keys = db::word_keys(conn)?;
    let mut learned: Vec<_> = recall::words(conn)?
        .into_iter()
        .filter(|word| word_keys.contains(&word.key))
        .collect();
    learned.sort_by(|a, b| (a.standing.due_at, &a.key).cmp(&(b.standing.due_at, &b.key)));
    let mut seen: HashSet<String> = pool.iter().map(|word| word.english.clone()).collect();
    for word in learned.into_iter().take(usize::try_from(POOL).unwrap_or(0)) {
        if seen.insert(word.english.clone()) {
            pool.push(Asked {
                english: word.english,
                source: WordSource::Recall,
            });
        }
    }
    Ok(pool)
}

/// What kind of word a word asked for is and what it means, read from the
/// books each time: as the session's chapter has it, or, for a word of the
/// chapter the learner is on, as that one does.
fn gloss(conn: &Connection, asked: &Asked, chapter_id: Option<&str>) -> Result<Gloss> {
    let current = match (chapter_id, asked.source) {
        (None, WordSource::Chapter) => db::current_chapter(conn)?,
        _ => None,
    };
    db::gloss(conn, &asked.english, chapter_id.or(current.as_deref()))
}

/// The words a session draws from, each with what the books say of it.
fn pool(conn: &Connection, chapter_id: Option<&str>) -> Result<Vec<Met>> {
    words(conn, chapter_id)?
        .into_iter()
        .map(|asked| {
            let said = gloss(conn, &asked, chapter_id)?;
            Ok(Met {
                asked,
                kind: said.part_of_speech,
                transitive: said.transitive,
            })
        })
        .collect()
}

/// The sentence a session asks for at `turn` with this structure: what it
/// is about, and a word that fits the structure when one was met.
fn sentence(
    pool: &[Met],
    interests: &[String],
    structure: String,
    (drawn, turn): (u64, usize),
) -> NewItem {
    NewItem {
        topic: topic(interests, drawn, turn),
        word: word(pool, &structure, drawn, turn),
        structure,
        warm: false,
        retry_of: None,
    }
}

/// A word asked for as the learner is shown it.
fn shown(conn: &Connection, asked: &Asked, chapter_id: Option<&str>) -> Result<StructureWord> {
    let said = gloss(conn, asked, chapter_id)?;
    Ok(StructureWord {
        english: asked.english.clone(),
        source: asked.source,
        part_of_speech: said.part_of_speech,
        translations: said.translations,
    })
}

/// How a session's answered sentences went, the weakest structure first.
fn summary(items: &[ItemRow]) -> StructureSummary {
    let mut tallies: Vec<StructureTally> = Vec::new();
    let (mut correct, mut partial, mut wrong) = (0, 0, 0);
    for item in items {
        let Some(answered) = &item.answered else {
            continue;
        };
        match answered.verdict {
            StructureVerdict::Correct => correct += 1,
            StructureVerdict::Partial => partial += 1,
            StructureVerdict::Wrong => wrong += 1,
        }
        let at = tallies
            .iter()
            .position(|tally| tally.key == item.item.structure)
            .unwrap_or_else(|| {
                tallies.push(StructureTally {
                    key: item.item.structure.clone(),
                    right: 0,
                    total: 0,
                });
                tallies.len() - 1
            });
        if let Some(tally) = tallies.get_mut(at) {
            tally.total += 1;
            if answered.verdict != StructureVerdict::Wrong {
                tally.right += 1;
            }
        }
    }
    // By the share that was right; stable, so ties stay as they were asked.
    tallies.sort_by(|a, b| (a.right * b.total).cmp(&(b.right * a.total)));
    StructureSummary {
        correct,
        partial,
        wrong,
        structures: tallies,
    }
}

/// The keys of a session's structures, in the order they first come.
fn structures_of(items: &[ItemRow]) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .iter()
        .filter(|item| seen.insert(item.item.structure.as_str()))
        .map(|item| item.item.structure.clone())
        .collect()
}

/// A session as it stands.
fn view(conn: &Connection, id: &str) -> Result<StructureSitting> {
    let row = db::sitting(conn, id)?;
    let items = db::items(conn, id)?;
    let next = match items.iter().find(|item| item.answered.is_none()) {
        Some(next) if !row.finished => {
            let structure = known(&next.item.structure)?;
            Some(StructureItem {
                index: next.index,
                structure: next.item.structure.clone(),
                name: structure.name.to_owned(),
                level: structure.level,
                example: structure.example.to_owned(),
                // The word is what the sentence is built on: a topic on top
                // of it leaves no natural sentence to write.
                topic: next.item.word.is_none().then(|| next.item.topic.clone()),
                word: match &next.item.word {
                    Some(asked) => Some(shown(conn, asked, row.chapter_id.as_deref())?),
                    None => None,
                },
                warm: next.item.warm,
            })
        }
        _ => None,
    };
    Ok(StructureSitting {
        id: row.id,
        size: row.size,
        structures: structures_of(&items),
        chapter_id: row.chapter_id,
        done: count(items.iter().filter(|item| item.answered.is_some()).count()),
        total: count(items.len()),
        item: next,
        summary: row.finished.then(|| summary(&items)),
    })
}

/// The structures a session on the chapter practises: the ones it uses
/// most, as far as they are known.
fn chapter_view(conn: &Connection, chapter_id: &str) -> Result<ChapterStructures> {
    let mut structures = db::chapter_structures(conn, chapter_id)?;
    structures.truncate(CHAPTER_TOP);
    Ok(ChapterStructures {
        book_title: db::book_title(conn, chapter_id)?,
        chapter: books::get_chapter(conn, chapter_id)?,
        scanned: db::scanned(conn, chapter_id)?,
        structures,
    })
}

/// The menu: every structure with how it stands, the sessions left
/// unfinished, and the chapter the learner is on.
pub fn state(ctx: Ctx<'_>, now: DateTime<Utc>) -> Result<StructuresState> {
    let conn = ctx.conn()?;
    let rounds = db::rounds(&conn)?;
    let structures = CATALOGUE
        .iter()
        .map(|structure| {
            let stands = rounds.get(structure.key).and_then(|of| standing(of));
            StructureInfo {
                key: structure.key.to_owned(),
                level: structure.level,
                name: structure.name.to_owned(),
                example: structure.example.to_owned(),
                strength: strength(stands.map_or(0, |stands| stands.step)),
                due: stands.is_some_and(|stands| stands.due_at <= now),
            }
        })
        .collect();
    let mut paused = Vec::new();
    for row in db::unfinished(&conn)? {
        let items = db::items(&conn, &row.id)?;
        paused.push(StructureSittingInfo {
            done: count(items.iter().filter(|item| item.answered.is_some()).count()),
            total: count(items.len()),
            structures: structures_of(&items),
            id: row.id,
            started_at: row.started_at,
        });
    }
    let chapter = match db::current_chapter(&conn)? {
        Some(id) => Some(chapter_view(&conn, &id)?),
        None => None,
    };
    Ok(StructuresState {
        structures,
        paused,
        chapter,
    })
}

/// The structure the partner of a conversation is given to bring out: the
/// practised one most overdue; none when none is due.
pub fn target(conn: &Connection, now: DateTime<Utc>) -> Result<Option<Target>> {
    let rounds = db::rounds(conn)?;
    let due = CATALOGUE
        .iter()
        .filter_map(|structure| {
            let stands = rounds.get(structure.key).and_then(|of| standing(of))?;
            (stands.due_at <= now).then_some((stands.due_at, structure))
        })
        .min_by_key(|(due_at, _)| *due_at);
    Ok(due.map(|(_, structure)| Target {
        description: format!("{}: {}", structure.name, structure.form),
        contexts: format!(
            "Used for {}, in sentences like \"{}\"",
            structure.usage, structure.example
        ),
    }))
}

/// The structures the chapter uses. It is read for them once, a few pieces
/// of it, and what was found is kept: asked again, it is not read again.
/// `progress` hears how many pieces were read, before the first and after
/// each one.
pub fn scan(
    ctx: Ctx<'_>,
    model: &mut dyn Model,
    chapter_id: &str,
    progress: &dyn Fn(ChapterProgress),
    now: DateTime<Utc>,
) -> Result<ChapterStructures> {
    let text = {
        let conn = ctx.conn()?;
        if db::scanned(&conn, chapter_id)? {
            return chapter_view(&conn, chapter_id);
        }
        books::chapter_text(&conn, chapter_id)?
    };
    let structures: Vec<StructureRef> = CATALOGUE.iter().map(reference).collect();
    let pieces: Vec<&str> = chunks(&text, CHUNK_CHARS)
        .into_iter()
        .take(SCAN_PIECES)
        .collect();
    let report = |done: usize| {
        progress(ChapterProgress {
            chapter_id: chapter_id.to_owned(),
            done: count(done),
            total: count(pieces.len()),
        });
    };
    report(0);
    let mut found = Vec::new();
    for (read, piece) in pieces.iter().enumerate() {
        // The database is not held while the model answers: that takes long.
        let answer = model.detect(&StructureDetectParams {
            structures: structures.clone(),
            text: (*piece).to_owned(),
        })?;
        found.extend(answer.found);
        report(read + 1);
    }
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    db::store_scan(&tx, chapter_id, &rank(&found, &text), now)?;
    tx.commit()?;
    chapter_view(&conn, chapter_id)
}

/// Starts a session of `size` sentences over these structures; on a
/// chapter, with that chapter's words.
pub fn start(
    ctx: Ctx<'_>,
    keys: &[String],
    size: u32,
    chapter_id: Option<&str>,
    now: DateTime<Utc>,
) -> Result<StructureSitting> {
    if !SIZES.contains(&size) {
        return Err(Error::Invalid(format!("not a session size: {size}")));
    }
    for key in keys {
        known(key)?;
    }
    let mut conn = ctx.conn()?;
    let profile = require_profile(&conn)?;
    if let Some(id) = chapter_id {
        books::get_chapter(&conn, id)?;
    }
    let id = new_id();
    let drawn = seed(&id);
    let pool = pool(&conn, chapter_id)?;
    let items: Vec<NewItem> = plan(keys, size, drawn)
        .into_iter()
        .enumerate()
        .map(|(turn, slot)| NewItem {
            warm: slot.warm,
            ..sentence(&pool, &profile.interests, slot.structure, (drawn, turn))
        })
        .collect();
    if items.is_empty() {
        return Err(Error::Invalid("a session needs a structure".into()));
    }
    let tx = conn.transaction()?;
    db::start(&tx, &id, size, chapter_id, &items, now)?;
    tx.commit()?;
    view(&conn, &id)
}

pub fn get(ctx: Ctx<'_>, sitting_id: &str) -> Result<StructureSitting> {
    view(&*ctx.conn()?, sitting_id)
}

/// The learner says the word asked for at `index` will not fit: the
/// sentence is asked without it, about its topic, and loses nothing.
pub fn drop_word(ctx: Ctx<'_>, sitting_id: &str, index: u32) -> Result<StructureSitting> {
    let conn = ctx.conn()?;
    if db::sitting(&conn, sitting_id)?.finished {
        return Err(Error::Invalid("the session is finished".into()));
    }
    db::drop_word(&conn, sitting_id, index)?;
    view(&conn, sitting_id)
}

/// Judges the sentence written for the one at `index`. `peeked` says the
/// learner asked to see the form; in the warm-up it is in sight anyway and
/// costs nothing. A missed sentence is asked again at the end, once, about
/// something else; with the last one answered the session is finished.
pub fn answer(
    ctx: Ctx<'_>,
    model: &mut dyn Model,
    sitting_id: &str,
    (index, text, peeked): (u32, &str, bool),
    now: DateTime<Utc>,
) -> Result<StructureResult> {
    let text = text.trim();
    let (row, item, profile) = {
        let conn = ctx.conn()?;
        let row = db::sitting(&conn, sitting_id)?;
        if row.finished {
            return Err(Error::Invalid("the session is finished".into()));
        }
        let item = db::items(&conn, sitting_id)?
            .into_iter()
            .find(|item| item.index == index)
            .ok_or_else(|| Error::NotFound("sentence not found".into()))?;
        if item.answered.is_some() {
            return Err(Error::Invalid("the sentence is already answered".into()));
        }
        let part_of_speech = match &item.item.word {
            Some(asked) => gloss(&conn, asked, row.chapter_id.as_deref())?.part_of_speech,
            None => None,
        };
        (row, item, (require_profile(&conn)?, part_of_speech))
    };
    let (profile, part_of_speech) = profile;
    let structure = known(&item.item.structure)?;
    let asked = item.item.word.as_ref().map(|word| word.english.clone());
    // The database is not held while the model answers: that takes long.
    let grade = model.grade(&StructureGradeParams {
        native_lang: profile.native_lang.clone(),
        level: profile.level,
        variant: profile.variant,
        structure: reference(structure),
        word: asked.clone(),
        part_of_speech,
        answer: text.to_owned(),
    })?;
    let used_word = asked.is_none() || grade.uses_word;
    let verdict = verdict(
        Labels {
            uses_structure: grade.uses_structure,
            well_formed: grade.well_formed,
            uses_word: grade.uses_word,
            slips: grade.slips,
        },
        Written {
            answered: !text.is_empty(),
            peeked: peeked && !item.item.warm,
            word_asked: asked.is_some(),
        },
    );

    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    db::answer(
        &tx,
        sitting_id,
        index,
        &Answer {
            text,
            peeked,
            verdict,
            explanation: &grade.explanation,
            better: &grade.better,
        },
        now,
    )?;
    let items = db::items(&tx, sitting_id)?;
    let repeats =
        item.item.retry_of.is_some() || items.iter().any(|each| each.item.retry_of == Some(index));
    if verdict == StructureVerdict::Wrong && !repeats {
        let pool = pool(&tx, row.chapter_id.as_deref())?;
        db::append(
            &tx,
            sitting_id,
            &NewItem {
                retry_of: Some(index),
                ..sentence(
                    &pool,
                    &profile.interests,
                    item.item.structure.clone(),
                    (seed(sitting_id), items.len()),
                )
            },
        )?;
    } else if items.iter().all(|each| each.answered.is_some()) {
        db::finish(&tx, sitting_id, now)?;
    }
    tx.commit()?;
    Ok(StructureResult {
        verdict,
        explanation: grade.explanation,
        better: grade.better,
        used_word,
    })
}

/// Leaves a session: paused, to go on with, or `finished` as it is. One
/// with nothing written is not kept at all.
pub fn close(ctx: Ctx<'_>, sitting_id: &str, finished: bool, now: DateTime<Utc>) -> Result<()> {
    let conn = ctx.conn()?;
    let written = db::items(&conn, sitting_id)?
        .iter()
        .any(|item| item.answered.is_some());
    if !written {
        db::delete(&conn, sitting_id)
    } else if finished {
        db::finish(&conn, sitting_id, now)
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn structures_state(app: AppHandle) -> Result<StructuresState> {
    run(app, move |_, ctx| state(ctx, Utc::now())).await
}

#[tauri::command]
pub async fn scan_chapter_structures(
    app: AppHandle,
    chapter_id: String,
) -> Result<ChapterStructures> {
    run(app, move |app, ctx| {
        scan(
            ctx,
            &mut Sidecar(ctx),
            &chapter_id,
            &|progress| {
                // A closed window is the only way this fails; the work goes on.
                let _ = app.emit("structure-scan-progress", progress);
            },
            Utc::now(),
        )
    })
    .await
}

#[tauri::command]
pub async fn start_structure_sitting(
    app: AppHandle,
    structures: Vec<String>,
    size: u32,
    chapter_id: Option<String>,
) -> Result<StructureSitting> {
    run(app, move |_, ctx| {
        start(ctx, &structures, size, chapter_id.as_deref(), Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn get_structure_sitting(app: AppHandle, sitting_id: String) -> Result<StructureSitting> {
    run(app, move |_, ctx| get(ctx, &sitting_id)).await
}

#[tauri::command]
pub async fn drop_structure_word(
    app: AppHandle,
    sitting_id: String,
    index: u32,
) -> Result<StructureSitting> {
    run(app, move |_, ctx| drop_word(ctx, &sitting_id, index)).await
}

#[tauri::command]
pub async fn answer_structure(
    app: AppHandle,
    sitting_id: String,
    index: u32,
    answer: String,
    peeked: bool,
) -> Result<StructureResult> {
    run(app, move |_, ctx| {
        self::answer(
            ctx,
            &mut Sidecar(ctx),
            &sitting_id,
            (index, &answer, peeked),
            Utc::now(),
        )
    })
    .await
}

#[tauri::command]
pub async fn close_structure_sitting(
    app: AppHandle,
    sitting_id: String,
    finished: bool,
) -> Result<()> {
    run(app, move |_, ctx| {
        close(ctx, &sitting_id, finished, Utc::now())
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use chrono::Duration;

    use super::*;
    use crate::agent::protocol::StructureFound;
    use crate::agent::Agent;
    use crate::db::{open_in_memory, parse_ts, profile};
    use crate::domain::{PartOfSpeech, Strength, Topic};

    /// Labels a sentence by what it holds: without "bad" it has the
    /// structure, and it has the word when it has it as it was given.
    #[derive(Default)]
    struct Stub {
        graded: Vec<StructureGradeParams>,
        read: Vec<String>,
    }

    impl Model for Stub {
        fn grade(&mut self, params: &StructureGradeParams) -> Result<StructureGrade> {
            self.graded.push(params.clone());
            let has = !params.answer.contains("bad") && !params.answer.is_empty();
            Ok(StructureGrade {
                uses_structure: has,
                well_formed: has,
                uses_word: params
                    .word
                    .as_ref()
                    .is_some_and(|word| params.answer.contains(word.as_str())),
                slips: false,
                explanation: "Porque sí.".into(),
                better: "I can do it.".into(),
            })
        }

        fn detect(&mut self, params: &StructureDetectParams) -> Result<StructuresFound> {
            self.read.push(params.text.clone());
            Ok(StructuresFound {
                found: vec![
                    StructureFound {
                        key: "past-simple".into(),
                        count: 3,
                        sentence: "He ran home.".into(),
                    },
                    StructureFound {
                        key: "can".into(),
                        count: 1,
                        sentence: "Not in the book.".into(),
                    },
                ],
            })
        }
    }

    struct World {
        db: Mutex<Connection>,
        agent: Agent,
        dir: tempfile::TempDir,
    }

    impl World {
        fn new() -> Self {
            let conn = open_in_memory().expect("db");
            profile::save_profile(&conn, &profile::tests::profile()).expect("profile");
            Self {
                db: Mutex::new(conn),
                agent: Agent::new(None),
                dir: tempfile::tempdir().expect("tempdir"),
            }
        }

        /// With a book of one chapter: a verb that takes an object and one
        /// that takes none, a noun, a word of no kind worth naming, and a
        /// text.
        fn with_chapter() -> Self {
            let world = Self::new();
            world
                .db
                .lock()
                .expect("db")
                .execute_batch(
                    "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
                     INSERT INTO book_chapters (id, book_id, idx, title, words, text)
                       VALUES ('c', 'b', 0, 'I', 3, 'He ran home. He can swim.');
                     INSERT INTO chapter_words
                       (id, chapter_id, key, lemma, forms, sentence, occurrences, depth,
                        created_at, part_of_speech, transitive)
                     VALUES ('w1', 'c', 'stir', 'stir', '[]', 's', 1, 'most', '2026-01-01',
                             'verb', 1),
                            ('w2', 'c', 'trot', 'trot', '[]', 's', 3, 'most', '2026-01-01',
                             'verb', 0),
                            ('w3', 'c', 'bank', 'bank', '[]', 's', 9, 'most', '2026-01-01',
                             'noun', 0),
                            ('w4', 'c', 'of', 'of', '[]', 's', 9, 'most', '2026-01-01',
                             'other', 0);
                     INSERT INTO word_translations (word_id, text) VALUES
                       ('w1', 'remover'), ('w2', 'trotar'), ('w3', 'orilla'),
                       ('w3', 'ribera');",
                )
                .expect("rows");
            world
        }

        fn ctx(&self) -> Ctx<'_> {
            Ctx {
                db: &self.db,
                agent: &self.agent,
                data_dir: self.dir.path(),
            }
        }
    }

    fn now() -> DateTime<Utc> {
        parse_ts("2026-03-01T10:00:00.000Z").expect("a date")
    }

    fn keys(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    /// Writes a sentence for whatever is asked next: a right one with the
    /// word asked for, or a "bad" one.
    fn write(world: &World, model: &mut Stub, id: &str, right: bool) -> StructureResult {
        let item = get(world.ctx(), id)
            .expect("sitting")
            .item
            .expect("a sentence to write");
        let asked = item.word.map_or_else(String::new, |word| word.english);
        let text = if right {
            format!("I can {asked} it.")
        } else {
            "bad".to_owned()
        };
        answer(world.ctx(), model, id, (item.index, &text, false), now()).expect("answer")
    }

    #[test]
    fn a_session_is_refused_without_a_size_or_a_structure_of_the_catalogue() {
        let world = World::new();
        let start = |keys: &[String], size| start(world.ctx(), keys, size, None, now());
        assert_eq!(
            start(&keys(&["can"]), 15).expect_err("size").kind(),
            "invalid"
        );
        assert_eq!(
            start(&keys(&["nothing"]), 10).expect_err("key").kind(),
            "invalid"
        );
        assert_eq!(start(&[], 10).expect_err("none").kind(), "invalid");
        assert_eq!(
            super::start(world.ctx(), &keys(&["can"]), 10, Some("gone"), now())
                .expect_err("chapter")
                .kind(),
            "notFound"
        );
    }

    #[test]
    fn a_session_asks_its_sentences_and_ends_with_how_each_structure_went() {
        let world = World::new();
        let mut model = Stub::default();
        let sitting = start(world.ctx(), &keys(&["can", "will"]), 10, None, now()).expect("start");
        assert_eq!((sitting.done, sitting.total, sitting.size), (0, 10, 10));
        assert_eq!(sitting.chapter_id, None);
        assert_eq!(sitting.structures.len(), 2);
        let first = sitting.item.expect("first sentence");
        assert!(first.warm);
        assert_eq!(first.level, crate::domain::Level::Basic);
        assert!(["Can / can't", "Will"].contains(&first.name.as_str()));
        assert_ne!(first.example, "");
        assert_eq!(first.word, None, "no word was met yet");
        assert!(matches!(
            first.topic,
            Some(Topic::Preset { .. } | Topic::Interest { .. })
        ));

        let result = write(&world, &mut model, &sitting.id, true);
        assert_eq!(result.verdict, StructureVerdict::Correct);
        assert!(result.used_word);
        assert_eq!(model.graded[0].native_lang, "es");
        assert_eq!(model.graded[0].structure.key, first.structure);

        for _ in 1..10 {
            write(&world, &mut model, &sitting.id, true);
        }
        let ended = get(world.ctx(), &sitting.id).expect("sitting");
        assert_eq!((ended.done, ended.total, ended.item), (10, 10, None));
        let summary = ended.summary.expect("finished");
        assert_eq!(
            (summary.correct, summary.partial, summary.wrong),
            (10, 0, 0)
        );
        assert_eq!(summary.structures.len(), 2);
        assert_eq!(summary.structures.iter().map(|t| t.total).sum::<u32>(), 10);
        assert_eq!(
            answer(
                world.ctx(),
                &mut model,
                &sitting.id,
                (0, "I can.", false),
                now()
            )
            .expect_err("finished")
            .kind(),
            "invalid"
        );
    }

    #[test]
    fn a_missed_sentence_comes_back_once_at_the_end() {
        let world = World::new();
        let mut model = Stub::default();
        let sitting = start(world.ctx(), &keys(&["can"]), 10, None, now()).expect("start");
        let missed = write(&world, &mut model, &sitting.id, false);
        assert_eq!(missed.verdict, StructureVerdict::Wrong);
        assert_eq!(get(world.ctx(), &sitting.id).expect("sitting").total, 11);
        for _ in 1..10 {
            write(&world, &mut model, &sitting.id, true);
        }
        // The one that came back, missed again: it does not come back twice.
        let again = get(world.ctx(), &sitting.id).expect("sitting");
        assert_eq!(again.item.as_ref().map(|item| item.index), Some(10));
        assert_eq!(again.item.map(|item| item.warm), Some(false));
        write(&world, &mut model, &sitting.id, false);
        let ended = get(world.ctx(), &sitting.id).expect("sitting");
        assert_eq!((ended.done, ended.total), (11, 11));
        let summary = ended.summary.expect("finished");
        assert_eq!((summary.correct, summary.wrong), (9, 2));
        assert_eq!(
            summary.structures,
            [StructureTally {
                key: "can".into(),
                right: 9,
                total: 11
            }]
        );
    }

    #[test]
    fn nothing_written_is_wrong_and_the_form_asked_for_is_help_after_the_warm_up() {
        let world = World::with_chapter();
        let mut model = Stub::default();
        let sitting = start(world.ctx(), &keys(&["can"]), 10, Some("c"), now()).expect("start");
        let item = sitting.item.expect("first");
        assert_eq!(item.topic, None, "the word is what it is built on");
        let asked = item.word.expect("a word of the chapter");
        assert!(["stir", "trot", "bank"].contains(&asked.english.as_str()));
        assert_eq!(asked.source, WordSource::Chapter);

        // In the warm-up the form is in sight: looking at it costs nothing.
        let right = format!("I can {} it.", asked.english);
        let warm = answer(
            world.ctx(),
            &mut model,
            &sitting.id,
            (0, &right, true),
            now(),
        )
        .expect("answer");
        assert_eq!(warm.verdict, StructureVerdict::Correct);
        let wordless = answer(
            world.ctx(),
            &mut model,
            &sitting.id,
            (1, "I can do it.", false),
            now(),
        )
        .expect("answer");
        assert_eq!(wordless.verdict, StructureVerdict::Partial);
        assert!(!wordless.used_word);
        let empty = answer(
            world.ctx(),
            &mut model,
            &sitting.id,
            (2, "  ", false),
            now(),
        )
        .expect("answer");
        assert_eq!(empty.verdict, StructureVerdict::Wrong);
        assert_eq!(model.graded[2].answer, "");

        // The fourth is past the warm-up of a session of ten.
        let after = get(world.ctx(), &sitting.id)
            .expect("sitting")
            .item
            .expect("fourth");
        assert!(!after.warm);
        let again = after.word.expect("a word").english;
        let peeked = answer(
            world.ctx(),
            &mut model,
            &sitting.id,
            (after.index, &format!("I can {again} it."), true),
            now(),
        )
        .expect("answer");
        assert_eq!(peeked.verdict, StructureVerdict::Partial);
        assert_eq!(
            answer(
                world.ctx(),
                &mut model,
                &sitting.id,
                (0, "I can.", false),
                now()
            )
            .expect_err("answered")
            .kind(),
            "invalid"
        );
    }

    #[test]
    fn a_word_of_any_kind_is_asked_for_with_its_kind_and_what_it_means() {
        let world = World::with_chapter();
        let mut model = Stub::default();
        let sitting = start(world.ctx(), &keys(&["can"]), 60, Some("c"), now()).expect("start");
        let mut kinds = HashSet::new();
        for _ in 0..60 {
            let item = get(world.ctx(), &sitting.id)
                .expect("sitting")
                .item
                .expect("a sentence to write");
            let asked = item.word.clone().expect("a word of the chapter");
            let (kind, means): (_, &[&str]) = match asked.english.as_str() {
                "stir" => (PartOfSpeech::Verb, &["remover"]),
                "trot" => (PartOfSpeech::Verb, &["trotar"]),
                "bank" => (PartOfSpeech::Noun, &["orilla", "ribera"]),
                other => panic!("{other} is no word to ask for"),
            };
            assert_eq!(asked.part_of_speech, Some(kind));
            assert_eq!(asked.translations, means);
            kinds.insert(kind);
            write(&world, &mut model, &sitting.id, true);
            // The model is told what kind of word it was asked to label.
            let graded = model.graded.last().expect("graded");
            assert_eq!(graded.word.as_deref(), Some(asked.english.as_str()));
            assert_eq!(graded.part_of_speech, Some(kind));
        }
        assert_eq!(kinds.len(), 2, "not verbs alone");
    }

    #[test]
    fn a_structure_built_on_a_verb_is_asked_with_one_even_when_it_comes_back() {
        let world = World::with_chapter();
        let mut model = Stub::default();
        let sitting = start(world.ctx(), &keys(&["passive"]), 10, Some("c"), now()).expect("start");
        // Every one is missed, so every one comes back at the end.
        for _ in 0..20 {
            let item = get(world.ctx(), &sitting.id)
                .expect("sitting")
                .item
                .expect("a sentence to write");
            // Never "trot", which takes no object, or "bank", a noun.
            let asked = item.word.expect("a verb of the chapter");
            assert_eq!(asked.english, "stir");
            assert_eq!(item.topic, None);
            write(&world, &mut model, &sitting.id, false);
        }
        assert_eq!(get(world.ctx(), &sitting.id).expect("sitting").item, None);
    }

    #[test]
    fn a_structure_built_on_a_verb_has_a_topic_and_no_word_without_such_a_verb() {
        let world = World::with_chapter();
        // As stored before a verb was asked whether it takes an object.
        world
            .db
            .lock()
            .expect("db")
            .execute_batch("UPDATE chapter_words SET transitive = NULL;")
            .expect("rows");
        let sitting =
            start(world.ctx(), &keys(&["causative"]), 10, Some("c"), now()).expect("start");
        let item = sitting.item.expect("first");
        assert_eq!(item.word, None, "nobody said any takes an object");
        assert!(item.topic.is_some());
        // Any other structure asks for them as before.
        let other = start(world.ctx(), &keys(&["can"]), 10, Some("c"), now()).expect("start");
        assert!(other.item.expect("first").word.is_some());
    }

    #[test]
    fn a_word_that_will_not_fit_is_dropped_and_costs_nothing() {
        let world = World::with_chapter();
        let mut model = Stub::default();
        let sitting = start(world.ctx(), &keys(&["can"]), 10, Some("c"), now()).expect("start");
        assert!(sitting.item.expect("first").word.is_some());

        let dropped = drop_word(world.ctx(), &sitting.id, 0).expect("drop");
        let item = dropped.item.clone().expect("the same sentence");
        assert_eq!((item.index, item.word), (0, None));
        assert!(item.topic.is_some(), "it is about something again");
        assert_eq!(get(world.ctx(), &sitting.id).expect("sitting"), dropped);

        let result = answer(
            world.ctx(),
            &mut model,
            &sitting.id,
            (0, "I can do it.", false),
            now(),
        )
        .expect("answer");
        assert_eq!(result.verdict, StructureVerdict::Correct);
        assert!(result.used_word);
        assert_eq!(model.graded[0].word, None);

        // Not once it is answered, and not in a session that is not there.
        assert_eq!(
            drop_word(world.ctx(), &sitting.id, 0)
                .expect_err("answered")
                .kind(),
            "invalid"
        );
        assert_eq!(
            drop_word(world.ctx(), "gone", 0).expect_err("gone").kind(),
            "notFound"
        );
        close(world.ctx(), &sitting.id, true, now()).expect("finish");
        assert_eq!(
            drop_word(world.ctx(), &sitting.id, 1)
                .expect_err("finished")
                .kind(),
            "invalid"
        );
    }

    #[test]
    fn a_sentence_stored_with_its_word_alone_gains_its_kind_and_what_it_means() {
        let world = World::with_chapter();
        // As a session stored it before a word was shown with its kind.
        world
            .db
            .lock()
            .expect("db")
            .execute_batch(
                "INSERT INTO structure_sittings (id, size, chapter_id, started_at)
                   VALUES ('old', 10, NULL, '2026-02-01T10:00:00.000Z');
                 INSERT INTO structure_items
                   (sitting_id, idx, structure, topic, verb, verb_source, warm)
                 VALUES ('old', 0, 'can', '{\"kind\":\"preset\",\"key\":\"travel\"}', 'stir',
                         'recall', 1);",
            )
            .expect("rows");
        let stored = get(world.ctx(), "old")
            .expect("sitting")
            .item
            .expect("its sentence");
        // Stored with a topic when a word came with one: it is not asked.
        assert_eq!(stored.topic, None);
        let asked = stored.word.expect("its word");
        assert_eq!(
            asked,
            StructureWord {
                english: "stir".into(),
                source: WordSource::Recall,
                part_of_speech: Some(PartOfSpeech::Verb),
                translations: vec!["remover".into()],
            }
        );
    }

    #[test]
    fn a_word_of_the_chapter_the_learner_is_on_is_shown_as_that_chapter_has_it() {
        let world = World::with_chapter();
        {
            let conn = world.db.lock().expect("db");
            // A later chapter has "bank" as a verb; the learner is on the first.
            conn.execute_batch(
                "INSERT INTO book_chapters (id, book_id, idx, title, words, text)
                   VALUES ('d', 'b', 1, 'II', 1, 'text');
                 INSERT INTO chapter_words
                   (id, chapter_id, key, lemma, forms, sentence, occurrences, depth,
                    created_at, part_of_speech)
                 VALUES ('w9', 'd', 'bank', 'bank', '[]', 's', 1, 'most', '2026-01-02',
                         'verb');
                 INSERT INTO word_translations (word_id, text) VALUES ('w9', 'ladear');
                 UPDATE chapter_words SET part_of_speech = 'other'
                   WHERE id IN ('w1', 'w2');",
            )
            .expect("rows");
            db::mark_opened(&conn, "c", now()).expect("opened");
        }
        // From the menu, on no chapter: its words are the current chapter's.
        let sitting = start(world.ctx(), &keys(&["can"]), 10, None, now()).expect("start");
        let asked = sitting.item.expect("first").word.expect("its only word");
        assert_eq!(asked.english, "bank");
        assert_eq!(asked.part_of_speech, Some(PartOfSpeech::Noun));
        assert_eq!(asked.translations, ["orilla", "ribera"]);
    }

    #[test]
    fn a_session_left_is_paused_one_finished_moves_its_structures() {
        let world = World::new();
        let mut model = Stub::default();
        let empty = start(world.ctx(), &keys(&["can"]), 10, None, now()).expect("start");
        close(world.ctx(), &empty.id, false, now()).expect("close");
        assert_eq!(state(world.ctx(), now()).expect("state").paused, []);
        assert_eq!(
            get(world.ctx(), &empty.id).expect_err("gone").kind(),
            "notFound"
        );

        let sitting = start(world.ctx(), &keys(&["can", "will"]), 10, None, now()).expect("start");
        for _ in 0..4 {
            write(&world, &mut model, &sitting.id, true);
        }
        close(world.ctx(), &sitting.id, false, now()).expect("pause");
        let paused = state(world.ctx(), now()).expect("state");
        assert_eq!(paused.paused.len(), 1);
        assert_eq!((paused.paused[0].done, paused.paused[0].total), (4, 10));
        assert!(paused.paused[0].structures.len() <= 2);
        assert!(paused
            .structures
            .iter()
            .all(|each| each.strength == Strength::New && !each.due));
        assert_eq!(
            target(&world.db.lock().expect("db"), now()).expect("target"),
            None
        );

        close(world.ctx(), &sitting.id, true, now()).expect("finish");
        let ended = get(world.ctx(), &sitting.id).expect("sitting");
        let practised: Vec<String> = ended
            .summary
            .expect("finished")
            .structures
            .into_iter()
            .map(|tally| tally.key)
            .collect();
        let after = state(world.ctx(), now() + Duration::days(4)).expect("state");
        assert_eq!(after.paused, []);
        for each in &after.structures {
            let was = practised.contains(&each.key);
            assert_eq!(each.strength == Strength::Settling, was, "{}", each.key);
            assert_eq!(each.due, was, "{}", each.key);
        }
        let next = state(world.ctx(), now() + Duration::days(2)).expect("state");
        assert!(next.structures.iter().all(|each| !each.due), "not yet");
        let conn = world.db.lock().expect("db");
        let brought = target(&conn, now() + Duration::days(4))
            .expect("target")
            .expect("one is due");
        assert!(brought.description.contains(": "));
        assert!(brought.contexts.starts_with("Used for "));
    }

    #[test]
    fn a_chapter_is_read_for_its_structures_once() {
        let world = World::with_chapter();
        let mut model = Stub::default();
        assert_eq!(state(world.ctx(), now()).expect("state").chapter, None);
        db::mark_opened(&world.db.lock().expect("db"), "c", now()).expect("opened");
        let before = state(world.ctx(), now())
            .expect("state")
            .chapter
            .expect("the chapter opened");
        assert_eq!(before.book_title, "Alice");
        assert_eq!(before.chapter.id, "c");
        assert!(!before.scanned);

        let steps = Mutex::new(Vec::new());
        let hear = |p: ChapterProgress| steps.lock().expect("steps").push((p.done, p.total));
        let found = scan(world.ctx(), &mut model, "c", &hear, now()).expect("scan");
        assert_eq!(*steps.lock().expect("steps"), [(0, 1), (1, 1)]);
        assert!(found.scanned);
        let seen: Vec<_> = found
            .structures
            .iter()
            .map(|each| (each.key.as_str(), each.count, each.example.as_str()))
            .collect();
        assert_eq!(seen, [("past-simple", 3, "He ran home."), ("can", 1, "")]);
        assert_eq!(model.read, ["He ran home. He can swim."]);

        let again = scan(world.ctx(), &mut model, "c", &hear, now()).expect("scan");
        assert_eq!(steps.lock().expect("steps").len(), 2, "no progress either");
        assert_eq!(again, found);
        assert_eq!(model.read.len(), 1, "it is not read again");
        assert_eq!(
            state(world.ctx(), now()).expect("state").chapter,
            Some(found)
        );
    }
}
