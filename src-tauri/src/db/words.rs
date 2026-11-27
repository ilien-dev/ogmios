//! The words of prepared chapters, the pieces of an extraction still under
//! way, and the words the learner already knows.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::profile::get_profile;
use super::{found, new_id, parse_ts, ts};
use crate::agent::protocol::{CheckWord, LabelWord, RelatedWord, VocabItem, WordCheck};
use crate::books::practice::{inflects, preferred};
use crate::books::sentences::affirmed_base;
use crate::books::vocab::{called_in_form, key, tokens, Word};
use crate::domain::{BookWord, Depth, Direction, KnownWord, PartOfSpeech, VerbForm};
use crate::error::Result;

/// The right answers the learner gave English → native, by the key of their
/// word: in practice and the refresh of any chapter, and in the daily
/// recall. They say which translation of a word the learner uses
/// (`books::practice::preferred`), and nothing of it is stored: the order
/// is read off them every time.
pub struct Used {
    native: String,
    answers: HashMap<String, Vec<String>>,
}

impl Used {
    /// The answers given to the word of `key`, or to every word.
    pub fn load(conn: &Connection, key: Option<&str>) -> Result<Self> {
        let native = get_profile(conn)?.map_or_default(|profile| profile.native_lang);
        let mut stmt = conn.prepare(
            "SELECT w.key, a.answer FROM word_answers a
             JOIN chapter_words w ON w.id = a.word_id
             WHERE a.correct = 1 AND a.direction = ?2 AND (?1 IS NULL OR w.key = ?1)
             UNION ALL
             SELECT e.key, e.answer FROM word_events e
             WHERE e.kind = 'right' AND e.direction = ?2 AND e.answer IS NOT NULL
               AND (?1 IS NULL OR e.key = ?1)",
        )?;
        let rows = stmt.query_map(params![key, Direction::Recognition], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut answers: HashMap<String, Vec<String>> = HashMap::new();
        for row in rows {
            let (key, answer) = row?;
            answers.entry(key).or_default().push(answer);
        }
        Ok(Self { native, answers })
    }

    /// The translations the chapter's word `id`, of `key`, was prepared
    /// with ([`extracted`]), the one the learner answers with most first.
    pub fn order(
        &self,
        conn: &Connection,
        (key, id): (&str, &str),
        part: Option<PartOfSpeech>,
    ) -> Result<Vec<String>> {
        let shown = extracted(conn, id)?;
        Ok(match self.answers.get(key) {
            Some(answers) => {
                let forms = in_forms(conn, id)?;
                preferred(shown, &forms, answers, (&self.native, inflects(part)))
            }
            None => shown,
        })
    }
}

/// The pieces already answered for this chapter at this depth, by index.
/// Pieces kept for another depth, or cut from a text divided differently,
/// are of no use any more and go.
pub fn stored_chunks(
    conn: &Connection,
    chapter_id: &str,
    depth: Depth,
    total: u32,
) -> Result<BTreeMap<u32, Vec<VocabItem>>> {
    conn.execute(
        "DELETE FROM chapter_chunks WHERE chapter_id = ?1 AND (depth != ?2 OR total != ?3)",
        params![chapter_id, depth, total],
    )?;
    let mut stmt =
        conn.prepare("SELECT idx, items FROM chapter_chunks WHERE chapter_id = ?1 AND depth = ?2")?;
    let rows = stmt.query_map(params![chapter_id, depth], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut found = BTreeMap::new();
    for row in rows {
        let (idx, items) = row?;
        found.insert(idx, serde_json::from_str(&items)?);
    }
    Ok(found)
}

/// Keeps the answer for one piece. Asked twice, the first answer stays.
pub fn store_chunk(
    conn: &Connection,
    chapter_id: &str,
    depth: Depth,
    (idx, total): (u32, u32),
    items: &[VocabItem],
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO chapter_chunks (chapter_id, depth, idx, total, items)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![chapter_id, depth, idx, total, serde_json::to_string(items)?],
    )?;
    Ok(())
}

/// The keys never extracted for any chapter: the words the learner said
/// they know. A word finished in another chapter is left out later, by its
/// sense ([`finish`]): written the same, it may mean something else here.
pub fn excluded(conn: &Connection) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT key FROM known_words")?;
    let keys = stmt.query_map([], |row| row.get(0))?;
    Ok(keys.collect::<rusqlite::Result<_>>()?)
}

/// Whether a word just stored means what a word finished in another chapter
/// means: of the same sense (`db::senses`). It is learned already.
fn learned_elsewhere(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (
           SELECT 1 FROM chapter_words w JOIN chapter_words o ON o.sense_id = w.sense_id
           WHERE w.id = ?1 AND o.id != w.id AND o.chapter_id != w.chapter_id
             AND o.done_at IS NOT NULL)",
        [id],
        |row| row.get(0),
    )?)
}

/// Stores the chapter's words at this depth and forgets the pieces they came
/// from; run it inside a transaction. A word the chapter already has is left
/// exactly as it is: a deeper depth only adds. A word that means what one
/// finished in another chapter means is not stored: it is learned. Written
/// the same in another sense ("bug", the insect, learned; "bug", the error,
/// here) it is a word to learn.
pub fn finish(
    conn: &Connection,
    chapter_id: &str,
    depth: Depth,
    words: &[Word],
    now: DateTime<Utc>,
) -> Result<()> {
    let mut insert = conn.prepare(
        "INSERT OR IGNORE INTO chapter_words
           (id, chapter_id, key, lemma, forms, sentence, needs_context, occurrences, depth,
            created_at, part_of_speech, transitive, base, verb_form)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
    )?;
    let mut translate =
        conn.prepare("INSERT OR IGNORE INTO word_translations (word_id, text) VALUES (?1, ?2)")?;
    for word in words {
        let id = new_id();
        let added = insert.execute(params![
            id,
            chapter_id,
            word.key,
            word.lemma,
            serde_json::to_string(&word.forms)?,
            word.sentence,
            word.needs_context,
            word.count,
            depth,
            ts(now),
            word.part_of_speech,
            word.transitive,
            word.base,
            word.verb_form
        ])?;
        if added == 1 {
            for translation in &word.translations {
                translate.execute(params![id, translation])?;
            }
            super::senses::assign(conn, &id)?;
            if learned_elsewhere(conn, &id)? {
                conn.execute("DELETE FROM chapter_words WHERE id = ?1", [&id])?;
            }
        }
    }
    conn.execute(
        "UPDATE book_chapters SET prepared = ?2 WHERE id = ?1",
        params![chapter_id, depth],
    )?;
    conn.execute(
        "DELETE FROM chapter_chunks WHERE chapter_id = ?1",
        [chapter_id],
    )?;
    Ok(())
}

/// The keys of the words the chapter asks: the ones it has that the learner
/// has not said they know.
pub fn asked(conn: &Connection, chapter_id: &str) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT key FROM chapter_words
         WHERE chapter_id = ?1 AND key NOT IN (SELECT key FROM known_words)",
    )?;
    let keys = stmt.query_map([chapter_id], |row| row.get(0))?;
    Ok(keys.collect::<rusqlite::Result<_>>()?)
}

/// The chapter's word with this key, if it has it.
pub fn id_by_key(conn: &Connection, chapter_id: &str, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM chapter_words WHERE chapter_id = ?1 AND key = ?2",
            params![chapter_id, key],
            |row| row.get(0),
        )
        .optional()?)
}

/// Adds one word to a chapter outside its preparation: one the learner
/// asked to practise. It goes in at the depth the chapter was prepared at;
/// a chapter never prepared is from then on prepared at the narrowest
/// depth, which leaves every wider one on offer. A word the chapter has is
/// left as it is. Run it inside a transaction.
pub fn add(conn: &Connection, chapter_id: &str, word: &Word, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE book_chapters SET prepared = COALESCE(prepared, ?2) WHERE id = ?1",
        params![chapter_id, Depth::Hardest],
    )?;
    let id = new_id();
    let added = conn.execute(
        "INSERT OR IGNORE INTO chapter_words
           (id, chapter_id, key, lemma, forms, sentence, needs_context, occurrences, depth,
            created_at, part_of_speech, transitive, base, verb_form)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                 (SELECT prepared FROM book_chapters WHERE id = ?2), ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            chapter_id,
            word.key,
            word.lemma,
            serde_json::to_string(&word.forms)?,
            word.sentence,
            word.needs_context,
            word.count,
            ts(now),
            word.part_of_speech,
            word.transitive,
            word.base,
            word.verb_form
        ],
    )?;
    if added == 1 {
        for translation in &word.translations {
            conn.execute(
                "INSERT OR IGNORE INTO word_translations (word_id, text) VALUES (?1, ?2)",
                params![id, translation],
            )?;
        }
        super::senses::assign(conn, &id)?;
    }
    Ok(())
}

/// Marks the word as one the learner knows, or takes that back. It is known
/// by its key, so it is in every chapter of every book at once: it leaves
/// their queues and counts towards their readiness, and no later chapter
/// extracts it. Its rows and their answers are left alone, so taking it back
/// puts it where it was. Returns the chapter the word was marked in.
pub fn set_known(
    conn: &Connection,
    word_id: &str,
    known: bool,
    now: DateTime<Utc>,
) -> Result<String> {
    let (chapter_id, key, lemma): (String, String, String) = found(
        conn.query_row(
            "SELECT chapter_id, key, lemma FROM chapter_words WHERE id = ?1",
            [word_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ),
        "word",
    )?;
    if known {
        conn.execute(
            "INSERT OR IGNORE INTO known_words (key, lemma, created_at) VALUES (?1, ?2, ?3)",
            params![key, lemma, ts(now)],
        )?;
    } else {
        forget(conn, &key)?;
    }
    Ok(chapter_id)
}

/// Keeps that the learner, sorting the chapter's list, left the word to
/// learn, or takes that back: the next sorting starts after the words that
/// have it. Returns the word's chapter.
pub fn set_sorted(
    conn: &Connection,
    word_id: &str,
    sorted: bool,
    now: DateTime<Utc>,
) -> Result<String> {
    let chapter_id = found(
        conn.query_row(
            "UPDATE chapter_words SET sorted_at = ?2 WHERE id = ?1 RETURNING chapter_id",
            params![word_id, sorted.then(|| ts(now))],
            |row| row.get(0),
        ),
        "word",
    )?;
    Ok(chapter_id)
}

/// Has the whole chapter to be sorted again: another pass over its list.
pub fn unsort(conn: &Connection, chapter_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE chapter_words SET sorted_at = NULL WHERE chapter_id = ?1",
        [chapter_id],
    )?;
    Ok(())
}

/// Takes back that the learner knows the word with this key: it is asked
/// again wherever a chapter has it. A key that is not known changes nothing.
pub fn forget(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM known_words WHERE key = ?1", [key])?;
    Ok(())
}

/// The rows of `word_translations` (`t`) of a word and of every word of
/// its sense (`w`), its own first and then the oldest word's: a word means
/// what its sense means, whatever chapter said it (`db::senses`).
pub const OF_SENSE: &str = "FROM word_translations t JOIN chapter_words w ON w.id = t.word_id
         WHERE (w.id = ?1 OR w.sense_id = (SELECT sense_id FROM chapter_words WHERE id = ?1))";
pub const SENSE_ORDER: &str = "ORDER BY w.id != ?1, w.created_at, w.rowid, t.rowid";
/// Whether the word of a row (`w`) is called by the form the word asked
/// about is: only then is what its translation is in that form the same.
/// "partió" is "partir" for "set off" in the past, never in its base form.
pub const SAME_FORM: &str =
    "(w.id = ?1 OR w.verb_form IS (SELECT verb_form FROM chapter_words WHERE id = ?1))";

/// The translations the words of a word's sense were prepared with, its
/// own first, each once: an answer a dispute upheld is accepted in practice
/// and listed nowhere.
pub fn extracted(conn: &Connection, word_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT t.text {OF_SENSE} AND t.source = 'extraction' {SENSE_ORDER}"
    ))?;
    let rows = stmt
        .query_map([word_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    let mut seen: Vec<String> = Vec::new();
    Ok(rows
        .into_iter()
        .filter(|each| {
            let same = key(each);
            let new = !seen.contains(&same);
            seen.push(same);
            new
        })
        .collect())
}

/// Every form each translation a chapter's word was prepared with was said
/// in for the form the word is called by: "chorreó" and "chorreaba" for
/// "chorrear", of "trickled". An answer in one of them is that translation.
fn in_forms(conn: &Connection, word_id: &str) -> Result<HashMap<String, Vec<String>>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT t.text, t.in_form, t.in_form_also {OF_SENSE} AND {SAME_FORM}
           AND t.source = 'extraction' AND t.in_form IS NOT NULL {SENSE_ORDER}"
    ))?;
    let rows = stmt
        .query_map([word_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<Vec<(String, String, Option<String>)>>>()?;
    let mut forms = HashMap::new();
    for (text, in_form, also) in rows {
        let mut all = vec![in_form];
        if let Some(also) = also {
            all.extend(serde_json::from_str::<Vec<String>>(&also)?);
        }
        forms.entry(text).or_insert(all);
    }
    Ok(forms)
}

/// What each translation a chapter's word was prepared with is in the form
/// the word is called by, of those a model has said it of.
pub fn said_in_form(conn: &Connection, word_id: &str) -> Result<HashMap<String, String>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT t.text, t.in_form {OF_SENSE} AND {SAME_FORM}
           AND t.source = 'extraction' AND t.in_form IS NOT NULL {SENSE_ORDER}"
    ))?;
    let rows = stmt
        .query_map([word_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
    let mut said = HashMap::new();
    for (text, in_form) in rows {
        said.entry(text).or_insert(in_form);
    }
    Ok(said)
}

/// The `shown` translations of a word called by another form than its base
/// form, each in that form: "jurado" for "jurar" when the word is "sworn".
/// None for a word called by its base form, and until every one of them was
/// said in its form: half of them in it would read as two words.
pub fn as_called(
    shown: &[String],
    said: &HashMap<String, String>,
    called_by_base: bool,
) -> Option<Vec<String>> {
    if called_by_base || shown.is_empty() {
        return None;
    }
    shown.iter().map(|text| said.get(text).cloned()).collect()
}

/// Every word the learner said they know, the latest first. Its translations
/// are the ones the first chapter that has it was prepared with, the one the
/// learner answers with most first, of a deleted book too; a word no chapter
/// has has none.
pub fn known(conn: &Connection) -> Result<Vec<KnownWord>> {
    let mut stmt =
        conn.prepare("SELECT key, lemma FROM known_words ORDER BY created_at DESC, key")?;
    let mut words = stmt
        .query_map([], |row| {
            Ok(KnownWord {
                key: row.get(0)?,
                lemma: row.get(1)?,
                translations: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stmt = conn.prepare(
        "SELECT id, part_of_speech FROM chapter_words
         WHERE key = ?1 ORDER BY created_at, id LIMIT 1",
    )?;
    let used = Used::load(conn, None)?;
    for word in &mut words {
        let first: Option<(String, Option<PartOfSpeech>)> = stmt
            .query_row([&word.key], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?;
        if let Some((id, part)) = first {
            word.translations = used.order(conn, (&word.key, &id), part)?;
        }
    }
    Ok(words)
}

/// A finished book word for the progress map.
#[derive(Debug, Clone, PartialEq)]
pub struct Learned {
    pub lemma: String,
    /// The translation the learner answers with most, or its first.
    pub translation: Option<String>,
    pub done_at: DateTime<Utc>,
}

/// Every finished word, once each however many chapters have it, with the
/// first time it was finished; the earliest first.
pub fn learned(conn: &Connection) -> Result<Vec<Learned>> {
    let mut stmt = conn.prepare(
        "SELECT w.lemma, MIN(w.done_at), w.id, w.key, w.part_of_speech
         FROM chapter_words w WHERE w.done_at IS NOT NULL
         GROUP BY w.key ORDER BY MIN(w.done_at), w.key",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<PartOfSpeech>>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let used = Used::load(conn, None)?;
    rows.into_iter()
        .map(|(lemma, done_at, id, key, part)| {
            let shown = used.order(conn, (&key, &id), part)?;
            Ok(Learned {
                lemma,
                translation: shown.into_iter().next(),
                done_at: parse_ts(&done_at)?,
            })
        })
        .collect()
}

/// The chapter's words, most frequent in it first, each with the
/// translations it was prepared with, the one the learner answers with most
/// first ([`Used`]): in the form the word is called by once that was said
/// ([`as_called`]), as practice shows them, and in their base form until
/// then.
pub fn list(conn: &Connection, chapter_id: &str) -> Result<Vec<BookWord>> {
    let mut stmt = conn.prepare(
        "SELECT id, lemma, occurrences, done_at IS NOT NULL,
                key IN (SELECT key FROM known_words), part_of_speech, key,
                sorted_at IS NOT NULL, verb_form, sentence, base, forms
         FROM chapter_words
         WHERE chapter_id = ?1 ORDER BY occurrences DESC, key",
    )?;
    let strengths = super::recall::strengths(conn)?;
    let words = stmt
        .query_map([chapter_id], |row| {
            let key: String = row.get(6)?;
            let word = BookWord {
                id: row.get(0)?,
                lemma: row.get(1)?,
                part_of_speech: row.get(5)?,
                verb_form: row.get(8)?,
                sentence: row.get(9)?,
                translations: Vec::new(),
                count: row.get(2)?,
                done: row.get(3)?,
                // A known word is in no recall, so it has none.
                strength: strengths.get(&key).copied(),
                half: None,
                known: row.get(4)?,
                sorted: row.get(7)?,
            };
            let called: (Option<String>, String) = (row.get(10)?, row.get(11)?);
            Ok((key, called, word))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let halves = super::practice::halves(conn, chapter_id)?;
    let used = Used::load(conn, None)?;
    words
        .into_iter()
        .map(|(key, (base, forms), mut word)| {
            let forms: Vec<String> = serde_json::from_str(&forms)?;
            let called = (word.lemma.as_str(), base.as_deref());
            let written = (forms.as_slice(), word.sentence.as_str());
            let called_by_base =
                !called_in_form(called, written, word.part_of_speech, word.verb_form);
            word.half = halves.get(&word.id).copied();
            let shown = used.order(conn, (&key, &word.id), word.part_of_speech)?;
            let said = said_in_form(conn, &word.id)?;
            word.translations = as_called(&shown, &said, called_by_base).unwrap_or(shown);
            Ok(word)
        })
        .collect()
}

/// Every word still to be labelled, of any book: its id, what it is called
/// and the sentence it was taken from. One no chapter says the kind of, and
/// a verb nobody said takes an object or not, or the form of: each was
/// stored before that was asked for. So was a verb called by another form
/// than its base form with a translation nobody put in that form: it comes
/// with those translations. A deleted book has only the words answered in
/// it left (`books::archive_book`), and they come back in the recall.
pub fn unlabelled(conn: &Connection) -> Result<Vec<LabelWord>> {
    let mut stmt = conn.prepare(
        "SELECT id, lemma, sentence, base, forms, part_of_speech, verb_form,
                part_of_speech IS NULL
                  OR (part_of_speech IN ('verb', 'phrasalVerb')
                    AND (transitive IS NULL OR verb_form IS NULL))
         FROM chapter_words
         ORDER BY chapter_id, occurrences DESC, key",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let word = LabelWord {
                id: row.get(0)?,
                lemma: row.get(1)?,
                sentence: row.get(2)?,
                translations: Vec::new(),
                verb_form: row.get(6)?,
            };
            let base: Option<String> = row.get(3)?;
            let forms: String = row.get(4)?;
            let kind: (Option<PartOfSpeech>, Option<VerbForm>) = (row.get(5)?, row.get(6)?);
            Ok((word, base, forms, kind, row.get::<_, bool>(7)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // The translations not said yet in the form the word is called by.
    let mut stmt = conn.prepare(
        "SELECT t.text FROM word_translations t
         JOIN chapter_words w ON w.id = t.word_id
         WHERE w.id = ?1 AND t.source = 'extraction'
           AND (t.in_form IS NULL
             OR (w.verb_form = 'past'
               AND (t.in_form_also IS NULL OR t.in_form_persons IS NULL)))
         ORDER BY t.rowid",
    )?;
    let mut words = Vec::new();
    for (mut word, base, forms, (part_of_speech, verb_form), unkind) in rows {
        let forms: Vec<String> = serde_json::from_str(&forms)?;
        let called = (word.lemma.as_str(), base.as_deref());
        if called_in_form(called, (&forms, &word.sentence), part_of_speech, verb_form) {
            // What another chapter says the word means is asked of it too,
            // and is said in its form with its own: it is kept as its own.
            let own: Vec<String> = {
                let mut own = conn.prepare(
                    "SELECT text FROM word_translations WHERE word_id = ?1 ORDER BY rowid",
                )?;
                let rows = own.query_map([&word.id], |row| row.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<_>>()?
            };
            for text in extracted(conn, &word.id)? {
                if !own.iter().any(|each| key(each) == key(&text)) {
                    conn.execute(
                        "INSERT OR IGNORE INTO word_translations (word_id, text) VALUES (?1, ?2)",
                        params![word.id, text],
                    )?;
                }
            }
            let rows = stmt.query_map([&word.id], |row| row.get(0))?;
            word.translations = rows.collect::<rusqlite::Result<_>>()?;
        }
        if unkind || !word.translations.is_empty() {
            words.push(word);
        }
    }
    Ok(words)
}

/// Every word not looked at yet against its sentence, of any book: what it
/// is called, the sentence it was taken from, the kind it was taken for and
/// the translations it was taken with (`check`). And every word looked at
/// before a look said which sense it is, whose key has another sense of its
/// kind (`db::senses::siblings`): it is looked at once more, for that
/// alone. Each comes with those other senses.
pub fn unchecked(conn: &Connection) -> Result<Vec<CheckWord>> {
    let mut stmt = conn.prepare(
        "SELECT id, lemma, sentence, part_of_speech, checked FROM chapter_words w
         WHERE checked = 0
            OR (sensed = 0 AND EXISTS (
                  SELECT 1 FROM chapter_words o
                  WHERE o.key = w.key AND o.sense_id IS NOT w.sense_id))
         ORDER BY chapter_id, occurrences DESC, key",
    )?;
    let mut words = stmt
        .query_map([], |row| {
            Ok(CheckWord {
                id: row.get(0)?,
                lemma: row.get(1)?,
                sentence: row.get(2)?,
                part_of_speech: row.get(3)?,
                translations: Vec::new(),
                senses: std::collections::BTreeMap::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stmt = conn.prepare(
        "SELECT text FROM word_translations
         WHERE word_id = ?1 AND source = 'extraction' ORDER BY rowid",
    )?;
    for word in &mut words {
        let rows = stmt.query_map([&word.id], |row| row.get(0))?;
        word.translations = rows.collect::<rusqlite::Result<_>>()?;
        word.senses = super::senses::siblings(conn, &word.id)?
            .into_iter()
            .collect();
    }
    // One looked at already, with no sense left to be one of, is not asked.
    let looked: std::collections::HashSet<String> = conn
        .prepare("SELECT id FROM chapter_words WHERE checked = 1")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    words.retain(|word| !looked.contains(&word.id) || !word.senses.is_empty());
    Ok(words)
}

/// The words a look says are from the root of a word's translations, in
/// another kind, that are none of the `translations` it keeps: each once.
fn related(look: &WordCheck, translations: &[String]) -> Vec<RelatedWord> {
    let mut seen: Vec<String> = translations.iter().map(|each| key(each)).collect();
    let mut kept = Vec::new();
    for word in &look.related {
        let text = word.text.trim();
        let same = key(text);
        if same.is_empty() || word.part_of_speech == look.part_of_speech || seen.contains(&same) {
            continue;
        }
        seen.push(same);
        kept.push(RelatedWord {
            text: text.to_owned(),
            part_of_speech: word.part_of_speech,
        });
    }
    kept
}

/// Gives a word these translations in place of the ones it was prepared
/// with; one it had keeps what was said of it in its form. A dispute
/// upheld stays.
fn replace_translations(conn: &Connection, id: &str, translations: &[String]) -> Result<()> {
    let new: Vec<&str> = translations
        .iter()
        .map(|each| each.trim())
        .filter(|each| !each.is_empty())
        .collect();
    let mut stmt = conn.prepare(
        "SELECT text FROM word_translations WHERE word_id = ?1 AND source = 'extraction'",
    )?;
    let had: Vec<String> = stmt
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for text in had
        .iter()
        .filter(|text| !new.iter().any(|each| key(each) == key(text)))
    {
        conn.execute(
            "DELETE FROM word_translations WHERE word_id = ?1 AND text = ?2 AND source = 'extraction'",
            params![id, text],
        )?;
    }
    let mut add =
        conn.prepare("INSERT OR IGNORE INTO word_translations (word_id, text) VALUES (?1, ?2)")?;
    for text in new {
        if !had.iter().any(|each| key(each) == key(text)) {
            add.execute(params![id, text])?;
        }
    }
    Ok(())
}

/// What a look at a word against its sentence found, as code takes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Look {
    /// Nothing to put right: what the model said is kept for no word.
    Fits,
    /// Another word written the same way: a kind of its own, or not one
    /// translation in common with the ones it was taken with.
    Other,
    /// The same word, a verb written in another form than its base form
    /// that kept none: it is given that base form, and nothing else changes.
    Base,
    /// The same word, with translations that say more than it does: a
    /// negation, a tense or a mood of a word beside it in its sentence
    /// ("tendría una oportunidad" for "stand a chance"). Its translations
    /// become the look's, and its sentences stay: they gloss the same word.
    Translations,
}

/// What code makes of a look at a word that was taken as `lemma`, of the
/// kind `taken`, with these translations and `base`, against `sentence`.
/// The model only says what it sees. A word whose sentence does not write
/// it as it is called is left as it is: its key is not the word written
/// there. A look that says it does not fit and changes neither its kind
/// nor a single translation is no other word.
pub fn judge_look(
    (lemma, sentence): (&str, &str),
    (taken, base): (Option<PartOfSpeech>, Option<&str>),
    translations: &[String],
    look: &WordCheck,
) -> Look {
    let said = tokens(sentence);
    let written = tokens(lemma).iter().all(|word| said.contains(word));
    let given: Vec<String> = look
        .translations
        .iter()
        .map(|each| key(each))
        .filter(|each| !each.is_empty())
        .collect();
    if look.fits || !written || given.is_empty() {
        return Look::Fits;
    }
    let verb = matches!(
        look.part_of_speech,
        PartOfSpeech::Verb | PartOfSpeech::PhrasalVerb
    );
    let kind = taken.is_some_and(|taken| taken != look.part_of_speech);
    let shared = translations.iter().any(|each| given.contains(&key(each)));
    if kind || !shared {
        return Look::Other;
    }
    let new_base = look
        .base
        .as_deref()
        .is_some_and(|said| !key(said).is_empty() && key(said) != key(lemma));
    // Only a translation the look leaves out says it was wrong: one it
    // adds is no reason to change a word.
    let dropped = translations.iter().any(|each| !given.contains(&key(each)));
    if verb && base.is_none() && new_base {
        Look::Base
    } else if dropped {
        Look::Translations
    } else {
        Look::Fits
    }
}

/// Keeps what a look at a word against its sentence found ([`judge_look`]);
/// whether the word changed. Every word looked at is marked, and is not
/// looked at again. One its sentence uses as another word written the same
/// way ("moped", the past of "mope", taken for the noun) becomes that word,
/// under the same key and called as before: its kind, whether it takes an
/// object, the form of a verb and the base form of one written in another
/// form, and its translations, which are said in its form again
/// (`unlabelled`). The sentences it was asked with gloss the other word:
/// they go, and new ones are written. A verb that only lacked its base
/// form ("kicked", kept as the model wrote it) is given it, and keeps its
/// translations and its sentences.
pub fn check(conn: &Connection, id: &str, look: &WordCheck) -> Result<bool> {
    let marked = conn.execute(
        "UPDATE chapter_words SET checked = 1 WHERE id = ?1 AND checked = 0",
        [id],
    )?;
    if marked == 0 {
        // Looked at before: this look only says which sense it is.
        return sense(conn, id, look);
    }
    let changed = looked(conn, id, look)?;
    Ok(sense(conn, id, look)? || changed)
}

/// Keeps which of the senses its key had a look says a word is
/// (`db::senses::same_as`): the two are one meaning from then on, and so is
/// what is taken for right. Whether they were made one. A word is asked it
/// once.
fn sense(conn: &Connection, id: &str, look: &WordCheck) -> Result<bool> {
    conn.execute("UPDATE chapter_words SET sensed = 1 WHERE id = ?1", [id])?;
    match look.same_as.as_deref() {
        Some(sense) => super::senses::same_as(conn, id, sense),
        None => Ok(false),
    }
}

/// What a first look at a word puts right ([`check`]).
fn looked(conn: &Connection, id: &str, look: &WordCheck) -> Result<bool> {
    let (word_key, lemma, sentence, taken, base): (
        String,
        String,
        String,
        Option<PartOfSpeech>,
        Option<String>,
    ) = conn.query_row(
        "SELECT key, lemma, sentence, part_of_speech, base FROM chapter_words WHERE id = ?1",
        [id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )?;
    let mut stmt = conn.prepare(
        "SELECT text FROM word_translations
         WHERE word_id = ?1 AND source = 'extraction' ORDER BY rowid",
    )?;
    let had: Vec<String> = stmt
        .query_map([id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let verb = matches!(
        look.part_of_speech,
        PartOfSpeech::Verb | PartOfSpeech::PhrasalVerb
    );
    let new_base = look
        .base
        .as_deref()
        .map(str::trim)
        .filter(|said| verb && !said.is_empty() && key(said) != key(&lemma));
    let found = judge_look((&lemma, &sentence), (taken, base.as_deref()), &had, look);
    // What it says of how the word is asked holds for the word it is now.
    let kept: Vec<String> = if matches!(found, Look::Other | Look::Translations) {
        look.translations.clone()
    } else {
        had
    };
    let related = related(look, &kept);
    conn.execute(
        "UPDATE chapter_words SET context_there = ?2, context_back = ?3, related = ?4
         WHERE id = ?1",
        params![
            id,
            look.context_there,
            look.context_back,
            serde_json::to_string(&related)?
        ],
    )?;
    match found {
        Look::Fits => Ok(false),
        Look::Translations => {
            replace_translations(conn, id, &look.translations)?;
            super::senses::assign(conn, id)?;
            Ok(true)
        }
        Look::Base => {
            conn.execute(
                "UPDATE chapter_words SET base = ?2, verb_form = COALESCE(verb_form, ?3)
                 WHERE id = ?1",
                params![id, new_base, look.verb_form],
            )?;
            Ok(true)
        }
        Look::Other => {
            conn.execute(
                "UPDATE chapter_words
                 SET part_of_speech = ?2, transitive = ?3, verb_form = ?4, base = ?5
                 WHERE id = ?1",
                params![
                    id,
                    look.part_of_speech,
                    look.transitive && verb,
                    look.verb_form.filter(|_| verb),
                    new_base
                ],
            )?;
            replace_translations(conn, id, &look.translations)?;
            super::senses::assign(conn, id)?;
            conn.execute("DELETE FROM word_sentences WHERE key = ?1", [word_key])?;
            Ok(true)
        }
    }
}

/// Keeps the other persons of a past said in its form: `persons`, one
/// list for each of the `asked` translations, in that order, empty for one
/// that has none ("juré", "juraron" beside "juró"); whether any was news.
/// An answer that is not one for each says nothing, and what a translation
/// has already, it keeps.
pub fn put_persons(
    conn: &Connection,
    id: &str,
    asked: &[String],
    persons: &[Vec<String>],
) -> Result<bool> {
    if asked.len() != persons.len() {
        return Ok(false);
    }
    let mut stmt = conn.prepare(
        "UPDATE word_translations SET in_form_persons = ?3
         WHERE word_id = ?1 AND text = ?2 AND source = 'extraction'
           AND in_form IS NOT NULL AND in_form_persons IS NULL",
    )?;
    let mut changed = 0;
    for (text, forms) in asked.iter().zip(persons) {
        let forms: Vec<&str> = forms
            .iter()
            .map(|each| each.trim())
            .filter(|each| !each.is_empty())
            .collect();
        changed += stmt.execute(params![id, text, serde_json::to_string(&forms)?])?;
    }
    Ok(changed > 0)
}

/// Keeps the translations of a word in the form it is called by: `said`,
/// one for each of the `asked` ones, in that order; whether any was news.
/// An answer that is not one for each says nothing: the word is asked about
/// again. What a translation has already, it keeps.
pub fn put_in_form(conn: &Connection, id: &str, asked: &[String], said: &[String]) -> Result<bool> {
    let said: Vec<&str> = said.iter().map(|each| each.trim()).collect();
    if asked.len() != said.len() || said.iter().any(|each| each.is_empty()) {
        return Ok(false);
    }
    let mut stmt = conn.prepare(
        "UPDATE word_translations SET in_form = ?3
         WHERE word_id = ?1 AND text = ?2 AND source = 'extraction' AND in_form IS NULL",
    )?;
    let mut changed = 0;
    for (text, in_form) in asked.iter().zip(said) {
        changed += stmt.execute(params![id, text, in_form])?;
    }
    Ok(changed > 0)
}

/// Gives every translation of a word of a book, and the forms it is said
/// in, without the words a negation outside the word calls for
/// (`books::sentences::affirmed_base`): "tener ninguna oportunidad" for
/// "stand a chance", taken from "wouldn't stand a chance", becomes "tener
/// alguna oportunidad". One the word already has as it is now said is the
/// same translation, and only that one is kept. Changes nothing the second
/// time; how many translations it changed.
pub fn affirm(conn: &Connection, lang: &str) -> Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT t.word_id, t.text, t.in_form, t.in_form_also, w.lemma, w.forms,
                w.sentence
         FROM word_translations t JOIN chapter_words w ON w.id = t.word_id
         WHERE t.source = 'extraction'",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Said {
                word_id: row.get(0)?,
                text: row.get(1)?,
                in_form: row.get(2)?,
                also: row.get(3)?,
                lemma: row.get(4)?,
                forms: row.get(5)?,
                sentence: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut changed = 0_usize;
    for row in rows {
        let forms: Vec<String> = serde_json::from_str(&row.forms).unwrap_or_default();
        // The word in every form it is shown in: a negation in any is its own.
        let form = [row.lemma.clone()]
            .into_iter()
            .chain(forms)
            .collect::<Vec<_>>()
            .join(" ");
        let clear = |text: &str| affirmed_base(text, (&form, &row.sentence), lang);
        let text = clear(&row.text);
        let in_form = row.in_form.as_deref().map(clear);
        // One nobody said yet stays unsaid: the next labelling says it.
        let listed: Option<Vec<String>> = row
            .also
            .as_deref()
            .map(|json| serde_json::from_str(json).unwrap_or_default());
        let cleared: Option<Vec<String>> = listed
            .as_ref()
            .map(|listed| listed.iter().map(|each| clear(each)).collect());
        if text == row.text && in_form == row.in_form && cleared == listed {
            continue;
        }
        let held: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM word_translations WHERE word_id = ?1 AND text = ?2)",
            params![row.word_id, text],
            |found| found.get(0),
        )?;
        if held && text != row.text {
            conn.execute(
                "DELETE FROM word_translations WHERE word_id = ?1 AND text = ?2",
                params![row.word_id, row.text],
            )?;
        } else {
            conn.execute(
                "UPDATE word_translations SET text = ?3, in_form = ?4, in_form_also = ?5
                 WHERE word_id = ?1 AND text = ?2",
                params![
                    row.word_id,
                    row.text,
                    text,
                    in_form,
                    cleared
                        .map(|each| serde_json::to_string(&each))
                        .transpose()?
                ],
            )?;
        }
        changed += 1;
    }
    Ok(changed)
}

/// A translation of a word of a book, as [`affirm`] reads it.
struct Said {
    word_id: String,
    text: String,
    in_form: Option<String>,
    also: Option<String>,
    lemma: String,
    forms: String,
    sentence: String,
}

/// Keeps the other forms each translation of a word says the same in,
/// beside the one it is called by: `also`, a list for each of the `asked`
/// ones, in that order, empty for one that has none ("juraba" beside
/// "juró"); whether any was news. An answer that is not one for each says
/// nothing, and what a translation has already, it keeps.
pub fn put_also(
    conn: &Connection,
    id: &str,
    asked: &[String],
    also: &[Vec<String>],
) -> Result<bool> {
    if asked.len() != also.len() {
        return Ok(false);
    }
    let mut stmt = conn.prepare(
        "UPDATE word_translations SET in_form_also = ?3
         WHERE word_id = ?1 AND text = ?2 AND source = 'extraction'
           AND in_form IS NOT NULL AND in_form_also IS NULL",
    )?;
    let mut changed = 0;
    for (text, forms) in asked.iter().zip(also) {
        let forms: Vec<&str> = forms
            .iter()
            .map(|each| each.trim())
            .filter(|each| !each.is_empty())
            .collect();
        changed += stmt.execute(params![id, text, serde_json::to_string(&forms)?])?;
    }
    Ok(changed > 0)
}

/// Says what kind of word a word is, whether it takes an object and, of
/// one its chapter calls a verb, the form its sentence has it in; whether
/// any of it was news. What the word has already, it keeps.
pub fn label(
    conn: &Connection,
    id: &str,
    (part_of_speech, transitive): (PartOfSpeech, bool),
    verb_form: Option<VerbForm>,
) -> Result<bool> {
    let changed = conn.execute(
        "UPDATE chapter_words
         SET verb_form = CASE
               WHEN COALESCE(part_of_speech, ?2) IN ('verb', 'phrasalVerb')
               THEN COALESCE(verb_form, ?4)
             END,
             part_of_speech = COALESCE(part_of_speech, ?2),
             transitive = COALESCE(transitive, ?3)
         WHERE id = ?1
           AND (part_of_speech IS NULL OR transitive IS NULL
             OR (part_of_speech IN ('verb', 'phrasalVerb')
               AND verb_form IS NULL AND ?4 IS NOT NULL))",
        params![id, part_of_speech, transitive, verb_form],
    )?;
    Ok(changed == 1)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::books::{ParsedBook, ParsedChapter};
    use crate::db::books::{self, NewBook};
    use crate::db::open_in_memory;
    use crate::domain::{PartOfSpeech, Ways};

    /// Stores a book with one chapter per text; their ids in reading order.
    pub fn book(conn: &Connection, id: &str, texts: &[&str]) -> Vec<String> {
        let parsed = ParsedBook {
            title: Some(id.into()),
            author: None,
            chapters: texts
                .iter()
                .map(|text| ParsedChapter {
                    title: String::new(),
                    front_matter: false,
                    text: (*text).into(),
                })
                .collect(),
        };
        let book = NewBook {
            id,
            title: id,
            format: "epub",
            hash: id,
            file_name: id,
            parsed: &parsed,
        };
        books::insert_book(conn, &book, Utc::now()).expect("insert");
        let stored = books::get_book(conn, id).expect("book");
        stored.chapters.into_iter().map(|c| c.id).collect()
    }

    pub fn word(lemma: &str, translations: &[&str], count: u32) -> Word {
        Word {
            key: crate::books::vocab::key(lemma),
            lemma: lemma.into(),
            base: None,
            verb_form: None,
            forms: vec![lemma.into()],
            sentence: format!("A sentence with {lemma}."),
            part_of_speech: None,
            transitive: None,
            translations: translations.iter().map(|t| (*t).to_owned()).collect(),
            needs_context: false,
            count,
        }
    }

    pub fn mark_done(conn: &Connection, chapter_id: &str, key: &str) {
        let changed = conn
            .execute(
                "UPDATE chapter_words SET done_at = ?3 WHERE chapter_id = ?1 AND key = ?2",
                params![chapter_id, key, ts(Utc::now())],
            )
            .expect("done");
        assert_eq!(changed, 1);
    }

    pub fn mark_known(conn: &Connection, lemma: &str) {
        conn.execute(
            "INSERT INTO known_words (key, lemma, created_at) VALUES (?1, ?2, ?3)",
            params![crate::books::vocab::key(lemma), lemma, ts(Utc::now())],
        )
        .expect("known");
    }

    fn lemmas(words: &[BookWord]) -> Vec<(&str, u32)> {
        words.iter().map(|w| (w.lemma.as_str(), w.count)).collect()
    }

    #[test]
    fn code_decides_what_a_look_at_a_word_puts_right() {
        let look = |fits: bool, kind: PartOfSpeech, base: Option<&str>, said: &[&str]| WordCheck {
            id: "w".into(),
            fits,
            part_of_speech: kind,
            transitive: false,
            verb_form: None,
            base: base.map(str::to_owned),
            translations: said.iter().map(|each| (*each).to_owned()).collect(),
            context_there: false,
            context_back: false,
            related: Vec::new(),
            same_as: None,
        };
        let had = ["ciclomotor".to_owned(), "moto pequeña".to_owned()];
        let moped = ("moped", "He moped around.");
        let noun = (Some(PartOfSpeech::Noun), None);
        let verb = PartOfSpeech::Verb;
        let judged = |words, taken, look: &WordCheck| judge_look(words, taken, &had, look);
        // Another kind, or not one translation in common: another word.
        let other = look(false, verb, Some("mope"), &["andar deprimido"]);
        assert_eq!(judged(moped, noun, &other), Look::Other);
        let sense = look(false, PartOfSpeech::Noun, None, &["vespa"]);
        assert_eq!(judged(moped, noun, &sense), Look::Other);
        // The same kind and a translation in common: the same word. One it
        // leaves out was wrong, and they are the look's; one it only adds
        // changes nothing.
        let same = look(false, PartOfSpeech::Noun, None, &["Ciclomotor", "scooter"]);
        assert_eq!(judged(moped, noun, &same), Look::Translations);
        let more = look(
            false,
            PartOfSpeech::Noun,
            None,
            &["ciclomotor", "moto pequeña", "vespa"],
        );
        assert_eq!(judged(moped, noun, &more), Look::Fits);
        // Said to fit, or with nothing to put in its place: kept.
        assert_eq!(
            judged(moped, noun, &look(true, verb, None, &["x"])),
            Look::Fits
        );
        assert_eq!(
            judged(moped, noun, &look(false, verb, None, &[" "])),
            Look::Fits
        );
        // A word its sentence does not write as it is called keeps its key.
        let leaf = ("leaf", "The tree leaves early.");
        assert_eq!(judged(leaf, noun, &other), Look::Fits);
        // A verb that only lacked its base form is given it.
        let past = (Some(verb), None);
        let base = look(false, verb, Some("kick"), &["ciclomotor", "moto pequeña"]);
        assert_eq!(judged(("kicked", "He kicked it."), past, &base), Look::Base);
        let kept = (Some(verb), Some("kick"));
        assert_eq!(judged(("kicked", "He kicked it."), kept, &base), Look::Fits);
    }

    #[test]
    fn words_are_listed_most_frequent_first_with_their_translations() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one"]);
        let words = [
            Word {
                part_of_speech: Some(PartOfSpeech::Verb),
                ..word("peep", &["asomarse", "echar un vistazo"], 2)
            },
            word("bank", &["orilla"], 5),
            word("ache", &["doler"], 2),
        ];
        finish(&conn, &chapters[0], Depth::Relevant, &words, Utc::now()).expect("finish");

        let listed = list(&conn, &chapters[0]).expect("list");
        assert_eq!(lemmas(&listed), [("bank", 5), ("ache", 2), ("peep", 2)]);
        assert_eq!(listed[2].translations, ["asomarse", "echar un vistazo"]);
        assert_eq!(listed[2].part_of_speech, Some(PartOfSpeech::Verb));
        assert_eq!(listed[0].part_of_speech, None, "a word nobody labelled");
        let chapter = books::get_chapter(&conn, &chapters[0]).expect("chapter");
        assert_eq!(chapter.prepared, Some(Depth::Relevant));
    }

    #[test]
    fn a_verb_called_by_another_form_is_listed_in_that_form_once_it_was_said() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one"]);
        let sworn = Word {
            base: Some("swear".into()),
            verb_form: Some(VerbForm::PastParticiple),
            part_of_speech: Some(PartOfSpeech::Verb),
            ..word("sworn", &["jurar", "prometer"], 1)
        };
        finish(&conn, &chapters[0], Depth::Most, &[sworn], Utc::now()).expect("finish");
        let listed = || list(&conn, &chapters[0]).expect("list").remove(0);
        assert_eq!(
            listed().translations,
            ["jurar", "prometer"],
            "until it was said"
        );
        assert_eq!(listed().verb_form, Some(VerbForm::PastParticiple));
        assert_eq!(listed().sentence, "A sentence with sworn.");

        let asked = ["jurar".to_owned(), "prometer".to_owned()];
        let said = ["jurado".to_owned(), "prometido".to_owned()];
        assert!(put_in_form(&conn, &listed().id, &asked, &said).expect("put"));
        assert_eq!(listed().translations, ["jurado", "prometido"]);
    }

    #[test]
    fn a_translation_kept_with_what_a_negation_outside_its_word_calls_for_loses_it() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one"]);
        let donut = "And poor, stupid Donut wouldn’t stand a chance out here in the cold.";
        let words = [
            Word {
                sentence: donut.into(),
                ..word(
                    "stand a chance",
                    &[
                        "tener ninguna oportunidad",
                        "tener posibilidades",
                        "tener ninguna posibilidad",
                    ],
                    1,
                )
            },
            Word {
                sentence: "He didn't overlook it.".into(),
                ..word("overlook", &["no ver", "pasar por alto"], 1)
            },
        ];
        // As a chapter prepared before this kept them, and said in its form.
        finish(&conn, &chapters[0], Depth::Most, &words, Utc::now()).expect("finish");
        conn.execute_batch(
            "INSERT INTO word_translations (word_id, text, source)
               SELECT word_id, 'tener alguna posibilidad', 'extraction' FROM word_translations
               WHERE text = 'tener posibilidades';
             UPDATE word_translations SET in_form = 'tendría ninguna oportunidad',
               in_form_also = '[\"tendría ninguna\"]'
             WHERE text = 'tener ninguna oportunidad';",
        )
        .expect("old rows");

        assert_eq!(affirm(&conn, "es").expect("affirm"), 3);
        let listed = list(&conn, &chapters[0]).expect("list");
        let chance = listed
            .iter()
            .find(|w| w.lemma == "stand a chance")
            .expect("chance");
        let mut texts: Vec<String> = conn
            .prepare("SELECT text || '|' || COALESCE(in_form, '-') || '|' || COALESCE(in_form_also, '-') FROM word_translations WHERE word_id = ?1 ORDER BY text")
            .expect("stmt")
            .query_map([&chance.id], |row| row.get(0))
            .expect("rows")
            .collect::<rusqlite::Result<_>>()
            .expect("texts");
        texts.sort();
        assert_eq!(
            texts,
            [
                "tener posibilidades|-|-",
                "tener una oportunidad|tendría una oportunidad|[\"tendría una\"]",
                "tener una posibilidad|-|-",
            ]
        );
        let overlook = listed
            .iter()
            .find(|w| w.lemma == "overlook")
            .expect("overlook");
        assert!(overlook.translations.contains(&"no ver".to_owned()));
        // Once.
        assert_eq!(affirm(&conn, "es").expect("affirm"), 0);
    }

    #[test]
    fn the_translation_the_learner_answers_with_most_is_listed_first() {
        let conn = open_in_memory().expect("db");
        crate::db::profile::save_profile(&conn, &crate::db::profile::tests::profile())
            .expect("profile");
        let chapters = book(&conn, "b", &["one", "two"]);
        let clue = || [word("clue", &["pista", "indicio"], 1)];
        finish(&conn, &chapters[0], Depth::Most, &clue(), Utc::now()).expect("finish");
        finish(&conn, &chapters[1], Depth::Most, &clue(), Utc::now()).expect("finish");
        let shown = |chapter: &str| list(&conn, chapter).expect("list").remove(0).translations;
        assert_eq!(shown(&chapters[0]), ["pista", "indicio"], "as prepared");

        // Answers kept before any of this was read off them.
        let id = list(&conn, &chapters[0]).expect("list").remove(0).id;
        let sitting = crate::db::practice::start(&conn, &chapters[0], Ways::Both, Utc::now())
            .expect("sitting");
        let say = |way: Direction, text: &str, correct: bool| {
            crate::db::practice::record(&conn, &sitting, (&id, way), (text, correct), Utc::now())
                .expect("answer");
        };
        say(Direction::Recognition, "pista", true);
        say(Direction::Recognition, "los indicios", true);
        say(Direction::Recognition, "indicio", true);
        // None of these says which translation the learner uses.
        say(Direction::Recognition, "pista", false);
        say(Direction::Production, "pista", true);
        say(Direction::Recognition, "señal", true);

        assert_eq!(shown(&chapters[0]), ["indicio", "pista"]);
        // The word is the same one in every chapter that has it.
        assert_eq!(shown(&chapters[1]), ["indicio", "pista"]);
        let row = crate::db::practice::word(&conn, &id).expect("word");
        assert_eq!(row.shown, ["indicio", "pista"]);
        assert_eq!(row.translations, ["pista", "indicio"], "all still accepted");
        mark_done(&conn, &chapters[0], "clue");
        let learned = learned(&conn).expect("learned");
        assert_eq!(learned[0].translation.as_deref(), Some("indicio"));
        set_known(&conn, &id, true, Utc::now()).expect("known");
        assert_eq!(
            known(&conn).expect("known")[0].translations,
            ["indicio", "pista"]
        );
        // Nothing was stored: the order is read off the answers.
        let stored: Vec<String> = extracted(&conn, &id).expect("stored");
        assert_eq!(stored, ["pista", "indicio"]);

        // The daily recall counts too: its right answers, and no miss.
        let recalled = |kind: &str, text: &str| {
            conn.execute(
                "INSERT INTO word_events (key, kind, direction, answer, created_at)
                 VALUES ('clue', ?1, 'recognition', ?2, ?3)",
                params![kind, text, ts(Utc::now())],
            )
            .expect("event");
        };
        recalled("miss", "pista");
        recalled("miss", "pista");
        assert_eq!(shown(&chapters[1]), ["indicio", "pista"]);
        recalled("right", "pista");
        recalled("right", "la pista");
        assert_eq!(shown(&chapters[1]), ["pista", "indicio"]);
    }

    #[test]
    fn an_answer_in_the_form_the_word_is_called_by_says_which_translation_is_used() {
        let conn = open_in_memory().expect("db");
        crate::db::profile::save_profile(&conn, &crate::db::profile::tests::profile())
            .expect("profile");
        let chapters = book(&conn, "b", &["one"]);
        let trickled = Word {
            base: Some("trickle".into()),
            verb_form: Some(VerbForm::Past),
            part_of_speech: Some(PartOfSpeech::Verb),
            ..word("trickled", &["gotear", "chorrear", "escurrirse"], 1)
        };
        finish(&conn, &chapters[0], Depth::Most, &[trickled], Utc::now()).expect("finish");
        let id = list(&conn, &chapters[0]).expect("list").remove(0).id;
        let asked: Vec<String> = ["gotear", "chorrear", "escurrirse"]
            .map(String::from)
            .into();
        let said: Vec<String> = ["goteó", "chorreó", "se escurrió"].map(String::from).into();
        assert!(put_in_form(&conn, &id, &asked, &said).expect("in form"));
        let also = [["goteaba"], ["chorreaba"], ["se escurría"]]
            .map(|each| each.map(String::from).to_vec());
        assert!(put_also(&conn, &id, &asked, &also).expect("also"));

        // Answers kept before an answer in the past counted for anything.
        let sitting = crate::db::practice::start(&conn, &chapters[0], Ways::Both, Utc::now())
            .expect("sitting");
        for answer in ["chorreo", "chorreaba"] {
            crate::db::practice::record(
                &conn,
                &sitting,
                (&id, Direction::Recognition),
                (answer, true),
                Utc::now(),
            )
            .expect("answer");
        }

        let listed = list(&conn, &chapters[0]).expect("list").remove(0);
        assert_eq!(listed.translations, ["chorreó", "goteó", "se escurrió"]);
        let row = crate::db::practice::word(&conn, &id).expect("word");
        assert_eq!(row.shown_as(), ["chorreó", "goteó", "se escurrió"]);
        assert_eq!(
            row.translations,
            ["gotear", "chorrear", "escurrirse"],
            "all still accepted"
        );
    }

    #[test]
    fn a_deeper_depth_adds_words_without_resetting_existing_ones() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one"]);
        let chapter = &chapters[0];
        finish(
            &conn,
            chapter,
            Depth::Hardest,
            &[word("peep", &["asomarse"], 2)],
            Utc::now(),
        )
        .expect("hardest");
        mark_done(&conn, chapter, "peep");
        let before = list(&conn, chapter).expect("list");

        let deeper = [word("peep", &["mirar"], 9), word("bank", &["orilla"], 5)];
        finish(&conn, chapter, Depth::Most, &deeper, Utc::now()).expect("most");

        let after = list(&conn, chapter).expect("list");
        assert_eq!(lemmas(&after), [("bank", 5), ("peep", 2)]);
        assert_eq!(after[1], before[0], "same id, translations and count");
        let (done, depth): (Option<String>, Depth) = conn
            .query_row(
                "SELECT done_at, depth FROM chapter_words WHERE key = 'peep'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("peep");
        assert!(done.is_some(), "progress is kept");
        assert_eq!(depth, Depth::Hardest);
        let prepared = books::get_chapter(&conn, chapter)
            .expect("chapter")
            .prepared;
        assert_eq!(prepared, Some(Depth::Most));
    }

    #[test]
    fn a_known_word_is_never_taken_and_one_done_elsewhere_only_in_another_sense() {
        let conn = open_in_memory().expect("db");
        let first = book(&conn, "b", &["one", "two"]);
        let other = book(&conn, "c", &["three"]);
        let noun = |lemma: &str, said: &[&str]| Word {
            part_of_speech: Some(PartOfSpeech::Noun),
            ..word(lemma, said, 1)
        };
        let words = [
            noun("bug", &["bicho", "insecto"]),
            noun("bank", &["orilla"]),
        ];
        finish(&conn, &first[0], Depth::Most, &words, Utc::now()).expect("finish");
        mark_done(&conn, &first[0], "bug");
        mark_known(&conn, "To Give Up");

        // Only what the learner said they know is never taken, by its key.
        let keys: Vec<String> = excluded(&conn).expect("excluded").into_iter().collect();
        assert_eq!(keys, ["give up"]);

        // Learned in a chapter, the word is not stored for another in that
        // meaning, said with a synonym or not; an open word is.
        let again = [
            noun("bug", &["insecto", "bichito"]),
            noun("bank", &["orilla"]),
        ];
        finish(&conn, &first[1], Depth::Most, &again, Utc::now()).expect("finish");
        assert_eq!(
            lemmas(&list(&conn, &first[1]).expect("list")),
            [("bank", 1)]
        );
        // Written the same in another sense, or as another kind of word, it
        // is a word to learn.
        let error = [
            noun("bug", &["error", "falla"]),
            Word {
                part_of_speech: Some(PartOfSpeech::Verb),
                ..word("bug", &["molestar"], 1)
            },
        ];
        finish(&conn, &other[0], Depth::Most, &error, Utc::now()).expect("finish");
        assert_eq!(lemmas(&list(&conn, &other[0]).expect("list")), [("bug", 1)]);
        let said = &list(&conn, &other[0]).expect("list")[0].translations;
        assert_eq!(said, &["error", "falla"]);
    }

    #[test]
    fn deleting_a_book_discards_the_words_nobody_answered_but_keeps_the_known_ones() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one"]);
        finish(
            &conn,
            &chapters[0],
            Depth::Most,
            &[word("peep", &["asomarse"], 1)],
            Utc::now(),
        )
        .expect("finish");
        store_chunk(&conn, &chapters[0], Depth::Most, (0, 2), &[]).expect("chunk");
        mark_known(&conn, "bank");

        books::archive_book(&conn, "b", Utc::now()).expect("delete");
        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count")
        };
        assert_eq!(count("chapter_words"), 0);
        assert_eq!(count("word_translations"), 0);
        assert_eq!(count("chapter_chunks"), 0);
        assert_eq!(count("known_words"), 1);
    }

    #[test]
    fn known_words_are_listed_latest_first_and_one_can_be_forgotten() {
        let conn = open_in_memory().expect("db");
        let first = book(&conn, "b", &["one", "two"]);
        let words = [
            word("peep", &["asomarse", "echar un vistazo"], 1),
            word("bank", &["orilla"], 1),
        ];
        finish(&conn, &first[0], Depth::Most, &words, Utc::now()).expect("finish");
        // The same word in a second chapter is still one known word.
        finish(
            &conn,
            &first[1],
            Depth::Most,
            &[word("peep", &["mirar"], 1)],
            Utc::now() + chrono::Duration::seconds(1),
        )
        .expect("finish");
        assert_eq!(known(&conn).expect("none"), []);

        let now = Utc::now();
        for (at, lemma) in ["bank", "peep"].into_iter().enumerate() {
            let listed = list(&conn, &first[0]).expect("list");
            let id = &listed.iter().find(|w| w.lemma == lemma).expect("word").id;
            let later = now + chrono::Duration::seconds(i64::try_from(at).expect("small"));
            set_known(&conn, id, true, later).expect("known");
        }
        let shown = |conn: &Connection| -> Vec<(String, Vec<String>)> {
            known(conn)
                .expect("known")
                .into_iter()
                .map(|w| (w.key, w.translations))
                .collect()
        };
        let peep = (
            "peep".to_owned(),
            vec!["asomarse".to_owned(), "echar un vistazo".to_owned()],
        );
        let bank = ("bank".to_owned(), vec!["orilla".to_owned()]);
        assert_eq!(shown(&conn), [peep.clone(), bank.clone()]);

        // Its book deleted, a known word stays, translated as it was.
        books::archive_book(&conn, "b", Utc::now()).expect("delete");
        assert_eq!(shown(&conn), [peep, bank.clone()]);

        // Forgotten by its key, with no chapter on the shelf to find it through.
        forget(&conn, "peep").expect("forget");
        forget(&conn, "peep").expect("twice changes nothing");
        assert_eq!(shown(&conn), [bank]);
        let excluded = excluded(&conn).expect("excluded");
        assert_eq!(excluded, HashSet::from(["bank".to_owned()]));
    }

    #[test]
    fn stored_pieces_survive_until_the_depth_or_the_division_changes() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one"]);
        let chapter = &chapters[0];
        let item = VocabItem {
            lemma: "peep".into(),
            form: "peeped".into(),
            sentence: "She peeped.".into(),
            part_of_speech: PartOfSpeech::Verb,
            transitive: false,
            translations: vec!["asomarse".into()],
            proper_noun: false,
            needs_context: true,
            verb_form: Some(VerbForm::Past),
        };
        // A piece answered before the form of a verb was asked for.
        let before: VocabItem = serde_json::from_str(
            r#"{"lemma":"peep","form":"peeped","sentence":"She peeped.","partOfSpeech":"verb",
                "transitive":false,"translations":["asomarse"],"properNoun":false,
                "needsContext":true}"#,
        )
        .expect("an old piece");
        assert_eq!(before.verb_form, None);
        store_chunk(
            &conn,
            chapter,
            Depth::Most,
            (1, 3),
            std::slice::from_ref(&item),
        )
        .expect("store");
        store_chunk(&conn, chapter, Depth::Most, (1, 3), &[]).expect("again");

        let kept = stored_chunks(&conn, chapter, Depth::Most, 3).expect("read");
        assert_eq!(kept, BTreeMap::from([(1, vec![item])]));
        let other = stored_chunks(&conn, chapter, Depth::Most, 4).expect("recut");
        assert!(other.is_empty());
        let gone = stored_chunks(&conn, chapter, Depth::Most, 3).expect("read");
        assert!(gone.is_empty(), "pieces of another division were dropped");
    }
}
