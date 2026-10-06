//! Translating a chapter a sentence at a time, whether or not its words were
//! learned first: the learner says when they are ready for it. It goes into
//! the learner's language first, and then back into English from a version
//! of each paragraph as close to the author's as that language allows.
//!
//! A chapter is translated in attempts. An attempt is one session in one
//! direction, from the first paragraph on: left, it is paused and can be
//! gone on with; finished, it is kept as it ended and a new one starts over.
//! One with nothing written is not kept at all.
//!
//! Nothing is corrected while the learner writes. A paragraph is reviewed
//! once it is whole, by the model, with what it needs to know of the chapter;
//! the learner goes on meanwhile and opens the review when they choose.
//! A paragraph is open the way back once an attempt has it whole the way
//! there.
//!
//! While an attempt runs, a reviewed paragraph shows only where it went
//! wrong and what it scores. Its detail waits for the end: a finished
//! attempt is read paragraph by paragraph, under a summary of what matters
//! most in it and what came back. A word a review found the learner did
//! not know can be added to the chapter's practice from there.
//!
//! The model writes four things, each kept the first time it arrives: the
//! chapter's brief, a paragraph's version, a paragraph's review and an
//! attempt's summary. The database is never held while it is asked.

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::profile::{agent, require_profile};
use super::run;
use crate::agent::protocol::{
    self, AttemptSummaryParams, ChapterBrief, ChapterBriefParams, ParagraphReviewParams,
    ParagraphVersion, ParagraphVersionParams, ReviewSentence, SummaryNote,
};
use crate::books::practice::mark;
use crate::books::segment::{headed, paragraphs, sentences};
use crate::books::translate::{
    fits, overall, shown, summarised, sums_up, words as count_words, BRIEF_CHARS, SENTENCE_CHARS,
    SUMMARY_NOTES,
};
use crate::books::vocab::{self, Word};
use crate::db::translate::AttemptRow;
use crate::db::{books, profile, recall, translate as db, words};
use crate::domain::{
    AttemptSummary, Level, Translation, TranslationAttempt, TranslationAttempts,
    TranslationDirection, TranslationParagraph,
};
use crate::error::{Error, Result};
use crate::Ctx;

use TranslationDirection::ToEnglish;

/// The three things the model is asked for; a stub in the tests.
pub trait Model {
    fn brief(&mut self, params: &ChapterBriefParams) -> Result<ChapterBrief>;
    fn version(&mut self, params: &ParagraphVersionParams) -> Result<ParagraphVersion>;
    fn review(&mut self, params: &ParagraphReviewParams) -> Result<protocol::ParagraphReview>;
    fn summary(&mut self, params: &AttemptSummaryParams) -> Result<protocol::AttemptSummary>;
}

/// The model behind the sidecar.
pub(super) struct Sidecar<'a>(pub(super) Ctx<'a>);

impl Model for Sidecar<'_> {
    fn brief(&mut self, params: &ChapterBriefParams) -> Result<ChapterBrief> {
        agent(self.0)?.chapter_brief(params)
    }

    fn version(&mut self, params: &ParagraphVersionParams) -> Result<ParagraphVersion> {
        agent(self.0)?.paragraph_version(params)
    }

    fn review(&mut self, params: &ParagraphReviewParams) -> Result<protocol::ParagraphReview> {
        agent(self.0)?.paragraph_review(params)
    }

    fn summary(&mut self, params: &AttemptSummaryParams) -> Result<protocol::AttemptSummary> {
        agent(self.0)?.attempt_summary(params)
    }
}

fn count(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

/// A chapter as it is translated: the author's sentences by paragraph, and
/// who translates it.
struct Open {
    english: Vec<Vec<String>>,
    native_lang: String,
    level: Level,
}

/// The author's sentences by paragraph: the chapter as it is translated,
/// and as it is listened to.
pub(super) fn cut(conn: &Connection, chapter_id: &str) -> Result<Vec<Vec<String>>> {
    let text = books::chapter_text(conn, chapter_id)?;
    let blocks = db::lines_are_blocks(conn, chapter_id)?;
    let title = books::get_chapter(conn, chapter_id)?.title;
    Ok(headed(paragraphs(&text, blocks), &title)
        .iter()
        .map(|paragraph| sentences(paragraph))
        .filter(|cut| !cut.is_empty())
        .collect())
}

/// The chapter cut into paragraphs and sentences.
fn open(conn: &Connection, chapter_id: &str) -> Result<Open> {
    let profile = require_profile(conn)?;
    Ok(Open {
        english: cut(conn, chapter_id)?,
        native_lang: profile.native_lang,
        level: profile.level,
    })
}

/// Whether every sentence of the paragraph has been written.
fn is_whole(paragraph: &TranslationParagraph) -> bool {
    paragraph
        .source
        .as_ref()
        .is_some_and(|source| paragraph.written.len() >= source.len())
}

/// An attempt as it stands.
fn translation(conn: &Connection, attempt: &AttemptRow, chapter: &Open) -> Result<Translation> {
    let there = db::written_there(conn, &attempt.chapter_id)?;
    let written = db::written(conn, &attempt.id)?;
    let versions = db::versions(conn, &attempt.chapter_id, &chapter.native_lang)?;
    let reviews = db::reviews(conn, &attempt.id)?;
    let asked = words::asked(conn, &attempt.chapter_id)?;
    let spelling = profile::spelling(conn)?;
    let learned = recall::learned_forms(conn, &attempt.chapter_id)?;
    let back = attempt.direction == ToEnglish;
    let mut listed = Vec::new();
    let mut scored = Vec::new();
    for (at, english) in chapter.english.iter().enumerate() {
        let index = count(at);
        // Open the way back once an attempt has it whole the way there.
        if back && there.get(&index).copied().unwrap_or(0) < count(english.len()) {
            continue;
        }
        let written = written.get(&index).cloned().unwrap_or_default();
        let native = (!back).then_some(chapter.native_lang.as_str());
        let review = reviews.get(&index).map(|review| {
            shown(
                review,
                &written,
                &|key| asked.contains(key),
                spelling,
                native,
            )
        });
        if let Some(review) = &review {
            scored.push((
                review.score,
                written.iter().map(|each| count_words(each)).sum(),
            ));
        }
        listed.push(TranslationParagraph {
            index,
            source: if back {
                versions.get(&index).cloned()
            } else {
                Some(english.clone())
            },
            written,
            learned: english
                .iter()
                .map(|sentence| mark(sentence, &learned))
                .collect(),
            english: english.clone(),
            review,
        });
    }
    Ok(Translation {
        attempt_id: attempt.id.clone(),
        chapter_id: attempt.chapter_id.clone(),
        direction: attempt.direction,
        finished: attempt.finished,
        score: overall(&scored),
        summary: db::summary(conn, &attempt.id)?,
        current: listed
            .iter()
            .find(|paragraph| !is_whole(paragraph))
            .map(|paragraph| paragraph.index),
        paragraphs: listed,
        total: count(chapter.english.len()),
    })
}

/// An attempt, its chapter, and how it stands.
fn stand(conn: &Connection, attempt_id: &str) -> Result<(AttemptRow, Open, Translation)> {
    let attempt = db::attempt(conn, attempt_id)?;
    let chapter = open(conn, &attempt.chapter_id)?;
    let state = translation(conn, &attempt, &chapter)?;
    Ok((attempt, chapter, state))
}

fn paragraph(state: &Translation, index: u32) -> Result<&TranslationParagraph> {
    state
        .paragraphs
        .iter()
        .find(|paragraph| paragraph.index == index)
        .ok_or_else(|| Error::Invalid("this paragraph is not open yet".into()))
}

/// Every attempt at a chapter, the latest first, and how many paragraphs
/// are open each way.
pub fn attempts(ctx: Ctx<'_>, chapter_id: &str) -> Result<TranslationAttempts> {
    let conn = ctx.conn()?;
    let chapter = open(&conn, chapter_id)?;
    let there = db::written_there(&conn, chapter_id)?;
    let back = (0u32..)
        .zip(&chapter.english)
        .filter(|(index, english)| there.get(index).copied().unwrap_or(0) >= count(english.len()))
        .count();
    let mut listed = Vec::new();
    for attempt in db::attempts(&conn, chapter_id)? {
        let state = translation(&conn, &attempt, &chapter)?;
        let whole = state.paragraphs.iter().filter(|p| is_whole(p)).count();
        listed.push(TranslationAttempt {
            id: attempt.id,
            direction: attempt.direction,
            started_at: attempt.started_at,
            finished: attempt.finished,
            done: count(whole),
            total: count(state.paragraphs.len()),
        });
    }
    Ok(TranslationAttempts {
        attempts: listed,
        paragraphs: count(chapter.english.len()),
        back: count(back),
    })
}

/// Starts an attempt from the first paragraph. The way back is refused
/// until a paragraph is whole the way there.
pub fn start(
    ctx: Ctx<'_>,
    chapter_id: &str,
    direction: TranslationDirection,
    now: DateTime<Utc>,
) -> Result<Translation> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let chapter = open(&tx, chapter_id)?;
    let attempt = db::attempt(&tx, &db::start(&tx, chapter_id, direction, now)?)?;
    let state = translation(&tx, &attempt, &chapter)?;
    if state.paragraphs.is_empty() {
        return Err(Error::Invalid(
            "no paragraph is translated into your language yet".into(),
        ));
    }
    tx.commit()?;
    Ok(state)
}

/// An attempt as it stands: to go on with it, or to read it once finished.
pub fn get(ctx: Ctx<'_>, attempt_id: &str) -> Result<Translation> {
    Ok(stand(&*ctx.conn()?, attempt_id)?.2)
}

/// Leaves an attempt: paused, to go on with later, or finished for good.
/// One with nothing written is not kept either way.
pub fn close(ctx: Ctx<'_>, attempt_id: &str, finished: bool, now: DateTime<Utc>) -> Result<()> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let attempt = db::attempt(&tx, attempt_id)?;
    if db::written(&tx, &attempt.id)?.is_empty() {
        db::delete(&tx, &attempt.id)?;
    } else if finished {
        db::finish(&tx, &attempt.id, now)?;
    }
    tx.commit()?;
    Ok(())
}

/// Deletes an attempt for good, paused or finished: what was written in it,
/// its reviews and its summary go with it. What the chapter has of its own
/// stays: its brief, and the versions of its paragraphs.
pub fn remove(ctx: Ctx<'_>, attempt_id: &str) -> Result<()> {
    let conn = ctx.conn()?;
    let attempt = db::attempt(&conn, attempt_id)?;
    db::delete(&conn, &attempt.id)
}

/// Keeps one sentence of the paragraph being translated: the next one, or
/// one already written, which is written again. No sentence is skipped, a
/// paragraph that is whole is not touched again, and neither is an attempt
/// that is finished.
pub fn write(
    ctx: Ctx<'_>,
    attempt_id: &str,
    (index, sentence): (u32, u32),
    text: &str,
    now: DateTime<Utc>,
) -> Result<Translation> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(Error::Invalid("a sentence cannot be empty".into()));
    }
    if text.chars().count() > SENTENCE_CHARS {
        return Err(Error::Invalid("this sentence is too long".into()));
    }
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let (attempt, chapter, state) = stand(&tx, attempt_id)?;
    if attempt.finished {
        return Err(Error::Invalid("this attempt is finished".into()));
    }
    if state.current != Some(index) {
        return Err(Error::Invalid(
            "this paragraph is not the one being translated".into(),
        ));
    }
    let being = paragraph(&state, index)?;
    let Some(source) = &being.source else {
        return Err(Error::Invalid("this paragraph is not prepared yet".into()));
    };
    if sentence > count(being.written.len()) || sentence >= count(source.len()) {
        return Err(Error::Invalid("this sentence is not the next one".into()));
    }
    db::write(&tx, &attempt.id, (index, sentence), &text, now)?;
    let after = translation(&tx, &attempt, &chapter)?;
    tx.commit()?;
    Ok(after)
}

/// What a review needs to know of the chapter, written the first time it is
/// needed.
fn brief(
    ctx: Ctx<'_>,
    chapter_id: &str,
    native_lang: &str,
    model: &mut dyn Model,
    now: DateTime<Utc>,
) -> Result<String> {
    if let Some(kept) = db::brief(&*ctx.conn()?, chapter_id, native_lang)? {
        return Ok(kept);
    }
    let text = books::chapter_text(&*ctx.conn()?, chapter_id)?;
    let written = model.brief(&ChapterBriefParams {
        native_lang: native_lang.to_owned(),
        text: text.chars().take(BRIEF_CHARS).collect(),
    })?;
    let conn = ctx.conn()?;
    db::store_brief(&conn, chapter_id, native_lang, written.brief.trim(), now)?;
    db::brief(&conn, chapter_id, native_lang)?
        .ok_or_else(|| Error::Internal("the chapter's brief was not kept".into()))
}

/// Writes the version of a paragraph that is translated back into English,
/// if it has none yet; the attempt as it stands after it. The paragraph has
/// to be whole the way there, in this attempt or another: an attempt in
/// that direction asks for it ahead, so the way back opens without a wait.
/// A version without a sentence for each one of the paragraph is asked for
/// once more, and then refused.
pub fn prepare(
    ctx: Ctx<'_>,
    attempt_id: &str,
    index: u32,
    model: &mut dyn Model,
    now: DateTime<Utc>,
) -> Result<Translation> {
    let (attempt, chapter, english) = {
        let conn = ctx.conn()?;
        let (attempt, chapter, state) = stand(&conn, attempt_id)?;
        let english = usize::try_from(index)
            .ok()
            .and_then(|at| chapter.english.get(at))
            .cloned()
            .unwrap_or_default();
        let there = db::written_there(&conn, &attempt.chapter_id)?;
        if english.is_empty() || there.get(&index).copied().unwrap_or(0) < count(english.len()) {
            return Err(Error::Invalid("this paragraph is not open yet".into()));
        }
        let versions = db::versions(&conn, &attempt.chapter_id, &chapter.native_lang)?;
        if versions.contains_key(&index) {
            return Ok(state);
        }
        (attempt, chapter, english)
    };
    let params = ParagraphVersionParams {
        brief: brief(ctx, &attempt.chapter_id, &chapter.native_lang, model, now)?,
        native_lang: chapter.native_lang.clone(),
        sentences: english,
    };
    let mut version = model.version(&params)?;
    if !fits(&version.sentences, params.sentences.len()) {
        version = model.version(&params)?;
    }
    if !fits(&version.sentences, params.sentences.len()) {
        return Err(Error::Provider(
            "the version does not match the paragraph".into(),
        ));
    }
    let lines: Vec<String> = version
        .sentences
        .iter()
        .map(|sentence| sentence.trim().to_owned())
        .collect();
    let conn = ctx.conn()?;
    db::store_version(
        &conn,
        &attempt.chapter_id,
        &chapter.native_lang,
        index,
        &lines,
        now,
    )?;
    translation(&conn, &attempt, &chapter)
}

/// Reviews a paragraph that is whole, if it has no review yet. A failed
/// request keeps nothing, so it can be asked again; a review is final.
pub fn review(
    ctx: Ctx<'_>,
    attempt_id: &str,
    index: u32,
    model: &mut dyn Model,
    now: DateTime<Utc>,
) -> Result<Translation> {
    let (attempt, chapter, lines, previous, spelling) = {
        let conn = ctx.conn()?;
        let (attempt, chapter, state) = stand(&conn, attempt_id)?;
        let spelling = profile::spelling(&conn)?;
        let being = paragraph(&state, index)?;
        if being.review.is_some() {
            return Ok(state);
        }
        if !is_whole(being) {
            return Err(Error::Invalid("this paragraph is not whole yet".into()));
        }
        let at = usize::try_from(index).unwrap_or(usize::MAX);
        let english = chapter.english.get(at).cloned().unwrap_or_default();
        let source = being.source.clone().unwrap_or_default();
        let back = attempt.direction == ToEnglish;
        let lines: Vec<ReviewSentence> = english
            .into_iter()
            .zip(source)
            .zip(being.written.clone())
            .map(|((english, source), attempt)| ReviewSentence {
                english,
                native: back.then_some(source),
                attempt,
            })
            .collect();
        let previous = at
            .checked_sub(1)
            .and_then(|before| chapter.english.get(before))
            .map(|sentences| sentences.join(" "))
            .unwrap_or_default();
        (attempt, chapter, lines, previous, spelling)
    };
    let brief = brief(ctx, &attempt.chapter_id, &chapter.native_lang, model, now)?;
    let written = model.review(&ParagraphReviewParams {
        brief,
        native_lang: chapter.native_lang.clone(),
        level: chapter.level,
        direction: attempt.direction,
        strict_spelling: spelling.is_strict(),
        previous,
        sentences: lines,
    })?;
    let conn = ctx.conn()?;
    db::store_review(&conn, &attempt.id, index, &written, now)?;
    translation(&conn, &attempt, &chapter)
}

/// Sums a finished attempt up from the errors its reviews marked, if it has
/// no summary yet: a slip is no matter for a summary. One without an error
/// has nothing to sum up, and the model is not asked.
pub fn summarize(
    ctx: Ctx<'_>,
    attempt_id: &str,
    model: &mut dyn Model,
    now: DateTime<Utc>,
) -> Result<Translation> {
    let (attempt, chapter, notes) = {
        let conn = ctx.conn()?;
        let (attempt, chapter, state) = stand(&conn, attempt_id)?;
        if !attempt.finished {
            return Err(Error::Invalid("this attempt is not finished".into()));
        }
        if state.summary.is_some() {
            return Ok(state);
        }
        let notes: Vec<SummaryNote> = state
            .paragraphs
            .iter()
            .filter_map(|paragraph| paragraph.review.as_ref())
            .flat_map(|review| &review.marks)
            .filter(|mark| sums_up(mark))
            .take(SUMMARY_NOTES)
            .map(|mark| SummaryNote {
                fragment: mark.fragment.clone(),
                severity: mark.severity,
                better: mark.better.clone(),
                why: mark.why.clone(),
            })
            .collect();
        (attempt, chapter, notes)
    };
    let summary = if notes.is_empty() {
        AttemptSummary {
            points: Vec::new(),
            habits: Vec::new(),
        }
    } else {
        summarised(&model.summary(&AttemptSummaryParams {
            native_lang: chapter.native_lang.clone(),
            level: chapter.level,
            direction: attempt.direction,
            notes,
        })?)
    };
    let conn = ctx.conn()?;
    db::store_summary(&conn, &attempt.id, &summary, now)?;
    translation(&conn, &attempt, &chapter)
}

/// Adds the word a mark is about to the practice of the attempt's chapter:
/// a new word of its list, with the sentence of the book it was missed in;
/// or, when the chapter has it and the learner had said they knew it, the
/// same word asked again. One the chapter already asks is left as it is.
pub fn practise(
    ctx: Ctx<'_>,
    attempt_id: &str,
    (index, mark): (u32, u32),
    now: DateTime<Utc>,
) -> Result<Translation> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let (attempt, chapter, state) = stand(&tx, attempt_id)?;
    let being = paragraph(&state, index)?;
    let word = being
        .review
        .as_ref()
        .and_then(|review| review.marks.get(usize::try_from(mark).ok()?))
        .and_then(|mark| mark.word.as_ref())
        .ok_or_else(|| Error::Invalid("this mark has no word to practise".into()))?;
    let key = vocab::key(&word.english);
    if let Some(id) = words::id_by_key(&tx, &attempt.chapter_id, &key)? {
        words::set_known(&tx, &id, false, now)?;
    } else {
        let text = books::chapter_text(&tx, &attempt.chapter_id)?;
        words::add(
            &tx,
            &attempt.chapter_id,
            &Word {
                key,
                lemma: word.english.clone(),
                base: None,
                verb_form: None,
                forms: vec![word.english.clone()],
                sentence: being.english.join(" "),
                part_of_speech: None,
                transitive: None,
                translations: word.translations.clone(),
                needs_context: false,
                count: vocab::count_in(&word.english, &text),
            },
            now,
        )?;
    }
    let after = translation(&tx, &attempt, &chapter)?;
    tx.commit()?;
    Ok(after)
}

#[tauri::command]
pub async fn list_attempts(app: AppHandle, chapter_id: String) -> Result<TranslationAttempts> {
    run(app, move |_, ctx| attempts(ctx, &chapter_id)).await
}

#[tauri::command]
pub async fn start_attempt(
    app: AppHandle,
    chapter_id: String,
    direction: TranslationDirection,
) -> Result<Translation> {
    run(app, move |_, ctx| {
        start(ctx, &chapter_id, direction, Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn get_attempt(app: AppHandle, attempt_id: String) -> Result<Translation> {
    run(app, move |_, ctx| get(ctx, &attempt_id)).await
}

#[tauri::command]
pub async fn close_attempt(app: AppHandle, attempt_id: String, finished: bool) -> Result<()> {
    run(app, move |_, ctx| {
        close(ctx, &attempt_id, finished, Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn delete_attempt(app: AppHandle, attempt_id: String) -> Result<()> {
    run(app, move |_, ctx| remove(ctx, &attempt_id)).await
}

#[tauri::command]
pub async fn write_sentence(
    app: AppHandle,
    attempt_id: String,
    paragraph: u32,
    sentence: u32,
    text: String,
) -> Result<Translation> {
    run(app, move |_, ctx| {
        write(ctx, &attempt_id, (paragraph, sentence), &text, Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn prepare_paragraph(
    app: AppHandle,
    attempt_id: String,
    paragraph: u32,
) -> Result<Translation> {
    run(app, move |_, ctx| {
        prepare(ctx, &attempt_id, paragraph, &mut Sidecar(ctx), Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn review_paragraph(
    app: AppHandle,
    attempt_id: String,
    paragraph: u32,
) -> Result<Translation> {
    run(app, move |_, ctx| {
        review(ctx, &attempt_id, paragraph, &mut Sidecar(ctx), Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn summarize_attempt(app: AppHandle, attempt_id: String) -> Result<Translation> {
    run(app, move |_, ctx| {
        summarize(ctx, &attempt_id, &mut Sidecar(ctx), Utc::now())
    })
    .await
}

#[tauri::command]
pub async fn practise_word(
    app: AppHandle,
    attempt_id: String,
    paragraph: u32,
    mark: u32,
) -> Result<Translation> {
    run(app, move |_, ctx| {
        practise(ctx, &attempt_id, (paragraph, mark), Utc::now())
    })
    .await
}

#[cfg(test)]
mod tests {
    use chrono::TimeDelta;

    use super::*;
    use crate::agent::protocol::{NoteWord, ParagraphNote, SummaryHabit};
    use crate::commands::practice::tests::{t0, Desk};
    use crate::db::profile;
    use crate::db::words;
    use crate::db::words::tests::{book, word};
    use crate::domain::{Depth, Severity};
    use TranslationDirection::ToNative;

    const TEXT: &str = "The boy woke before the sirens did. He lay still and counted the \
                        cracks; there were eleven of them.\n\
                        He had not slept in three days. “You know what happens here?” the man \
                        asked.\n\
                        The boy knew it well.";

    /// A chapter of three paragraphs, of three, two and one sentence, with
    /// one word to learn that is not learned: it is translated all the same.
    fn chapter(desk: &Desk) -> String {
        let conn = desk.db.lock().expect("db");
        let chapter = book(&conn, "b", &[TEXT]).remove(0);
        let list = [word("peep", &["asomarse"], 1)];
        words::finish(&conn, &chapter, Depth::Most, &list, t0()).expect("words");
        chapter
    }

    /// The model as a stub: counts what it is asked, and answers as told.
    #[derive(Default)]
    struct Stub {
        briefs: Vec<ChapterBriefParams>,
        versions: Vec<ParagraphVersionParams>,
        reviews: Vec<ParagraphReviewParams>,
        summaries: Vec<AttemptSummaryParams>,
        /// How many versions come back a sentence short before a right one.
        short: usize,
        notes: Vec<ParagraphNote>,
        fail: bool,
    }

    impl Model for Stub {
        fn brief(&mut self, params: &ChapterBriefParams) -> Result<ChapterBrief> {
            self.briefs.push(params.clone());
            Ok(ChapterBrief {
                brief: " A boy waits for his trial. ".into(),
            })
        }

        fn version(&mut self, params: &ParagraphVersionParams) -> Result<ParagraphVersion> {
            self.versions.push(params.clone());
            let mut sentences: Vec<String> = params
                .sentences
                .iter()
                .map(|sentence| format!(" es: {sentence} "))
                .collect();
            if self.short > 0 {
                self.short -= 1;
                sentences.pop();
            }
            Ok(ParagraphVersion { sentences })
        }

        fn review(&mut self, params: &ParagraphReviewParams) -> Result<protocol::ParagraphReview> {
            if self.fail {
                return Err(Error::Provider("no answer".into()));
            }
            self.reviews.push(params.clone());
            Ok(protocol::ParagraphReview {
                good: Some("Buen ritmo.".into()),
                notes: self.notes.clone(),
            })
        }

        fn summary(&mut self, params: &AttemptSummaryParams) -> Result<protocol::AttemptSummary> {
            self.summaries.push(params.clone());
            Ok(protocol::AttemptSummary {
                points: vec![" Lee la frase entera. ".into()],
                habits: vec![SummaryHabit {
                    habit: "La primera palabra".into(),
                    advice: "Mira el verbo.".into(),
                    examples: vec!["toNative".into()],
                }],
            })
        }
    }

    /// A note on a fragment of a sentence, about the word `english` if any.
    fn note(sentence: u32, fragment: &str, english: Option<&str>) -> ParagraphNote {
        ParagraphNote {
            sentence,
            fragment: fragment.into(),
            severity: Severity::Error,
            better: format!("mejor {fragment}"),
            why: format!("porque {fragment}"),
            word: english.map(|english| NoteWord {
                english: english.into(),
                translations: vec![format!("{english}es")],
            }),
        }
    }

    fn begin(desk: &Desk, chapter: &str, direction: TranslationDirection) -> Translation {
        start(desk.ctx(), chapter, direction, t0()).expect("an attempt")
    }

    fn say(desk: &Desk, attempt: &Translation, at: (u32, u32), text: &str) -> Result<Translation> {
        write(desk.ctx(), &attempt.attempt_id, at, text, t0())
    }

    /// Writes every sentence of a paragraph, in order: "<direction> <n>".
    fn fill(desk: &Desk, attempt: &Translation, index: u32, sentences: u32) -> Translation {
        let mut state = None;
        for sentence in 0..sentences {
            let text = format!("{} {index}.{sentence}", attempt.direction.as_str());
            state = Some(say(desk, attempt, (index, sentence), &text).expect("written"));
        }
        state.expect("a sentence")
    }

    fn refusal<T: std::fmt::Debug>(result: Result<T>) -> &'static str {
        result.expect_err("refused").kind()
    }

    /// (finished, done, total) of every attempt at the chapter, latest first.
    fn listed(desk: &Desk, chapter: &str) -> Vec<(bool, u32, u32)> {
        attempts(desk.ctx(), chapter)
            .expect("attempts")
            .attempts
            .iter()
            .map(|each| (each.finished, each.done, each.total))
            .collect()
    }

    #[test]
    fn a_chapter_is_translated_a_sentence_at_a_time_and_none_is_skipped() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let id = chapter(&desk);
        let nowhere = start(desk.ctx(), "nowhere", ToNative, t0());
        assert_eq!(refusal(nowhere), "notFound");
        assert_eq!(refusal(get(desk.ctx(), "nowhere")), "notFound");

        let fresh = begin(&desk, &id, ToNative);
        let cut: Vec<Vec<&str>> = fresh
            .paragraphs
            .iter()
            .map(|p| p.source.iter().flatten().map(String::as_str).collect())
            .collect();
        assert_eq!(
            cut,
            [
                vec![
                    "The boy woke before the sirens did.",
                    "He lay still and counted the cracks;",
                    "there were eleven of them.",
                ],
                vec![
                    "He had not slept in three days.",
                    "“You know what happens here?” the man asked.",
                ],
                vec!["The boy knew it well."],
            ]
        );
        assert_eq!((fresh.current, fresh.total), (Some(0), 3));

        // The next sentence, or one already written; never one further on,
        // an empty one, or one of another paragraph.
        assert_eq!(refusal(say(&desk, &fresh, (0, 1), "x")), "invalid");
        assert_eq!(refusal(say(&desk, &fresh, (1, 0), "x")), "invalid");
        assert_eq!(refusal(say(&desk, &fresh, (0, 0), "  ")), "invalid");
        let long = "x".repeat(SENTENCE_CHARS + 1);
        assert_eq!(refusal(say(&desk, &fresh, (0, 0), &long)), "invalid");
        say(&desk, &fresh, (0, 0), "  El niño   despertó. ").expect("first");
        say(&desk, &fresh, (0, 1), "Se quedó quieto;").expect("second");
        let again = say(&desk, &fresh, (0, 0), "El chico despertó.").expect("again");
        assert_eq!(
            again.paragraphs[0].written,
            ["El chico despertó.", "Se quedó quieto;"]
        );
        assert_eq!(again.current, Some(0));
        assert_eq!(refusal(say(&desk, &fresh, (0, 3), "x")), "invalid");

        // Whole, the paragraph is not touched again and the next one is on.
        let whole = say(&desk, &fresh, (0, 2), "había once.").expect("third");
        assert_eq!(whole.current, Some(1));
        assert_eq!(refusal(say(&desk, &fresh, (0, 0), "x")), "invalid");
        assert_eq!(listed(&desk, &id), [(false, 1, 3)]);

        fill(&desk, &fresh, 1, 2);
        let done = fill(&desk, &fresh, 2, 1);
        assert_eq!(done.current, None);
        assert_eq!(get(desk.ctx(), &fresh.attempt_id).expect("kept"), done);
    }

    #[test]
    fn an_attempt_is_paused_gone_on_with_or_finished_and_a_new_one_starts_over() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let id = chapter(&desk);
        let leave = |attempt: &Translation, finished| {
            close(desk.ctx(), &attempt.attempt_id, finished, t0()).expect("left");
        };

        // One with nothing written is not kept, paused or finished.
        leave(&begin(&desk, &id, ToNative), false);
        leave(&begin(&desk, &id, ToNative), true);
        assert_eq!(listed(&desk, &id), []);

        // Paused, it is gone on with from the sentence it was left on.
        let first = begin(&desk, &id, ToNative);
        fill(&desk, &first, 0, 3);
        say(&desk, &first, (1, 0), "uno").expect("written");
        leave(&first, false);
        let resumed = get(desk.ctx(), &first.attempt_id).expect("paused");
        assert!(!resumed.finished);
        assert_eq!(
            (resumed.current, resumed.paragraphs[1].written.len()),
            (Some(1), 1)
        );
        say(&desk, &resumed, (1, 1), "dos").expect("goes on");

        // A new one starts from the first paragraph, and has nothing of it.
        let later = t0() + TimeDelta::minutes(5);
        let second = start(desk.ctx(), &id, ToNative, later).expect("another");
        assert_ne!(second.attempt_id, first.attempt_id);
        assert_eq!(second.current, Some(0));
        assert!(second.paragraphs.iter().all(|p| p.written.is_empty()));
        say(&desk, &second, (0, 0), "otra vez").expect("written");
        assert_eq!(
            listed(&desk, &id),
            [(false, 0, 3), (false, 2, 3)],
            "latest first"
        );

        // Finished, it is kept as it ended and nothing more is written.
        leave(&first, true);
        let kept = get(desk.ctx(), &first.attempt_id).expect("kept");
        assert!(kept.finished);
        assert_eq!(kept.paragraphs[1].written, ["uno", "dos"]);
        assert_eq!(refusal(say(&desk, &kept, (2, 0), "x")), "invalid");
        assert_eq!(listed(&desk, &id), [(false, 0, 3), (true, 2, 3)]);
        let gone = close(desk.ctx(), "nowhere", true, t0());
        assert_eq!(refusal(gone), "notFound");

        // Deleted, an attempt is gone with everything written in it, whether
        // it was paused or finished; the other one is not touched.
        remove(desk.ctx(), &first.attempt_id).expect("deleted");
        assert_eq!(listed(&desk, &id), [(false, 0, 3)]);
        assert_eq!(refusal(get(desk.ctx(), &first.attempt_id)), "notFound");
        assert_eq!(refusal(remove(desk.ctx(), &first.attempt_id)), "notFound");
        remove(desk.ctx(), &second.attempt_id).expect("deleted");
        assert_eq!(listed(&desk, &id), []);
        for table in ["attempt_sentences", "attempt_reviews", "attempt_summaries"] {
            assert_eq!(desk.count(&format!("SELECT COUNT(*) FROM {table}")), 0);
        }
    }

    #[test]
    fn a_whole_paragraph_is_reviewed_once_with_what_the_chapter_is_about() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let id = chapter(&desk);
        let attempt = begin(&desk, &id, ToNative);
        let mut model = Stub {
            notes: vec![
                note(2, "toNative", None),
                note(0, "0.0", None),
                note(7, "toNative", None),
                note(1, "not written", None),
            ],
            ..Stub::default()
        };
        let ask =
            |model: &mut Stub, index| review(desk.ctx(), &attempt.attempt_id, index, model, t0());

        say(&desk, &attempt, (0, 0), "uno").expect("first");
        assert_eq!(refusal(ask(&mut model, 0)), "invalid", "not whole");
        assert_eq!(refusal(ask(&mut model, 5)), "invalid", "no such paragraph");
        let whole = fill(&desk, &attempt, 0, 3);
        assert_eq!(whole.score, None, "nothing reviewed yet");

        // A failed request keeps nothing: it is asked again.
        model.fail = true;
        assert_eq!(refusal(ask(&mut model, 0)), "provider");
        model.fail = false;
        let reviewed = ask(&mut model, 0).expect("reviewed");
        let being = &reviewed.paragraphs[0];
        let shown = being.review.clone().expect("a review");
        assert_eq!(shown.good.as_deref(), Some("Buen ritmo."));
        // The notes are where the learner wrote those words, and the two
        // that name words that are not there are dropped.
        let marked: Vec<_> = shown
            .sentences
            .iter()
            .map(|parts| {
                parts
                    .iter()
                    .map(|part| (part.text.as_str(), part.mark))
                    .collect::<Vec<_>>()
            })
            .collect();
        assert_eq!(
            marked,
            [
                vec![("toNative ", None), ("0.0", Some(0))],
                vec![("toNative 0.1", None)],
                vec![("toNative", Some(1)), (" 0.2", None)],
            ]
        );
        assert_eq!(shown.marks[1].why, "porque toNative");
        // Six words, two of them wrong.
        assert_eq!((shown.score, reviewed.score), (67, Some(67)));
        assert_eq!(being.english[0], "The boy woke before the sirens did.");

        let profile = profile::tests::profile();
        assert_eq!(
            model.reviews,
            [ParagraphReviewParams {
                native_lang: profile.native_lang.clone(),
                level: profile.level,
                direction: ToNative,
                strict_spelling: false,
                brief: "A boy waits for his trial.".into(),
                previous: String::new(),
                sentences: vec![
                    ReviewSentence {
                        english: "The boy woke before the sirens did.".into(),
                        native: None,
                        attempt: "toNative 0.0".into(),
                    },
                    ReviewSentence {
                        english: "He lay still and counted the cracks;".into(),
                        native: None,
                        attempt: "toNative 0.1".into(),
                    },
                    ReviewSentence {
                        english: "there were eleven of them.".into(),
                        native: None,
                        attempt: "toNative 0.2".into(),
                    },
                ],
            }]
        );
        assert_eq!(model.briefs.len(), 1);
        assert_eq!(model.briefs[0].text, TEXT);

        // A review is final, and the brief is written once for the chapter.
        assert_eq!(ask(&mut model, 0).expect("kept"), reviewed);
        fill(&desk, &attempt, 1, 2);
        ask(&mut model, 1).expect("the next one");
        assert_eq!((model.reviews.len(), model.briefs.len()), (2, 1));
        assert_eq!(
            model.reviews[1].previous,
            "The boy woke before the sirens did. He lay still and counted the cracks; there \
             were eleven of them."
        );
        assert_eq!(desk.count("SELECT COUNT(*) FROM attempt_reviews"), 2);

        // Another attempt has its own reviews.
        let other = begin(&desk, &id, ToNative);
        assert_eq!(fill(&desk, &other, 0, 3).paragraphs[0].review, None);
    }

    #[test]
    fn a_finished_attempt_is_summed_up_once_from_the_notes_of_its_reviews() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let id = chapter(&desk);
        let attempt = begin(&desk, &id, ToNative);
        let slip = ParagraphNote {
            severity: Severity::Slip,
            ..note(1, "0.1", None)
        };
        let mut model = Stub {
            notes: vec![note(0, "toNative", None), slip.clone()],
            ..Stub::default()
        };
        let sum = |model: &mut Stub, attempt: &Translation| {
            summarize(desk.ctx(), &attempt.attempt_id, model, t0())
        };
        fill(&desk, &attempt, 0, 3);
        review(desk.ctx(), &attempt.attempt_id, 0, &mut model, t0()).expect("review");
        assert_eq!(refusal(sum(&mut model, &attempt)), "invalid", "running");

        close(desk.ctx(), &attempt.attempt_id, true, t0()).expect("finished");
        let summed = sum(&mut model, &attempt).expect("summary");
        let summary = summed.summary.clone().expect("a summary");
        assert_eq!(summary.points, ["Lee la frase entera."]);
        assert_eq!(summary.habits[0].examples, ["toNative"]);
        let profile = profile::tests::profile();
        assert_eq!(
            model.summaries,
            [AttemptSummaryParams {
                native_lang: profile.native_lang,
                level: profile.level,
                direction: ToNative,
                notes: vec![SummaryNote {
                    fragment: "toNative".into(),
                    severity: Severity::Error,
                    better: "mejor toNative".into(),
                    why: "porque toNative".into(),
                }],
            }]
        );
        assert_eq!(sum(&mut model, &attempt).expect("kept"), summed);
        assert_eq!(model.summaries.len(), 1);

        // Nothing marked, nothing to sum up: the model is not asked.
        let clean = begin(&desk, &id, ToNative);
        fill(&desk, &clean, 0, 3);
        close(desk.ctx(), &clean.attempt_id, true, t0()).expect("finished");
        let empty = sum(&mut model, &clean).expect("summary").summary;
        assert_eq!(
            empty,
            Some(AttemptSummary {
                points: vec![],
                habits: vec![]
            })
        );
        assert_eq!(model.summaries.len(), 1);

        // Neither is a slip: the model is not asked about one.
        let slipped = begin(&desk, &id, ToNative);
        fill(&desk, &slipped, 0, 3);
        model.notes = vec![slip];
        let marked = review(desk.ctx(), &slipped.attempt_id, 0, &mut model, t0()).expect("review");
        let marks = marked.paragraphs[0].review.as_ref().map(|r| r.marks.len());
        assert_eq!(marks, Some(1));
        close(desk.ctx(), &slipped.attempt_id, true, t0()).expect("finished");
        assert_eq!(sum(&mut model, &slipped).expect("summary").summary, empty);
        assert_eq!(model.summaries.len(), 1);
    }

    #[test]
    fn a_word_a_review_names_is_added_to_the_chapters_practice() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let id = chapter(&desk);
        let attempt = begin(&desk, &id, ToNative);
        let mut model = Stub {
            notes: vec![
                note(0, "0.0", Some("sirens")),
                note(1, "0.1", Some("peep")),
                note(2, "0.2", None),
            ],
            ..Stub::default()
        };
        fill(&desk, &attempt, 0, 3);
        let reviewed =
            review(desk.ctx(), &attempt.attempt_id, 0, &mut model, t0()).expect("review");
        let offered = |state: &Translation| -> Vec<Option<bool>> {
            let review = state.paragraphs[0].review.clone().expect("a review");
            review
                .marks
                .iter()
                .map(|mark| mark.word.as_ref().map(|word| word.in_practice))
                .collect()
        };
        // "peep" is a word of the chapter already; the third note has none.
        assert_eq!(offered(&reviewed), [Some(false), Some(true), None]);
        let add = |mark| practise(desk.ctx(), &attempt.attempt_id, (0, mark), t0());
        assert_eq!(refusal(add(2)), "invalid", "no word");
        assert_eq!(refusal(add(9)), "invalid", "no such mark");

        let added = add(0).expect("added");
        assert_eq!(offered(&added), [Some(true), Some(true), None]);
        let listed = words::list(&desk.db.lock().expect("db"), &id).expect("words");
        let new = listed
            .iter()
            .find(|word| word.lemma == "sirens")
            .expect("in the list");
        assert_eq!(new.translations, ["sirenses"]);
        assert_eq!((new.count, new.done, new.known), (1, false, false));
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM chapter_words WHERE sentence LIKE 'The boy woke%'"),
            1,
            "with the paragraph it was missed in"
        );
        // Added twice, it is there once.
        add(0).expect("again");
        assert_eq!(desk.count("SELECT COUNT(*) FROM chapter_words"), 2);

        // One the learner had said they knew is asked again.
        let peep = words::id_by_key(&desk.db.lock().expect("db"), &id, "peep")
            .expect("word")
            .expect("peep");
        words::set_known(&desk.db.lock().expect("db"), &peep, true, t0()).expect("known");
        let known = get(desk.ctx(), &attempt.attempt_id).expect("attempt");
        assert_eq!(offered(&known)[1], Some(false));
        assert_eq!(offered(&add(1).expect("asked again"))[1], Some(true));
    }

    #[test]
    fn a_word_is_added_to_a_chapter_never_prepared_at_the_narrowest_depth() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let id = book(&desk.db.lock().expect("db"), "bare", &[TEXT]).remove(0);
        let attempt = begin(&desk, &id, ToNative);
        let mut model = Stub {
            notes: vec![note(0, "0.0", Some("to wake"))],
            ..Stub::default()
        };
        fill(&desk, &attempt, 0, 3);
        review(desk.ctx(), &attempt.attempt_id, 0, &mut model, t0()).expect("review");
        practise(desk.ctx(), &attempt.attempt_id, (0, 0), t0()).expect("added");
        let conn = desk.db.lock().expect("db");
        let chapter = books::get_chapter(&conn, &id).expect("chapter");
        assert_eq!(chapter.prepared, Some(Depth::Hardest));
        assert_eq!(words::list(&conn, &id).expect("words")[0].lemma, "to wake");
    }

    #[test]
    fn a_paragraph_goes_back_into_english_once_it_is_whole_the_other_way() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let id = chapter(&desk);
        let mut model = Stub {
            notes: vec![note(1, "toEnglish", None)],
            ..Stub::default()
        };
        let closed = start(desk.ctx(), &id, ToEnglish, t0());
        assert_eq!(refusal(closed), "invalid", "nothing translated yet");
        assert_eq!(listed(&desk, &id), [], "a refused attempt is not kept");

        let there = begin(&desk, &id, ToNative);
        let ahead = prepare(desk.ctx(), &there.attempt_id, 0, &mut model, t0());
        assert_eq!(refusal(ahead), "invalid", "not whole yet");
        fill(&desk, &there, 0, 3);
        let whole = attempts(desk.ctx(), &id).expect("attempts");
        assert_eq!((whole.paragraphs, whole.back), (3, 1));

        let back = begin(&desk, &id, ToEnglish);
        assert_eq!(back.paragraphs.len(), 1);
        assert_eq!(
            (back.paragraphs[0].source.clone(), back.current),
            (None, Some(0))
        );
        assert_eq!(refusal(say(&desk, &back, (0, 0), "x")), "invalid");

        // A version a sentence short is asked for once more, then refused.
        model.short = 2;
        let unfit = prepare(desk.ctx(), &back.attempt_id, 0, &mut model, t0());
        assert_eq!(refusal(unfit), "provider");
        assert_eq!(desk.count("SELECT COUNT(*) FROM paragraph_versions"), 0);
        model.short = 1;
        let ready = prepare(desk.ctx(), &back.attempt_id, 0, &mut model, t0()).expect("prepared");
        assert_eq!(model.versions.len(), 4);
        assert_eq!(model.versions[0].brief, "A boy waits for his trial.");
        assert_eq!(
            ready.paragraphs[0].source.as_deref(),
            Some(
                &[
                    "es: The boy woke before the sirens did.".to_owned(),
                    "es: He lay still and counted the cracks;".to_owned(),
                    "es: there were eleven of them.".to_owned(),
                ][..]
            )
        );
        // Prepared once, whichever attempt asks for it again.
        prepare(desk.ctx(), &there.attempt_id, 0, &mut model, t0()).expect("kept");
        assert_eq!((model.versions.len(), model.briefs.len()), (4, 1));

        let whole = fill(&desk, &back, 0, 3);
        assert_eq!(whole.current, None, "the others are not open yet");
        let reviewed = review(desk.ctx(), &back.attempt_id, 0, &mut model, t0()).expect("review");
        let sent = &model.reviews[0].sentences[1];
        assert_eq!(
            (sent.native.as_deref(), sent.attempt.as_str()),
            (
                Some("es: He lay still and counted the cracks;"),
                "toEnglish 0.1"
            )
        );
        let being = &reviewed.paragraphs[0];
        let marks = &being.review.as_ref().expect("a review").marks;
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].fragment, "toEnglish");
        assert_eq!(being.english.len(), 3, "the author's sentences beside it");
        assert_eq!(listed(&desk, &id), [(false, 1, 1), (false, 1, 3)]);
    }
}
