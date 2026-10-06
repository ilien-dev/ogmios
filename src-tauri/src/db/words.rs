//! The words of prepared chapters, the pieces of an extraction still under
//! way, and the words the learner already knows.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::profile::get_profile;
use super::{found, new_id, parse_ts, ts};
use crate::agent::protocol::{LabelWord, VocabItem};
use crate::books::practice::{inflects, preferred};
use crate::books::vocab::Word;
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
        let native = get_profile(conn)?
            .map(|profile| profile.native_lang)
            .unwrap_or_default();
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

    /// The translations the word of `key` is `shown` as, the one the
    /// learner answers with most first.
    pub fn order(&self, key: &str, part: Option<PartOfSpeech>, shown: Vec<String>) -> Vec<String> {
        match self.answers.get(key) {
            Some(answers) => preferred(shown, answers, (&self.native, inflects(part))),
            None => shown,
        }
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

/// The keys never extracted for this chapter: words the learner knows, and
/// words finished in any other chapter of any book.
pub fn excluded(conn: &Connection, chapter_id: &str) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT key FROM known_words
         UNION
         SELECT key FROM chapter_words WHERE done_at IS NOT NULL AND chapter_id != ?1",
    )?;
    let keys = stmt.query_map([chapter_id], |row| row.get(0))?;
    Ok(keys.collect::<rusqlite::Result<_>>()?)
}

/// Stores the chapter's words at this depth and forgets the pieces they came
/// from; run it inside a transaction. A word the chapter already has is left
/// exactly as it is: a deeper depth only adds.
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

/// The translations a chapter's word was prepared with, in that order: an
/// answer a dispute upheld is accepted in practice and listed nowhere.
pub fn extracted(conn: &Connection, word_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached(
        "SELECT text FROM word_translations
         WHERE word_id = ?1 AND source = 'extraction' ORDER BY rowid",
    )?;
    let rows = stmt.query_map([word_id], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every word the learner said they know, the latest first. Its translations
/// are the ones the first chapter that has it was prepared with, the one the
/// learner answers with most first; a word whose books are all gone has none.
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
            word.translations = used.order(&word.key, part, extracted(conn, &id)?);
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
            let shown = used.order(&key, part, extracted(conn, &id)?);
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
/// first ([`Used`]).
pub fn list(conn: &Connection, chapter_id: &str) -> Result<Vec<BookWord>> {
    let mut stmt = conn.prepare(
        "SELECT id, lemma, occurrences, done_at IS NOT NULL,
                key IN (SELECT key FROM known_words), part_of_speech, key,
                sorted_at IS NOT NULL
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
                translations: Vec::new(),
                count: row.get(2)?,
                done: row.get(3)?,
                // A known word is in no recall, so it has none.
                strength: strengths.get(&key).copied(),
                half: None,
                known: row.get(4)?,
                sorted: row.get(7)?,
            };
            Ok((key, word))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let halves = super::practice::halves(conn, chapter_id)?;
    let used = Used::load(conn, None)?;
    words
        .into_iter()
        .map(|(key, mut word)| {
            word.half = halves.get(&word.id).copied();
            word.translations = used.order(&key, word.part_of_speech, extracted(conn, &word.id)?);
            Ok(word)
        })
        .collect()
}

/// Every word still to be labelled, of any book: its id, what it is called
/// and the sentence it was taken from. One no chapter says the kind of, and
/// a verb nobody said takes an object or not, or the form of: each was
/// stored before that was asked for. So was a verb called by another form
/// than its base form with a translation nobody put in that form: it comes
/// with those translations.
pub fn unlabelled(conn: &Connection) -> Result<Vec<LabelWord>> {
    let mut stmt = conn.prepare(
        "SELECT id, lemma, sentence FROM chapter_words
         WHERE part_of_speech IS NULL
            OR (part_of_speech IN ('verb', 'phrasalVerb')
                AND (transitive IS NULL OR verb_form IS NULL))
            OR (base IS NOT NULL AND EXISTS (
                  SELECT 1 FROM word_translations t
                  WHERE t.word_id = chapter_words.id
                    AND t.source = 'extraction' AND t.in_form IS NULL))
         ORDER BY chapter_id, occurrences DESC, key",
    )?;
    let mut words = stmt
        .query_map([], |row| {
            Ok(LabelWord {
                id: row.get(0)?,
                lemma: row.get(1)?,
                sentence: row.get(2)?,
                translations: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stmt = conn.prepare(
        "SELECT t.text FROM word_translations t
         JOIN chapter_words w ON w.id = t.word_id
         WHERE w.id = ?1 AND w.base IS NOT NULL
           AND t.source = 'extraction' AND t.in_form IS NULL
         ORDER BY t.rowid",
    )?;
    for word in &mut words {
        let rows = stmt.query_map([&word.id], |row| row.get(0))?;
        word.translations = rows.collect::<rusqlite::Result<_>>()?;
    }
    Ok(words)
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
    fn known_words_and_words_done_in_another_chapter_are_excluded() {
        let conn = open_in_memory().expect("db");
        let first = book(&conn, "b", &["one", "two"]);
        let other = book(&conn, "c", &["three"]);
        let words = [word("peep", &["asomarse"], 1), word("bank", &["orilla"], 1)];
        finish(&conn, &first[0], Depth::Most, &words, Utc::now()).expect("finish");
        mark_done(&conn, &first[0], "peep");
        mark_known(&conn, "To Give Up");

        let keys = |chapter: &str| {
            let mut keys: Vec<String> = excluded(&conn, chapter)
                .expect("excluded")
                .into_iter()
                .collect();
            keys.sort();
            keys
        };
        // An open word ("bank") is excluded nowhere.
        assert_eq!(keys(&first[1]), ["give up", "peep"]);
        assert_eq!(keys(&other[0]), ["give up", "peep"]);
        // In its own chapter a done word is kept by the row it already has.
        assert_eq!(keys(&first[0]), ["give up"]);
    }

    #[test]
    fn deleting_a_book_takes_its_words_and_keeps_the_known_ones() {
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

        books::delete_book(&conn, "b").expect("delete");
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
        assert_eq!(shown(&conn), [peep.clone(), bank]);

        // Its book gone, a known word stays, with nothing to translate it.
        books::delete_book(&conn, "b").expect("delete");
        assert_eq!(known(&conn).expect("known")[0].lemma, "peep");
        assert_eq!(
            shown(&conn),
            [("peep".to_owned(), vec![]), ("bank".to_owned(), vec![])]
        );

        // Forgotten by its key, with no chapter left to find it through.
        forget(&conn, "peep").expect("forget");
        forget(&conn, "peep").expect("twice changes nothing");
        assert_eq!(shown(&conn), [("bank".to_owned(), vec![])]);
        let other = book(&conn, "c", &["three"]);
        let excluded = excluded(&conn, &other[0]).expect("excluded");
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
