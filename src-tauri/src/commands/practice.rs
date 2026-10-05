//! A session of practice on a chapter: a number of its open words, drawn
//! and fixed when it starts, asked one question at a time until each is
//! finished in the directions the session asks, both or one alone, or known. Every answer is checked at once and kept at
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
use super::sentences::banked;
use crate::books::hint::{first_letter, letters, mask, most};
use crate::books::practice::pick;
use crate::books::practice::{
    accepts_english, accepts_native, asked_in, blank, fills, inflects, is_extra, mark, next, pace,
    progress, progress_over, seed, session_questions, sizes, SIZES,
};
use crate::books::sentences::{choose, or_other, production, recognition, Banked, Verdict};
use crate::books::spelling::Spelling;
use crate::db::practice::{self, SittingRow, WordRow};
use crate::db::sentences::{self, Sentence};
use crate::db::{books, profile, words};
use crate::domain::{
    AnotherWord, AnswerResult, Direction, OneWay, PartOfSpeech, PracticeItem, PracticeOptions,
    PracticeStep, SentencePart, ShownSentence, Sitting, Ways, WordHint,
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
    let words = practice::session_words(conn, sitting)?;
    let log = practice::session_log(conn, &sitting.id)?;
    let asked = if sitting.finished {
        None
    } else {
        next(&words, &log, sitting.ways, seed(&sitting.id))
    };
    let Some(question) = asked else {
        practice::finish(conn, &sitting.id, now)?;
        return Ok(PracticeStep::Summary {
            summary: practice::summary(conn, sitting)?,
            progress: progress_over(&words, sitting.ways),
        });
    };
    let word = practice::word(conn, question.word_id)?;
    Ok(PracticeStep::Item {
        item: in_sentence(conn, word, question.direction, &sitting.id)?,
        progress: progress(&words, sitting.ways),
    })
}

/// The sentence of its bank a word is asked with next, in the sitting or
/// the run `drawn_for`; none for a word with no bank yet. Which one is
/// `books::sentences::choose`, drawn for that sitting, that word and how
/// often the word's sentences were shown: it is the same one until the word
/// is answered, however often the step is read.
pub(super) fn next_sentence(
    conn: &Connection,
    (key, own): (&str, &str),
    drawn_for: &str,
) -> Result<Option<Sentence>> {
    let held = sentences::bank(conn, key)?;
    let banked: Vec<Banked> = held.iter().map(|each| banked(each, own)).collect();
    let shown: u32 = held.iter().map(|each| each.shows).sum();
    let turn = usize::try_from(shown).unwrap_or(usize::MAX);
    let chosen = choose(&banked, |len| {
        pick(seed(&format!("{drawn_for}{key}")), turn, len)
    })
    .map(|each| each.id.clone());
    Ok(held
        .into_iter()
        .find(|each| Some(&each.id) == chosen.as_ref()))
}

/// A sentence of a word's bank as a direction shows it: the word marked
/// English → native, taken out native → English.
pub(super) fn in_place(sentence: &Sentence, direction: Direction) -> Option<Vec<SentencePart>> {
    let form = std::slice::from_ref(&sentence.form);
    match direction {
        Direction::Recognition => Some(mark(&sentence.text, form)),
        Direction::Production => blank(&sentence.text, form),
    }
}

/// A word asked with a sentence of its bank. English → native shows the
/// word as the sentence writes it. Native → English shows what that form is
/// in the learner's language. The sentence itself is kept back for the
/// first hint ([`hinted`]): only a word that `needs_context` to be told
/// from another sense shows it from the start ([`in_place`]).
pub(super) fn asked_with(
    (word_id, part_of_speech): (String, Option<PartOfSpeech>),
    sentence: &Sentence,
    direction: Direction,
    needs_context: bool,
) -> PracticeItem {
    let prompt = match direction {
        Direction::Recognition => sentence.form.clone(),
        Direction::Production => sentence.hint.clone(),
    };
    PracticeItem {
        word_id,
        direction,
        prompt,
        part_of_speech,
        context: needs_context
            .then(|| in_place(sentence, direction))
            .flatten(),
        sentence_id: Some(sentence.id.clone()),
    }
}

/// The word as a session of practice asks it: with a sentence of its bank,
/// a different one each time, or, until it has a bank, as its chapter has
/// it ([`item`]).
fn in_sentence(
    conn: &Connection,
    word: WordRow,
    direction: Direction,
    drawn_for: &str,
) -> Result<PracticeItem> {
    Ok(
        match next_sentence(conn, (&word.key, &word.sentence), drawn_for)? {
            Some(sentence) => asked_with(
                (word.id, word.part_of_speech),
                &sentence,
                direction,
                word.needs_context,
            ),
            None => item(word, direction),
        },
    )
}

/// What came with an answer: the sentence it was given to, whether it is
/// the second try at it, and whether the learner asked for a hint first.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Shown<'a> {
    pub sentence_id: Option<&'a str>,
    pub second: bool,
    pub hinted: bool,
}

/// How an answer was come by, as the screen says: on the second try at the
/// word, or after a hint.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tries {
    pub second: bool,
    pub hinted: bool,
}

impl<'a> Shown<'a> {
    /// What came with an answer given to this sentence in these tries.
    pub(super) fn of(sentence_id: Option<&'a str>, tries: Option<Tries>) -> Self {
        let tries = tries.unwrap_or_default();
        Self {
            sentence_id,
            second: tries.second,
            hinted: tries.hinted,
        }
    }
}

impl Shown<'_> {
    /// A right answer given with this was helped: it is not a clean one.
    pub(super) fn helped(self) -> bool {
        self.second || self.hinted
    }
}

/// The sentence an answer says it was given to: it has to be one the word
/// can still be asked with.
pub(super) fn shown_sentence(
    conn: &Connection,
    key: &str,
    shown: Shown<'_>,
) -> Result<Option<Sentence>> {
    let Some(id) = shown.sentence_id else {
        return Ok(None);
    };
    sentences::usable(conn, id)?
        .filter(|sentence| sentence.key == key)
        .map(Some)
        .ok_or_else(|| Error::Invalid("this sentence is not being asked".into()))
}

/// What a word means and how it is written, for checking an answer given
/// to one of its sentences.
pub(super) struct Meaning<'a> {
    /// Every accepted translation, in its base form.
    pub translations: &'a [String],
    /// The ones it is shown as.
    pub shown: &'a [String],
    /// Every way the word is known to be written, its base form included.
    pub forms: Vec<String>,
    /// English answers a dispute upheld.
    pub upheld: &'a [String],
    /// The other words the learner has that are shown the same way
    /// (`db::sentences::rivals`).
    pub rivals: Vec<String>,
    /// Whether its translations are taken in any form
    /// (`books::practice::inflects`).
    pub inflects: bool,
}

impl<'a> Meaning<'a> {
    pub(super) fn of(conn: &Connection, word: &'a WordRow) -> Result<Self> {
        Ok(Self {
            translations: &word.translations,
            shown: &word.shown,
            forms: english(word),
            upheld: &word.english,
            rivals: sentences::rivals(conn, &word.key, &word.shown)?,
            inflects: inflects(word.part_of_speech),
        })
    }
}

/// An answer given to a sentence, judged.
pub(super) struct Judged {
    pub verdict: Verdict,
    /// What was asked for, the first one first.
    pub accepted: Vec<String>,
    /// The translation in the form of the sentence, to point out.
    pub exact: Option<String>,
}

impl Judged {
    pub(super) fn is_right(&self) -> bool {
        matches!(self.verdict, Verdict::Right | Verdict::RightBase)
    }

    /// Neither right nor a miss the first time it is given: the word in
    /// another form, or another word for what was shown.
    pub(super) fn is_no_answer(&self) -> bool {
        matches!(self.verdict, Verdict::WrongForm | Verdict::OtherWord)
    }
}

/// Judges an answer given to a word in a sentence of its bank
/// (`books::sentences`). Native → English, the forms of every sentence of
/// the bank are forms of the word too: any of them is the word, and only
/// the one of this sentence fills its blank. An answer that is neither, and
/// is another English word for the hint, as the second look listed them or
/// as the learner's own words have it, is no miss
/// (`books::sentences::or_other`).
pub(super) fn judged(
    conn: &Connection,
    meaning: &Meaning<'_>,
    sentence: &Sentence,
    (direction, answer): (Direction, &str),
    (native_lang, spelling): (&str, Spelling),
) -> Result<Judged> {
    Ok(match direction {
        Direction::Recognition => {
            let verdict = recognition(
                answer,
                meaning.translations,
                Some(&sentence.hint),
                ((native_lang, meaning.inflects), spelling),
            );
            let mut accepted = vec![sentence.hint.clone()];
            for each in meaning.shown {
                if !accepted.contains(each) {
                    accepted.push(each.clone());
                }
            }
            Judged {
                exact: (verdict == Verdict::RightBase).then(|| sentence.hint.clone()),
                verdict,
                accepted,
            }
        }
        Direction::Production => {
            let mut other = meaning.forms.clone();
            other.extend(
                sentences::bank(conn, &sentence.key)?
                    .into_iter()
                    .map(|each| each.form),
            );
            let verdict = production(answer, &sentence.form, (&other, meaning.upheld), spelling);
            let rivals = [meaning.rivals.as_slice(), sentence.also.as_slice()].concat();
            Judged {
                verdict: or_other(verdict, answer, &rivals, spelling),
                accepted: vec![sentence.form.clone()],
                exact: None,
            }
        }
    })
}

/// The sentence as it is shown whole once its word is answered.
pub(super) fn whole(sentence: &Sentence) -> ShownSentence {
    ShownSentence {
        id: sentence.id.clone(),
        text: sentence.text.clone(),
        translation: sentence.translation.clone(),
        book: sentence.book,
    }
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
        part_of_speech: word.part_of_speech,
        context,
        sentence_id: None,
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

/// What a native → English answer has to be when the word is asked with its
/// sentence blanked: the forms that fill the blank, as the sentence writes
/// them. "stir" is not the word of "his mind ____." None when the word is
/// asked on its own: its base form and any form of the book will do.
pub(super) fn blanked(word: &WordRow) -> Vec<String> {
    if word.needs_context {
        fills(&word.sentence, &english(word))
    } else {
        Vec::new()
    }
}

/// Whether `answer` is right for the word asked in a direction, and what
/// was asked for, the first one first. Native → English, a word asked with
/// its sentence blanked has to be the form that fills the blank
/// ([`blanked`]); an answer a dispute upheld is accepted either way.
pub(super) fn verdict(
    word: &WordRow,
    direction: Direction,
    answer: &str,
    (native_lang, spelling): (&str, Spelling),
) -> (bool, Vec<String>) {
    match direction {
        Direction::Recognition => (
            accepts_native(
                answer,
                &word.translations,
                (native_lang, inflects(word.part_of_speech)),
                spelling,
            ),
            word.shown.clone(),
        ),
        Direction::Production => {
            let blanks = blanked(word);
            let written = if blanks.is_empty() {
                &word.forms
            } else {
                &blanks
            };
            let forms = [written.as_slice(), word.english.as_slice()].concat();
            let base = blanks.first().unwrap_or(&word.lemma);
            let correct = accepts_english(answer, base, &forms, spelling);
            let accepted = if blanks.is_empty() {
                vec![word.lemma.clone()]
            } else {
                blanks
            };
            (correct, accepted)
        }
    }
}

/// [`verdict`], as an answer given to a sentence is judged. Native →
/// English, an answer that is not the word and is another word the learner
/// has for what was shown is no miss (`books::sentences::or_other`).
pub(super) fn plain(
    conn: &Connection,
    word: &WordRow,
    (direction, answer): (Direction, &str),
    how: (&str, Spelling),
) -> Result<Judged> {
    let (correct, accepted) = verdict(word, direction, answer, how);
    let mut verdict = if correct {
        Verdict::Right
    } else {
        Verdict::Miss
    };
    if direction == Direction::Production {
        let rivals = sentences::rivals(conn, &word.key, &word.shown)?;
        verdict = or_other(verdict, answer, &rivals, how.1);
    }
    Ok(Judged {
        verdict,
        accepted,
        exact: None,
    })
}

/// What a hint to a word asked in a direction is made of, with the sentence
/// of its bank it is asked with if any: the answer it stands for, which is
/// the one a miss would show first, and the sentence the word was asked
/// without, that of its bank or else of its chapter. The answer is the form
/// that sentence has; a word that shows its sentence from the start has
/// none to add.
pub(super) fn clue(
    word: &WordRow,
    sentence: Option<&Sentence>,
    direction: Direction,
) -> (String, Option<Vec<SentencePart>>) {
    let (answer, context) = match (sentence, direction) {
        (Some(sentence), Direction::Recognition) => {
            (sentence.hint.clone(), in_place(sentence, direction))
        }
        (Some(sentence), Direction::Production) => {
            (sentence.form.clone(), in_place(sentence, direction))
        }
        (None, Direction::Recognition) => (
            word.shown.first().cloned().unwrap_or_default(),
            Some(mark(&word.sentence, &word.forms)),
        ),
        (None, Direction::Production) => {
            let forms = english(word);
            let answer = fills(&word.sentence, &forms)
                .into_iter()
                .next()
                .unwrap_or_else(|| word.lemma.clone());
            (answer, blank(&word.sentence, &forms))
        }
    };
    (answer, context.filter(|_| !word.needs_context))
}

/// A hint to a word once `asked` others were given ([`clue`], [`climb`]).
pub(super) fn hinted(
    word: &WordRow,
    sentence: Option<&Sentence>,
    direction: Direction,
    asked: usize,
) -> WordHint {
    let (answer, context) = clue(word, sentence, direction);
    climb(&answer, context, asked)
}

/// What an answer that is another word for what was shown comes back with:
/// the sentence the word was asked without, and the first letter of the
/// `answer`. That is what tells it from the word that was typed.
pub(super) fn another(answer: &str, context: Option<Vec<SentencePart>>) -> AnotherWord {
    let asked = first_letter(context.is_some());
    AnotherWord {
        hint: climb(answer, context, asked),
        asked: u32::try_from(asked).unwrap_or(u32::MAX),
    }
}

/// The hint to `answer` once `asked` others were given
/// (`books::hint::letters`): the sentence the word was asked without, alone
/// the first time and with every hint after it, then the answer letter by
/// letter (`books::hint::mask`).
pub(super) fn climb(answer: &str, context: Option<Vec<SentencePart>>, asked: usize) -> WordHint {
    match letters(asked, context.is_some()) {
        None => WordHint {
            mask: None,
            context,
            more: true,
        },
        Some(given) => WordHint {
            mask: Some(mask(answer, given)),
            context,
            more: given < most(answer),
        },
    }
}

/// The hint the learner asked for on the word a session is showing. Nothing
/// is kept: the answer that follows says it was given with a hint.
pub fn hint(
    ctx: Ctx<'_>,
    sitting_id: &str,
    (word_id, direction): (&str, Direction),
    (sentence_id, asked): (Option<&str>, usize),
) -> Result<WordHint> {
    let conn = ctx.conn()?;
    let sitting = practising(&conn, sitting_id)?;
    let word = practice::word(&conn, word_id)?;
    if word.chapter_id != sitting.chapter_id {
        return Err(Error::Invalid("this word is not being asked".into()));
    }
    let shown = Shown {
        sentence_id,
        ..Shown::default()
    };
    let sentence = shown_sentence(&conn, &word.key, shown)?;
    Ok(hinted(&word, sentence.as_ref(), direction, asked))
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
    let sitting = practice::sitting(conn, &id)?;
    let words = practice::session_words(conn, &sitting)?;
    let log = practice::session_log(conn, &id)?;
    if next(&words, &log, sitting.ways, seed(&id)).is_some() {
        return Ok(Some(sitting));
    }
    practice::finish(conn, &id, now)?;
    Ok(None)
}

/// What "Practice" on a chapter can do now: go on with the session left
/// unfinished, or start one, in both directions or in one alone, in any of
/// the sizes on offer, each with about how long it takes at the learner's
/// pace. A session of one direction counts the words that owe that way.
/// Ways with nothing left to ask are offered all the same, as an extra
/// review (`books::practice::is_extra`) of every word that can be asked.
pub fn options(ctx: Ctx<'_>, chapter_id: &str, now: DateTime<Utc>) -> Result<PracticeOptions> {
    let mut conn = ctx.conn()?;
    books::get_chapter(&conn, chapter_id)?;
    let tx = conn.transaction()?;
    let resume = held(&tx, chapter_id, now)?.is_some();
    let (answers, gaps) = practice::pace_sample(&tx)?;
    let pace = pace(answers, &gaps);
    let open = practice::open_histories(&tx, chapter_id)?;
    let all = practice::reviewable(&tx, chapter_id)?;
    let offered = |ways: Ways| {
        let words = if is_extra(&open, ways) {
            all
        } else {
            asked_in(&open, ways)
        };
        sizes(words, pace, ways)
    };
    tx.commit()?;
    Ok(PracticeOptions {
        resume,
        sizes: offered(Ways::Both),
        one_way: OneWay {
            recognition: offered(Ways::Recognition),
            production: offered(Ways::Production),
        },
        extra: [Ways::Both, Ways::Recognition, Ways::Production]
            .into_iter()
            .filter(|ways| is_extra(&open, *ways))
            .collect(),
    })
}

/// Starts a session on a chapter and gives its first question: `size` of
/// the chapter's open words that have something to ask in `ways`, drawn
/// among them, or all of them. While a session of the chapter is unfinished
/// it is that one that is gone on with, with the words and the ways it had,
/// whatever `size` and `ways` say. When none of the open words has anything
/// to ask in `ways` the session is an extra review
/// (`books::practice::is_extra`): it draws among every word the learner has
/// not said they know. A chapter with no such word answers with the summary
/// straight away.
pub fn start(
    ctx: Ctx<'_>,
    chapter_id: &str,
    (size, ways): (Option<u32>, Ways),
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
        let id = if is_extra(&practice::open_histories(&tx, chapter_id)?, ways) {
            practice::start_extra(&tx, chapter_id, ways, now)?
        } else {
            practice::start(&tx, chapter_id, ways, now)?
        };
        let sitting = practice::sitting(&tx, &id)?;
        practice::fix_words(&tx, &sitting, size)?;
        sitting
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
/// to be one the session has open: of one of its words, in a direction it
/// asks that still owes something. Native → English, a word asked with its
/// sentence blanked has to be the form that fills the blank ([`blanked`]);
/// an answer a dispute upheld is accepted either way. An empty answer is "I don't know": a miss like any
/// other, kept as an empty text.
#[cfg(test)]
pub fn answer(
    ctx: Ctx<'_>,
    sitting_id: &str,
    asked: (&str, Direction),
    answer: &str,
    now: DateTime<Utc>,
) -> Result<AnswerResult> {
    answer_shown(ctx, sitting_id, asked, (answer, Shown::default()), now)
}

/// [`answer`], for a word asked with a sentence of its bank: the answer
/// names that sentence, and is checked against it. Native → English, the
/// word in a form that does not fill the blank is no answer the first time:
/// nothing is kept, and the learner tries again. Nor is another English
/// word for what was shown, with a sentence or without: it comes back with
/// what tells the word asked for from it ([`another`]). On the second try
/// either is a miss.
pub fn answer_shown(
    ctx: Ctx<'_>,
    sitting_id: &str,
    (word_id, direction): (&str, Direction),
    (answer, shown): (&str, Shown<'_>),
    now: DateTime<Utc>,
) -> Result<AnswerResult> {
    let mut conn = ctx.conn()?;
    let native_lang = require_profile(&conn)?.native_lang;
    let spelling = profile::spelling(&conn)?;
    let tx = conn.transaction()?;
    let sitting = practising(&tx, sitting_id)?;
    let word = practice::word(&tx, word_id)?;
    let asked = !sitting.finished
        && session_questions(&practice::session_words(&tx, &sitting)?, sitting.ways)
            .iter()
            .any(|open| open.word_id == word.id && open.direction == direction);
    if !asked {
        return Err(Error::Invalid("this word is not being asked".into()));
    }
    let sentence = shown_sentence(&tx, &word.key, shown)?;
    let judged = if let Some(sentence) = &sentence {
        judged(
            &tx,
            &Meaning::of(&tx, &word)?,
            sentence,
            (direction, answer),
            (&native_lang, spelling),
        )?
    } else {
        plain(&tx, &word, (direction, answer), (&native_lang, spelling))?
    };
    if judged.is_no_answer() && !shown.second {
        let another = (judged.verdict == Verdict::OtherWord).then(|| {
            let (answer, context) = clue(&word, sentence.as_ref(), direction);
            another(&answer, context)
        });
        return Ok(AnswerResult {
            answer_id: 0,
            correct: false,
            accepted: Vec::new(),
            step: step(&tx, &sitting, now)?,
            again: true,
            another,
            helped: false,
            exact: None,
            sentence: None,
        });
    }
    let correct = judged.is_right();
    let answer_id = practice::record(
        &tx,
        &sitting.id,
        (word_id, direction),
        (answer.trim(), correct),
        now,
    )?;
    if let Some(sentence) = &sentence {
        practice::tag(&tx, answer_id, &sentence.id)?;
    }
    let step = step(&tx, &sitting, now)?;
    tx.commit()?;
    Ok(AnswerResult {
        answer_id,
        correct,
        accepted: judged.accepted,
        step,
        again: false,
        another: None,
        helped: correct && shown.helped(),
        exact: judged.exact,
        sentence: sentence.as_ref().map(whole),
    })
}

/// "This sentence is bad" on the answer just given: the sentence is never
/// asked with again, and the answer is taken back as if it had not been
/// given, a miss or not. Only the last answer of a session can be, while it
/// has not been put to "I was right": what was answered after it stands on
/// it. The session goes on from where it was.
pub fn discard(ctx: Ctx<'_>, answer_id: i64, now: DateTime<Utc>) -> Result<PracticeStep> {
    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    let answer = practice::answer(&tx, answer_id)?;
    let sitting = practising(&tx, &answer.sitting_id)?;
    let Some(sentence_id) = answer.sentence_id.as_deref() else {
        return Err(Error::Invalid("this answer has no sentence".into()));
    };
    if answer.disputed || !practice::is_latest(&tx, &answer)? {
        return Err(Error::Invalid("this answer cannot be taken back".into()));
    }
    sentences::discard(&tx, sentence_id)?;
    practice::void(&tx, &answer, now)?;
    let step = step(&tx, &practice::sitting(&tx, &sitting.id)?, now)?;
    tx.commit()?;
    Ok(step)
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
    ways: Option<Ways>,
) -> Result<Sitting> {
    let plan = (size, ways.unwrap_or(Ways::Both));
    run(app, move |_, ctx| start(ctx, &chapter_id, plan, Utc::now())).await
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
    sentence_id: Option<String>,
    tries: Option<Tries>,
) -> Result<AnswerResult> {
    run(app, move |_, ctx| {
        let shown = Shown::of(sentence_id.as_deref(), tries);
        answer_shown(
            ctx,
            &sitting_id,
            (&word_id, direction),
            (&answer, shown),
            Utc::now(),
        )
    })
    .await
}

#[tauri::command]
pub async fn hint_word(
    app: AppHandle,
    sitting_id: String,
    word_id: String,
    direction: Direction,
    sentence_id: Option<String>,
    asked: u32,
) -> Result<WordHint> {
    run(app, move |_, ctx| {
        let asked = usize::try_from(asked).unwrap_or(usize::MAX);
        hint(
            ctx,
            &sitting_id,
            (&word_id, direction),
            (sentence_id.as_deref(), asked),
        )
    })
    .await
}

#[tauri::command]
pub async fn discard_sentence(app: AppHandle, answer_id: i64) -> Result<PracticeStep> {
    run(app, move |_, ctx| discard(ctx, answer_id, Utc::now())).await
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
            start(self.ctx(), chapter, (None, Ways::Both), now).expect("start")
        }

        /// A session of `size` words, or the session left unfinished.
        pub fn sized(&self, chapter: &str, size: u32, now: DateTime<Utc>) -> Sitting {
            start(self.ctx(), chapter, (Some(size), Ways::Both), now).expect("start")
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
    fn spelling_counts_only_once_the_learner_asks_for_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let list = [word("grayish-white", &["blanco grisáceo"], 1)];
        let chapter = desk.chapter("b", &list);
        let sitting = desk.start(&chapter, t0());
        let asked = item(&sitting.step).clone();
        let say = |text: &str| desk.answer(&sitting, &asked, text, t0()).correct;
        assert!(!say("blango grisaceo"), "a wrong letter is a miss");
        assert!(say("blanco grisaceo"));

        let strict = {
            let conn = desk.db.lock().expect("db");
            let mut settings = profile::get_settings(&conn).expect("settings");
            settings.strict_spelling = true;
            profile::save_settings(&conn, &settings).expect("saved");
            settings
        };
        assert!(strict.strict_spelling);
        assert!(
            !desk
                .answer(&sitting, &asked, "blanco grisaceo", t0())
                .correct
        );
        assert!(
            desk.answer(&sitting, &asked, "Blanco grisáceo.", t0())
                .correct
        );
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
        assert_eq!(first.direction, Direction::Recognition);
        let (there, other) = (Direction::Recognition, Direction::Production);

        // The first look at "bank" is a miss, and it adds nothing: two in a
        // row English → native open the other way, as for "peep". The two
        // words alternate until both are done.
        let mut step = sitting.step.clone();
        let mut asked = Vec::new();
        let mut missed = false;
        while let PracticeStep::Item { item, .. } = step {
            let (word, text) = match item.prompt.as_str() {
                "bank" if !std::mem::replace(&mut missed, true) => ("bank", "banco"),
                "bank" => ("bank", "La Orilla"),
                "peep" => ("peep", " Asomarse. "),
                "orilla, la ribera" => ("bank", "The Bank."),
                "asomarse" => ("peep", "to peep"),
                other => panic!("{other} is not asked"),
            };
            match (word, item.direction) {
                ("bank", Direction::Recognition) => assert_eq!(
                    shown(&item),
                    [("She sat on the ", false), ("Bank", true), (".", false)]
                ),
                ("bank", Direction::Production) => assert_eq!(
                    shown(&item),
                    [("She sat on the ", false), ("", true), (".", false)],
                    "the word is taken out of its sentence"
                ),
                _ => assert_eq!(item.context, None),
            }
            let result = desk.answer(&sitting, &item, text, now);
            assert_eq!(result.correct, text != "banco", "{text}");
            if !result.correct {
                assert_eq!(result.accepted, ["orilla", "la ribera"]);
            }
            asked.push((word, item.direction));
            step = result.step;
        }
        let times = |word: &str, way: Direction| {
            let same = asked.iter().filter(|each| **each == (word, way));
            same.count()
        };
        assert_eq!(times("bank", there), 3, "the miss and two in a row");
        assert_eq!(times("peep", there), 2);
        assert_eq!((times("bank", other), times("peep", other)), (2, 2));
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

        // Nothing left to ask: a new sitting is an extra review of the two.
        let extra = desk.start(&chapter, now);
        assert_ne!(extra.id, sitting.id);
        assert_eq!(bar(&extra.step), (0, 8));
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
    fn a_session_of_ten_asks_only_its_ten_words_and_the_next_takes_ten_of_the_others() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(30));

        let first = desk.sized(&chapter, 10, t0());
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM practice_session_words"),
            10
        );
        let (asked, summary) = desk.finish(&first, t0());
        let mut taken = distinct(&asked);
        assert_eq!(taken.len(), 10, "ten of the chapter's thirty");
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

        // The next one takes other words, as many as it is asked for.
        let second = desk.sized(&chapter, 10, t0());
        assert_ne!(second.id, first.id);
        let (asked, summary) = desk.finish(&second, t0());
        assert_eq!(distinct(&asked).len(), 10);
        taken.extend(distinct(&asked));
        assert_eq!(summary, SittingSummary { done: 10, open: 10 });

        // "All" is what is left: no word was taken twice.
        let (asked, summary) = desk.play(&chapter, t0());
        assert_eq!(distinct(&asked).len(), 10);
        taken.extend(distinct(&asked));
        assert_eq!(distinct(&taken), range(0, 30));
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
            let mut third = String::new();
            // Eight answers, the third and the sixth wrong, hours apart;
            // then the learner leaves with a word on the screen.
            for turn in 1..=8 {
                let asked = item(&step).clone();
                if turn == 3 {
                    third.clone_from(&asked.word_id);
                }
                let text = if turn % 3 == 0 {
                    "wrong".to_owned()
                } else {
                    right(&asked)
                };
                let now = t0() + TimeDelta::hours(turn);
                step = desk.answer(&sitting, &asked, &text, now).step;
            }
            assert_eq!(item(&step).word_id, third, "missed five questions before");
            (chapter, sitting.id, item(&step).clone(), bar(&step))
        };
        // Six right answers, and each miss fell on a word with no run.
        assert_eq!(left_at, (6, 40));

        let desk = Desk::open(&path);
        let later = t0() + TimeDelta::days(40);
        assert!(offered(&desk, &chapter, later).resume);
        // Neither the size nor the ways are asked again, and they say
        // nothing if they are given.
        let resumed =
            start(desk.ctx(), &chapter, (Some(20), Ways::Recognition), later).expect("resumed");
        assert_eq!(resumed.id, id, "the same session");
        assert_eq!(item(&resumed.step), &pending, "the word left on the screen");
        assert_eq!(bar(&resumed.step), left_at, "the bar where it was");
        assert_eq!(desk.count("SELECT COUNT(*) FROM practice_sittings"), 1);
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 8);

        // Played out, it asked its ten words and no other, both ways.
        let (asked, summary) = desk.finish(&resumed, later);
        assert_eq!(distinct(&asked).len(), 10);
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
        // One way alone is every word, at three answers a word and not five.
        let one_way = [(Some(10), 10, 4), (Some(20), 20, 8), (None, 30, 12)];
        for sizes in [&fresh.one_way.recognition, &fresh.one_way.production] {
            let sizes = sizes.iter();
            let sizes = sizes.map(|size| (size.size, size.words, size.minutes));
            assert_eq!(sizes.collect::<Vec<_>>(), one_way);
        }

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
            sizes_of(&offered(&desk, &chapter, after_a_break))[..2],
            [(Some(10), 10, 3), (Some(20), 20, 5)],
            "the median of the learner's own answers, the break left out"
        );
        // The pace is the learner's, whatever the chapter.
        assert_eq!(
            sizes_of(&offered(&desk, &small, after_a_break)),
            [(None, 10, 3)]
        );

        let missing = options(desk.ctx(), "nowhere", t0()).expect_err("no chapter");
        assert_eq!(missing.kind(), "notFound");
        let odd = start(desk.ctx(), &small, (Some(7), Ways::Both), t0()).expect_err("not a size");
        assert_eq!(odd.kind(), "invalid");
    }

    #[test]
    fn a_session_of_one_way_ends_with_that_way_and_leaves_its_words_half_done() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(3));
        let (there, back) = (Direction::Recognition, Direction::Production);
        let one_way = |ways: Ways| start(desk.ctx(), &chapter, (None, ways), t0()).expect("start");
        let listed = || words::list(&desk.db.lock().expect("db"), &chapter).expect("list");

        // Native → English alone is asked from the start, two steps a word.
        let sitting = one_way(Ways::Production);
        assert_eq!(bar(&sitting.step), (0, 6));
        assert_eq!(item(&sitting.step).direction, back);
        let (asked, summary) = desk.finish(&sitting, t0());
        assert_eq!(asked.len(), 6, "two right answers a word, one way");
        // One way is half a word: none is done, and each says which half.
        assert_eq!(summary, SittingSummary { done: 0, open: 3 });
        assert!(listed()
            .iter()
            .all(|word| !word.done && word.half == Some(back)));

        // That way has nothing left to ask, so it is offered as an extra
        // review of every word; the other one has every word to ask.
        let options = offered(&desk, &chapter, t0());
        assert!(!options.resume);
        assert_eq!(sizes_of(&options), [(None, 3, 2)]);
        assert_eq!(options.extra, [Ways::Production]);
        assert_eq!(options.one_way.production[0].words, 3);
        assert_eq!(options.one_way.recognition[0].words, 3);

        // The other way finishes the words.
        let rest = one_way(Ways::Recognition);
        assert_eq!(item(&rest.step).direction, there);
        let (asked, summary) = desk.finish(&rest, t0());
        assert_eq!(asked.len(), 6);
        assert_eq!(summary, SittingSummary { done: 3, open: 0 });
        assert!(listed().iter().all(|word| word.done && word.half.is_none()));
    }

    #[test]
    fn a_way_with_nothing_left_to_ask_is_an_extra_review_counted_from_its_own_answers() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(3));
        let back = Direction::Production;
        let one_way = |ways: Ways| start(desk.ctx(), &chapter, (None, ways), t0()).expect("start");
        let listed = || words::list(&desk.db.lock().expect("db"), &chapter).expect("list");
        desk.finish(&one_way(Ways::Production), t0());

        // Asked again that way, every word is, from none: two steps a word.
        let extra = one_way(Ways::Production);
        assert_eq!(bar(&extra.step), (0, 6));
        let first = item(&extra.step).clone();
        assert_eq!(first.direction, back);
        // A miss is kept like any other: the word owes that way again.
        let missed = desk.answer(&extra, &first, "wrong", t0());
        assert_eq!(bar(&missed.step), (0, 6));
        let half = |id: &str| {
            listed()
                .iter()
                .find(|word| word.id == id)
                .expect("word")
                .half
        };
        assert_eq!(half(&first.word_id), None);

        // Left and gone on with, it is the same session where it was.
        let resumed = one_way(Ways::Recognition);
        assert_eq!(resumed.id, extra.id);
        assert_eq!(resumed.step, missed.step);
        let (asked, summary) = desk.finish(&resumed, t0());
        assert_eq!(asked.len(), 6, "two right answers in a row a word");
        assert_eq!(summary, SittingSummary { done: 0, open: 3 });
        assert!(listed().iter().all(|word| word.half == Some(back)));

        // Once every word is done, any way is an extra review of them all.
        desk.finish(&one_way(Ways::Recognition), t0());
        let options = offered(&desk, &chapter, t0());
        assert_eq!(
            options.extra,
            [Ways::Both, Ways::Recognition, Ways::Production]
        );
        assert_eq!(sizes_of(&options), [(None, 3, 2)]);
        let both = one_way(Ways::Both);
        assert_eq!(bar(&both.step), (0, 12));
        let (asked, summary) = desk.finish(&both, t0());
        assert_eq!(asked.len(), 12);
        assert_eq!(summary, SittingSummary { done: 3, open: 0 });

        // A word the learner knows is not asked, in an extra review either.
        let known = listed()[0].id.clone();
        words::set_known(&desk.db.lock().expect("db"), &known, true, t0()).expect("known");
        assert_eq!(offered(&desk, &chapter, t0()).sizes[0].words, 2);
        let (asked, _) = desk.finish(&one_way(Ways::Both), t0());
        assert_eq!(distinct(&asked).len(), 2);
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
                "SELECT id FROM chapter_words
                 WHERE id NOT IN (SELECT word_id FROM practice_session_words) LIMIT 1",
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
        assert_eq!(distinct(&asked).len(), 2);
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
            let old = practice::start(&conn, &chapter, Ways::Both, t0()).expect("sitting");
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
        let missing =
            start(desk.ctx(), "nowhere", (None, Ways::Both), t0()).expect_err("no chapter");
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
        assert_ne!(item(&moved).prompt, first.prompt);
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
        let rest: Vec<String> = range(0, 3)
            .into_iter()
            .filter(|word| *word != first.prompt)
            .collect();

        let step = know(desk.ctx(), &sitting.id, &first.word_id, t0()).expect("known");
        assert_ne!(item(&step).prompt, first.prompt);
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_answers"), 0);
        assert_eq!(desk.count("SELECT COUNT(*) FROM known_words"), 1);
        let late = desk_error(&desk, &sitting.id, &first.word_id);
        assert_eq!(late.kind(), "invalid", "a known word is not asked");

        // The same word in another book's chapter is known there too.
        let elsewhere = desk.start(&other, t0());
        assert_ne!(item(&elsewhere.step).prompt, first.prompt);
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
        assert_eq!(distinct(&asked), rest);
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

        let native = translation(&first.prompt);
        assert_eq!(say(there, "wrong"), (0, 12), "a miss on a fresh word");
        assert_eq!(say(there, &native), (1, 12), "a right answer");
        assert_eq!(say(there, ""), (0, 12), "a miss after one right answer");
        assert_eq!(say(there, &native), (1, 12));
        assert_eq!(say(there, &native), (2, 12));
        assert_eq!(say(back, &first.prompt), (3, 12));

        // Read again, or gone on with after leaving: the bar is where it was.
        let now = current(desk.ctx(), &sitting.id, t0()).expect("step");
        assert_eq!(bar(&now), (3, 12));
        let resumed = desk.start(&chapter, t0() + TimeDelta::days(2));
        assert_eq!(resumed.id, sitting.id);
        assert_eq!(bar(&resumed.step), (3, 12));

        // "I know this" takes the word's four steps out of the total, and
        // the one it had earned out of the value.
        let other = item(&resumed.step).clone();
        assert_ne!(other.word_id, id, "asked a moment ago");
        let earned = desk.answer(&sitting, &other, &right(&other), t0());
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
            let later = practice::start(&conn, &chapter, Ways::Both, t0()).expect("sitting");
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
        let id = word_in(&desk, &chapter, "run");
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

        // A miss this way shows the word its sentence is blanked of, and
        // adds nothing either.
        let miss = say(back, "walk").expect("miss");
        assert!(!miss.correct);
        assert_eq!(miss.accepted, ["ran"]);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 2)]);
        let unknown = say(back, "  ").expect("no idea");
        assert!(!unknown.correct);
        assert_eq!(unknown.accepted, ["ran"]);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 2)]);

        // A right answer followed by a miss is a run of none. The base form
        // is a miss: "He run, and run again" is not what the book says.
        assert!(say(back, "ran").expect("right").correct);
        assert_eq!(owes(&desk, &chapter, &id), [(back, 1)]);
        for text in ["run", "To run"] {
            let base = say(back, text).expect("miss");
            assert!(!base.correct, "{text}");
            assert_eq!(base.accepted, ["ran"]);
        }
        assert_eq!(owes(&desk, &chapter, &id), [(back, 2)]);

        // The form in the book, whatever its case: two in a row finish this
        // way too, and with it the word.
        for text in ["Ran", "ran."] {
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
        assert_eq!(check.direction, back);
        let refused = answer(desk.ctx(), &sitting.id, (&id, there), "w00es", t0());
        assert_eq!(refused.expect_err("not asked").kind(), "invalid");

        let passed = desk.answer(&sitting, &check, &right(&check), t0());
        assert!(passed.correct);
        assert_eq!(owes(&desk, &second, &check.word_id), []);
        assert_eq!(readiness(&desk, &second), Some(50));
        let last = item(&passed.step).clone();
        assert_eq!(last.direction, back);
        assert_ne!(last.word_id, check.word_id);
        let over = desk.answer(&sitting, &last, &right(&last), t0());
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
        let back = Direction::Production;

        let sitting = desk.start(&second, t0());
        // The others answered right until its check comes up.
        let others_until_it = |mut step: PracticeStep| {
            let mut others = 0;
            while item(&step).word_id != id {
                let other = item(&step).clone();
                step = desk.answer(&sitting, &other, &right(&other), t0()).step;
                others += 1;
            }
            (step, others)
        };
        let (step, _) = others_until_it(sitting.step.clone());
        let check = item(&step).clone();
        assert_eq!(check.direction, back);
        let miss = desk.answer(&sitting, &check, "", t0());
        assert!(!miss.correct);
        assert_eq!(owes(&desk, &second, &id), [(back, 2)]);

        // No more than five other questions, and it is asked again the same
        // way.
        let (step, others) = others_until_it(miss.step);
        assert!(others <= 5, "{others} questions before it came back");
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
        // Checked in the second, it still owes what it owed in the first,
        // and as a review word there its check the other way with it.
        assert_eq!(owes(&desk, &first, &own), [(there, 2), (back, 1)]);
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
        let other = word_in(&desk, &second, "w01");
        let turns = [
            (&id, there, "w00es"),
            (&other, there, "w01es"),
            (&id, there, "w00es"),
            (&other, there, "w01es"),
            (&id, back, "w00"),
        ];
        for (word, way, text) in turns {
            let given = answer(desk.ctx(), &ahead.id, (word, way), text, t0());
            assert!(given.expect("answer").correct, "{text}");
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
        assert_eq!(owes(&desk, &second, &other), [(back, 2)], "not shared");
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
