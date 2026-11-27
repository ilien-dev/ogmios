//! Giving words the sentences they are asked with. A word is given them by
//! the chapter it is from, in the sense that chapter gives it: another book
//! can mean something else by it. A word that was never given one in its
//! chapter is given a sentence of that chapter that has it, found here by
//! code, and that once only. The model says what the word is there, in the
//! form the sentence has it, in the learner's language, and translates the
//! sentence. A word some other chapter, of any book, has written alike in
//! another sense (`db::spellings::rivals`) is also written [`WRITTEN`]
//! sentences of its own in its chapter's sense: those are the words a
//! learner can mistake for one another, and the only ones worth what
//! writing costs. They are written again when they run low
//! ([`refill_due`]), before the learner runs out of them. When a chapter brings the first rival of a word, both are
//! written for; a word written for already is not written for again. A
//! chapter of a deleted book is not read again: only sentences written for
//! it are asked for.
//!
//! The model labels, this code decides. A sentence is kept only if its hint
//! does not give the word away and is words of its translation
//! (`books::sentences`), and it is used only once a second request has
//! looked at it and called it good. A sentence kept before a hint had to be
//! words of its translation, whose hint is not, is glossed once more
//! ([`renew`]). What is
//! refused either way stays, so that it is not asked about again. That
//! second look also lists the other English words a learner shown the hint
//! could type: an answer that is one of them is no miss
//! (`books::sentences::or_other`). And it lists the word's other
//! translations in the form the hint has, and labels the form of a verb: a
//! word asked in a sentence is answered in the form it has there. A
//! sentence looked at before any of these was asked for is put to it once
//! more, for the labels alone.
//!
//! It runs in the background, a few words a request, each answer stored as
//! it arrives: stopped at any point, the next run goes on from there. The
//! database is never held while the model answers. A word with no sentence
//! is asked as before, with the sentence of its chapter.

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, TimeDelta, Utc};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};

use super::profile::{agent, require_profile};
use super::run;
use crate::agent::protocol::{
    BookGloss, NewSentence as Wrote, ReviewedSentence, SentenceReviewParams, SentenceVerdict,
    SentenceVerdicts, SentenceWord, SentenceWriteParams, SentencesWritten, WrittenWord,
};
use crate::books::segment::{paragraphs, sentences as cut};
use crate::books::sentences::{
    cue_in, fits, found, hint_fits, in_translation, left, other_hints, shown_in, unaided, Banked,
    GIVEN, LOW, SENTENCE_CHARS, WORDS_PER_CALL,
};
use crate::books::variety::peninsular;
use crate::db::recall::{self, Source};
use crate::db::sentences::{self as bank, Labels, NewSentence, Sentence};
use crate::db::{practice, spellings, translate};
use crate::domain::{PartOfSpeech, SentenceProgress};
use crate::error::Result;
use crate::Ctx;

/// Sentences put to the second look in one request.
const REVIEWED_PER_CALL: usize = 30;

/// Sentences the model is asked to write for a word in a chapter's sense,
/// the one time it is asked.
pub const WRITTEN: u32 = 5;

/// The two things the model is asked for; a stub in the tests.
pub trait Model {
    fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten>;
    fn review(&mut self, params: &SentenceReviewParams) -> Result<SentenceVerdicts>;
}

/// The model behind the sidecar.
pub(super) struct Sidecar<'a>(pub(super) Ctx<'a>);

impl Model for Sidecar<'_> {
    fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten> {
        agent(self.0)?.sentence_write(params)
    }

    fn review(&mut self, params: &SentenceReviewParams) -> Result<SentenceVerdicts> {
        agent(self.0)?.sentence_review(params)
    }
}

/// Whose words are given sentences.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope<'a> {
    /// The words of a chapter the learner has not said they know.
    Chapter(&'a str),
    /// The learned words the daily recall asks.
    Recall,
}

/// A word that may be given sentences, with what glossing them takes.
#[derive(Clone)]
struct Wanted {
    key: String,
    lemma: String,
    part_of_speech: Option<PartOfSpeech>,
    translations: Vec<String>,
    /// What fixes its sense: the sentence of its chapter, or what the
    /// learner asked for in a conversation.
    sense: String,
    forms: Vec<String>,
    /// The chapter it is from; none for a word of a conversation.
    chapter: Option<String>,
    /// The chapter's word; none for a word of a conversation.
    word_id: Option<String>,
}

/// A word of a chapter as it is wanted.
fn chapter_word(conn: &Connection, word_id: &str, key: String) -> Result<Wanted> {
    let word = practice::word(conn, word_id)?;
    let mut forms = word.forms;
    if !forms.contains(&word.lemma) {
        forms.push(word.lemma.clone());
    }
    Ok(Wanted {
        key,
        part_of_speech: bank::part_of_speech(conn, word_id)?,
        lemma: word.lemma,
        translations: word.shown,
        sense: word.sentence,
        forms,
        chapter: Some(word.chapter_id),
        word_id: Some(word.id),
    })
}

/// The words of a chapter, and the words of other chapters they are rivals
/// of that were never written for: a chapter that brings a word's first
/// rival has both written for.
fn with_rivals(conn: &Connection, chapter_id: &str) -> Result<Vec<Wanted>> {
    let mut words: Vec<Wanted> = bank::chapter_keys(conn, chapter_id)?
        .into_iter()
        .map(|(word_id, key)| chapter_word(conn, &word_id, key))
        .collect::<Result<_>>()?;
    let mut seen: Vec<String> = words.iter().filter_map(|w| w.word_id.clone()).collect();
    let mut others = Vec::new();
    for word in &words {
        let Some(id) = word.word_id.as_deref() else {
            continue;
        };
        for rival in spellings::rivals(conn, id)? {
            if seen.contains(&rival.word_id) {
                continue;
            }
            seen.push(rival.word_id.clone());
            let key: String = conn.query_row(
                "SELECT key FROM chapter_words WHERE id = ?1",
                [&rival.word_id],
                |row| row.get(0),
            )?;
            if !bank::written(conn, &key, &rival.chapter_id)? {
                others.push(chapter_word(conn, &rival.word_id, key)?);
            }
        }
    }
    words.extend(others);
    Ok(words)
}

/// The words of the scope, the ones still to learn first.
fn wanted(conn: &Connection, scope: Scope<'_>) -> Result<Vec<Wanted>> {
    match scope {
        Scope::Chapter(chapter_id) => with_rivals(conn, chapter_id),
        Scope::Recall => recall::words(conn)?
            .into_iter()
            .map(|word| match word.source {
                Source::Book { word_id } => chapter_word(conn, &word_id, word.key),
                Source::Chat { asked } => Ok(Wanted {
                    key: word.key,
                    lemma: word.english,
                    part_of_speech: None,
                    translations: vec![asked.clone()],
                    sense: asked,
                    forms: word.forms,
                    chapter: None,
                    word_id: None,
                }),
            })
            .collect(),
    }
}

/// A sentence of a bank as `books::sentences` reads it: `own` is the
/// sentence of the chapter being practised, and `recent` the ones the word
/// was asked with the last time and in this sitting.
pub(super) fn banked(sentence: &Sentence, own: &str, recent: &[String]) -> Banked {
    Banked {
        id: sentence.id.clone(),
        book: sentence.book,
        own: sentence.text == own,
        shows: sentence.shows,
        last: recent.contains(&sentence.id),
    }
}

/// Whether the word has another sense of its kind (`commands::ladder::tied`):
/// its card alone has no one answer, so it is asked with a sentence in
/// view, and those are the only words sentences are written for. A rival
/// of another kind is told by the tag of the card, and needs none.
fn tied(conn: &Connection, word_id: &str) -> Result<bool> {
    super::ladder::tied(conn, &practice::word(conn, word_id)?, None)
}

/// How many sentences the model is to write for a word in `chapter`'s
/// sense: [`WRITTEN`] for a word written alike to another one the first
/// time, and again when it runs low ([`refill_due`]); none otherwise.
fn to_write(conn: &Connection, word: &Wanted, chapter: &str) -> Result<u32> {
    let Some(id) = word.word_id.as_deref() else {
        return Ok(0);
    };
    let first = tied(conn, id)? && !bank::written(conn, &word.key, chapter)?;
    let again = refill_due(conn, (id, &word.key, chapter), Utc::now())?;
    if !first && !again {
        return Ok(0);
    }
    // Never past the most a word is written.
    let room = MOST_WRITTEN.saturating_sub(bank::written_count(conn, &word.key, chapter)?);
    Ok(WRITTEN.min(room))
}

/// What a word means in the chapters that have it written alike
/// (`db::spellings::rivals`), each once: what a sentence written for it has
/// to rule out.
fn others(conn: &Connection, word_id: &str) -> Result<Vec<String>> {
    let mut found: Vec<String> = Vec::new();
    for rival in spellings::rivals(conn, word_id)? {
        for meaning in rival.translations {
            if !found.contains(&meaning) {
                found.push(meaning);
            }
        }
    }
    Ok(found)
}

/// The sentences a word already has in `chapter`'s sense, for the model to
/// write none like them; none when it is not to write.
fn avoided(conn: &Connection, due: &Due, chapter: &str) -> Result<Vec<String>> {
    if due.write == 0 {
        return Ok(Vec::new());
    }
    Ok(bank::bank(conn, &due.word.key, Some(chapter))?
        .into_iter()
        .map(|each| each.text)
        .collect())
}

/// The window refills of a word are counted in: about one sitting.
const REFILL_GAP_HOURS: i64 = 12;

/// Batches a word is written in one [`REFILL_GAP_HOURS`] window, its first
/// one included: a word missed many times in a row gets up to a third, and
/// then reuses what it has.
const BATCHES_PER_GAP: u32 = 3;

/// Sentences the model writes for a word in one chapter's sense, ever.
/// Past them nothing more is written: they rotate, the least shown first,
/// at random, so that none is learned by heart.
pub const MOST_WRITTEN: u32 = 30;

/// Whether a word written alike to another one has run low on the
/// sentences of its chapter's sense ([`LOW`] uses or fewer left): then more
/// are written, in the background, before the ones it has run out. Not
/// while it was written for [`BATCHES_PER_GAP`] times in the last
/// [`REFILL_GAP_HOURS`], nor once it has [`MOST_WRITTEN`]. A word never
/// written for is not due here: it is written for once in any case.
pub fn refill_due(
    conn: &Connection,
    (word_id, key, chapter): (&str, &str, &str),
    now: DateTime<Utc>,
) -> Result<bool> {
    if !tied(conn, word_id)? || !bank::written(conn, key, chapter)? {
        return Ok(false);
    }
    // Only the sentences whose few words fix its sense count: the others
    // are no use to a word its tag cannot tell apart.
    let held: Vec<Banked> = bank::bank(conn, key, Some(chapter))?
        .iter()
        .filter(|each| super::practice::fixed(each))
        .map(|each| banked(each, "", &[]))
        .collect();
    if left(&held) > LOW || bank::written_count(conn, key, chapter)? >= MOST_WRITTEN {
        return Ok(false);
    }
    let since = now - TimeDelta::hours(REFILL_GAP_HOURS);
    Ok(bank::writes_since(conn, key, chapter, since)? < BATCHES_PER_GAP)
}

/// After an answer to the word `word_id`: the chapter whose sentences of it
/// are to be written again now ([`refill_due`]); none when none are.
pub fn refill_after(
    conn: &Connection,
    word_id: &str,
    now: DateTime<Utc>,
) -> Result<Option<String>> {
    let (key, chapter): (String, String) = conn.query_row(
        "SELECT key, chapter_id FROM chapter_words WHERE id = ?1",
        [word_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(refill_due(conn, (word_id, &key, &chapter), now)?.then_some(chapter))
}

/// Writes the sentences of `chapter` again in the background, as opening
/// it does: the answer that made them due does not wait for them.
pub fn refill(app: &AppHandle, chapter: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Nothing to tell the learner if it fails: the next run tries again.
        let _ = write_sentences(app, chapter).await;
    });
}

/// The sentences of a chapter: only its own show the sense it gives a word.
fn chapter_sentences(conn: &Connection, chapter_id: &str) -> Result<Vec<String>> {
    let blocks = translate::lines_are_blocks(conn, chapter_id)?;
    Ok(paragraphs(&bank::chapter_text(conn, chapter_id)?, blocks)
        .iter()
        .flat_map(|paragraph| cut(paragraph))
        .collect())
}

/// The sentences of its chapter the word is given, each with the form it
/// has there: the one it was found in, or when that one cannot ask it
/// another, not a piece of that one.
fn in_book(word: &Wanted, book: &[(String, String)]) -> Vec<(String, String)> {
    let mut kept = found(std::slice::from_ref(&word.sense), &word.forms, GIVEN);
    let forms: Vec<String> = word.forms.iter().map(|form| form.to_lowercase()).collect();
    // Most sentences do not have the word: those are told apart cheaply.
    let near: Vec<String> = book
        .iter()
        .filter(|(_, lower)| forms.iter().any(|form| lower.contains(form)))
        .filter(|(sentence, _)| {
            !word.sense.contains(sentence.as_str()) && !sentence.contains(&word.sense)
        })
        .map(|(sentence, _)| sentence.clone())
        .collect();
    kept.extend(found(&near, &word.forms, GIVEN.saturating_sub(kept.len())));
    kept
}

/// A word with what it is due: to be read in its chapter, and how many
/// sentences to be written for it.
struct Due {
    word: Wanted,
    read: bool,
    write: u32,
}

/// A word with the batch it is asked about.
struct Asked {
    word: Wanted,
    /// The sentences of its chapter in the batch, each with its form.
    book: Vec<(String, String)>,
    params: SentenceWord,
}

/// The word asked about these sentences of its chapter, and for `write`
/// sentences of the model's own.
fn asked_about(word: Wanted, from_book: Vec<(String, String)>, write: u32) -> Asked {
    Asked {
        params: SentenceWord {
            // Two chapters can ask the same key in one request: each by its word.
            id: word.word_id.clone().unwrap_or_else(|| word.key.clone()),
            lemma: word.lemma.clone(),
            part_of_speech: word.part_of_speech,
            translations: word.translations.clone(),
            sense: word.sense.clone(),
            book: from_book
                .iter()
                .map(|(sentence, _)| sentence.clone())
                .collect(),
            write,
            avoid: Vec::new(),
            others: Vec::new(),
        },
        book: from_book,
        word,
    }
}

/// What the word is asked about: the sentence of its chapter it is given,
/// when it is to be given one, and `write` sentences of the model's. None
/// when that is nothing.
fn ask(word: Wanted, chapter: Option<&[(String, String)]>, write: u32) -> Option<Asked> {
    let from_book = chapter.map_or_else(Vec::new, |chapter| in_book(&word, chapter));
    (!from_book.is_empty() || write > 0).then(|| asked_about(word, from_book, write))
}

/// Whether a form is one of the word: one its chapter writes, or one that
/// starts as its base form does ("swore" is not, and is let go).
fn of_word(form: &str, word: &Wanted) -> bool {
    let form = form.to_lowercase();
    let stem = |text: &str| text.chars().take(3).collect::<String>();
    word.forms.iter().any(|each| each.to_lowercase() == form)
        || stem(&form) == stem(&word.lemma.to_lowercase())
}

/// A sentence the model wrote, as it can be kept: one sentence short enough
/// to read at a glance, with a form of the word in it exactly once, and a
/// gloss that passes as one of the book does ([`gloss`]).
fn written<'a>(
    said: &'a Wrote,
    word: &Wanted,
    lang: &str,
) -> Option<(&'a str, &'a str, String, &'a str)> {
    let (sentence, form) = (said.sentence.trim(), said.form.trim());
    let fit = !sentence.is_empty()
        && sentence.chars().count() <= SENTENCE_CHARS
        && fits(sentence, form)
        && of_word(form, word);
    let glossed = BookGloss {
        index: 0,
        hint: said.hint.clone(),
        translation: said.translation.clone(),
    };
    let hint = gloss(&glossed, form, lang).map(|(hint, _)| hint)?;
    fit.then_some((sentence, form, hint, said.translation.trim()))
}

/// What the model said of a sentence, as it can be kept: the hint, without
/// the words of the learner's `lang` for English ones outside the `form`
/// (`books::sentences::unaided`), and the translation. None when the hint
/// gives the word away, or is not words of the translation: the word would
/// be asked by something its sentence does not say. None too when the
/// translation speaks to "vosotros" (`books::variety`).
fn gloss<'a>(said: &'a BookGloss, form: &str, lang: &str) -> Option<(String, &'a str)> {
    let (hint, translation) = (
        unaided(said.hint.trim(), form, lang),
        said.translation.trim(),
    );
    (hint_fits(&hint, form) && in_translation(&hint, translation) && !peninsular(translation, lang))
        .then_some((hint, translation))
}

/// Keeps what the model answered for one word: each sentence whose gloss
/// passes the checks is kept to be looked at, and each other is refused for
/// good.
fn keep(
    conn: &Connection,
    (asked, answer): (&Asked, &WrittenWord),
    lang: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    let key = asked.word.key.as_str();
    let Some(chapter) = asked.word.chapter.as_deref() else {
        return Ok(());
    };
    for gloss in &answer.book {
        let at = usize::try_from(gloss.index).unwrap_or(usize::MAX);
        let Some((sentence, form)) = asked.book.get(at) else {
            continue;
        };
        if let Some((hint, translation)) = self::gloss(gloss, form, lang) {
            let new = NewSentence {
                key,
                chapter: Some(chapter),
                book: true,
                sentence,
                form,
                hint: &hint,
                translation,
            };
            bank::add(conn, &new, now)?;
        }
    }
    // A sentence of the book the model said nothing of is not asked again.
    for (sentence, _) in &asked.book {
        bank::refuse(conn, (key, chapter), sentence, now)?;
    }
    let wanted = usize::try_from(asked.params.write).unwrap_or(usize::MAX);
    for said in answer.written.iter().take(wanted) {
        if let Some((sentence, form, hint, translation)) = written(said, &asked.word, lang) {
            let new = NewSentence {
                key,
                chapter: Some(chapter),
                book: false,
                sentence,
                form,
                hint: &hint,
                translation,
            };
            bank::add(conn, &new, now)?;
        }
    }
    Ok(())
}

/// Puts these sentences to the second look: its labels, by sentence.
fn labels(
    ctx: Ctx<'_>,
    model: &mut dyn Model,
    native_lang: &str,
    chunk: &[Sentence],
) -> Result<HashMap<String, SentenceVerdict>> {
    let sentences = {
        let conn = ctx.conn()?;
        chunk
            .iter()
            .map(|each| {
                let (lemma, meaning) = bank::meaning(&conn, &each.key, each.chapter_id.as_deref())?;
                let others = match each.chapter_id.as_deref() {
                    Some(chapter) => match bank::word_in(&conn, &each.key, chapter)? {
                        Some(word) => others(&conn, &word)?,
                        None => Vec::new(),
                    },
                    None => Vec::new(),
                };
                Ok(ReviewedSentence {
                    others,
                    id: each.id.clone(),
                    from_book: each.book,
                    lemma,
                    meaning,
                    sentence: each.text.clone(),
                    form: each.form.clone(),
                    hint: each.hint.clone(),
                    translation: each.translation.clone(),
                })
            })
            .collect::<Result<Vec<_>>>()?
    };
    let verdicts = model.review(&SentenceReviewParams {
        native_lang: native_lang.to_owned(),
        sentences,
    })?;
    Ok(verdicts
        .verdicts
        .into_iter()
        .map(|verdict| (verdict.id.clone(), verdict))
        .collect())
}

/// What a label says of a sentence, as it is kept: the other English words
/// it lists, the word's other translations in the form of the hint
/// (`books::sentences::other_hints`), and the form of the verb. Nothing for
/// a sentence the model said nothing of. `base` is the word's translations
/// in their base form.
fn kept(
    label: Option<&SentenceVerdict>,
    sentence: &Sentence,
    (base, lang): (&[String], &str),
) -> Labels {
    let Some(label) = label else {
        return Labels::default();
    };
    let also = label.also.iter();
    Labels {
        also: also
            .map(|each| each.trim().to_owned())
            .filter(|each| !each.is_empty())
            .collect(),
        hints: other_hints(&label.hints, (&sentence.hint, &sentence.form, lang), base),
        verb_form: label.verb_form,
        cue: cue_in(&label.cue, (&sentence.text, &sentence.form)),
        general: label
            .general
            .iter()
            .map(|each| each.trim().to_owned())
            .filter(|each| !each.is_empty())
            .collect(),
    }
}

/// Puts every sentence waiting to be looked at to the model, a few at a
/// time, and keeps its labels: one called good can be asked with, and one
/// called bad, or not labelled at all, is refused.
fn look(ctx: Ctx<'_>, model: &mut dyn Model, native_lang: &str) -> Result<()> {
    let waiting = bank::unreviewed(&*ctx.conn()?)?;
    for chunk in waiting.chunks(REVIEWED_PER_CALL) {
        let labels = labels(ctx, model, native_lang, chunk)?;
        let conn = ctx.conn()?;
        for each in chunk {
            let label = labels.get(&each.id);
            let good = label.is_some_and(|label| label.good);
            let (_, base) = bank::meaning(&conn, &each.key, each.chapter_id.as_deref())?;
            bank::review(
                &conn,
                &each.id,
                good,
                &kept(label, each, (&base, native_lang)),
            )?;
        }
    }
    Ok(())
}

/// Puts the sentences looked at before one of their labels was asked for
/// (`db::sentences::unlabelled`) to the model, for the labels alone:
/// whether they are good was settled, and one the model says nothing of has
/// none.
fn label(ctx: Ctx<'_>, model: &mut dyn Model, native_lang: &str) -> Result<()> {
    let unlabelled = bank::unlabelled(&*ctx.conn()?)?;
    for chunk in unlabelled.chunks(REVIEWED_PER_CALL) {
        let labels = labels(ctx, model, native_lang, chunk)?;
        let conn = ctx.conn()?;
        for each in chunk {
            let (_, base) = bank::meaning(&conn, &each.key, each.chapter_id.as_deref())?;
            let labels = kept(labels.get(&each.id), each, (&base, native_lang));
            bank::label(&conn, &each.id, &labels)?;
        }
    }
    Ok(())
}

/// A word with the sentences it is asked with whose hint is not words of
/// their translation, as written or without its negation
/// (`books::sentences::shown_in`): kept before a hint had to be. Or whose
/// translation speaks to "vosotros" (`books::variety`): kept before the
/// learner's Spanish had to be Latin American.
struct Outdated {
    asked: Asked,
    sentences: Vec<Sentence>,
}

/// The sentences of a word's bank to be glossed again, if any.
fn outdated(conn: &Connection, word: Wanted, lang: &str) -> Result<Option<Outdated>> {
    let sentences: Vec<Sentence> = bank::bank(conn, &word.key, word.chapter.as_deref())?
        .into_iter()
        .filter(|each| {
            !shown_in(&each.hint, &each.translation, lang) || peninsular(&each.translation, lang)
        })
        .collect();
    if sentences.is_empty() {
        return Ok(None);
    }
    let book = sentences
        .iter()
        .map(|each| (each.text.clone(), each.form.clone()))
        .collect();
    Ok(Some(Outdated {
        asked: asked_about(word, book, 0),
        sentences,
    }))
}

/// Glosses these sentences once more, and has the new gloss looked at
/// before anything is kept: until then they are asked with as they were.
/// One glossed well and called good keeps its place in the bank and its
/// answers, with its new hint and translation; any other is not asked with
/// again, so none is glossed twice.
fn renew(ctx: Ctx<'_>, model: &mut dyn Model, native_lang: &str, batch: &[Outdated]) -> Result<()> {
    let written = model.write(&SentenceWriteParams {
        native_lang: native_lang.to_owned(),
        words: batch.iter().map(|each| each.asked.params.clone()).collect(),
    })?;
    let mut glossed: Vec<Sentence> = Vec::new();
    let mut refused: Vec<&str> = Vec::new();
    for each in batch {
        let answer = written
            .words
            .iter()
            .find(|word| word.id == each.asked.params.id);
        for (at, old) in each.sentences.iter().enumerate() {
            let new = answer
                .and_then(|answer| {
                    let said = |gloss: &&BookGloss| usize::try_from(gloss.index) == Ok(at);
                    answer.book.iter().find(said)
                })
                .and_then(|said| gloss(said, &old.form, native_lang));
            match new {
                Some((hint, translation)) => glossed.push(Sentence {
                    hint,
                    translation: translation.to_owned(),
                    ..old.clone()
                }),
                None => refused.push(&old.id),
            }
        }
    }
    let labels = if glossed.is_empty() {
        HashMap::new()
    } else {
        labels(ctx, model, native_lang, &glossed)?
    };
    let conn = ctx.conn()?;
    for id in refused {
        bank::discard(&conn, id)?;
    }
    for each in &glossed {
        let label = labels.get(&each.id);
        if label.is_some_and(|label| label.good) {
            let (_, base) = bank::meaning(&conn, &each.key, each.chapter_id.as_deref())?;
            bank::regloss(&conn, each, &kept(label, each, (&base, native_lang)))?;
        } else {
            bank::discard(&conn, &each.id)?;
        }
    }
    Ok(())
}

/// Gives the words of the scope that were never given a sentence one of
/// their book; how many words that was. Every hint kept is first rid of the
/// words for English ones outside its form (`db::sentences::unaid`). `progress` hears how many are done
/// out of how many. Sentences left waiting by a run that was cut short are
/// looked at first, so nothing is asked twice. The sentences kept before
/// their rivals were listed are labelled last ([`label`]), after those
/// whose hint their translation does not have are glossed again
/// ([`renew`]): the words that have no sentence yet do not wait for them.
pub fn top_up(
    ctx: Ctx<'_>,
    scope: Scope<'_>,
    model: &mut dyn Model,
    progress: &dyn Fn(u32, u32),
) -> Result<u32> {
    let profile = require_profile(&*ctx.conn()?)?;
    // Hints kept before they had to leave out a tense their form does not
    // show lose it here, with no request to the model.
    bank::unaid(&*ctx.conn()?, &profile.native_lang)?;
    look(ctx, model, &profile.native_lang)?;

    let mut asked: Vec<Asked> = Vec::new();
    let mut stale: Vec<Outdated> = Vec::new();
    {
        let conn = ctx.conn()?;
        // By the chapter they are from: the words of one chapter share its
        // text. Each is to be read in it, or written for, or neither.
        let mut groups: Vec<(String, Vec<Due>)> = Vec::new();
        for word in wanted(&conn, scope)? {
            // A word of a conversation is of no book: it has no sentence.
            let Some(chapter) = word.chapter.clone() else {
                continue;
            };
            let given = bank::given(&conn, &word.key, &chapter)?;
            let read = !given && !bank::archived(&conn, &chapter)?;
            let write = to_write(&conn, &word, &chapter)?;
            if given {
                stale.extend(outdated(&conn, word.clone(), &profile.native_lang)?);
            }
            if !read && write == 0 {
                continue;
            }
            let due = Due { word, read, write };
            match groups.iter_mut().find(|(held, _)| *held == chapter) {
                Some((_, words)) => words.push(due),
                None => groups.push((chapter, vec![due])),
            }
        }
        for (chapter, words) in groups {
            let text: Vec<(String, String)> = if words.iter().any(|due| due.read) {
                chapter_sentences(&conn, &chapter)?
                    .into_iter()
                    .map(|sentence| {
                        let lower = sentence.to_lowercase();
                        (sentence, lower)
                    })
                    .collect()
            } else {
                Vec::new()
            };
            for due in words {
                let avoid = avoided(&conn, &due, &chapter)?;
                let chapter = due.read.then_some(text.as_slice());
                let others = match due.word.word_id.as_deref() {
                    Some(id) => others(&conn, id)?,
                    None => Vec::new(),
                };
                asked.extend(ask(due.word, chapter, due.write).map(|mut each| {
                    each.params.avoid = avoid;
                    each.params.others = others;
                    each
                }));
            }
        }
    }
    let count = |len: usize| u32::try_from(len).unwrap_or(u32::MAX);
    let total = count(asked.len());
    let mut done = 0_usize;
    progress(0, total);

    for batch in asked.chunks(WORDS_PER_CALL) {
        let written = model.write(&SentenceWriteParams {
            native_lang: profile.native_lang.clone(),
            words: batch.iter().map(|each| each.params.clone()).collect(),
        })?;
        {
            let mut conn = ctx.conn()?;
            let tx = conn.transaction()?;
            let now = Utc::now();
            for each in batch {
                let answer = written.words.iter().find(|word| word.id == each.params.id);
                if let Some(answer) = answer {
                    keep(&tx, (each, answer), &profile.native_lang, now)?;
                }
                // Asked to write, whatever it wrote: the first time, or again.
                if let (Some(chapter), true) = (&each.word.chapter, each.params.write > 0) {
                    if bank::written(&tx, &each.word.key, chapter)? {
                        bank::refilled(&tx, &each.word.key, chapter, now)?;
                    }
                    bank::wrote(&tx, &each.word.key, chapter, now)?;
                }
            }
            tx.commit()?;
        }
        // Looked at as they come: the first words are ready first.
        look(ctx, model, &profile.native_lang)?;
        done += batch.len();
        progress(count(done), total);
    }
    for batch in stale.chunks(WORDS_PER_CALL) {
        renew(ctx, model, &profile.native_lang, batch)?;
    }
    label(ctx, model, &profile.native_lang)?;
    // What was looked at in this run loses the negation outside its form.
    bank::unaid(&*ctx.conn()?, &profile.native_lang)?;
    Ok(total)
}

/// How far the words of the scope stand with their sentences: how many
/// there are, how many can be asked with one, and how many sentences those
/// have, in their chapter for a chapter and in any for the recall.
pub fn stock(conn: &Connection, scope: Scope<'_>) -> Result<(u32, u32, u32)> {
    let count = |len: usize| u32::try_from(len).unwrap_or(u32::MAX);
    let mut words = 0_usize;
    let (mut ready, mut sentences) = (0_usize, 0_usize);
    for word in wanted(conn, scope)? {
        let Some(chapter) = word.chapter.as_deref() else {
            continue;
        };
        let within = match scope {
            // Its own words only, not the rivals it brought.
            Scope::Chapter(own) if own != chapter => continue,
            Scope::Chapter(_) => Some(chapter),
            Scope::Recall => None,
        };
        let held = bank::bank(conn, &word.key, within)?.len();
        words += 1;
        ready += usize::from(held > 0);
        sentences += held;
    }
    Ok((count(words), count(ready), count(sentences)))
}

/// One run at a time: a second one waits, and then finds little to do.
static RUNNING: Mutex<()> = Mutex::new(());

/// Gives the words of a chapter, or with none the learned words of the
/// recall, the sentence of their book they were never given, reporting
/// `sentence-progress` on the way.
#[tauri::command]
pub async fn write_sentences(app: AppHandle, chapter_id: Option<String>) -> Result<u32> {
    run(app, move |app, ctx| {
        let _one = RUNNING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let scope = chapter_id.as_deref().map_or(Scope::Recall, Scope::Chapter);
        top_up(ctx, scope, &mut Sidecar(ctx), &|done, total| {
            // What is ready so far; a count that cannot be read says nothing.
            let (words, ready, sentences) = ctx
                .conn()
                .ok()
                .and_then(|conn| stock(&conn, scope).ok())
                .unwrap_or_default();
            let progress = SentenceProgress {
                chapter_id: chapter_id.clone(),
                done,
                total,
                words,
                ready,
                sentences,
            };
            // A closed window is the only way this fails; the work goes on.
            let _ = app.emit("sentence-progress", progress);
        })
    })
    .await
}

#[cfg(test)]
pub mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::commands::practice::tests::{numbered, t0, Desk};
    use crate::db::sessions;
    use crate::db::spellings;
    use crate::db::words;
    use crate::domain::{VerbForm, VocabItem};
    use crate::error::Error;

    /// A model that glosses every sentence of the book; the second look
    /// refuses a clumsy one, and lists one other English word for every
    /// hint ([`rival`]). It keeps what it was asked.
    #[derive(Default)]
    pub struct Stub {
        pub writes: Vec<SentenceWriteParams>,
        pub reviews: usize,
        /// The second look fails this many times before it answers.
        pub review_fails: usize,
        /// It writes the sentences asked for ([`penned`]); none otherwise.
        pub pen: bool,
    }

    /// The `at`th sentence the stub writes for a word in a sense: the word
    /// once in it, and none the same for two senses.
    pub fn penned(lemma: &str, at: u32, sense: &str) -> String {
        format!("Story {at}.{}: the {lemma} was there.", sense.len())
    }

    /// The chapter that has the word of `key`, the first one.
    pub fn chapter_having(conn: &Connection, key: &str) -> Option<String> {
        use rusqlite::OptionalExtension;
        conn.query_row(
            "SELECT chapter_id FROM chapter_words WHERE key = ?1 ORDER BY created_at, id LIMIT 1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .expect("chapter")
    }

    pub fn hint(lemma: &str) -> String {
        format!("{lemma}ó")
    }

    /// The translation the stub gives a sentence: it has the hint.
    pub fn translation(lemma: &str, index: usize) -> String {
        format!("{} libro {index}", hint(lemma))
    }

    /// The other English word the stub lists for the hint of a form.
    pub fn rival(form: &str) -> String {
        format!("{form}ish")
    }

    /// The other translation the stub lists in the form of a hint.
    pub fn other_hint(hint: &str) -> String {
        format!("se {hint}")
    }

    impl Model for Stub {
        fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten> {
            self.writes.push(params.clone());
            let words = params
                .words
                .iter()
                .map(|word| WrittenWord {
                    id: word.id.clone(),
                    written: (0..if self.pen { word.write } else { 0 })
                        .map(|at| Wrote {
                            sentence: penned(&word.lemma, at, &word.sense),
                            form: word.lemma.clone(),
                            hint: hint(&word.lemma),
                            translation: format!("{} escrita {at}", hint(&word.lemma)),
                        })
                        .collect(),
                    book: (0..word.book.len())
                        .map(|index| BookGloss {
                            index: u32::try_from(index).expect("small"),
                            hint: hint(&word.lemma),
                            translation: translation(&word.lemma, index),
                        })
                        .collect(),
                })
                .collect();
            Ok(SentencesWritten { words })
        }

        fn review(&mut self, params: &SentenceReviewParams) -> Result<SentenceVerdicts> {
            if self.review_fails > 0 {
                self.review_fails -= 1;
                return Err(Error::Provider("no answer".into()));
            }
            self.reviews += 1;
            Ok(SentenceVerdicts {
                verdicts: params
                    .sentences
                    .iter()
                    .map(|each| SentenceVerdict {
                        id: each.id.clone(),
                        good: !each.sentence.contains("clumsy"),
                        also: vec![format!(" {} ", rival(&each.form)), "  ".into()],
                        hints: vec![
                            format!(" {} ", other_hint(&each.hint)),
                            each.hint.clone(),
                            each.form.clone(),
                            // A base form is no form of the sentence.
                            each.meaning.first().cloned().unwrap_or_default(),
                        ],
                        general: Vec::new(),
                        verb_form: Some(VerbForm::Past),
                        // The word after it, as the fake sidecar says.
                        cue: each
                            .sentence
                            .split_whitespace()
                            .skip_while(|word| !word.starts_with(each.form.as_str()))
                            .nth(1)
                            .map(|word| {
                                word.trim_matches(|c: char| !c.is_alphanumeric()).to_owned()
                            })
                            .into_iter()
                            .collect(),
                    })
                    .collect(),
            })
        }
    }

    /// Gives the chapter's words their sentences with the stub.
    pub fn stock(desk: &Desk, chapter: &str) -> Stub {
        let mut stub = Stub::default();
        top_up(desk.ctx(), Scope::Chapter(chapter), &mut stub, &|_, _| {}).expect("top up");
        stub
    }

    fn texts(desk: &Desk, key: &str) -> Vec<String> {
        bank::bank(&desk.db.lock().expect("db"), key, None)
            .expect("bank")
            .into_iter()
            .map(|sentence| sentence.text)
            .collect()
    }

    /// A chapter of a book with this text, with these words.
    fn chapter_of(desk: &Desk, text: &str, list: &[Word]) -> String {
        let conn = desk.db.lock().expect("db");
        let chapter = words::tests::book(&conn, "b", &[text]).remove(0);
        words::finish(&conn, &chapter, crate::domain::Depth::Most, list, t0()).expect("words");
        chapter
    }

    /// The sentences a word was given when it was given several: a bank
    /// kept before a word was given one only.
    fn old_bank(desk: &Desk, key: &str, sentences: &[(&str, &str)]) {
        let conn = desk.db.lock().expect("db");
        for (at, (sentence, form)) in sentences.iter().enumerate() {
            let there = chapter_having(&conn, key);
            let new = NewSentence {
                key,
                chapter: there.as_deref(),
                book: true,
                sentence,
                form,
                hint: &hint(key),
                translation: &translation(key, at + 1),
            };
            bank::add(&conn, &new, Utc::now()).expect("add");
            // Written for before: what is asked here is something else.
            if let Some(chapter) = new.chapter {
                bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
            }
        }
        for waiting in bank::unreviewed(&conn).expect("waiting") {
            bank::review(&conn, &waiting.id, true, &Labels::default()).expect("review");
        }
    }

    #[test]
    fn a_word_is_given_the_sentence_of_its_chapter_once_and_none_is_written() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "Here w00 is again in the garden. And then w00 once more.";
        let chapter = chapter_of(&desk, text, &numbered(2));
        let heard = RefCell::new(Vec::new());
        let mut stub = Stub::default();
        let given = top_up(
            desk.ctx(),
            Scope::Chapter(&chapter),
            &mut stub,
            &|done, total| heard.borrow_mut().push((done, total)),
        )
        .expect("top up");
        assert_eq!(given, 2);
        assert_eq!(*heard.borrow(), [(0, 2), (2, 2)]);

        // One request for both words, one sentence each: the chapter's.
        let [asked] = stub.writes.as_slice() else {
            panic!("one request")
        };
        let word = &asked.words[0];
        assert_eq!(word.lemma, "w00");
        assert_eq!(word.sense, "A sentence with w00.");
        assert_eq!(word.book, ["A sentence with w00."]);
        assert_eq!(asked.words[1].book, ["A sentence with w01."]);

        assert_eq!(texts(&desk, "w00"), ["A sentence with w00."]);
        let own = &bank::bank(&desk.db.lock().expect("db"), "w00", None).expect("bank")[0];
        assert!(own.book);
        assert_eq!(
            (
                own.form.as_str(),
                own.hint.as_str(),
                own.translation.as_str()
            ),
            ("w00", "w00ó", "w00ó libro 0")
        );
        assert_eq!(own.also, ["w00ish"], "as the second look listed them");

        // Given once: a second run asks for nothing, though the book has
        // w00 in other sentences.
        let again = stock(&desk, &chapter);
        assert_eq!((again.writes.len(), again.reviews), (0, 0));
    }

    #[test]
    fn a_word_its_chapter_sentence_cannot_ask_is_given_another_and_no_second_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        // The word twice in the sentence of its chapter: no one blank.
        let twice = Word {
            sentence: "She peeped and peeped.".into(),
            ..peep()
        };
        let text = "She peeped and peeped. A clumsy peep it was. He peeped at it.";
        let chapter = chapter_of(&desk, text, &[twice]);
        let stub = stock(&desk, &chapter);
        assert_eq!(stub.writes[0].words[0].book, ["A clumsy peep it was."]);

        // The second look refused it: the word has none, and gets no other.
        assert_eq!(texts(&desk, "peep"), Vec::<String>::new());
        let again = stock(&desk, &chapter);
        assert_eq!((again.writes.len(), again.reviews), (0, 0));
    }

    #[test]
    fn a_word_with_a_bank_kept_before_is_given_no_more_however_spent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "Do not peep now. He peeped at it. They peep a lot.";
        let chapter = chapter_of(&desk, text, &[peep()]);
        old_bank(&desk, "peep", &[("Do not peep now.", "peep")]);
        let stub = stock(&desk, &chapter);
        assert_eq!((stub.writes.len(), stub.reviews), (0, 0));
        assert_eq!(texts(&desk, "peep"), ["Do not peep now."]);
    }

    #[test]
    fn a_sentence_looked_at_before_is_labelled_once_and_stays_as_it_was() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "Do not peep now. A clumsy peep it was.";
        let chapter = chapter_of(&desk, text, &[peep()]);
        old_bank(
            &desk,
            "peep",
            &[
                ("Do not peep now.", "peep"),
                ("A clumsy peep it was.", "peep"),
            ],
        );
        // As the rows were before the list was asked for.
        desk.db
            .lock()
            .expect("db")
            .execute("UPDATE word_sentences SET also = NULL", [])
            .expect("old rows");

        let stub = stock(&desk, &chapter);
        assert_eq!((stub.writes.len(), stub.reviews), (0, 1));
        let bank = bank::bank(&desk.db.lock().expect("db"), "peep", None).expect("bank");
        let also: Vec<&[String]> = bank.iter().map(|each| each.also.as_slice()).collect();
        assert_eq!(also, [["peepish"], ["peepish"]]);

        // Nor one looked at before the translations in the form of the
        // hint were asked for: it is labelled once more, for those.
        desk.db
            .lock()
            .expect("db")
            .execute("UPDATE word_sentences SET hints = NULL", [])
            .expect("old rows");
        let stub = stock(&desk, &chapter);
        assert_eq!((stub.writes.len(), stub.reviews), (0, 1));
        let bank = bank::bank(&desk.db.lock().expect("db"), "peep", None).expect("bank");
        for each in &bank {
            assert_eq!(each.hints, ["se peepó"]);
            assert_eq!(each.verb_form, Some(VerbForm::Past));
            assert_eq!(each.also, ["peepish"], "listed again, the same");
        }
        assert_eq!(bank.len(), 2);
        // Whether it is good was settled: the clumsy one is still asked with.
        assert_eq!(bank.len(), 2);

        let again = stock(&desk, &chapter);
        assert_eq!((again.writes.len(), again.reviews), (0, 0));
    }

    #[test]
    fn what_the_code_refuses_is_kept_out_and_never_asked_about_again() {
        struct Careless;
        impl Model for Careless {
            fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten> {
                Ok(SentencesWritten {
                    words: vec![WrittenWord {
                        id: params.words[0].id.clone(),
                        written: Vec::new(),
                        // The hint gives the word away.
                        book: vec![BookGloss {
                            index: 0,
                            hint: "w00".into(),
                            translation: "libro".into(),
                        }],
                    }],
                })
            }

            fn review(&mut self, _: &SentenceReviewParams) -> Result<SentenceVerdicts> {
                panic!("nothing is kept to be looked at")
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        top_up(
            desk.ctx(),
            Scope::Chapter(&chapter),
            &mut Careless,
            &|_, _| {},
        )
        .expect("top up");
        assert_eq!(texts(&desk, "w00"), Vec::<String>::new());

        // The sentence is remembered: the word is not asked about again.
        let stub = stock(&desk, &chapter);
        assert_eq!(stub.writes.len(), 0);
    }

    #[test]
    fn a_hint_its_translation_does_not_have_is_refused_like_one_that_gives_the_word_away() {
        struct Apart;
        impl Model for Apart {
            fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten> {
                let mut written = Stub::default().write(params)?;
                for gloss in written.words.iter_mut().flat_map(|word| &mut word.book) {
                    // The form of the English word, not of the translation.
                    gloss.hint = "salvada".into();
                    gloss.translation = "Demasiado ancha para salvarse.".into();
                }
                Ok(written)
            }

            fn review(&mut self, _: &SentenceReviewParams) -> Result<SentenceVerdicts> {
                panic!("nothing is kept to be looked at")
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        top_up(desk.ctx(), Scope::Chapter(&chapter), &mut Apart, &|_, _| {}).expect("top up");
        assert_eq!(texts(&desk, "w00"), Vec::<String>::new());
        assert_eq!(stock(&desk, &chapter).writes.len(), 0);
    }

    /// A sentence as it was kept before a hint had to be words of its
    /// translation: the hint in the form of the English word.
    fn kept_apart(desk: &Desk, sentence: &str) -> Sentence {
        let conn = desk.db.lock().expect("db");
        let there = chapter_having(&conn, "peep");
        let new = NewSentence {
            key: "peep",
            chapter: there.as_deref(),
            book: true,
            sentence,
            form: "peeped",
            hint: "asomada",
            translation: "Demasiado alto para asomarse.",
        };
        bank::add(&conn, &new, Utc::now()).expect("add");
        // Written for before: what is asked here is something else.
        if let Some(chapter) = new.chapter {
            bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
        }
        let waiting = bank::unreviewed(&conn).expect("waiting").remove(0);
        let labels = Labels {
            also: vec!["peered".into()],
            hints: vec!["mirada".into()],
            verb_form: Some(VerbForm::PastParticiple),
            cue: Vec::new(),
            general: Vec::new(),
        };
        bank::review(&conn, &waiting.id, true, &labels).expect("review");
        waiting
    }

    #[test]
    fn a_sentence_kept_with_a_hint_its_translation_does_not_have_is_glossed_again() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = chapter_of(&desk, "He peeped at it.", &[peep()]);
        let old = kept_apart(&desk, "He peeped at it.");
        let shown = Shown {
            sentence_id: Some(&old.id),
            ..Shown::default()
        };
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        assert_eq!(asked.sentence_id.as_deref(), Some(old.id.as_str()));
        let asked_for = (asked.word_id.as_str(), asked.direction);
        answer_shown(desk.ctx(), &sitting.id, asked_for, ("nope", shown), t0()).expect("answer");

        let stub = stock(&desk, &chapter);
        assert_eq!((stub.writes.len(), stub.reviews), (1, 1));
        assert_eq!(stub.writes[0].words[0].book, ["He peeped at it."]);
        // The same sentence, with the answer given to it, and what it is
        // now said to be.
        let [new] = bank::bank(&desk.db.lock().expect("db"), "peep", None)
            .expect("bank")
            .try_into()
            .expect("one sentence");
        assert_eq!((&new.id, new.shows), (&old.id, 1));
        assert_eq!(
            (new.hint.as_str(), new.translation.as_str()),
            ("peepó", "peepó libro 0")
        );
        assert_eq!(new.also, ["peepedish"]);
        assert_eq!(new.hints, ["se peepó"]);
        assert_eq!(new.verb_form, Some(VerbForm::Past));

        // Once: its hint is words of its translation now.
        let again = stock(&desk, &chapter);
        assert_eq!((again.writes.len(), again.reviews), (0, 0));
    }

    #[test]
    fn a_translation_that_says_vosotros_is_refused() {
        struct Spain;
        impl Model for Spain {
            fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten> {
                let mut written = Stub::default().write(params)?;
                for gloss in written.words.iter_mut().flat_map(|word| &mut word.book) {
                    gloss.translation = format!("Vosotros sois {}", gloss.hint);
                }
                Ok(written)
            }

            fn review(&mut self, _: &SentenceReviewParams) -> Result<SentenceVerdicts> {
                panic!("nothing is kept to be looked at")
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        top_up(desk.ctx(), Scope::Chapter(&chapter), &mut Spain, &|_, _| {}).expect("top up");
        assert_eq!(texts(&desk, "w00"), Vec::<String>::new());
    }

    #[test]
    fn a_sentence_kept_with_a_translation_that_says_vosotros_is_glossed_again() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "You peeped at it.";
        let chapter = chapter_of(&desk, text, &[peep()]);
        let old = {
            let conn = desk.db.lock().expect("db");
            let there = chapter_having(&conn, "peep");
            let new = NewSentence {
                key: "peep",
                chapter: there.as_deref(),
                book: true,
                sentence: text,
                form: "peeped",
                hint: "asomasteis",
                translation: "Os asomasteis.",
            };
            bank::add(&conn, &new, Utc::now()).expect("add");
            // Written for before: what is asked here is something else.
            if let Some(chapter) = new.chapter {
                bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
            }
            let waiting = bank::unreviewed(&conn).expect("waiting").remove(0);
            bank::review(&conn, &waiting.id, true, &Labels::default()).expect("review");
            waiting
        };

        let stub = stock(&desk, &chapter);
        assert_eq!((stub.writes.len(), stub.reviews), (1, 1));
        let [new] = bank::bank(&desk.db.lock().expect("db"), "peep", None)
            .expect("bank")
            .try_into()
            .expect("one sentence");
        assert_eq!(new.id, old.id);
        assert_eq!(new.translation, "peepó libro 0");

        // Once: it says "ustedes" now.
        let again = stock(&desk, &chapter);
        assert_eq!((again.writes.len(), again.reviews), (0, 0));
    }

    #[test]
    fn a_hint_kept_with_a_tense_its_form_does_not_show_loses_it_without_the_model() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "I'd made a point of smoking.";
        let point = Word {
            forms: vec!["made a point of".into()],
            sentence: text.into(),
            ..word("make a point of", &["empeñarse en", "asegurarse de"], 1)
        };
        let chapter = chapter_of(&desk, text, &[point]);
        // As a chapter prepared before this was asked for kept it.
        {
            let conn = desk.db.lock().expect("db");
            let there = chapter_having(&conn, "make a point of");
            let new = NewSentence {
                key: "make a point of",
                chapter: there.as_deref(),
                book: true,
                sentence: text,
                form: "made a point of",
                hint: "me había empeñado en",
                translation: "Me había empeñado en fumar.",
            };
            bank::add(&conn, &new, Utc::now()).expect("add");
            // Written for before: what is asked here is something else.
            if let Some(chapter) = new.chapter {
                bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
            }
            let waiting = bank::unreviewed(&conn).expect("waiting").remove(0);
            let labels = Labels {
                also: Vec::new(),
                hints: vec!["me había asegurado de".into()],
                verb_form: Some(VerbForm::PastParticiple),
                cue: Vec::new(),
                general: Vec::new(),
            };
            bank::review(&conn, &waiting.id, true, &labels).expect("review");
        }

        let stub = stock(&desk, &chapter);
        assert_eq!((stub.writes.len(), stub.reviews), (0, 0));
        let [kept] = bank::bank(&desk.db.lock().expect("db"), "make a point of", None)
            .expect("bank")
            .try_into()
            .expect("one sentence");
        assert_eq!(kept.hint, "empeñado en");
        assert_eq!(kept.hints, ["asegurado de"]);
        assert_eq!(kept.translation, "Me había empeñado en fumar.");
        // Once.
        let conn = desk.db.lock().expect("db");
        assert_eq!(bank::unaid(&conn, "es").expect("unaid"), 0);
    }

    #[test]
    fn a_hint_kept_with_a_negation_its_form_does_not_show_loses_it_without_the_model() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "And poor, stupid Donut wouldn’t stand a chance out here in the cold.";
        let chance = Word {
            forms: vec!["stand a chance".into()],
            sentence: text.into(),
            ..word(
                "stand a chance",
                &["tener posibilidades", "tener alguna oportunidad"],
                1,
            )
        };
        let chapter = chapter_of(&desk, text, &[chance]);
        // As the chapter of the screenshot kept it, looked at and labelled.
        {
            let conn = desk.db.lock().expect("db");
            let there = chapter_having(&conn, "stand a chance");
            let new = NewSentence {
                key: "stand a chance",
                chapter: there.as_deref(),
                book: true,
                sentence: text,
                form: "stand a chance",
                hint: "tendría ninguna oportunidad",
                translation: "Y la pobre y tonta Donut no tendría ninguna oportunidad aquí fuera, con este frío.",
            };
            bank::add(&conn, &new, Utc::now()).expect("add");
            // Written for before: what is asked here is something else.
            if let Some(chapter) = new.chapter {
                bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
            }
            let waiting = bank::unreviewed(&conn).expect("waiting").remove(0);
            let labels = Labels {
                also: Vec::new(),
                hints: vec!["tendría posibilidades".into()],
                verb_form: Some(VerbForm::Base),
                cue: Vec::new(),
                general: Vec::new(),
            };
            bank::review(&conn, &waiting.id, true, &labels).expect("review");
        }

        let stub = stock(&desk, &chapter);
        // Nothing is glossed again for a hint its translation reads without "no".
        assert_eq!((stub.writes.len(), stub.reviews), (0, 0));
        let [kept] = bank::bank(&desk.db.lock().expect("db"), "stand a chance", None)
            .expect("bank")
            .try_into()
            .expect("one sentence");
        assert_eq!(kept.hint, "tendría una oportunidad");
        assert_eq!(kept.hints, ["tendría posibilidades"]);
        // Once.
        let conn = desk.db.lock().expect("db");
        assert_eq!(bank::unaid(&conn, "es").expect("unaid"), 0);
    }

    #[test]
    fn a_hint_loses_a_no_and_then_the_tense_behind_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let conn = desk.db.lock().expect("db");
        let there = chapter_having(&conn, "see");
        let new = NewSentence {
            key: "see",
            chapter: there.as_deref(),
            book: true,
            sentence: "He had not seen it.",
            form: "seen",
            hint: "no lo había visto",
            translation: "No lo había visto.",
        };
        bank::add(&conn, &new, Utc::now()).expect("add");
        // Written for before: what is asked here is something else.
        if let Some(chapter) = new.chapter {
            bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
        }
        let waiting = bank::unreviewed(&conn).expect("waiting").remove(0);
        let labels = Labels {
            also: Vec::new(),
            hints: vec!["no lo había notado".into()],
            verb_form: Some(VerbForm::PastParticiple),
            cue: Vec::new(),
            general: Vec::new(),
        };
        bank::review(&conn, &waiting.id, true, &labels).expect("review");
        assert_eq!(bank::unaid(&conn, "es").expect("unaid"), 1);
        let [kept] = bank::bank(&conn, "see", None)
            .expect("bank")
            .try_into()
            .expect("one sentence");
        assert_eq!(kept.hint, "visto");
        assert_eq!(kept.hints, ["notado"]);
    }

    #[test]
    fn a_hint_not_looked_at_keeps_the_negation_of_its_translation_until_it_is() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "And poor, stupid Donut wouldn’t stand a chance out here in the cold.";
        let conn = desk.db.lock().expect("db");
        let there = chapter_having(&conn, "stand a chance");
        let new = NewSentence {
            key: "stand a chance",
            chapter: there.as_deref(),
            book: true,
            sentence: text,
            form: "stand a chance",
            hint: "tendría ninguna oportunidad",
            translation: "Y la pobre y tonta Donut no tendría ninguna oportunidad aquí fuera.",
        };
        bank::add(&conn, &new, Utc::now()).expect("add");
        // Written for before: what is asked here is something else.
        if let Some(chapter) = new.chapter {
            bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
        }
        assert_eq!(bank::unaid(&conn, "es").expect("unaid"), 0);
        let waiting = bank::unreviewed(&conn).expect("waiting").remove(0);
        assert_eq!(waiting.hint, "tendría ninguna oportunidad");
    }

    #[test]
    fn one_that_cannot_be_glossed_well_is_not_asked_with_again_nor_glossed_twice() {
        struct Stubborn(Stub);
        impl Model for Stubborn {
            fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten> {
                let mut written = self.0.write(params)?;
                for gloss in written.words.iter_mut().flat_map(|word| &mut word.book) {
                    gloss.hint = "asomada".into();
                }
                Ok(written)
            }

            fn review(&mut self, _: &SentenceReviewParams) -> Result<SentenceVerdicts> {
                panic!("nothing new to look at")
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = chapter_of(&desk, "He peeped at it.", &[peep()]);
        kept_apart(&desk, "He peeped at it.");
        let mut model = Stubborn(Stub::default());
        top_up(desk.ctx(), Scope::Chapter(&chapter), &mut model, &|_, _| {}).expect("top up");
        assert_eq!(model.0.writes.len(), 1);
        assert_eq!(texts(&desk, "peep"), Vec::<String>::new());
        assert_eq!(stock(&desk, &chapter).writes.len(), 0);

        // Nor one the second look calls bad.
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = chapter_of(&desk, "A clumsy peeped one.", &[peep()]);
        kept_apart(&desk, "A clumsy peeped one.");
        let stub = stock(&desk, &chapter);
        assert_eq!((stub.writes.len(), stub.reviews), (1, 1));
        assert_eq!(texts(&desk, "peep"), Vec::<String>::new());
        assert_eq!(stock(&desk, &chapter).writes.len(), 0);
    }

    #[test]
    fn a_sentence_the_second_look_says_nothing_of_is_not_used() {
        struct Silent;
        impl Model for Silent {
            fn write(&mut self, params: &SentenceWriteParams) -> Result<SentencesWritten> {
                Stub::default().write(params)
            }

            fn review(&mut self, params: &SentenceReviewParams) -> Result<SentenceVerdicts> {
                assert_eq!(params.sentences.len(), 1);
                assert_eq!(params.sentences[0].meaning, ["w00es"]);
                Ok(SentenceVerdicts { verdicts: vec![] })
            }
        }

        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        top_up(
            desk.ctx(),
            Scope::Chapter(&chapter),
            &mut Silent,
            &|_, _| {},
        )
        .expect("top up");
        assert_eq!(texts(&desk, "w00"), Vec::<String>::new());
    }

    #[test]
    fn a_run_cut_short_is_gone_on_with_and_asks_nothing_twice() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(1));
        let mut stub = Stub {
            review_fails: 1,
            ..Stub::default()
        };
        let cut = top_up(desk.ctx(), Scope::Chapter(&chapter), &mut stub, &|_, _| {});
        assert!(matches!(cut, Err(Error::Provider(_))));
        // Glossed, not looked at: it cannot be asked with yet.
        assert_eq!(texts(&desk, "w00"), Vec::<String>::new());

        let next = stock(&desk, &chapter);
        assert_eq!((next.writes.len(), next.reviews), (0, 1));
        assert_eq!(texts(&desk, "w00").len(), 1);
    }

    #[test]
    fn a_known_word_gets_none_and_neither_does_a_word_of_a_conversation() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(2));
        {
            let conn = desk.db.lock().expect("db");
            let id = words::id_by_key(&conn, &chapter, "w00")
                .expect("id")
                .expect("word");
            words::set_known(&conn, &id, true, t0()).expect("known");
            let session =
                sessions::insert_session(&conn, &sessions::tests::setup(), t0()).expect("session");
            let item = VocabItem {
                asked: Some("relajarse".into()),
                english: "to wind down".into(),
                note: None,
            };
            sessions::insert_vocab(&conn, &session, &item, t0()).expect("vocab");
        }
        let stub = stock(&desk, &chapter);
        let asked: Vec<&str> = stub.writes[0]
            .words
            .iter()
            .map(|word| word.lemma.as_str())
            .collect();
        assert_eq!(asked, ["w01"]);

        // Nothing of the chapter is learned: the recall has the one word of
        // the conversation, and no book has a sentence for it.
        let mut stub = Stub::default();
        let given = top_up(desk.ctx(), Scope::Recall, &mut stub, &|_, _| {}).expect("top up");
        assert_eq!((given, stub.writes.len()), (0, 0));
    }

    // ── asking with the sentences ─────────────────────────────────────────

    use crate::books::vocab::Word;
    use crate::commands::dispute::dispute;
    use crate::commands::practice::tests::item;
    use crate::commands::practice::{answer_shown, discard, Shown};
    use crate::commands::recall;
    use crate::db::words::tests::word;
    use crate::domain::{
        AnswerResult, Direction, PracticeItem, PracticeStep, RecallStep, Sitting, Ways, WordHint,
    };
    use chrono::TimeDelta;

    /// "peep", which its chapter has as "peeped".
    fn peep() -> Word {
        Word {
            forms: vec!["peeped".into()],
            sentence: "She peeped in.".into(),
            ..word("peep", &["asomarse"], 1)
        }
    }

    /// The sentence an item is asked with.
    fn sentence_of(desk: &Desk, item: &PracticeItem) -> Sentence {
        let id = item.sentence_id.as_deref().expect("asked with a sentence");
        bank::usable(&desk.db.lock().expect("db"), id)
            .expect("bank")
            .expect("usable")
    }

    /// The text of a sentence, whether it can still be asked with or not.
    fn sentence_of_any(desk: &Desk, id: Option<&str>) -> String {
        let id = id.expect("asked with a sentence");
        desk.db
            .lock()
            .expect("db")
            .query_row(
                "SELECT sentence FROM word_sentences WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("sentence")
    }

    fn say(
        desk: &Desk,
        sitting: &Sitting,
        item: &PracticeItem,
        (text, second): (&str, bool),
    ) -> AnswerResult {
        let shown = Shown {
            sentence_id: item.sentence_id.as_deref(),
            second,
            hinted: false,
            rung: 0,
        };
        answer_shown(
            desk.ctx(),
            &sitting.id,
            (&item.word_id, item.direction),
            (text, shown),
            t0(),
        )
        .expect("answer")
    }

    fn answers(desk: &Desk) -> i64 {
        desk.count("SELECT COUNT(*) FROM word_answers")
    }

    /// A chapter with "peep" and a bank of several sentences, as one kept
    /// before a word was given one only, and a session on it.
    fn peeping(desk: &Desk) -> Sitting {
        let text = "Do not peep now. He peeped at it. They peep a lot.";
        let chapter = chapter_of(desk, text, &[peep()]);
        stock(desk, &chapter);
        let more = [
            ("Do not peep now.", "peep"),
            ("He peeped at it.", "peeped"),
            ("They peep a lot.", "peep"),
        ];
        old_bank(desk, "peep", &more);
        desk.start(&chapter, t0())
    }

    /// The first hint to a word a session is asking.
    fn first_hint(desk: &Desk, sitting: &Sitting, item: &PracticeItem) -> WordHint {
        crate::commands::practice::hint(
            desk.ctx(),
            &sitting.id,
            (&item.word_id, item.direction),
            (item.sentence_id.as_deref(), 0),
        )
        .expect("hint")
    }

    #[test]
    fn a_word_is_asked_as_it_is_called_beside_a_sentence_that_asks_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping(&desk);

        // English → native: the word as it is called, on its own, whatever
        // sentence was drawn. One that writes it so is the one beside it,
        // and it is the first hint, the word marked in it.
        let first = item(&sitting.step).clone();
        let beside = sentence_of(&desk, &first);
        assert_eq!(beside.form, "peep");
        assert_eq!(
            (first.direction, first.prompt.as_str()),
            (Direction::Recognition, "peep")
        );
        let clue = first_hint(&desk, &sitting, &first);
        assert_eq!((&first.context, &clue.mask), (&None, &None));
        let marked: Vec<&str> = clue
            .context
            .as_deref()
            .expect("in its sentence")
            .iter()
            .filter(|part| part.marked)
            .map(|part| part.text.as_str())
            .collect();
        assert_eq!(marked, ["peep"]);

        // What the word means is right at once. What its sentence says for
        // it is pointed out, never asked for; the sentence comes back whole,
        // with where it is from.
        let result = say(&desk, &sitting, &first, ("asomarse", false));
        assert!(result.correct && !result.helped && !result.again);
        assert_eq!(result.accepted, ["asomarse"]);
        assert_eq!(result.exact.as_deref(), Some("peepó"));
        let whole = result.sentence.expect("shown whole");
        assert_eq!(
            (whole.text.as_str(), whole.book),
            (beside.text.as_str(), true)
        );

        // Beside another sentence it is the same question, with the same
        // answer; what that sentence says for the word is no answer to it.
        let second = item(&result.step).clone();
        assert_ne!(second.sentence_id, first.sentence_id);
        assert_eq!(
            (second.direction, second.prompt.as_str()),
            (Direction::Recognition, "peep")
        );
        let result = say(&desk, &sitting, &second, ("Asomarse", false));
        assert!(result.correct && !result.helped);
        assert_eq!(result.accepted, ["asomarse"]);

        // Native → English: what the word means, and the sentence with a
        // blank once it is asked for. Any form its book writes is the word.
        let mut step = result.step;
        let mut right = 0;
        for form in ["peeped", "peep"] {
            let asked = item(&step).clone();
            assert_eq!(asked.direction, Direction::Production);
            assert_eq!(asked.prompt, "asomarse");
            assert_eq!(asked.context, None);
            let clue = first_hint(&desk, &sitting, &asked);
            let blanks = clue.context.as_deref().expect("blanked");
            assert!(blanks
                .iter()
                .any(|part| part.marked && part.text.is_empty()));
            assert!(!blanks.iter().any(|part| part.text.contains("peep")));

            let result = say(&desk, &sitting, &asked, (form, false));
            assert!(result.correct && !result.helped && !result.again);
            assert_eq!(result.accepted, ["peep"]);
            assert_eq!(result.exact, None);
            right += 1;
            step = result.step;
        }
        assert_eq!(right, 2);
        assert!(matches!(step, PracticeStep::Summary { .. }));
        // Every answer says which sentence it was given beside.
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM word_answers WHERE sentence_id IS NULL"),
            0
        );
    }

    #[test]
    fn the_wrong_form_twice_is_a_miss_and_a_form_nobody_knows_is_one_at_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        // "peeped", a word of its own, shown as "forzó": its base form is
        // the word in a form it is not asked for.
        let chapter = forced(&desk);
        let sitting = desk.start(&chapter, t0());
        let asked = asked_back(&desk, &sitting, sitting.step.clone(), &|_| {
            "forzó".to_owned()
        });
        assert_eq!(asked.prompt, "forzó");
        assert!(asked.sentence_id.is_some());
        assert!(say(&desk, &sitting, &asked, ("peep", false)).again);
        let missed = say(&desk, &sitting, &asked, ("peep", true));
        assert!(!missed.correct && !missed.again && !missed.helped);
        assert_eq!(missed.accepted, ["peeped"]);

        let asked = item(&missed.step).clone();
        let unknown = say(&desk, &sitting, &asked, ("peeping", false));
        assert!(!unknown.correct && !unknown.again);

        // A sentence that is not of the word's bank is refused.
        let asked = item(&unknown.step).clone();
        let stray = Shown {
            sentence_id: Some("none"),
            ..Shown::default()
        };
        let refused = answer_shown(
            desk.ctx(),
            &sitting.id,
            (&asked.word_id, asked.direction),
            ("peeped", stray),
            t0(),
        );
        assert!(matches!(refused, Err(Error::Invalid(_))));
    }

    #[test]
    fn a_word_is_asked_with_the_kind_of_word_it_is() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let verb = Word {
            part_of_speech: Some(PartOfSpeech::Verb),
            verb_form: Some(VerbForm::Present),
            ..peep()
        };
        let chapter = desk.chapter("b", &[verb]);

        // As its chapter has it, until it has a bank.
        let plain = item(&desk.start(&chapter, t0()).step).clone();
        assert_eq!(plain.sentence_id, None);
        assert_eq!(plain.part_of_speech, Some(PartOfSpeech::Verb));
        assert_eq!(plain.verb_form, Some(VerbForm::Present));

        // Beside a sentence of its bank it is the same kind of word in the
        // same form, its own: the form the second look says the sentence
        // has it in (a past, says the stub) is not the form it is asked in.
        stock(&desk, &chapter);
        let banked = item(&desk.start(&chapter, t0()).step).clone();
        assert!(banked.sentence_id.is_some());
        assert_eq!(banked.part_of_speech, Some(PartOfSpeech::Verb));
        assert_eq!(banked.verb_form, Some(VerbForm::Present));
        assert_eq!(banked.prompt, plain.prompt);
    }

    /// "peeped", a word of its own: the form its chapter has "peep" in.
    fn peeped() -> Word {
        Word {
            key: "peeped".into(),
            lemma: "peeped".into(),
            base: Some("peep".into()),
            verb_form: Some(VerbForm::Past),
            part_of_speech: Some(PartOfSpeech::Verb),
            translations: vec!["forzar".into()],
            ..peep()
        }
    }

    /// A chapter with "peeped", given the sentence of its book, its
    /// translation said in its form: "forzó".
    fn forced(desk: &Desk) -> String {
        let chapter = chapter_of(desk, "She peeped in.", &[peeped()]);
        stock(desk, &chapter);
        let conn = desk.db.lock().expect("db");
        let id = words::id_by_key(&conn, &chapter, "peeped").expect("id");
        let (asked, said) = (["forzar".to_owned()], ["forzó".to_owned()]);
        assert!(words::put_in_form(&conn, &id.expect("word"), &asked, &said).expect("put"));
        chapter
    }

    /// The word as it is asked native → English, once `right` was given
    /// to it English → native as often as the session asked.
    fn asked_back(
        desk: &Desk,
        sitting: &Sitting,
        mut step: PracticeStep,
        right: &dyn Fn(&PracticeItem) -> String,
    ) -> PracticeItem {
        while item(&step).direction == Direction::Recognition {
            let asked = item(&step).clone();
            let said = say(desk, sitting, &asked, (&right(&asked), true));
            assert!(said.correct);
            step = said.step;
        }
        item(&step).clone()
    }

    #[test]
    fn a_form_of_a_verb_that_is_a_word_of_its_own_is_asked_as_that_form() {
        // With no sentence of its bank it is the form its chapter has, said
        // to be that form, and its translation is right in any form.
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = chapter_of(&desk, "She peeped in.", &[peeped()]);
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        assert_eq!(asked.direction, Direction::Recognition);
        assert_eq!(asked.prompt, "peeped");
        assert_eq!(asked.sentence_id, None);
        assert_eq!(asked.verb_form, Some(VerbForm::Past));
        let right = say(&desk, &sitting, &asked, ("forzado", false));
        assert!(right.correct && !right.again);
        let alone = right.accepted.clone();
        // Asked for in English while nobody said its translation in its
        // form, it is shown as its base form: that is the word too.
        let back = asked_back(&desk, &sitting, right.step, &|_| "forzado".to_owned());
        assert_eq!(back.verb_form, Some(VerbForm::Past));
        assert!(say(&desk, &sitting, &back, ("peep", false)).correct);

        // Beside a sentence it is the same question with the same answer.
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = chapter_of(&desk, "She peeped in.", &[peeped()]);
        stock(&desk, &chapter);
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        assert_eq!(asked.prompt, "peeped");
        assert!(asked.sentence_id.is_some());
        assert_eq!(asked.verb_form, Some(VerbForm::Past));
        let right = say(&desk, &sitting, &asked, ("forzado", false));
        assert!(right.correct && !right.again);
        assert_eq!(right.accepted, alone);

        // Shown in its form, its base form is the word in a form it is not
        // asked for: no other word, and no miss.
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = forced(&desk);
        let sitting = desk.start(&chapter, t0());
        let back = asked_back(&desk, &sitting, sitting.step.clone(), &|_| {
            "forzó".to_owned()
        });
        assert_eq!(back.prompt, "forzó");
        let before = answers(&desk);
        let told = say(&desk, &sitting, &back, ("peep", false));
        assert!(told.again && told.another.is_none());
        assert_eq!(answers(&desk), before);
        // The model would take it for right: it is not asked.
        let missed = say(&desk, &sitting, &back, ("peep", true));
        assert!(!missed.correct && !missed.again);
        let refused = dispute(
            desk.ctx(),
            missed.answer_id,
            &mut |_| panic!("the model is not asked"),
            t0(),
        );
        assert!(matches!(refused, Err(Error::Invalid(_))));
    }

    #[test]
    fn a_base_translation_missed_for_the_form_the_word_is_called_by_is_never_upheld() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = forced(&desk);
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        assert_eq!(asked.prompt, "peeped");
        assert!(asked.sentence_id.is_some());
        // "peeped" is "forzó": its infinitive is the word in another form.
        assert!(say(&desk, &sitting, &asked, ("forzar", false)).again);
        let missed = say(&desk, &sitting, &asked, ("Forzar", true));
        assert!(!missed.correct && !missed.again);
        assert_eq!(missed.accepted, ["forzó"]);
        // The model would take the base form for right: it is not asked.
        let refused = dispute(
            desk.ctx(),
            missed.answer_id,
            &mut |_| panic!("the model is not asked"),
            t0(),
        );
        assert!(matches!(refused, Err(Error::Invalid(_))));
    }

    #[test]
    fn a_verb_is_held_to_the_form_it_is_called_by_whatever_form_its_sentence_gives_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let verb = Word {
            part_of_speech: Some(PartOfSpeech::Verb),
            ..peep()
        };
        let chapter = chapter_of(&desk, "She peeped in.", &[verb]);
        stock(&desk, &chapter);
        desk.db
            .lock()
            .expect("db")
            .execute(
                "UPDATE word_sentences SET hint = 'asomándose', hints = NULL",
                [],
            )
            .expect("a gerund");
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        assert_eq!(
            (asked.direction, asked.prompt.as_str()),
            (Direction::Recognition, "peep")
        );

        // "peep" is "asomarse": the gerund its sentence has is the word in
        // another form, as any other form of it is. No answer yet, then a
        // miss that is not to stand by.
        assert!(say(&desk, &sitting, &asked, ("asomándose", false)).again);
        assert_eq!(answers(&desk), 0);
        let missed = say(&desk, &sitting, &asked, ("asomándose", true));
        assert!(!missed.correct && !missed.again);
        assert_eq!(missed.accepted, ["asomarse"]);
        assert_eq!(missed.exact.as_deref(), Some("asomándose"));
        let refused = dispute(
            desk.ctx(),
            missed.answer_id,
            &mut |_| panic!("the model is not asked"),
            t0(),
        );
        assert!(matches!(refused, Err(Error::Invalid(_))));
        assert!(say(&desk, &sitting, &asked, ("Asomarse", true)).correct);
    }

    #[test]
    fn only_a_word_its_chapter_calls_a_verb_has_a_form() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        // The second look labels a form, and the chapter says no verb.
        let chapter = desk.chapter("b", &[peep()]);
        stock(&desk, &chapter);
        let banked = item(&desk.start(&chapter, t0()).step).clone();
        assert!(banked.sentence_id.is_some());
        assert_eq!(banked.verb_form, None);
    }

    /// "lichen-like", with the three sentences a learner met it beside:
    /// each says it another way in the learner's language.
    fn lichen(desk: &Desk) -> (String, Vec<Sentence>) {
        let own = "Green, lichen-like growths glowed on the brick walls.";
        let adjective = Word {
            part_of_speech: Some(PartOfSpeech::Adjective),
            sentence: own.into(),
            ..word("lichen-like", &["parecido al liquen", "como de liquen"], 1)
        };
        let chapter = chapter_of(desk, own, &[adjective]);
        let conn = desk.db.lock().expect("db");
        let said = [
            (
                own,
                "parecidas al liquen",
                "Unas formaciones verdes parecidas al liquen brillaban en las paredes.",
            ),
            (
                "The cave floor had lichen-like patches that glowed faintly.",
                "similares al liquen",
                "El suelo de la cueva tenía manchas similares al liquen.",
            ),
            (
                "The lichen-like growth spread across the window.",
                "parecida al liquen",
                "La formación parecida al liquen se extendió por la ventana.",
            ),
        ];
        for (sentence, hint, translation) in said {
            let new = NewSentence {
                key: "lichen like",
                chapter: Some(&chapter),
                book: sentence == own,
                sentence,
                form: "lichen-like",
                hint,
                translation,
            };
            bank::add(&conn, &new, Utc::now()).expect("add");
        }
        for waiting in bank::unreviewed(&conn).expect("waiting") {
            bank::review(&conn, &waiting.id, true, &Labels::default()).expect("review");
        }
        let id = words::id_by_key(&conn, &chapter, "lichen like")
            .expect("id")
            .expect("word");
        let held = bank::bank(&conn, "lichen like", Some(&chapter)).expect("bank");
        assert_eq!(held.len(), 3);
        (id, held)
    }

    #[test]
    fn a_card_takes_the_same_answer_whatever_sentence_it_was_drawn_with() {
        use crate::books::sentences::Verdict;
        use crate::books::spelling::Spelling;
        use crate::commands::practice::{asked_with, by_word};
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let (id, held) = lichen(&desk);
        let conn = desk.db.lock().expect("db");
        let there = Direction::Recognition;
        let judged = |answer: &str| -> Vec<Verdict> {
            let row = practice::word(&conn, &id).expect("word");
            held.iter()
                .map(|each| {
                    let how = ("es", Spelling::Lenient);
                    by_word(&conn, &row, Some(each), (there, answer), how)
                        .expect("judged")
                        .verdict
                })
                .collect()
        };
        let row = practice::word(&conn, &id).expect("word");
        for each in &held {
            // What the learner sees says nothing of the sentence drawn.
            let asked = asked_with(("w".into(), &row), each, there);
            assert_eq!(asked.prompt, "lichen-like");
            assert_eq!((&asked.context, &asked.native_context), (&None, &None));
            // What is asked for is what the word means, the same each time;
            // how the sentence says it is only pointed out.
            let how = ("es", Spelling::Lenient);
            let said = by_word(&conn, &row, Some(each), (there, ""), how).expect("judged");
            assert_eq!(said.accepted, ["parecido al liquen", "como de liquen"]);
            assert_eq!(said.exact.as_deref(), Some(each.hint.as_str()));
        }
        // English says no gender and no number: either is the word.
        assert_eq!(judged("parecida al liquen"), [Verdict::Right; 3]);
        assert_eq!(judged("parecidos al liquen"), [Verdict::Right; 3]);
        // What only one sentence says is right beside none of them, not
        // beside that one alone.
        assert_eq!(judged("similares al liquen"), [Verdict::Miss; 3]);
        // Once it is what the word means, it is right beside all of them.
        assert!(crate::db::senses::add(&conn, &id, "similar al liquen").expect("add"));
        assert_eq!(judged("similares al liquen"), [Verdict::Right; 3]);
        let row = practice::word(&conn, &id).expect("word");
        assert_eq!(row.listed(), ["parecido al liquen", "como de liquen"]);
    }

    #[test]
    fn a_reflexive_pronoun_counts_for_nothing_towards_english() {
        use crate::books::spelling::Spelling;
        use crate::commands::practice::plain;
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let own = Word {
            forms: vec!["distanced himself".into()],
            sentence: "He distanced himself from them.".into(),
            ..word("distance oneself", &["distanciarse"], 1)
        };
        let bare = Word {
            forms: vec!["withdrew".into()],
            sentence: "She withdrew from them.".into(),
            ..word("withdraw", &["retirarse"], 1)
        };
        let chapter = desk.chapter("b", &[own, bare]);
        let conn = desk.db.lock().expect("db");
        let right = |key: &str, answer: &str| {
            let id = words::id_by_key(&conn, &chapter, key)
                .expect("id")
                .expect("word");
            let row = practice::word(&conn, &id).expect("word");
            let how = ("es", Spelling::Lenient);
            plain(&conn, &row, (Direction::Production, answer), how)
                .expect("judged")
                .is_right()
        };
        // What was shown does not say which pronoun the word is written
        // with, nor whether it has one.
        assert!(right("distance oneself", "distanced himself"));
        assert!(right("distance oneself", "distanced herself"));
        assert!(right("distance oneself", "distanced"));
        assert!(right("withdraw", "withdrew herself"));
        assert!(right("withdraw", "withdraw"));
        assert!(!right("withdraw", "distanced herself"));
        assert!(!right("distance oneself", "himself"));
    }

    #[test]
    fn a_hint_gives_the_answer_letter_by_letter_and_the_answer_is_helped() {
        use crate::commands::practice::hint;
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);

        // Asked on its own: the first hint is the sentence of its chapter,
        // and it stays with the ones that give the answer.
        let chapter = desk.chapter("plain", &[peep()]);
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        assert_eq!(
            (asked.direction, &asked.context),
            (Direction::Recognition, &None)
        );
        let ask = |before| {
            hint(
                desk.ctx(),
                &sitting.id,
                (&asked.word_id, asked.direction),
                (None, before),
            )
            .expect("hint")
        };
        let marked = |given: &WordHint| -> Vec<String> {
            given
                .context
                .as_deref()
                .expect("the sentence of its chapter")
                .iter()
                .filter(|part| part.marked)
                .map(|part| part.text.clone())
                .collect()
        };
        let first = ask(0);
        assert_eq!((first.mask.as_deref(), first.more), (None, true));
        assert_eq!(marked(&first), ["peeped"]);
        let length = ask(1);
        assert_eq!(
            (length.mask.as_deref(), length.more),
            (Some("________"), true)
        );
        assert_eq!(marked(&length), ["peeped"]);
        assert_eq!(ask(3).mask.as_deref(), Some("as______"));
        let last = ask(99);
        assert_eq!((last.mask.as_deref(), last.more), (Some("asomars_"), false));

        // Nothing was kept; the answer says it came with a hint.
        assert_eq!(answers(&desk), 0);
        let shown = Shown {
            hinted: true,
            ..Shown::default()
        };
        let asked_for = (asked.word_id.as_str(), asked.direction);
        let right = answer_shown(
            desk.ctx(),
            &sitting.id,
            asked_for,
            ("asomarse", shown),
            t0(),
        )
        .expect("answer");
        assert!(right.correct && right.helped);
        let next = item(&right.step).clone();
        let asked_for = (next.word_id.as_str(), next.direction);
        let missed = answer_shown(desk.ctx(), &sitting.id, asked_for, ("nope", shown), t0())
            .expect("answer");
        assert!(!missed.correct && !missed.helped);

        // A word of another chapter is not being asked.
        let other = desk.chapter("other", &numbered(1));
        let stray = item(&desk.start(&other, t0()).step).word_id.clone();
        let refused = hint(
            desk.ctx(),
            &sitting.id,
            (&stray, Direction::Recognition),
            (None, 0),
        );
        assert!(matches!(refused, Err(Error::Invalid(_))));
    }

    #[test]
    fn a_hint_to_a_word_beside_a_sentence_is_to_the_word_as_it_is_asked() {
        use crate::commands::practice::hint;
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping(&desk);
        let mut step = sitting.step.clone();
        // English -> native: what the word means, not what its sentence
        // says for it ("peepó").
        let asked = item(&step).clone();
        let given = hint(
            desk.ctx(),
            &sitting.id,
            (&asked.word_id, asked.direction),
            (asked.sentence_id.as_deref(), 2),
        )
        .expect("hint");
        assert_eq!(given.mask.as_deref(), Some("a_______"));
        for _ in 0..2 {
            let asked = item(&step).clone();
            step = say(&desk, &sitting, &asked, ("asomarse", false)).step;
        }
        // Native -> English: the word as it is called, which is what the
        // sentence beside it has.
        let asked = item(&step).clone();
        assert_eq!(asked.direction, Direction::Production);
        let sentence = sentence_of(&desk, &asked);
        assert_eq!(sentence.form, "peep");
        let given = hint(
            desk.ctx(),
            &sitting.id,
            (&asked.word_id, asked.direction),
            (asked.sentence_id.as_deref(), 1),
        )
        .expect("hint");
        assert_eq!(given.mask.as_deref(), Some("____"));
    }

    #[test]
    fn a_word_and_what_it_means_are_shown_in_small_letters() {
        use crate::commands::practice::hint;
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "Peeped in, she had.";
        // As the model wrote them: with a capital.
        let capital = Word {
            lemma: "Peep".into(),
            translations: vec!["Asomarse".into()],
            ..peep()
        };
        let chapter = chapter_of(&desk, text, &[capital]);
        {
            let conn = desk.db.lock().expect("db");
            let there = chapter_having(&conn, "peep");
            let new = NewSentence {
                key: "peep",
                chapter: there.as_deref(),
                book: true,
                sentence: text,
                form: "Peeped",
                hint: "Asomó",
                translation: "Asomó, eso hizo.",
            };
            bank::add(&conn, &new, Utc::now()).expect("add");
            // Written for before: what is asked here is something else.
            if let Some(chapter) = new.chapter {
                bank::wrote(&conn, new.key, chapter, Utc::now()).expect("wrote");
            }
            for waiting in bank::unreviewed(&conn).expect("waiting") {
                bank::review(&conn, &waiting.id, true, &Labels::default()).expect("review");
            }
        }
        let sitting = desk.start(&chapter, t0());
        let letter = |asked: &PracticeItem| {
            hint(
                desk.ctx(),
                &sitting.id,
                (&asked.word_id, asked.direction),
                (asked.sentence_id.as_deref(), 2),
            )
            .expect("hint")
            .mask
        };

        // English → native: the word, what it means, and what its sentence
        // says for it.
        let mut asked = item(&sitting.step).clone();
        assert_eq!(
            (asked.direction, asked.prompt.as_str()),
            (Direction::Recognition, "peep")
        );
        assert!(asked.sentence_id.is_some());
        assert_eq!(letter(&asked).as_deref(), Some("a_______"));
        while asked.direction == Direction::Recognition {
            let told = say(&desk, &sitting, &asked, ("ASOMARSE", false));
            assert!(told.correct);
            assert_eq!(told.accepted, ["asomarse"]);
            assert_eq!(told.exact.as_deref(), Some("asomó"));
            asked = item(&told.step).clone();
        }

        // Native → English: what it means, and the word a miss shows.
        assert_eq!(asked.prompt, "asomarse");
        assert_eq!(letter(&asked).as_deref(), Some("p_____"));
        let missed = say(&desk, &sitting, &asked, ("nope", false));
        assert_eq!(missed.accepted, ["peep"]);
    }

    #[test]
    fn a_word_that_needs_its_sentence_shows_it_and_its_hint_is_the_answer() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let text = "Do not peep now. He peeped at it. They peep a lot.";
        let ambiguous = Word {
            needs_context: true,
            ..peep()
        };
        let chapter = chapter_of(&desk, text, &[ambiguous]);
        stock(&desk, &chapter);
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        assert!(asked.sentence_id.is_some());
        let marked: Vec<&str> = asked
            .context
            .as_deref()
            .expect("shown from the start")
            .iter()
            .filter(|part| part.marked)
            .map(|part| part.text.as_str())
            .collect();
        assert_eq!(marked, ["peeped"]);
        // Nothing to add to it: the first hint is how long the answer is.
        let clue = first_hint(&desk, &sitting, &asked);
        assert_eq!(
            (clue.mask.as_deref(), clue.context),
            (Some("________"), None)
        );
    }

    #[test]
    fn a_sentence_called_bad_is_gone_and_its_answer_with_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping(&desk);
        let asked = item(&sitting.step).clone();
        let missed = say(&desk, &sitting, &asked, ("nope", false));
        assert!(!missed.correct);
        assert_eq!(answers(&desk), 1);

        let step = discard(desk.ctx(), missed.answer_id, t0()).expect("discard");
        assert_eq!(answers(&desk), 0);
        let next = item(&step).clone();
        assert_eq!(next.direction, Direction::Recognition);
        assert_ne!(next.sentence_id, asked.sentence_id);
        let gone = sentence_of_any(&desk, asked.sentence_id.as_deref());
        assert!(!texts(&desk, "peep").contains(&gone));
        // Taken back once: there is no such answer any more.
        assert!(discard(desk.ctx(), missed.answer_id, t0()).is_err());

        // Only the last answer of a session can be taken back.
        let one = say(&desk, &sitting, &next, ("asomarse", false));
        let two = say(&desk, &sitting, item(&one.step), ("asomarse", false));
        assert!(matches!(
            discard(desk.ctx(), one.answer_id, t0()),
            Err(Error::Invalid(_))
        ));
        discard(desk.ctx(), two.answer_id, t0()).expect("the last one");
    }

    #[test]
    fn i_was_right_is_judged_on_the_sentence_that_was_shown() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping(&desk);
        // Past the sentence of the chapter, to one the model wrote.
        let first = item(&sitting.step).clone();
        let missed = say(&desk, &sitting, &first, ("nope", false));
        let step = discard(desk.ctx(), missed.answer_id, t0()).expect("discard");
        let asked = item(&step).clone();
        let shown = sentence_of(&desk, &asked);
        assert_ne!(shown.text, "She peeped in.");
        let missed = say(&desk, &sitting, &asked, ("mirar", false));
        let mut heard = None;
        dispute(
            desk.ctx(),
            missed.answer_id,
            &mut |params| {
                // The word is the form the learner saw, not its base form.
                assert_eq!((&params.lemma, &params.blank), (&asked.prompt, &None));
                heard = Some((params.sentence.clone(), params.lemma.clone()));
                Ok(crate::agent::protocol::VocabVerdict {
                    correct: false,
                    reason: "no".into(),
                })
            },
            t0(),
        )
        .expect("dispute");
        assert_eq!(heard, Some((shown.text, shown.form)));
    }

    #[test]
    fn the_recall_asks_a_learned_word_in_its_sentences_too() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping(&desk);
        let mut step = sitting.step.clone();
        while let PracticeStep::Item { item: asked, .. } = step.clone() {
            let right = match asked.direction {
                Direction::Recognition => "asomarse",
                Direction::Production => "peep",
            };
            step = say(&desk, &sitting, &asked, (right, false)).step;
        }
        let later = t0() + TimeDelta::days(1);
        let run = recall::start(desk.ctx(), Ways::Production, later).expect("start");
        let RecallStep::Item { item: asked, .. } = run.step.clone() else {
            panic!("a word is due")
        };
        let sentence = sentence_of(&desk, &asked);
        // What the word means, not what the sentence drawn says for it.
        assert_eq!(
            (asked.word_id.as_str(), asked.prompt.as_str()),
            ("peep", "asomarse")
        );
        assert_eq!(sentence.form, "peep");
        // A hint is to the word, and keeps nothing. Its sentence first,
        // the word taken out; then the word.
        assert_eq!(asked.context, None);
        let ask = |before| {
            let shown = (asked.sentence_id.as_deref(), before);
            recall::hint(desk.ctx(), &run.id, "peep", shown, later).expect("hint")
        };
        let first = ask(0);
        assert!(first.mask.is_none() && first.context.is_some());
        let given = ask(2).mask.expect("a letter");
        assert_eq!(given.chars().count(), sentence.form.chars().count());
        assert!(given.starts_with('p') && given.ends_with('_'));
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_events"), 0);

        let say = |text: &str, second: bool| {
            let shown = Shown {
                sentence_id: asked.sentence_id.as_deref(),
                second,
                hinted: false,
                rung: 0,
            };
            recall::answer_shown(desk.ctx(), &run.id, "peep", (text, shown), later).expect("answer")
        };
        let missed = say("nope", true);
        assert!(!missed.correct);
        assert_eq!(
            missed.sentence.as_ref().map(|whole| whole.text.as_str()),
            Some(sentence.text.as_str())
        );

        // Called bad: the miss is gone and the word is due again, with
        // another sentence.
        let step = recall::discard(desk.ctx(), &run.id, missed.answer_id, later).expect("discard");
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_events"), 0);
        let RecallStep::Item { item: next, .. } = step else {
            panic!("due again")
        };
        assert_ne!(next.sentence_id, asked.sentence_id);
        assert!(recall::discard(desk.ctx(), &run.id, missed.answer_id, later).is_err());
    }

    #[test]
    fn a_synonym_upheld_beside_a_sentence_is_right_for_the_word_from_then_on() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping(&desk);
        let mut step = sitting.step.clone();
        for _ in 0..2 {
            let asked = item(&step).clone();
            step = say(&desk, &sitting, &asked, ("asomarse", false)).step;
        }

        // A synonym, upheld: the judge was told of no blank, the sentence
        // asked nothing.
        let asked = item(&step).clone();
        assert_eq!(asked.direction, Direction::Production);
        assert!(asked.sentence_id.is_some());
        let missed = say(&desk, &sitting, &asked, ("looked", false));
        assert!(!missed.correct);
        let mut blank = Some("unset".to_owned());
        let upheld = dispute(
            desk.ctx(),
            missed.answer_id,
            &mut |params| {
                blank.clone_from(&params.blank);
                Ok(crate::agent::protocol::VocabVerdict {
                    correct: true,
                    reason: "ok".into(),
                })
            },
            t0(),
        )
        .expect("dispute");
        assert!(upheld.upheld);
        assert_eq!(blank, None);

        // The same card takes it from now on, whatever sentence is drawn.
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_english"), 1);
        let asked = item(&upheld.step).clone();
        assert_eq!(asked.direction, Direction::Production);
        assert!(say(&desk, &sitting, &asked, ("looked", false)).correct);
    }

    /// A chapter whose one word, "peep", has the one sentence of its book,
    /// labelled by the stub, and a session on it.
    fn peeping_once(desk: &Desk) -> Sitting {
        let chapter = chapter_of(desk, "She peeped in.", &[peep()]);
        stock(desk, &chapter);
        desk.start(&chapter, t0())
    }

    /// Whether the sentence of a hint has its word taken out.
    fn blanked(given: &WordHint) -> bool {
        given
            .context
            .as_deref()
            .is_some_and(|parts| parts.iter().any(|part| part.marked && part.text.is_empty()))
    }

    #[test]
    fn another_word_for_the_hint_is_no_miss_and_comes_back_with_what_tells_them_apart() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping_once(&desk);
        let mut step = sitting.step.clone();
        for _ in 0..2 {
            let asked = item(&step).clone();
            step = say(&desk, &sitting, &asked, ("asomarse", false)).step;
        }
        let asked = item(&step).clone();
        assert_eq!(
            (asked.direction, &asked.context),
            (Direction::Production, &None)
        );
        assert_eq!(asked.prompt, "asomarse");
        let other = rival(&sentence_of(&desk, &asked).form);
        let before = answers(&desk);

        // Right for the hint that was shown, and not the word: nothing is
        // kept, and the sentence comes with the first letter of the word.
        let told = say(&desk, &sitting, &asked, (&format!("The {other}"), false));
        assert!(told.again && !told.correct);
        assert_eq!(answers(&desk), before);
        let another = told.another.expect("another word");
        assert_eq!(another.asked, 2);
        assert_eq!(another.hint.mask.as_deref(), Some("p_____"));
        assert!(blanked(&another.hint) && another.hint.more);
        // It is the hint after two others: the next gives one more letter.
        let next = crate::commands::practice::hint(
            desk.ctx(),
            &sitting.id,
            (&asked.word_id, asked.direction),
            (asked.sentence_id.as_deref(), 3),
        )
        .expect("hint");
        assert_eq!(next.mask.as_deref(), Some("pe____"));

        // Told once, the same word again is a miss, and not one to stand
        // by: the model would take a word that means the same for right.
        let missed = say(&desk, &sitting, &asked, (&other, true));
        assert!(!missed.correct && !missed.again);
        assert_eq!(missed.another, None);
        assert_eq!(answers(&desk), before + 1);
        let unasked =
            &mut |_: &crate::agent::protocol::VocabJudgeParams| panic!("the model is not asked");
        let refused = dispute(desk.ctx(), missed.answer_id, unasked, t0());
        assert!(matches!(refused, Err(Error::Invalid(_))));

        // The word, on the second try: right, and helped.
        let asked = item(&missed.step).clone();
        assert!(say(&desk, &sitting, &asked, (&other, false)).again);
        let right = say(&desk, &sitting, &asked, ("peeped", true));
        assert!(right.correct && right.helped);
    }

    #[test]
    fn another_word_the_learner_has_for_the_same_translation_is_no_miss_either() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        // No sentence was given to either: only the words themselves say
        // that "idea" is shown the way "notion" is.
        let idea = Word {
            forms: vec!["idea".into(), "ideas".into()],
            ..word("idea", &["idea"], 1)
        };
        let list = [word("notion", &["noción", "idea"], 2), idea, peep()];
        let chapter = desk.chapter("b", &list);
        let plan = (None, Ways::Production);
        let sitting =
            crate::commands::practice::start(desk.ctx(), &chapter, plan, t0()).expect("start");
        let id = words::id_by_key(&desk.db.lock().expect("db"), &chapter, "notion")
            .expect("id")
            .expect("word");
        let say = |text: &str, second: bool| {
            let shown = Shown {
                second,
                ..Shown::default()
            };
            let asked = (id.as_str(), Direction::Production);
            answer_shown(desk.ctx(), &sitting.id, asked, (text, shown), t0()).expect("answer")
        };

        let told = say("Ideas", false);
        assert!(told.again);
        assert_eq!(answers(&desk), 0);
        let another = told.another.expect("another word");
        assert_eq!(another.hint.mask.as_deref(), Some("n_____"));
        assert!(blanked(&another.hint));

        // Typed again it is a miss that is not to stand by: upheld, "idea"
        // would be "notion" from then on.
        let missed = say("ideas", true);
        assert!(!missed.correct && !missed.again);
        let unasked =
            &mut |_: &crate::agent::protocol::VocabJudgeParams| panic!("the model is not asked");
        let refused = dispute(desk.ctx(), missed.answer_id, unasked, t0());
        assert!(matches!(refused, Err(Error::Invalid(_))));
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_english"), 0);

        // A word that shares no translation with it is a miss at once.
        let missed = say("peep", false);
        assert!(!missed.correct && !missed.again);
        // And the word itself is right, as ever.
        assert!(say("a notion", false).correct);
        // Asked the other way, "idea" is its own word: "notion" is not it.
        let idea = words::id_by_key(&desk.db.lock().expect("db"), &chapter, "idea")
            .expect("id")
            .expect("word");
        let shown = ("notion", Shown::default());
        let asked = (idea.as_str(), Direction::Production);
        let told = answer_shown(desk.ctx(), &sitting.id, asked, shown, t0()).expect("answer");
        assert!(told.again && told.another.is_some());
    }

    #[test]
    fn the_recall_takes_another_word_for_the_hint_as_no_miss_too() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let sitting = peeping_once(&desk);
        let mut step = sitting.step.clone();
        while let PracticeStep::Item { item: asked, .. } = step.clone() {
            let right = match asked.direction {
                Direction::Recognition => "asomarse",
                Direction::Production => "peep",
            };
            step = say(&desk, &sitting, &asked, (right, false)).step;
        }
        let later = t0() + TimeDelta::days(1);
        let run = recall::start(desk.ctx(), Ways::Production, later).expect("start");
        let RecallStep::Item { item: asked, .. } = run.step.clone() else {
            panic!("a word is due")
        };
        let other = rival(&sentence_of(&desk, &asked).form);
        let say = |text: &str, second: bool| {
            let shown = Shown {
                sentence_id: asked.sentence_id.as_deref(),
                second,
                hinted: false,
                rung: 0,
            };
            recall::answer_shown(desk.ctx(), &run.id, "peep", (text, shown), later).expect("answer")
        };

        let told = say(&other, false);
        assert!(told.again);
        let another = told.another.expect("another word");
        assert_eq!(
            (another.asked, another.hint.mask.as_deref()),
            (2, Some("p_____"))
        );
        assert!(blanked(&another.hint));
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_events"), 0);

        let right = say("peeped", true);
        assert!(right.correct && right.helped);
        assert_eq!(right.another, None);
    }

    // ── a word's sense is its chapter's ───────────────────────────────────

    /// "fuzzy" as a book about a cat has it.
    fn furry() -> Word {
        Word {
            sentence: "The fuzzy cat slept.".into(),
            ..word("fuzzy", &["peludo"], 1)
        }
    }

    /// "fuzzy" as a book about a picture has it.
    fn blurred() -> Word {
        Word {
            sentence: "The picture was fuzzy.".into(),
            ..word("fuzzy", &["difuso"], 1)
        }
    }

    /// "fuzzy", blurred, labelled another kind of word than "fuzzy", furry:
    /// its tag tells the two apart.
    fn blurring() -> Word {
        Word {
            part_of_speech: Some(PartOfSpeech::Noun),
            ..blurred()
        }
    }

    /// "fuzzy" of the cat book called an adjective: furry, told apart by its
    /// tag from "fuzzy", to blur.
    fn furry_is_an_adjective(desk: &Desk) {
        desk.db
            .lock()
            .expect("db")
            .execute(
                "UPDATE chapter_words SET part_of_speech = 'adjective'
                 WHERE key = 'fuzzy' AND part_of_speech IS NULL",
                [],
            )
            .expect("kind");
    }

    /// A book about a cat whose second chapter has "fuzzy" too, unprepared,
    /// and one about a picture: its chapters, [cat 1, cat 2, picture].
    fn two_books(desk: &Desk, picture: &Word) -> [String; 3] {
        let conn = desk.db.lock().expect("db");
        let cat = words::tests::book(
            &conn,
            "cat",
            &["The fuzzy cat slept.", "A fuzzy dog barked."],
        );
        let other = words::tests::book(&conn, "picture", &["The picture was fuzzy."]);
        let depth = crate::domain::Depth::Most;
        words::finish(&conn, &cat[0], depth, &[furry()], t0()).expect("words");
        words::finish(&conn, &other[0], depth, std::slice::from_ref(picture), t0()).expect("words");
        [cat[0].clone(), cat[1].clone(), other[0].clone()]
    }

    /// The sentences "fuzzy" can be asked with in a chapter.
    fn fuzzy_in(desk: &Desk, chapter: &str) -> Vec<Sentence> {
        bank::bank(&desk.db.lock().expect("db"), "fuzzy", Some(chapter)).expect("bank")
    }

    #[test]
    fn a_chapter_gives_its_word_sentences_of_its_own_and_of_no_other() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let [cat, _, picture] = two_books(&desk, &blurred());
        let stub = stock(&desk, &cat);
        // Not the second chapter of the same book: it may mean another thing.
        assert_eq!(stub.writes[0].words[0].book, ["The fuzzy cat slept."]);
        // A word given a sentence in one book is still given one in another:
        // its rival in the picture's chapter was read with it.
        assert_eq!(stub.writes[0].words.len(), 2);
        // Its book's sentence is never read again from the other chapter.
        assert!(stock(&desk, &picture)
            .writes
            .iter()
            .flat_map(|each| each.words.iter())
            .all(|each| each.book.is_empty()));
        let texts = |chapter: &str| -> Vec<String> {
            fuzzy_in(&desk, chapter)
                .into_iter()
                .map(|each| each.text)
                .collect()
        };
        assert_eq!(texts(&cat), ["The fuzzy cat slept."]);
        assert_eq!(texts(&picture), ["The picture was fuzzy."]);
    }

    /// The words of a chapter learned at `t0`: due in the recall since.
    fn learn_in(desk: &Desk, chapter: &str) {
        desk.db
            .lock()
            .expect("db")
            .execute(
                "UPDATE chapter_words SET done_at = ?1, learned_at = ?1 WHERE chapter_id = ?2",
                [crate::db::ts(t0()), chapter.to_owned()],
            )
            .expect("learn");
    }

    /// A stub that writes what it is asked to.
    fn pen() -> Stub {
        Stub {
            pen: true,
            ..Stub::default()
        }
    }

    /// The words a run of the stub was asked to write for, by chapter.
    fn written_for(stub: &Stub) -> Vec<String> {
        stub.writes
            .iter()
            .flat_map(|each| each.words.iter())
            .filter(|word| word.write > 0)
            .map(|word| word.sense.clone())
            .collect()
    }

    #[test]
    fn a_word_and_its_first_rival_are_both_written_for_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let [cat, _, picture] = two_books(&desk, &blurred());
        // The cat's chapter brings the picture's word in: both are written.
        let mut stub = pen();
        top_up(desk.ctx(), Scope::Chapter(&cat), &mut stub, &|_, _| {}).expect("top up");
        let mut senses = written_for(&stub);
        senses.sort();
        assert_eq!(senses, ["The fuzzy cat slept.", "The picture was fuzzy."]);
        assert_eq!(stub.writes[0].words[0].write, WRITTEN);
        // Each is told what the other means, to rule it out.
        let others: Vec<&Vec<String>> = stub.writes[0]
            .words
            .iter()
            .map(|each| &each.others)
            .collect();
        assert!(others.iter().all(|each| !each.is_empty()), "{others:?}");
        for chapter in [&cat, &picture] {
            let bank = fuzzy_in(&desk, chapter);
            let texts: Vec<&str> = bank.iter().map(|each| each.text.as_str()).collect();
            assert_eq!(
                bank.iter().filter(|each| !each.book).count(),
                5,
                "{texts:?}"
            );
        }
        // Nothing is written twice, from either chapter.
        let mut again = pen();
        top_up(desk.ctx(), Scope::Chapter(&picture), &mut again, &|_, _| {}).expect("top up");
        assert_eq!(written_for(&again).len(), 0);

        // A third meaning in a third book: only it is written for.
        let lamp = {
            let conn = desk.db.lock().expect("db");
            let lamp = words::tests::book(&conn, "lamp", &["My head felt fuzzy."]).remove(0);
            let dazed = Word {
                sentence: "My head felt fuzzy.".into(),
                ..word("fuzzy", &["aturdido"], 1)
            };
            words::finish(&conn, &lamp, crate::domain::Depth::Most, &[dazed], t0()).expect("words");
            lamp
        };
        let mut third = pen();
        top_up(desk.ctx(), Scope::Chapter(&lamp), &mut third, &|_, _| {}).expect("top up");
        assert_eq!(written_for(&third), ["My head felt fuzzy."]);
    }

    /// Shows every sentence of "fuzzy" in `chapter` but the first `keep`
    /// twice, as answers of the daily recall: they are spent.
    fn spend_all_but(desk: &Desk, chapter: &str, keep: usize) {
        let conn = desk.db.lock().expect("db");
        let bank = bank::bank(&conn, "fuzzy", Some(chapter)).expect("bank");
        for each in bank.iter().skip(keep) {
            for _ in 0..2 {
                conn.execute(
                    "INSERT INTO word_events (key, kind, direction, answer, created_at, sentence_id)
                     VALUES ('fuzzy', 'right', 'recognition', 'x', '2026-01-01T00:00:00.000Z', ?1)",
                    [&each.id],
                )
                .expect("event");
            }
        }
    }

    #[test]
    fn a_word_written_alike_is_written_for_again_once_its_sentences_run_low() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        // Two senses of one kind: the only words sentences are written for.
        let [cat, ..] = two_books(&desk, &blurred());
        let mut first = pen();
        top_up(desk.ctx(), Scope::Chapter(&cat), &mut first, &|_, _| {}).expect("top up");
        let word: String = desk
            .db
            .lock()
            .expect("db")
            .query_row(
                "SELECT id FROM chapter_words WHERE key = 'fuzzy' AND chapter_id = ?1",
                [&cat],
                |row| row.get(0),
            )
            .expect("word");
        let now = Utc::now();
        let due =
            |at: DateTime<Utc>| refill_after(&desk.db.lock().expect("db"), &word, at).expect("due");
        // Plenty left: nothing to write.
        assert_eq!(due(now), None);
        // Three sentences left: six uses, still enough.
        spend_all_but(&desk, &cat, 3);
        assert_eq!(due(now), None);
        // Two left: four uses, the threshold. Written once so far: a second
        // batch may come at once.
        spend_all_but(&desk, &cat, 2);
        assert_eq!(due(now), Some(cat.clone()));
        let mut again = pen();
        top_up(desk.ctx(), Scope::Chapter(&cat), &mut again, &|_, _| {}).expect("top up");
        assert!(written_for(&again).contains(&"The fuzzy cat slept.".to_owned()));
        // It is shown what it has already, so that nothing new reads like it.
        let asked = again
            .writes
            .iter()
            .flat_map(|each| each.words.iter())
            .find(|each| each.sense == "The fuzzy cat slept.")
            .expect("asked");
        assert!(
            asked.avoid.contains(&"The fuzzy cat slept.".to_owned()),
            "{:?}",
            asked.avoid
        );
        assert_eq!(desk.count("SELECT COUNT(*) FROM sentence_refills"), 1);
        // Three batches in the window, the first one included, and no more.
        {
            let conn = desk.db.lock().expect("db");
            conn.execute(
                "INSERT INTO sentence_refills (key, chapter_id, created_at) VALUES ('fuzzy', ?1, ?2)",
                rusqlite::params![&cat, crate::db::ts(now)],
            )
            .expect("third");
        }
        spend_all_but(&desk, &cat, 2);
        assert_eq!(due(now), None, "a third batch in the window already");
        let later = now + TimeDelta::hours(REFILL_GAP_HOURS) + TimeDelta::minutes(1);
        assert_eq!(due(later), Some(cat.clone()));
        // Once it was written 30 sentences, never again: they rotate.
        {
            let conn = desk.db.lock().expect("db");
            for at in 0..MOST_WRITTEN {
                conn.execute(
                    "INSERT INTO word_sentences
                       (id, key, source, sentence, form, hint, translation, created_at,
                        chapter_id, reviewed, discarded)
                     VALUES (?1, 'fuzzy', 'model', ?2, 'fuzzy', 'x', 'x', '2026-01-01', ?3, 1, 1)",
                    rusqlite::params![format!("filler{at}"), format!("Filler {at} fuzzy."), &cat],
                )
                .expect("filler");
            }
        }
        assert_eq!(due(later), None, "the most a word is written");
    }

    #[test]
    fn a_word_no_other_chapter_has_in_another_sense_is_never_written_for() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let alike = Word {
            sentence: "The picture was fuzzy.".into(),
            ..word("fuzzy", &["Peludo"], 1)
        };
        let [cat, ..] = two_books(&desk, &alike);
        learn_in(&desk, &cat);
        let mut stub = pen();
        top_up(desk.ctx(), Scope::Chapter(&cat), &mut stub, &|_, _| {}).expect("top up");
        top_up(desk.ctx(), Scope::Recall, &mut stub, &|_, _| {}).expect("top up");
        assert_eq!(written_for(&stub).len(), 0);
        assert_eq!(stub.writes[0].words.len(), 1, "its book's sentence only");
        assert_eq!(
            super::stock(&desk.db.lock().expect("db"), Scope::Chapter(&cat)).expect("stock"),
            (1, 1, 1)
        );
    }

    #[test]
    fn a_word_that_only_starts_as_another_is_no_rival_and_one_written_the_same_is() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let conn = desk.db.lock().expect("db");
        let chapters = words::tests::book(
            &conn,
            "dcc",
            &[
                "I kept spinning in circles. They found a boss fight.",
                "A spinning wheel came at me. The boss found a city.",
            ],
        );
        let depth = crate::domain::Depth::Most;
        let verb = Some(PartOfSpeech::Verb);
        let circles = Word {
            forms: vec!["spinning in circles".into()],
            sentence: "I kept spinning in circles.".into(),
            ..word("spin in circles", &["dar vueltas"], 1)
        };
        let fight = word("boss fight", &["pelea contra el jefe"], 1);
        let find = Word {
            part_of_speech: verb,
            ..word("found", &["encontrar", "hallar"], 1)
        };
        let wheel = Word {
            sentence: "A spinning wheel came at me.".into(),
            part_of_speech: Some(PartOfSpeech::Adjective),
            ..word("spinning", &["giratorio"], 1)
        };
        let boss = word("boss", &["jefe"], 1);
        let city = Word {
            part_of_speech: verb,
            ..word("found", &["fundar"], 1)
        };
        let again = Word {
            part_of_speech: verb,
            ..word("found", &["hallar", "dar con"], 1)
        };
        words::finish(&conn, &chapters[0], depth, &[circles, fight, find], t0()).expect("words");
        words::finish(&conn, &chapters[1], depth, &[wheel, boss, city], t0()).expect("words");
        let id = |key: &str, chapter: usize| -> String {
            conn.query_row(
                "SELECT id FROM chapter_words WHERE key = ?1 AND chapter_id = ?2",
                [key, chapters[chapter].as_str()],
                |row| row.get(0),
            )
            .expect("id")
        };
        // Asked by all it is written with, each is told from the other.
        for (key, chapter) in [("spinning", 1), ("boss", 1), ("boss fight", 0)] {
            let none = spellings::rivals(&conn, &id(key, chapter)).expect("rivals");
            assert_eq!(none.len(), 0, "{key}");
        }
        // Written the same, with nothing in common in what it means.
        let rivals = spellings::rivals(&conn, &id("found", 1)).expect("rivals");
        assert_eq!(rivals.len(), 1);
        assert_eq!(rivals[0].translations, ["encontrar", "hallar"]);
        assert!(rivals[0].same_book);
        assert_eq!(rivals[0].chapter_index, 0);
        // A third chapter with a synonym more is the same meaning: one rival
        // still, with all that sense means.
        let third = words::tests::book(&conn, "other", &["He found it again."]);
        let later = t0() + TimeDelta::seconds(1);
        words::finish(&conn, &third[0], depth, &[again], later).expect("words");
        let rivals = spellings::rivals(&conn, &id("found", 1)).expect("rivals");
        assert_eq!(rivals.len(), 1);
        assert_eq!(rivals[0].translations, ["encontrar", "hallar", "dar con"]);
        let of_find = spellings::rivals(&conn, &id("found", 0)).expect("rivals");
        assert_eq!(of_find.len(), 1);
        assert_eq!(of_find[0].translations, ["fundar"]);
    }

    #[test]
    fn a_word_with_a_rival_is_asked_alone_and_climbs_to_its_sentence() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let verb = Word {
            sentence: "The picture was fuzzy.".into(),
            part_of_speech: Some(PartOfSpeech::Verb),
            ..word("fuzzy", &["difuminar"], 1)
        };
        let [cat, _, picture] = two_books(&desk, &verb);
        furry_is_an_adjective(&desk);
        stock(&desk, &cat);
        stock(&desk, &picture);
        let sitting =
            crate::commands::practice::start(desk.ctx(), &cat, (None, Ways::Recognition), t0())
                .expect("start");
        let asked = item(&sitting.step).clone();
        // Alone: no sentence until it is needed.
        assert_eq!((&asked.context, &asked.native_context), (&None, &None));
        let say = |text: &str, rung: u8| {
            let shown = Shown {
                sentence_id: asked.sentence_id.as_deref(),
                rung,
                ..Shown::default()
            };
            answer_shown(
                desk.ctx(),
                &sitting.id,
                (&asked.word_id, asked.direction),
                (text, shown),
                t0(),
            )
            .expect("answer")
        };
        // What the other book means is no miss: it is told which word it was.
        let told = say("difuminar", 0);
        let ladder = told.ladder.expect("a step");
        let hint = ladder.hint.expect("a hint");
        assert!(told.again);
        assert_eq!(
            (ladder.rung, hint.meaning.as_str(), hint.book.as_deref()),
            (1, "difuminar", Some("picture"))
        );
        assert_eq!(hint.given, Some(PartOfSpeech::Verb));
        // Wrong again: the sentence is shown.
        let shown = say("nope", 1).ladder.expect("a step");
        assert_eq!(shown.rung, 2);
        assert!(shown
            .context
            .expect("its sentence")
            .iter()
            .any(|part| part.marked));
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM word_answers"),
            0,
            "no miss yet"
        );
        // Right with the sentence: understood, neither right nor a miss.
        let understood = say("peludo", 2);
        assert!(!understood.again && !understood.correct);
        assert!(understood.understood.is_some());
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 0);
        assert_eq!(desk.count("SELECT COUNT(*) FROM understood_answers"), 1);
    }

    #[test]
    fn a_word_its_tag_cannot_tell_apart_comes_with_its_sentence_and_skips_the_step_between() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        // "fuzzy", blurred, and "fuzzy", furry: no tag tells them apart.
        let [cat, _, picture] = two_books(&desk, &blurred());
        stock(&desk, &cat);
        stock(&desk, &picture);
        let sitting =
            crate::commands::practice::start(desk.ctx(), &cat, (None, Ways::Recognition), t0())
                .expect("start");
        let asked = item(&sitting.step).clone();
        // Never alone: the word alone has no one answer. No words that fix
        // its sense were said yet: the words around it stand in.
        let context = asked.context.clone().expect("its few words from the start");
        assert!(context.iter().any(|part| part.marked));
        let say = |text: &str, rung: u8| {
            let shown = Shown {
                sentence_id: asked.sentence_id.as_deref(),
                rung,
                ..Shown::default()
            };
            answer_shown(
                desk.ctx(),
                &sitting.id,
                (&asked.word_id, asked.direction),
                (text, shown),
                t0(),
            )
            .expect("answer")
        };
        let sentence = sentence_of(&desk, &asked);
        let (mine, other) = if sentence.chapter_id.as_deref() == Some(cat.as_str()) {
            ("peludo", "difuso")
        } else {
            ("difuso", "peludo")
        };
        // The other book's meaning: straight to the whole sentence, with no
        // word of what it is not.
        let shown = say(other, 0).ladder.expect("a step");
        // It had a few words: the step after shows its whole sentence.
        assert_eq!(
            (shown.rung, shown.hint.is_none(), shown.short),
            (2, true, true)
        );
        assert!(shown.context.is_some());
        // Right with it: understood, and the word comes back.
        let understood = say(mine, 2);
        assert_eq!(
            understood
                .understood
                .as_ref()
                .map(|tip| (tip.tied, tip.short)),
            Some((true, true))
        );
        let tip = understood.understood.clone().expect("a tip");
        // Its tip shows its few words again, and what the word is there.
        assert!(tip
            .example
            .is_some_and(|parts| parts.iter().any(|part| part.marked)));
        assert_eq!(tip.meaning.as_deref(), Some(sentence.hint.as_str()));
        // It was shown: the sentence is spent once, like any answer.
        assert_eq!(sentence_of(&desk, &asked).shows, 1);
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 0);
        assert_eq!(desk.count("SELECT COUNT(*) FROM understood_answers"), 1);
    }

    #[test]
    fn a_word_its_tag_cannot_tell_apart_is_asked_with_a_sentence_whose_few_words_fix_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let [cat, _, picture] = two_books(&desk, &blurred());
        stock(&desk, &cat);
        stock(&desk, &picture);
        // Only the sentence of the dog has words that fix the sense near it.
        let dog: String = {
            let conn = desk.db.lock().expect("db");
            conn.execute("UPDATE word_sentences SET cue = '[]'", [])
                .expect("none");
            conn.query_row(
                "SELECT id FROM word_sentences WHERE key = 'fuzzy' AND chapter_id = ?1
                 ORDER BY rowid DESC LIMIT 1",
                [&cat],
                |row| row.get(0),
            )
            .expect("one")
        };
        let text: String = desk
            .db
            .lock()
            .expect("db")
            .query_row(
                "SELECT sentence FROM word_sentences WHERE id = ?1",
                [&dog],
                |row| row.get(0),
            )
            .expect("text");
        let cue = text
            .split_whitespace()
            .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric()).to_owned())
            .find(|word| !word.eq_ignore_ascii_case("fuzzy") && !word.is_empty())
            .expect("a word");
        desk.db
            .lock()
            .expect("db")
            .execute(
                "UPDATE word_sentences SET cue = json_array(?2) WHERE id = ?1",
                [&dog, &cue],
            )
            .expect("cue");
        let sitting =
            crate::commands::practice::start(desk.ctx(), &cat, (None, Ways::Recognition), t0())
                .expect("start");
        let asked = item(&sitting.step).clone();
        assert_eq!(asked.sentence_id.as_deref(), Some(dog.as_str()));
    }

    #[test]
    fn a_word_its_tag_cannot_tell_apart_comes_with_the_few_words_that_fix_its_sense() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let [cat, _, picture] = two_books(&desk, &blurred());
        stock(&desk, &cat);
        stock(&desk, &picture);
        desk.db
            .lock()
            .expect("db")
            .execute(
                "UPDATE word_sentences SET cue = '[\"cat\",\"dog\",\"picture\"]'",
                [],
            )
            .expect("cue");
        let sitting =
            crate::commands::practice::start(desk.ctx(), &cat, (None, Ways::Recognition), t0())
                .expect("start");
        let asked = item(&sitting.step).clone();
        let shown: String = asked
            .context
            .clone()
            .expect("its few words")
            .iter()
            .map(|part| part.text.as_str())
            .collect();
        let sentence = sentence_of(&desk, &asked);
        // Fewer words than its sentence, the word and what fixes it.
        assert!(shown.len() < sentence.text.len(), "{shown}");
        assert!(shown.to_lowercase().contains("fuzzy"), "{shown}");
    }

    #[test]
    fn right_once_told_the_kind_is_helped_and_spends_its_sentence() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let [cat, _, picture] = two_books(&desk, &blurring());
        furry_is_an_adjective(&desk);
        stock(&desk, &cat);
        stock(&desk, &picture);
        learn_in(&desk, &cat);
        learn_in(&desk, &picture);
        let later = t0() + TimeDelta::days(1);
        let run = recall::start(desk.ctx(), Ways::Recognition, later).expect("start");
        let RecallStep::Item { item: asked, .. } = run.step.clone() else {
            panic!("a word is due")
        };
        assert_eq!(asked.context, None, "alone first");
        let sentence = sentence_of(&desk, &asked);
        let (mine, other) = if sentence.chapter_id.as_deref() == Some(cat.as_str()) {
            ("peludo", "difuso")
        } else {
            ("difuso", "peludo")
        };
        let say = |text: &str, rung: u8| {
            let shown = Shown {
                sentence_id: asked.sentence_id.as_deref(),
                rung,
                ..Shown::default()
            };
            recall::answer_shown(desk.ctx(), &run.id, "fuzzy", (text, shown), later)
                .expect("answer")
        };
        assert_eq!(say(other, 0).ladder.map(|each| each.rung), Some(1));
        let right = say(mine, 1);
        assert!(right.correct && right.helped);
        let spent: Option<String> = desk
            .db
            .lock()
            .expect("db")
            .query_row("SELECT sentence_id FROM word_events", [], |row| row.get(0))
            .expect("event");
        // Shown once answered: spent, so the next time another one comes.
        assert_eq!(spent, Some(sentence.id.clone()));
    }

    #[test]
    fn a_word_understood_with_its_sentence_in_the_recall_stays_due_and_leaves_the_run() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let [cat, _, picture] = two_books(&desk, &blurring());
        furry_is_an_adjective(&desk);
        stock(&desk, &cat);
        stock(&desk, &picture);
        learn_in(&desk, &cat);
        let later = t0() + TimeDelta::days(1);
        let run = recall::start(desk.ctx(), Ways::Recognition, later).expect("start");
        let RecallStep::Item { item: asked, .. } = run.step.clone() else {
            panic!("a word is due")
        };
        let sentence = sentence_of(&desk, &asked);
        let (mine, other) = if sentence.chapter_id.as_deref() == Some(cat.as_str()) {
            ("peludo", "difuso")
        } else {
            ("difuso", "peludo")
        };
        let say = |text: &str, rung: u8| {
            let shown = Shown {
                sentence_id: asked.sentence_id.as_deref(),
                rung,
                ..Shown::default()
            };
            recall::answer_shown(desk.ctx(), &run.id, "fuzzy", (text, shown), later)
                .expect("answer")
        };
        say(other, 0);
        say("nope", 1);
        let understood = say(mine, 2);
        assert!(understood.understood.is_some());
        assert!(matches!(understood.step, RecallStep::Summary { .. }));
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_events"), 0);
        // Still due: the next run asks it again.
        let next = recall::start(desk.ctx(), Ways::Recognition, later).expect("start");
        assert!(matches!(next.step, RecallStep::Item { .. }));
    }

    #[test]
    fn a_deleted_book_keeps_only_the_sentence_a_word_was_learned_with_and_those_written() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let [cat, ..] = two_books(&desk, &blurred());
        let mut stub = pen();
        top_up(desk.ctx(), Scope::Chapter(&cat), &mut stub, &|_, _| {}).expect("top up");
        learn_in(&desk, &cat);
        {
            let conn = desk.db.lock().expect("db");
            let new = NewSentence {
                key: "fuzzy",
                chapter: Some(&cat),
                book: true,
                sentence: "Its fuzzy tail moved.",
                form: "fuzzy",
                hint: "peluda",
                translation: "Su cola peluda se movió.",
            };
            bank::add(&conn, &new, Utc::now()).expect("add");
            let waiting = bank::unreviewed(&conn).expect("waiting").remove(0);
            bank::review(&conn, &waiting.id, true, &Labels::default()).expect("review");
        }
        assert_eq!(fuzzy_in(&desk, &cat).len(), 7);
        crate::db::books::archive_book(&desk.db.lock().expect("db"), "cat", t0()).expect("archive");
        let kept: Vec<(bool, String)> = fuzzy_in(&desk, &cat)
            .into_iter()
            .map(|each| (each.book, each.text))
            .collect();
        assert_eq!(kept.len(), 6);
        assert!(kept.contains(&(true, "The fuzzy cat slept.".to_owned())));
        assert!(!kept.iter().any(|(_, text)| text == "Its fuzzy tail moved."));
        // Its chapter is not read again, and nothing is written twice.
        let mut stub = pen();
        top_up(desk.ctx(), Scope::Recall, &mut stub, &|_, _| {}).expect("top up");
        assert_eq!(stub.writes.len(), 0);
    }
}
