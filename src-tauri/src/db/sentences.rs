//! The bank of sentences each word is asked with, by the word's key and
//! the chapter whose sense of it each one shows. How often one was shown is
//! counted from the answers that name it; which one comes next is
//! `books::sentences`.

use chrono::{DateTime, Utc};
use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::practice::NOT_KNOWN;
use super::{new_id, ts};
use crate::books::sentences::{affirmed, other_hints, unaided};
use crate::books::vocab;
use crate::domain::{PartOfSpeech, VerbForm};
use crate::error::Result;

/// One sentence of a word's bank.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sentence {
    pub id: String,
    pub key: String,
    /// From the book, not written by the model.
    pub book: bool,
    /// The sentence, in English.
    pub text: String,
    /// The word as the sentence writes it: what fills its blank.
    pub form: String,
    /// That form in the learner's language.
    pub hint: String,
    /// The sentence in the learner's language.
    pub translation: String,
    /// Times it was shown: the answers given to it, anywhere, the ones
    /// understood only with it among them.
    pub shows: u32,
    /// The other English words its hint could be answered with, as the
    /// second look listed them; none while it has not been labelled.
    pub also: Vec<String>,
    /// The word's other translations in the form the hint has, as the
    /// second look listed them; none while it has not been labelled.
    pub hints: Vec<String>,
    /// The form a verb has in the sentence; none for any other word, and
    /// while it has not been labelled.
    pub verb_form: Option<VerbForm>,
    /// The chapter whose sense of the word it shows; none for a word of a
    /// conversation.
    pub chapter_id: Option<String>,
    /// The words of the sentence, besides the word, that fix the sense it
    /// has there; none while it has not been looked at for them.
    pub cue: Option<Vec<String>>,
}

const SENTENCE: &str = "SELECT s.id, s.key, s.source = 'book', s.sentence, s.form, s.hint,
            s.translation,
            (SELECT COUNT(*) FROM word_answers a WHERE a.sentence_id = s.id)
              + (SELECT COUNT(*) FROM word_events e WHERE e.sentence_id = s.id)
              + (SELECT COUNT(*) FROM understood_answers u WHERE u.sentence_id = s.id)
              + (SELECT COUNT(*) FROM understood_recalls r WHERE r.sentence_id = s.id),
            COALESCE(s.also, '[]'), COALESCE(s.hints, '[]'), s.verb_form, s.chapter_id,
            s.cue
     FROM word_sentences s";

/// A list kept as a JSON array in the column `at`.
fn list(row: &Row<'_>, at: usize) -> rusqlite::Result<Vec<String>> {
    let json: String = row.get(at)?;
    serde_json::from_str(&json)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(at, Type::Text, error.into()))
}

fn sentence(row: &Row<'_>) -> rusqlite::Result<Sentence> {
    Ok(Sentence {
        id: row.get(0)?,
        key: row.get(1)?,
        book: row.get(2)?,
        text: row.get(3)?,
        form: row.get(4)?,
        hint: row.get(5)?,
        translation: row.get(6)?,
        shows: row.get(7)?,
        also: list(row, 8)?,
        hints: list(row, 9)?,
        verb_form: row.get(10)?,
        chapter_id: row.get(11)?,
        cue: row
            .get::<_, Option<String>>(12)?
            .map(|json| {
                serde_json::from_str(&json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(12, Type::Text, error.into())
                })
            })
            .transpose()?,
    })
}

/// The sentences a word can be asked with: looked at and found good, and
/// not called bad since. With a `chapter`, only those of that chapter's
/// sense of it; without, those of every chapter. The oldest first.
pub fn bank(conn: &Connection, key: &str, chapter: Option<&str>) -> Result<Vec<Sentence>> {
    let mut stmt = conn.prepare(&format!(
        "{SENTENCE} WHERE s.key = ?1 AND s.reviewed AND NOT s.discarded
           AND (?2 IS NULL OR s.chapter_id = ?2)
         ORDER BY s.created_at, s.rowid"
    ))?;
    let rows = stmt.query_map(params![key, chapter], sentence)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// One sentence a word can be asked with; none for one that is not in its
/// bank any more, or never was.
pub fn usable(conn: &Connection, id: &str) -> Result<Option<Sentence>> {
    Ok(conn
        .query_row(
            &format!("{SENTENCE} WHERE s.id = ?1 AND s.reviewed AND NOT s.discarded"),
            [id],
            sentence,
        )
        .optional()?)
}

/// A sentence and the form the word has in it, whatever became of it since
/// it was asked with.
pub fn text(conn: &Connection, id: &str) -> Result<Option<(String, String)>> {
    Ok(conn
        .query_row(
            "SELECT sentence, form FROM word_sentences WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

/// The other English words the hint of a sentence could be answered with,
/// whatever became of the sentence since it was asked with.
pub fn also(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let kept: Option<String> = conn
        .query_row(
            "SELECT COALESCE(also, '[]') FROM word_sentences WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(kept
        .map(|json| serde_json::from_str(&json))
        .transpose()?
        .unwrap_or_default())
}

/// Every form the word has in a sentence it was ever given.
pub fn forms(conn: &Connection, key: &str) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT form FROM word_sentences WHERE key = ?1 AND form != ''")?;
    let rows = stmt.query_map([key], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Whether the word was ever given a sentence of this chapter, whatever
/// came of it: one that was is not asked about again there.
pub fn given(conn: &Connection, key: &str, chapter: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM word_sentences
                        WHERE key = ?1 AND chapter_id = ?2 AND source = 'book')",
        [key, chapter],
        |row| row.get(0),
    )?)
}

/// Whether the model was asked to write sentences for the word in this
/// chapter's sense, whatever came of it.
pub fn written(conn: &Connection, key: &str, chapter: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sentence_writes WHERE key = ?1 AND chapter_id = ?2)",
        [key, chapter],
        |row| row.get(0),
    )?)
}

/// The model was asked to write sentences for the word in this chapter's
/// sense: it is not asked again.
pub fn wrote(conn: &Connection, key: &str, chapter: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO sentence_writes (key, chapter_id, created_at) VALUES (?1, ?2, ?3)",
        params![key, chapter, ts(now)],
    )?;
    Ok(())
}

/// More sentences were asked for the word in this chapter's sense, after
/// the first ones.
pub fn refilled(conn: &Connection, key: &str, chapter: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "INSERT INTO sentence_refills (key, chapter_id, created_at) VALUES (?1, ?2, ?3)",
        params![key, chapter, ts(now)],
    )?;
    Ok(())
}

/// When the model was last asked to write sentences for the word in this
/// chapter's sense; none if it never was.
pub fn last_write(conn: &Connection, key: &str, chapter: &str) -> Result<Option<DateTime<Utc>>> {
    let at: Option<String> = conn.query_row(
        "SELECT MAX(created_at) FROM (
           SELECT created_at FROM sentence_writes WHERE key = ?1 AND chapter_id = ?2
           UNION ALL
           SELECT created_at FROM sentence_refills WHERE key = ?1 AND chapter_id = ?2)",
        [key, chapter],
        |row| row.get(0),
    )?;
    super::parse_ts_opt(at.as_deref())
}

/// The sentence the word was asked with the last time, anywhere; none if
/// it never was asked with one.
pub fn last_shown(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT shown.id FROM (
               SELECT s.id, a.created_at AS at FROM word_answers a
                 JOIN word_sentences s ON s.id = a.sentence_id WHERE s.key = ?1
               UNION ALL
               SELECT s.id, e.created_at FROM word_events e
                 JOIN word_sentences s ON s.id = e.sentence_id WHERE s.key = ?1
               UNION ALL
               SELECT s.id, u.created_at FROM understood_answers u
                 JOIN word_sentences s ON s.id = u.sentence_id WHERE s.key = ?1
               UNION ALL
               SELECT s.id, r.created_at FROM understood_recalls r
                 JOIN word_sentences s ON s.id = r.sentence_id WHERE s.key = ?1
             ) shown ORDER BY shown.at DESC LIMIT 1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

/// Whether the chapter is of a deleted book: the sentences of its text are
/// not asked about any more.
pub fn archived(conn: &Connection, chapter: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM book_chapters c
                        JOIN archived_books a ON a.book_id = c.book_id WHERE c.id = ?1)",
        [chapter],
        |row| row.get(0),
    )?)
}

/// What a sentence is kept with.
pub struct NewSentence<'a> {
    pub key: &'a str,
    /// The chapter whose sense of the word it shows; none for a word of a
    /// conversation.
    pub chapter: Option<&'a str>,
    pub book: bool,
    pub sentence: &'a str,
    pub form: &'a str,
    pub hint: &'a str,
    pub translation: &'a str,
}

/// Keeps a sentence, to be looked at before it is used. One the word
/// already has is left as it is.
pub fn add(conn: &Connection, new: &NewSentence<'_>, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO word_sentences
           (id, key, source, sentence, form, hint, translation, created_at, chapter_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            new_id(),
            new.key,
            if new.book { "book" } else { "model" },
            new.sentence,
            new.form,
            new.hint,
            new.translation,
            ts(now),
            new.chapter
        ],
    )?;
    Ok(())
}

/// A sentence of the chapter that is never to be asked with, kept so that
/// it is not asked about again: one whose gloss the code refused.
pub fn refuse(
    conn: &Connection,
    (key, chapter): (&str, &str),
    sentence: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO word_sentences
           (id, key, source, sentence, form, hint, translation, reviewed, discarded, created_at,
            chapter_id)
         VALUES (?1, ?2, 'book', ?3, '', '', '', 1, 1, ?4, ?5)",
        params![new_id(), key, sentence, ts(now), chapter],
    )?;
    Ok(())
}

/// The sentences waiting to be looked at, the oldest first.
pub fn unreviewed(conn: &Connection) -> Result<Vec<Sentence>> {
    let mut stmt = conn.prepare(&format!(
        "{SENTENCE} WHERE NOT s.reviewed ORDER BY s.created_at, s.rowid"
    ))?;
    let rows = stmt.query_map([], sentence)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What the second look says of a sentence beside whether it is good.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Labels {
    /// The other English words its hint could be answered with.
    pub also: Vec<String>,
    /// The word's other translations, in the form the hint has.
    pub hints: Vec<String>,
    /// The form a verb has in it.
    pub verb_form: Option<VerbForm>,
    /// The words of it that fix the sense its word has there.
    pub cue: Vec<String>,
}

/// A sentence was looked at: a good one can be asked with from now on.
pub fn review(conn: &Connection, id: &str, good: bool, labels: &Labels) -> Result<()> {
    conn.execute(
        "UPDATE word_sentences SET reviewed = 1, discarded = ?2, also = NULL WHERE id = ?1",
        params![id, !good],
    )?;
    label(conn, id, labels)
}

/// The sentences asked with that were looked at before one of its labels
/// was asked for, the oldest first: the other English words for their hint,
/// or the word's other translations in the form of the hint; and, for a
/// word some other word is written alike to, the words that fix its sense.
pub fn unlabelled(conn: &Connection) -> Result<Vec<Sentence>> {
    let mut stmt = conn.prepare(&format!(
        "{SENTENCE} WHERE s.reviewed AND NOT s.discarded
           AND (s.also IS NULL OR s.hints IS NULL
                OR (s.cue IS NULL AND EXISTS (
                      SELECT 1 FROM chapter_words w
                      JOIN word_spellings a ON a.word_id = w.id
                      JOIN word_spellings b ON b.text = a.text AND b.word_id != a.word_id
                      WHERE w.key = s.key AND (a.whole OR b.whole))))
         ORDER BY s.created_at, s.rowid"
    ))?;
    let rows = stmt.query_map([], sentence)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What the second look says of a sentence ([`Labels`]). The other English
/// words it already has are kept: a sentence labelled again for something
/// else does not lose them to a look that says nothing of it.
pub fn label(conn: &Connection, id: &str, labels: &Labels) -> Result<()> {
    conn.execute(
        "UPDATE word_sentences SET also = COALESCE(also, ?2), hints = ?3, verb_form = ?4, cue = ?5
         WHERE id = ?1",
        params![
            id,
            serde_json::to_string(&labels.also)?,
            serde_json::to_string(&labels.hints)?,
            labels.verb_form,
            serde_json::to_string(&labels.cue)?
        ],
    )?;
    Ok(())
}

/// A sentence is glossed again, and looked at again: it keeps its place in
/// the bank and the answers given to it, with what it is now said to be.
pub fn regloss(conn: &Connection, sentence: &Sentence, labels: &Labels) -> Result<()> {
    conn.execute(
        "UPDATE word_sentences
         SET hint = ?2, translation = ?3, also = ?4, hints = ?5, verb_form = ?6, cue = ?7
         WHERE id = ?1",
        params![
            sentence.id,
            sentence.hint,
            sentence.translation,
            serde_json::to_string(&labels.also)?,
            serde_json::to_string(&labels.hints)?,
            labels.verb_form,
            serde_json::to_string(&labels.cue)?
        ],
    )?;
    Ok(())
}

/// Gives every sentence kept its hint and its other hints without the words
/// of the learner's `lang` for English ones outside its form
/// (`books::sentences::unaided`): a sentence glossed before this was asked
/// for is asked as one glossed now. Changes nothing the second time; how
/// many sentences it changed.
///
/// A sentence already looked at also loses what a negation outside its
/// form gives its hints (`books::sentences::affirmed`): "tendría ninguna
/// oportunidad" for "stand a chance" in "wouldn't stand a chance". One not
/// looked at yet keeps it until it is, so that it is looked at as the
/// words its translation has.
pub fn unaid(conn: &Connection, lang: &str) -> Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT id, form, hint, COALESCE(hints, '[]'), hints IS NULL, key, sentence, reviewed,
                chapter_id
         FROM word_sentences WHERE hint != ''",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Kept {
                id: row.get(0)?,
                form: row.get(1)?,
                hint: row.get(2)?,
                hints: list(row, 3)?,
                unlabelled: row.get(4)?,
                key: row.get(5)?,
                sentence: row.get(6)?,
                reviewed: row.get(7)?,
                chapter_id: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut changed = 0_usize;
    for row in rows {
        let (mut new_hint, mut new_hints) = unaided_all(&row, lang, &[]);
        if row.reviewed && (new_hint != row.hint || new_hints != row.hints) {
            // The word's own translations decide what is its own: read only
            // for the few sentences a negation outside the form changes.
            let (_, base) = meaning(conn, &row.key, row.chapter_id.as_deref())?;
            (new_hint, new_hints) = unaided_all(&row, lang, &base);
        }
        if new_hint == row.hint && new_hints == row.hints {
            continue;
        }
        // One not labelled yet stays so: the next run labels it.
        let json = (!row.unlabelled)
            .then(|| serde_json::to_string(&new_hints))
            .transpose()?;
        conn.execute(
            "UPDATE word_sentences SET hint = ?2, hints = ?3 WHERE id = ?1",
            params![row.id, new_hint, json],
        )?;
        changed += 1;
    }
    Ok(changed)
}

/// A sentence kept, as [`unaid`] reads it.
struct Kept {
    id: String,
    key: String,
    sentence: String,
    form: String,
    hint: String,
    hints: Vec<String>,
    unlabelled: bool,
    reviewed: bool,
    chapter_id: Option<String>,
}

/// The hint and the other hints of a sentence kept, without the words for
/// English ones outside its form and, once it was looked at, without what
/// a negation outside it gives them; `base` is the word's translations.
fn unaided_all(row: &Kept, lang: &str, base: &[String]) -> (String, Vec<String>) {
    // Without its "no" first: the auxiliary after it is then the first word.
    let clear = |hint: &str| {
        let hint = if row.reviewed {
            affirmed(hint, (&row.form, &row.sentence), base, lang)
        } else {
            hint.to_owned()
        };
        unaided(&hint, &row.form, lang)
    };
    let hint = clear(&row.hint);
    let listed: Vec<String> = row.hints.iter().map(|each| clear(each)).collect();
    let hints = other_hints(&listed, (&hint, &row.form, lang), &[]);
    (hint, hints)
}

/// The other words the learner has that are shown as one of these
/// `translations`, in every form their chapters write them: what a learner
/// asked for the word of `key` in English may well type instead of it.
pub fn rivals(conn: &Connection, key: &str, translations: &[String]) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT w.lemma, w.forms FROM chapter_words w
         JOIN word_translations t ON t.word_id = w.id AND t.source = 'extraction'
         WHERE w.key != ?1 AND t.text IN (SELECT value FROM json_each(?2))
         ORDER BY w.created_at, w.id",
    )?;
    let rows = stmt
        .query_map(params![key, serde_json::to_string(translations)?], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
    let mut all = Vec::new();
    for (lemma, forms) in rows {
        all.push(lemma);
        all.extend(serde_json::from_str::<Vec<String>>(&forms)?);
    }
    Ok(all)
}

/// The learner called the sentence bad: it is not asked with again.
pub fn discard(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE word_sentences SET discarded = 1 WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// What kind of word a chapter's word is, when the chapter says.
pub fn part_of_speech(conn: &Connection, word_id: &str) -> Result<Option<PartOfSpeech>> {
    Ok(conn.query_row(
        "SELECT part_of_speech FROM chapter_words WHERE id = ?1",
        [word_id],
        |row| row.get(0),
    )?)
}

/// The words of a chapter the learner has not said they know, each with its
/// key: the ones still to learn first, most frequent first.
pub fn chapter_keys(conn: &Connection, chapter_id: &str) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT w.id, w.key FROM chapter_words w
         WHERE w.chapter_id = ?1 AND {NOT_KNOWN}
         ORDER BY w.done_at IS NOT NULL, w.occurrences DESC, w.key"
    ))?;
    let rows = stmt.query_map([chapter_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The text of a chapter: the only one whose sentences show its sense of
/// its words.
pub fn chapter_text(conn: &Connection, chapter_id: &str) -> Result<String> {
    Ok(conn.query_row(
        "SELECT text FROM book_chapters WHERE id = ?1",
        [chapter_id],
        |row| row.get(0),
    )?)
}

/// The word of `key` as a chapter has it; none when that chapter does not.
pub fn word_in(conn: &Connection, key: &str, chapter: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM chapter_words WHERE key = ?1 AND chapter_id = ?2",
            [key, chapter],
            |row| row.get(0),
        )
        .optional()?)
}

/// Whether a chapter, this one or another of any book, has a word written
/// alike to `word_id` that does not mean exactly the same
/// (`db::spellings::rivals`).
pub fn senses_differ(conn: &Connection, word_id: &str) -> Result<bool> {
    Ok(!super::spellings::rivals(conn, word_id)?.is_empty())
}

/// What a word is called and what it means, by its key: as `chapter` says
/// when it has the word, otherwise as the first chapter that has it says,
/// the translation the learner answers with most first; or, for a word of a
/// conversation, as it was asked for there. A key nothing has any more is
/// its own name.
pub fn meaning(
    conn: &Connection,
    key: &str,
    chapter: Option<&str>,
) -> Result<(String, Vec<String>)> {
    let of_book: Option<(String, String)> = conn
        .query_row(
            "SELECT id, lemma FROM chapter_words WHERE key = ?1
             ORDER BY chapter_id IS NOT ?2, created_at, id LIMIT 1",
            params![key, chapter],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((word_id, lemma)) = of_book {
        let part = part_of_speech(conn, &word_id)?;
        let used = super::words::Used::load(conn, Some(key))?;
        return Ok((lemma, used.order(conn, (key, &word_id), part)?));
    }
    let mut stmt = conn.prepare(
        "SELECT english, asked FROM vocab WHERE asked IS NOT NULL ORDER BY created_at, rowid",
    )?;
    let asked = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(asked
        .into_iter()
        .find(|(english, _)| vocab::key(english) == key)
        .map_or_else(
            || (key.to_owned(), Vec::new()),
            |(english, asked)| (english, vec![asked]),
        ))
}
