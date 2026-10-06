//! Sittings, the words a session of practice was started with, and the
//! answers given. The answers are the whole of a word's progress: everything
//! else is counted from them by `books::practice`.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use super::words::Used;
use super::{found, new_id, parse_ts, ts};
use crate::books::practice::{Answer, Asked, SessionWord};
use crate::domain::{Direction, PartOfSpeech, SittingSummary, VerbForm, Ways};
use crate::error::Result;

/// A started sitting.
#[derive(Debug, Clone, PartialEq)]
pub struct SittingRow {
    pub id: String,
    pub chapter_id: String,
    pub started_at: DateTime<Utc>,
    /// A pass of the refresh before reading (`db::refresh`), not a run of
    /// "Practice": the two are started, answered and summed up apart.
    pub refresh: bool,
    /// It ran out of words to ask: it is over, and is not gone on with.
    pub finished: bool,
    /// The ways it asks its words in; both for a pass of the refresh.
    pub ways: Ways,
    /// An extra review: its words owe what the answers given in it say,
    /// whatever they were given before ([`session_words`]).
    pub extra: bool,
}

/// What asking a word needs.
#[derive(Debug, Clone, PartialEq)]
pub struct WordRow {
    pub id: String,
    /// What the word is known by in every chapter (`books::vocab::key`).
    pub key: String,
    pub chapter_id: String,
    /// What the word is called: its base form, or the form of a verb that
    /// is a word of its own (`books::vocab::Word`).
    pub lemma: String,
    /// The base form of a verb called by another form.
    pub base: Option<String>,
    /// What kind of word it is, when the chapter says.
    pub part_of_speech: Option<PartOfSpeech>,
    /// The form a verb has in the sentence of its chapter, when one said.
    pub verb_form: Option<VerbForm>,
    /// Every form the chapter uses, what the word is called first.
    pub forms: Vec<String>,
    pub sentence: String,
    pub needs_context: bool,
    /// Every accepted translation, the first one first: the ones the
    /// chapter was prepared with, then the ones a dispute upheld.
    pub translations: Vec<String>,
    /// The translations the chapter was prepared with: what the word is
    /// shown as, the one the learner answers with most first
    /// (`db::words::Used`). An answer upheld later is accepted, never shown.
    pub shown: Vec<String>,
    /// The shown translations in the form the word is called by, in the
    /// same order ("jurado" for "jurar", of "sworn"): what a verb called by
    /// another form than its base form is shown as. None for any other
    /// word, and until a model said them all (`db::words::put_in_form`).
    pub in_form: Option<Vec<String>>,
    /// English answers a dispute upheld, accepted beside the base form and
    /// the forms of the book. They are not forms: nothing marks or blanks
    /// them in the sentence.
    pub english: Vec<String>,
}

/// One answer as it was given, and whether it has been disputed.
#[derive(Debug, Clone, PartialEq)]
pub struct AnswerRow {
    pub seq: i64,
    pub word_id: String,
    pub direction: Direction,
    pub sitting_id: String,
    /// As the learner typed it; empty for "I don't know".
    pub answer: String,
    pub correct: bool,
    pub disputed: bool,
    /// The sentence of the word's bank it was given to, if it was.
    pub sentence_id: Option<String>,
}

/// Starts a sitting on a chapter that asks its words in `ways`; its id. A
/// session of practice then gets its words ([`fix_words`]).
pub fn start(
    conn: &Connection,
    chapter_id: &str,
    ways: Ways,
    now: DateTime<Utc>,
) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO practice_sittings (id, chapter_id, started_at, ways)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, chapter_id, ts(now), ways],
    )?;
    Ok(id)
}

/// [`start`], for an extra review of the chapter in `ways`.
pub fn start_extra(
    conn: &Connection,
    chapter_id: &str,
    ways: Ways,
    now: DateTime<Utc>,
) -> Result<String> {
    let id = start(conn, chapter_id, ways, now)?;
    conn.execute(
        "UPDATE practice_sittings SET extra = 1 WHERE id = ?1",
        [&id],
    )?;
    Ok(id)
}

pub fn sitting(conn: &Connection, id: &str) -> Result<SittingRow> {
    let (chapter_id, started, refresh, finished, (ways, extra)): (
        String,
        String,
        bool,
        bool,
        (Ways, bool),
    ) = found(
        conn.query_row(
            "SELECT chapter_id, started_at, kind = 'refresh', finished_at IS NOT NULL,
                    ways, extra
                 FROM practice_sittings WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    (row.get(4)?, row.get(5)?),
                ))
            },
        ),
        "sitting",
    )?;
    Ok(SittingRow {
        id: id.to_owned(),
        chapter_id,
        started_at: parse_ts(&started)?,
        refresh,
        finished,
        ways,
        extra,
    })
}

pub fn word(conn: &Connection, id: &str) -> Result<WordRow> {
    let (chapter_id, lemma, forms, sentence, needs_context, (key, part_of_speech)): (
        String,
        String,
        String,
        String,
        bool,
        (String, Option<PartOfSpeech>),
    ) = found(
        conn.query_row(
            "SELECT chapter_id, lemma, forms, sentence, needs_context, key, part_of_speech
                 FROM chapter_words WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    (row.get(5)?, row.get(6)?),
                ))
            },
        ),
        "word",
    )?;
    let (base, verb_form): (Option<String>, Option<VerbForm>) = conn.query_row(
        "SELECT base, verb_form FROM chapter_words WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let mut stmt = conn.prepare(
        "SELECT text, source = 'extraction', in_form FROM word_translations
         WHERE word_id = ?1 ORDER BY rowid",
    )?;
    let accepted = stmt
        .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<Vec<(String, bool, Option<String>)>>>()?;
    let shown = accepted
        .iter()
        .filter(|(_, extracted, _)| *extracted)
        .map(|(text, ..)| text.clone())
        .collect();
    let shown = Used::load(conn, Some(&key))?.order(&key, part_of_speech, shown);
    let said: HashMap<&str, &str> = accepted
        .iter()
        .filter_map(|(text, _, in_form)| Some((text.as_str(), in_form.as_deref()?)))
        .collect();
    let in_form: Option<Vec<String>> = shown
        .iter()
        .map(|text| said.get(text.as_str()).map(|each| (*each).to_owned()))
        .collect();
    let in_form = in_form.filter(|_| base.is_some() && !shown.is_empty());
    let translations = accepted.iter().map(|(text, ..)| text.clone()).collect();
    let mut stmt =
        conn.prepare("SELECT text FROM word_english WHERE word_id = ?1 ORDER BY rowid")?;
    let english = stmt
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(WordRow {
        id: id.to_owned(),
        key,
        chapter_id,
        lemma,
        base,
        part_of_speech,
        verb_form,
        forms: serde_json::from_str(&forms)?,
        sentence,
        needs_context,
        translations,
        shown,
        in_form,
        english,
    })
}

impl WordRow {
    /// What the word is shown as in the learner's language: in the form it
    /// is called by, once that was said, and in its base form until then.
    pub fn shown_as(&self) -> &[String] {
        self.in_form.as_deref().unwrap_or(&self.shown)
    }
}

/// One answer, by its place among all answers.
pub fn answer(conn: &Connection, seq: i64) -> Result<AnswerRow> {
    found(
        conn.query_row(
            "SELECT word_id, direction, sitting_id, answer, correct,
                    EXISTS (SELECT 1 FROM answer_disputes d WHERE d.seq = a.seq),
                    sentence_id
             FROM word_answers a WHERE a.seq = ?1",
            [seq],
            |row| {
                Ok(AnswerRow {
                    seq,
                    word_id: row.get(0)?,
                    direction: row.get(1)?,
                    sitting_id: row.get(2)?,
                    answer: row.get(3)?,
                    correct: row.get(4)?,
                    disputed: row.get(5)?,
                    sentence_id: row.get(6)?,
                })
            },
        ),
        "answer",
    )
}

/// Keeps the verdict on a disputed answer; run it inside a transaction, on
/// an answer not disputed before. A rejected dispute changes nothing else.
/// An upheld one makes that one answer correct, which is the whole undoing
/// of the miss, whatever was answered since; keeps the answer as one that is
/// accepted from now on, in the direction it was given; and brings the
/// word's `done_at` up to date.
pub fn settle(
    conn: &Connection,
    answer: &AnswerRow,
    (upheld, reason): (bool, &str),
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO answer_disputes (seq, upheld, reason, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![answer.seq, upheld, reason, ts(now)],
    )?;
    if !upheld {
        return Ok(());
    }
    conn.execute(
        "UPDATE word_answers SET correct = 1 WHERE seq = ?1",
        [answer.seq],
    )?;
    let store = match answer.direction {
        Direction::Recognition => Some(
            "INSERT OR IGNORE INTO word_translations (word_id, text, source)
             VALUES (?1, ?2, 'dispute')",
        ),
        // Upheld in a sentence of the bank, it fills that blank: another
        // sentence has the word in another form, and it would not fit there.
        Direction::Production if answer.sentence_id.is_some() => None,
        Direction::Production => {
            Some("INSERT OR IGNORE INTO word_english (word_id, text) VALUES (?1, ?2)")
        }
    };
    if let Some(store) = store {
        conn.execute(store, params![answer.word_id, answer.answer])?;
    }
    sync_done(conn, &answer.word_id, now)
}

/// Whether the answer `a` was given in the refresh before reading.
const IN_REFRESH: &str = "EXISTS (SELECT 1 FROM practice_sittings s
     WHERE s.id = a.sitting_id AND s.kind = 'refresh')";

/// A word's answers, oldest first.
fn answers(conn: &Connection, word_id: &str) -> Result<Vec<Answer>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT a.direction, a.correct, {IN_REFRESH} FROM word_answers a
         WHERE a.word_id = ?1 ORDER BY a.seq"
    ))?;
    let rows = stmt.query_map([word_id], |row| {
        Ok(Answer {
            direction: row.get(0)?,
            correct: row.get(1)?,
            refresh: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A word the learner has not said they know (`db::words::set_known`).
pub(super) const NOT_KNOWN: &str = "w.key NOT IN (SELECT key FROM known_words)";

/// A chapter's words neither finished nor known, most frequent first; the
/// chapter is `?1`.
const OPEN_WORDS: &str = "SELECT w.id FROM chapter_words w
     WHERE w.chapter_id = ?1 AND w.done_at IS NULL
       AND w.key NOT IN (SELECT key FROM known_words)
     ORDER BY w.occurrences DESC, w.key";

/// The words `ids` selects for `key`, in its order, each with every answer
/// it was given, in any sitting, oldest first.
fn histories(conn: &Connection, ids: &str, key: &str) -> Result<Vec<SessionWord>> {
    histories_of(conn, ids, "", key)
}

/// [`histories`], with the answers narrowed further by `only`: SQL that
/// goes on the condition on `word_answers a`.
fn histories_of(conn: &Connection, ids: &str, only: &str, key: &str) -> Result<Vec<SessionWord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT a.word_id, a.direction, a.correct, {IN_REFRESH} FROM word_answers a
         WHERE a.word_id IN ({ids}){only} ORDER BY a.seq"
    ))?;
    let rows = stmt.query_map([key], |row| {
        Ok((
            row.get::<_, String>(0)?,
            Answer {
                direction: row.get(1)?,
                correct: row.get(2)?,
                refresh: row.get(3)?,
            },
        ))
    })?;
    // Looked up by word, never walked: the order is the words' own.
    let mut given: HashMap<String, Vec<Answer>> = HashMap::new();
    for row in rows {
        let (word_id, answer) = row?;
        given.entry(word_id).or_default().push(answer);
    }
    let mut stmt = conn.prepare(ids)?;
    let words = stmt
        .query_map([key], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    words
        .into_iter()
        .map(|word_id| {
            Ok(SessionWord {
                review: is_review(conn, &word_id)?,
                answers: given.remove(&word_id).unwrap_or_default(),
                word_id,
            })
        })
        .collect()
}

/// Whether the word is a review word in its chapter: its key was finished in
/// another chapter, of any book. It is read off the other chapters' words
/// each time, never kept with the word, so a chapter prepared ahead has it
/// from the moment the word is finished elsewhere. Once finished there it
/// stays one, whatever a miss in the refresh does to it there.
fn is_review(conn: &Connection, word_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM chapter_words w JOIN chapter_words o ON o.key = w.key
                        WHERE w.id = ?1 AND o.chapter_id != w.chapter_id
                          AND o.learned_at IS NOT NULL)",
        [word_id],
        |row| row.get(0),
    )?)
}

/// A chapter's open words in no order: a new one every time it is read.
const SHUFFLED_WORDS: &str = "SELECT w.id FROM chapter_words w
     WHERE w.chapter_id = ?1 AND w.done_at IS NULL
       AND w.key NOT IN (SELECT key FROM known_words)
     ORDER BY RANDOM()";

/// Every word of a chapter the learner has not said they know, done or
/// not, in no order: what an extra review draws from. The chapter is `?1`.
const SHUFFLED_ALL: &str = "SELECT w.id FROM chapter_words w
     WHERE w.chapter_id = ?1
       AND w.key NOT IN (SELECT key FROM known_words)
     ORDER BY RANDOM()";

/// Fixes the words of a session just started: `size` of the chapter's open
/// words that have something to ask in the session's ways, or all of them.
/// Which ones is drawn, and so is the order they are kept in: a session of
/// ten is not the ten the chapter uses most, every time. An extra review
/// draws among every word the learner has not said they know.
pub fn fix_words(conn: &Connection, sitting: &SittingRow, size: Option<u32>) -> Result<()> {
    let size = size.map_or(usize::MAX, |size| {
        usize::try_from(size).unwrap_or(usize::MAX)
    });
    let from = if sitting.extra {
        SHUFFLED_ALL
    } else {
        SHUFFLED_WORDS
    };
    let drawn = histories(conn, from, &sitting.chapter_id)?;
    let asked = |word: &&SessionWord| sitting.extra || word.is_asked(sitting.ways);
    let taken = drawn.iter().filter(asked).take(size);
    let mut stmt = conn.prepare(
        "INSERT INTO practice_session_words (sitting_id, word_id, rank) VALUES (?1, ?2, ?3)",
    )?;
    for (rank, word) in taken.enumerate() {
        let rank = i64::try_from(rank).unwrap_or(i64::MAX);
        stmt.execute(params![sitting.id, word.word_id, rank])?;
    }
    Ok(())
}

/// The words a session still counts: the ones it was started with, less
/// those the learner has since said they know, in the order they had then,
/// each with all its answers. A word finished in it is among them, with
/// nothing left to ask. This is the set the session's questions, its end
/// and its progress are read off.
///
/// In an extra review each word has the answers given in that session
/// alone, and none is a review word: it owes two in a row every way the
/// session asks from its start, and stops being asked by the same rule.
pub fn session_words(conn: &Connection, sitting: &SittingRow) -> Result<Vec<SessionWord>> {
    let ids = format!(
        "SELECT s.word_id FROM practice_session_words s
         JOIN chapter_words w ON w.id = s.word_id
         WHERE s.sitting_id = ?1 AND {NOT_KNOWN} ORDER BY s.rank"
    );
    if !sitting.extra {
        return histories(conn, &ids, &sitting.id);
    }
    let own = histories_of(conn, &ids, " AND a.sitting_id = ?1", &sitting.id)?;
    Ok(own
        .into_iter()
        .map(|word| SessionWord {
            review: false,
            ..word
        })
        .collect())
}

/// The answers given in a sitting, oldest first: the order its questions
/// were asked in.
pub fn session_log(conn: &Connection, sitting_id: &str) -> Result<Vec<Asked>> {
    let mut stmt = conn.prepare(
        "SELECT word_id, direction, correct FROM word_answers
         WHERE sitting_id = ?1 ORDER BY seq",
    )?;
    let rows = stmt.query_map([sitting_id], |row| {
        Ok(Asked {
            word_id: row.get(0)?,
            direction: row.get(1)?,
            correct: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The chapter's session of practice that was left before it ran out of
/// words, if there is one.
pub fn unfinished(conn: &Connection, chapter_id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT s.id FROM practice_sittings s
         WHERE s.chapter_id = ?1 AND s.kind = 'practice' AND s.finished_at IS NULL
           AND EXISTS (SELECT 1 FROM practice_session_words p WHERE p.sitting_id = s.id)
         ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1",
    )?;
    let mut rows = stmt.query_map([chapter_id], |row| row.get(0))?;
    Ok(rows.next().transpose()?)
}

/// The sitting ran out of words to ask: it is over. One that was over
/// already keeps the moment it ended.
pub fn finish(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE practice_sittings SET finished_at = ?2 WHERE id = ?1 AND finished_at IS NULL",
        params![id, ts(now)],
    )?;
    Ok(())
}

/// The chapter's open words, neither finished nor known, most frequent
/// first, each with all its answers: what a session can be started with.
pub fn open_histories(conn: &Connection, chapter_id: &str) -> Result<Vec<SessionWord>> {
    histories(conn, OPEN_WORDS, chapter_id)
}

/// The one direction each word of the chapter is finished in while it still
/// owes the other, by word (`SessionWord::half`). A word never answered is
/// finished in neither, and a done word in both: neither is here.
pub fn halves(conn: &Connection, chapter_id: &str) -> Result<HashMap<String, Direction>> {
    let answered = "SELECT w.id FROM chapter_words w
         WHERE w.chapter_id = ?1 AND w.done_at IS NULL
           AND w.id IN (SELECT word_id FROM word_answers)";
    let words = histories(conn, answered, chapter_id)?;
    Ok(words
        .into_iter()
        .filter_map(|word| Some((word.half()?, word.word_id)))
        .map(|(half, word_id)| (word_id, half))
        .collect())
}

/// How many words of the chapter an extra review can ask: every one the
/// learner has not said they know, done or not.
pub fn reviewable(conn: &Connection, chapter_id: &str) -> Result<u32> {
    Ok(conn.query_row(
        &format!("SELECT COUNT(*) FROM chapter_words w WHERE w.chapter_id = ?1 AND {NOT_KNOWN}"),
        [chapter_id],
        |row| row.get(0),
    )?)
}

/// How many words of the chapter are open: neither finished nor known.
pub fn open_words(conn: &Connection, chapter_id: &str) -> Result<u32> {
    Ok(conn.query_row(
        &format!("SELECT COUNT(*) FROM ({OPEN_WORDS})"),
        [chapter_id],
        |row| row.get(0),
    )?)
}

/// The latest answers the learner's pace is read from.
const PACE_SAMPLE: u32 = 200;

/// What the learner's pace is read from (`books::practice::pace`): how many
/// answers they have given in all, and the milliseconds between consecutive
/// answers of the same sitting among the latest ones.
pub fn pace_sample(conn: &Connection) -> Result<(usize, Vec<i64>)> {
    let answers: i64 = conn.query_row("SELECT COUNT(*) FROM word_answers", [], |row| row.get(0))?;
    let mut stmt =
        conn.prepare("SELECT sitting_id, created_at FROM word_answers ORDER BY seq DESC LIMIT ?1")?;
    let latest = stmt
        .query_map([PACE_SAMPLE], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
    let mut gaps = Vec::new();
    // Newest first: each pair is an answer and the one given before it.
    for pair in latest.windows(2) {
        let [(sitting, at), (before_sitting, before)] = pair else {
            continue;
        };
        if sitting == before_sitting {
            gaps.push((parse_ts(at)? - parse_ts(before)?).num_milliseconds());
        }
    }
    Ok((usize::try_from(answers).unwrap_or(0), gaps))
}

/// A question of a chapter that is open and still owes something.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queued {
    pub word_id: String,
    pub direction: Direction,
    /// Correct answers in a row it still owes in this direction.
    pub owed: u32,
}

/// Everything a chapter has left to ask, whatever session its words are in:
/// its open words, most frequent first, each with one item for every
/// direction that is open and still owes something.
#[cfg(test)]
pub fn queue(conn: &Connection, chapter_id: &str) -> Result<Vec<Queued>> {
    let words = open_histories(conn, chapter_id)?;
    let open = crate::books::practice::open_questions(&words);
    Ok(open
        .into_iter()
        .map(|question| Queued {
            word_id: question.word_id.to_owned(),
            direction: question.direction,
            owed: question.owed,
        })
        .collect())
}

/// Brings `done_at` up to date for every unfinished word of the chapter
/// that has answers. A word whose answers read as done under the rule of
/// today, and were given under another, is finished by this: it counts
/// towards the chapter's readiness and is not taken into a session. So is
/// every word missed in a refresh, done or not: one made up for English →
/// native alone, as the rule once had it, owes the other way again.
pub fn sync_chapter(conn: &Connection, chapter_id: &str, now: DateTime<Utc>) -> Result<()> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id FROM chapter_words
         WHERE chapter_id = ?1
           AND (done_at IS NULL AND id IN (SELECT word_id FROM word_answers)
             OR id IN (SELECT a.word_id FROM word_answers a
                       WHERE a.correct = 0 AND {IN_REFRESH}))"
    ))?;
    let words = stmt
        .query_map([chapter_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for word_id in words {
        sync_done(conn, &word_id, now)?;
    }
    Ok(())
}

/// Sets or clears the word's `done_at` from its answers. Run it after any
/// change to them. A word already done keeps the day it was done; one that
/// is no longer done (a later miss, an undone answer) has it cleared. The
/// first time it is done is kept as `learned_at` and never cleared: from
/// then on the word is a review word in the other chapters ([`is_review`]),
/// and the ones that have answers there are brought up to date with it: one
/// that already has its check passed is done at once.
pub fn sync_done(conn: &Connection, word_id: &str, now: DateTime<Utc>) -> Result<()> {
    let word = SessionWord {
        word_id: word_id.to_owned(),
        review: is_review(conn, word_id)?,
        answers: answers(conn, word_id)?,
    };
    let done = word.is_done();
    conn.execute(
        "UPDATE chapter_words
         SET done_at = CASE WHEN ?2 THEN COALESCE(done_at, ?3) END
         WHERE id = ?1",
        params![word_id, done, ts(now)],
    )?;
    if !done {
        return Ok(());
    }
    let learned = conn.execute(
        "UPDATE chapter_words SET learned_at = ?2 WHERE id = ?1 AND learned_at IS NULL",
        params![word_id, ts(now)],
    )?;
    if learned == 0 {
        return Ok(());
    }
    // A word is learned once, so this goes no further than its key's words.
    let mut stmt = conn.prepare(
        "SELECT o.id FROM chapter_words w JOIN chapter_words o ON o.key = w.key
         WHERE w.id = ?1 AND o.chapter_id != w.chapter_id AND o.done_at IS NULL
           AND o.id IN (SELECT word_id FROM word_answers)",
    )?;
    let elsewhere = stmt
        .query_map([word_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for other in elsewhere {
        sync_done(conn, &other, now)?;
    }
    Ok(())
}

/// Keeps one answer and brings the word's `done_at` up to date; run it
/// inside a transaction. Returns the answer's place among all answers.
pub fn record(
    conn: &Connection,
    sitting_id: &str,
    (word_id, direction): (&str, Direction),
    (answer, correct): (&str, bool),
    now: DateTime<Utc>,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO word_answers (word_id, direction, sitting_id, answer, correct, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![word_id, direction, sitting_id, answer, correct, ts(now)],
    )?;
    let seq = conn.last_insert_rowid();
    sync_done(conn, word_id, now)?;
    Ok(seq)
}

/// Says which sentence of the word's bank an answer was given to: that is
/// one more time the sentence was shown.
pub fn tag(conn: &Connection, seq: i64, sentence_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE word_answers SET sentence_id = ?2 WHERE seq = ?1",
        params![seq, sentence_id],
    )?;
    Ok(())
}

/// Takes an answer back as if it had never been given, and with it the end
/// of its sitting, if it had ended: the word stands where it stood before.
/// A word this answer finished for the first time is not learned yet.
pub fn void(conn: &Connection, answer: &AnswerRow, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE chapter_words SET learned_at = NULL
         WHERE id = ?1
           AND learned_at >= (SELECT created_at FROM word_answers WHERE seq = ?2)",
        params![answer.word_id, answer.seq],
    )?;
    conn.execute("DELETE FROM word_answers WHERE seq = ?1", [answer.seq])?;
    conn.execute(
        "UPDATE practice_sittings SET finished_at = NULL WHERE id = ?1",
        [&answer.sitting_id],
    )?;
    sync_done(conn, &answer.word_id, now)
}

/// Whether the answer is the last one given in its sitting.
pub fn is_latest(conn: &Connection, answer: &AnswerRow) -> Result<bool> {
    let latest: Option<i64> = conn.query_row(
        "SELECT MAX(seq) FROM word_answers WHERE sitting_id = ?1",
        [&answer.sitting_id],
        |row| row.get(0),
    )?;
    Ok(latest == Some(answer.seq))
}

/// Words finished in the session, of the ones it was started with, and words
/// of its chapter still open: neither finished nor known.
pub fn summary(conn: &Connection, sitting: &SittingRow) -> Result<SittingSummary> {
    let done = conn.query_row(
        "SELECT COUNT(*) FROM chapter_words
         WHERE done_at IS NOT NULL
           AND id IN (SELECT word_id FROM practice_session_words WHERE sitting_id = ?1)",
        [&sitting.id],
        |row| row.get(0),
    )?;
    let open = open_words(conn, &sitting.chapter_id)?;
    Ok(SittingSummary { done, open })
}
