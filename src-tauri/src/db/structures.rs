//! The sessions of structures: the sentences each one asks for and what the
//! learner wrote; and the structures a chapter was found to use. How strong
//! a structure is is counted from the finished sessions (`structures`);
//! nothing is cached.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::{found, parse_ts, ts};
use crate::domain::{ChapterStructure, PartOfSpeech, StructureVerdict, Topic, WordSource};
use crate::error::{Error, Result};
use crate::structures::{Asked, Round};

/// One session as it is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SittingRow {
    pub id: String,
    /// How many sentences it was started with.
    pub size: u32,
    /// The chapter its words are from, when it is a session on one.
    pub chapter_id: Option<String>,
    pub started_at: String,
    pub finished: bool,
}

const SITTING: &str = "SELECT id, chapter_id, started_at, finished_at IS NOT NULL, size
     FROM structure_sittings";

fn sitting_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SittingRow> {
    Ok(SittingRow {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        started_at: row.get(2)?,
        finished: row.get(3)?,
        size: row.get(4)?,
    })
}

/// A sentence to ask for, before it is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    pub structure: String,
    pub topic: Topic,
    pub word: Option<Asked>,
    pub warm: bool,
    /// The place of the missed sentence it repeats.
    pub retry_of: Option<u32>,
}

/// What the learner wrote for a sentence, and what it was worth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answered {
    pub verdict: StructureVerdict,
}

/// One sentence of a session as it is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemRow {
    pub index: u32,
    pub item: NewItem,
    /// None until it is answered.
    pub answered: Option<Answered>,
}

/// Starts a session under the id its order was drawn from.
pub fn start(
    conn: &Connection,
    id: &str,
    size: u32,
    chapter_id: Option<&str>,
    items: &[NewItem],
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO structure_sittings (id, size, chapter_id, started_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, size, chapter_id, ts(now)],
    )?;
    for item in items {
        append(conn, id, item)?;
    }
    Ok(())
}

/// Adds a sentence at the end of a session; its place.
pub fn append(conn: &Connection, sitting_id: &str, item: &NewItem) -> Result<u32> {
    let index: u32 = conn.query_row(
        "SELECT COALESCE(MAX(idx) + 1, 0) FROM structure_items WHERE sitting_id = ?1",
        [sitting_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO structure_items
           (sitting_id, idx, structure, topic, verb, verb_source, warm, retry_of)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            sitting_id,
            index,
            item.structure,
            serde_json::to_string(&item.topic)?,
            item.word.as_ref().map(|word| word.english.as_str()),
            item.word.as_ref().map(|word| word.source),
            item.warm,
            item.retry_of,
        ],
    )?;
    Ok(index)
}

pub fn sitting(conn: &Connection, id: &str) -> Result<SittingRow> {
    found(
        conn.query_row(&format!("{SITTING} WHERE id = ?1"), [id], sitting_row),
        "session",
    )
}

/// The sessions left before their end, the latest first.
pub fn unfinished(conn: &Connection) -> Result<Vec<SittingRow>> {
    let mut stmt = conn.prepare(&format!(
        "{SITTING} WHERE finished_at IS NULL ORDER BY started_at DESC, rowid DESC"
    ))?;
    let rows = stmt.query_map([], sitting_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The sentences of a session, in the order they are asked.
pub fn items(conn: &Connection, sitting_id: &str) -> Result<Vec<ItemRow>> {
    let mut stmt = conn.prepare(
        "SELECT idx, structure, topic, verb, verb_source, warm, retry_of, verdict
         FROM structure_items WHERE sitting_id = ?1 ORDER BY idx",
    )?;
    let rows = stmt
        .query_map([sitting_id], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<WordSource>>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<u32>>(6)?,
                row.get::<_, Option<StructureVerdict>>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(
            |(index, structure, topic, verb, source, warm, retry_of, verdict)| {
                Ok(ItemRow {
                    index,
                    item: NewItem {
                        structure,
                        topic: serde_json::from_str(&topic)?,
                        word: verb
                            .zip(source)
                            .map(|(english, source)| Asked { english, source }),
                        warm,
                        retry_of,
                    },
                    answered: verdict.map(|verdict| Answered { verdict }),
                })
            },
        )
        .collect()
}

/// The sentence at `index` is asked without its word. Only one still to
/// be answered: what was asked of an answered one stays as it was judged.
pub fn drop_word(conn: &Connection, sitting_id: &str, index: u32) -> Result<()> {
    let dropped = conn.execute(
        "UPDATE structure_items SET verb = NULL, verb_source = NULL
         WHERE sitting_id = ?1 AND idx = ?2 AND verdict IS NULL",
        params![sitting_id, index],
    )?;
    if dropped == 0 {
        return Err(Error::Invalid("no sentence to drop the word of".into()));
    }
    Ok(())
}

/// What the learner wrote for a sentence, and what the model said of it.
pub struct Answer<'a> {
    pub text: &'a str,
    pub peeked: bool,
    pub verdict: StructureVerdict,
    pub explanation: &'a str,
    pub better: &'a str,
}

/// Keeps the answer to the sentence at `index`.
pub fn answer(
    conn: &Connection,
    sitting_id: &str,
    index: u32,
    answer: &Answer<'_>,
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "UPDATE structure_items
         SET answer = ?3, peeked = ?4, verdict = ?5, explanation = ?6, better = ?7,
             answered_at = ?8
         WHERE sitting_id = ?1 AND idx = ?2",
        params![
            sitting_id,
            index,
            answer.text,
            answer.peeked,
            answer.verdict,
            answer.explanation,
            answer.better,
            ts(now)
        ],
    )?;
    Ok(())
}

/// The session is over; one already finished keeps the moment it was.
pub fn finish(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE structure_sittings SET finished_at = ?2
         WHERE id = ?1 AND finished_at IS NULL",
        params![id, ts(now)],
    )?;
    Ok(())
}

/// Forgets a session, and what was written in it.
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM structure_sittings WHERE id = ?1", [id])?;
    Ok(())
}

/// What every finished session asked on each structure, oldest first, by
/// the structure's key.
pub fn rounds(conn: &Connection) -> Result<HashMap<String, Vec<Round>>> {
    let mut stmt = conn.prepare(
        "SELECT i.structure, s.finished_at, SUM(i.verdict <> 'wrong'), COUNT(*)
         FROM structure_items i JOIN structure_sittings s ON s.id = i.sitting_id
         WHERE s.finished_at IS NOT NULL AND i.verdict IS NOT NULL
         GROUP BY s.id, i.structure ORDER BY s.finished_at, s.rowid",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, u32>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut rounds: HashMap<String, Vec<Round>> = HashMap::new();
    for (structure, at, right, total) in rows {
        rounds.entry(structure).or_default().push(Round {
            at: parse_ts(&at)?,
            right,
            total,
        });
    }
    Ok(rounds)
}

/// The learner opened the chapter: it is the one they are on.
pub fn mark_opened(conn: &Connection, chapter_id: &str, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "UPDATE book_chapters SET opened_at = ?2 WHERE id = ?1",
        params![chapter_id, ts(now)],
    )?;
    Ok(())
}

/// The chapter opened last; none before any was.
pub fn current_chapter(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM book_chapters WHERE opened_at IS NOT NULL
             ORDER BY opened_at DESC, rowid DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?)
}

/// The title of the book a chapter is of.
pub fn book_title(conn: &Connection, chapter_id: &str) -> Result<String> {
    found(
        conn.query_row(
            "SELECT b.title FROM books b JOIN book_chapters c ON c.book_id = b.id
             WHERE c.id = ?1",
            [chapter_id],
            |row| row.get(0),
        ),
        "chapter",
    )
}

/// Whether the chapter was read for its structures.
pub fn scanned(conn: &Connection, chapter_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM chapter_structure_scans WHERE chapter_id = ?1)",
        [chapter_id],
        |row| row.get(0),
    )?)
}

/// The structures a chapter was found to use, the most used first.
pub fn chapter_structures(conn: &Connection, chapter_id: &str) -> Result<Vec<ChapterStructure>> {
    let mut stmt = conn.prepare(
        "SELECT structure, count, example FROM chapter_structures
         WHERE chapter_id = ?1 ORDER BY count DESC, rowid",
    )?;
    let rows = stmt.query_map([chapter_id], |row| {
        Ok(ChapterStructure {
            key: row.get(0)?,
            count: row.get(1)?,
            example: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Keeps what a chapter was found to use, ranked; it is not read again.
pub fn store_scan(
    conn: &Connection,
    chapter_id: &str,
    ranked: &[ChapterStructure],
    now: DateTime<Utc>,
) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO chapter_structure_scans (chapter_id, scanned_at)
         VALUES (?1, ?2)",
        params![chapter_id, ts(now)],
    )?;
    conn.execute(
        "DELETE FROM chapter_structures WHERE chapter_id = ?1",
        [chapter_id],
    )?;
    for each in ranked {
        conn.execute(
            "INSERT INTO chapter_structures (chapter_id, structure, count, example)
             VALUES (?1, ?2, ?3, ?4)",
            params![chapter_id, each.key, each.count, each.example],
        )?;
    }
    Ok(())
}

// A word of no kind worth naming is no word to build a sentence on; one
// nobody labelled yet is.
const WORDS: &str = "(part_of_speech IS NULL OR part_of_speech <> 'other')
     AND key NOT IN (SELECT key FROM known_words)";

/// The words of a chapter the learner has not said they know, of any kind:
/// the ones still open first, then the most used.
pub fn chapter_words(conn: &Connection, chapter_id: &str, limit: u32) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT lemma FROM chapter_words WHERE chapter_id = ?1 AND {WORDS}
         ORDER BY done_at IS NOT NULL, occurrences DESC, rowid LIMIT ?2"
    ))?;
    let rows = stmt.query_map(params![chapter_id, limit], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The keys of every word of the books a sentence can be asked to use.
pub fn word_keys(conn: &Connection) -> Result<HashSet<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT DISTINCT key FROM chapter_words WHERE {WORDS}"
    ))?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// What the books say of a word.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Gloss {
    /// None for a word nobody labelled.
    pub part_of_speech: Option<PartOfSpeech>,
    /// A verb that takes an object; none when nobody said.
    pub transitive: Option<bool>,
    /// What its chapter was prepared to say it means, the translation the
    /// learner answers with most first (`db::words::Used`).
    pub translations: Vec<String>,
}

/// What kind of word a word of the books is and what its chapter was
/// prepared to say it means: as `chapter_id` has it when it does, else as
/// the latest chapter that says its kind. Nothing for a word of no book.
pub fn gloss(conn: &Connection, lemma: &str, chapter_id: Option<&str>) -> Result<Gloss> {
    let Some((id, part_of_speech, transitive)) = conn
        .query_row(
            "SELECT id, part_of_speech, transitive FROM chapter_words WHERE lemma = ?1
             ORDER BY chapter_id IS ?2 DESC, part_of_speech IS NULL, created_at DESC, id
             LIMIT 1",
            params![lemma, chapter_id],
            |row| Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
    else {
        return Ok(Gloss::default());
    };
    let key = crate::books::vocab::key(lemma);
    let shown = super::words::extracted(conn, &id)?;
    let translations =
        super::words::Used::load(conn, Some(&key))?.order(&key, part_of_speech, shown);
    Ok(Gloss {
        part_of_speech,
        transitive,
        translations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn now() -> DateTime<Utc> {
        parse_ts("2026-03-01T10:00:00.000Z").expect("a date")
    }

    fn item(structure: &str, word: Option<&str>) -> NewItem {
        NewItem {
            structure: structure.to_owned(),
            topic: Topic::Preset {
                key: "travel".into(),
            },
            word: word.map(|english| Asked {
                english: english.to_owned(),
                source: WordSource::Chapter,
            }),
            warm: false,
            retry_of: None,
        }
    }

    fn right(verdict: StructureVerdict) -> Answer<'static> {
        Answer {
            text: "I can swim.",
            peeked: false,
            verdict,
            explanation: "Bien.",
            better: "I can swim.",
        }
    }

    #[test]
    fn a_session_keeps_its_sentences_in_order_and_what_was_answered() {
        let conn = open_in_memory().expect("db");
        start(
            &conn,
            "s",
            10,
            None,
            &[item("can", Some("stir")), item("will", None)],
            now(),
        )
        .expect("start");
        answer(&conn, "s", 0, &right(StructureVerdict::Partial), now()).expect("answer");
        let third = append(
            &conn,
            "s",
            &NewItem {
                retry_of: Some(0),
                ..item("can", None)
            },
        )
        .expect("append");
        assert_eq!(third, 2);

        let stored = items(&conn, "s").expect("items");
        assert_eq!(stored.len(), 3);
        assert_eq!(stored[0].item, item("can", Some("stir")));
        assert_eq!(
            stored[0].answered,
            Some(Answered {
                verdict: StructureVerdict::Partial
            })
        );
        assert_eq!(stored[1].answered, None);
        assert_eq!(stored[2].item.retry_of, Some(0));

        // A word is dropped from a sentence still to be answered alone.
        start(&conn, "t", 10, None, &[item("can", Some("trot"))], now()).expect("start");
        drop_word(&conn, "t", 0).expect("drop");
        assert_eq!(items(&conn, "t").expect("items")[0].item, item("can", None));
        assert_eq!(
            drop_word(&conn, "s", 0).expect_err("answered").kind(),
            "invalid"
        );
        assert_eq!(
            drop_word(&conn, "s", 9).expect_err("none").kind(),
            "invalid"
        );
        assert_eq!(items(&conn, "s").expect("items")[0].item, stored[0].item);
        delete(&conn, "t").expect("delete");
        assert_eq!(unfinished(&conn).expect("unfinished").len(), 1);

        finish(&conn, "s", now()).expect("finish");
        assert!(sitting(&conn, "s").expect("sitting").finished);
        assert_eq!(unfinished(&conn).expect("unfinished"), []);
        delete(&conn, "s").expect("delete");
        assert_eq!(items(&conn, "s").expect("items"), []);
    }

    #[test]
    fn rounds_count_what_each_finished_session_asked_on_a_structure() {
        let conn = open_in_memory().expect("db");
        let later = parse_ts("2026-03-02T10:00:00.000Z").expect("a date");
        for (id, at, verdicts) in [
            (
                "a",
                now(),
                [StructureVerdict::Correct, StructureVerdict::Wrong],
            ),
            (
                "b",
                later,
                [StructureVerdict::Partial, StructureVerdict::Correct],
            ),
        ] {
            start(
                &conn,
                id,
                10,
                None,
                &[item("can", None), item("can", None)],
                at,
            )
            .expect("start");
            for (index, verdict) in (0..).zip(verdicts) {
                answer(&conn, id, index, &right(verdict), at).expect("answer");
            }
            finish(&conn, id, at).expect("finish");
        }
        // One left unfinished counts for nothing yet.
        start(&conn, "c", 10, None, &[item("can", None)], later).expect("start");
        answer(&conn, "c", 0, &right(StructureVerdict::Wrong), later).expect("answer");

        let rounds = rounds(&conn).expect("rounds");
        assert_eq!(
            rounds.get("can").map(Vec::as_slice),
            Some(
                &[
                    Round {
                        at: now(),
                        right: 1,
                        total: 2
                    },
                    Round {
                        at: later,
                        right: 2,
                        total: 2
                    },
                ][..]
            )
        );
    }

    #[test]
    fn a_chapter_keeps_what_it_was_found_to_use_and_which_one_was_opened_last() {
        let conn = open_in_memory().expect("db");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('one', 'b', 0, 'I', 1, 'text'), ('two', 'b', 1, 'II', 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, done_at,
                created_at, part_of_speech)
             VALUES ('w1', 'one', 'stir', 'stir', '[]', 's', 1, 'most', '2026-01-02',
                     '2026-01-01', 'verb'),
                    ('w2', 'one', 'trot', 'trot', '[]', 's', 3, 'most', NULL, '2026-01-01',
                     'verb'),
                    ('w3', 'one', 'give up', 'give up', '[]', 's', 9, 'most', NULL,
                     '2026-01-01', 'phrasalVerb'),
                    ('w4', 'one', 'bank', 'bank', '[]', 's', 9, 'most', NULL, '2026-01-01',
                     'noun'),
                    ('w5', 'one', 'peep', 'peep', '[]', 's', 9, 'most', NULL, '2026-01-01',
                     'verb'),
                    ('w6', 'one', 'of', 'of', '[]', 's', 9, 'most', NULL, '2026-01-01',
                     'other'),
                    ('w7', 'one', 'glen', 'glen', '[]', 's', 2, 'most', NULL, '2026-01-01',
                     NULL),
                    ('w8', 'two', 'bank', 'bank', '[]', 's', 1, 'most', NULL, '2026-01-02',
                     'verb');
             INSERT INTO word_translations (word_id, text) VALUES
               ('w4', 'orilla'), ('w4', 'ribera'), ('w8', 'ladear');
             INSERT INTO word_translations (word_id, text, source)
               VALUES ('w4', 'banco', 'dispute');
             INSERT INTO known_words VALUES ('peep', 'peep', '2026-01-01');
             UPDATE chapter_words SET transitive = 1 WHERE id = 'w8';",
        )
        .expect("rows");

        assert_eq!(current_chapter(&conn).expect("current"), None);
        mark_opened(&conn, "two", now()).expect("opened");
        mark_opened(
            &conn,
            "one",
            parse_ts("2026-03-02T10:00:00.000Z").expect("a date"),
        )
        .expect("opened");
        assert_eq!(
            current_chapter(&conn).expect("current").as_deref(),
            Some("one")
        );
        assert_eq!(book_title(&conn, "one").expect("title"), "Alice");

        assert!(!scanned(&conn, "one").expect("scanned"));
        let ranked = [
            ChapterStructure {
                key: "past-simple".into(),
                count: 9,
                example: "He ran.".into(),
            },
            ChapterStructure {
                key: "can".into(),
                count: 2,
                example: String::new(),
            },
        ];
        store_scan(&conn, "one", &ranked, now()).expect("store");
        assert!(scanned(&conn, "one").expect("scanned"));
        assert_eq!(chapter_structures(&conn, "one").expect("found"), ranked);

        // Words of any kind, open ones first, then the most used; never a
        // known one or one of no kind worth naming.
        assert_eq!(
            chapter_words(&conn, "one", 10).expect("words"),
            ["give up", "bank", "trot", "glen", "stir"]
        );
        assert_eq!(chapter_words(&conn, "one", 2).expect("words").len(), 2);
        let keys = word_keys(&conn).expect("keys");
        assert!(keys.contains("stir") && keys.contains("bank") && keys.contains("glen"));
        assert!(!keys.contains("of") && !keys.contains("peep"));

        // As its own chapter has it, with what that chapter was prepared with.
        assert_eq!(
            gloss(&conn, "bank", Some("one")).expect("gloss"),
            Gloss {
                part_of_speech: Some(PartOfSpeech::Noun),
                transitive: None,
                translations: vec!["orilla".to_owned(), "ribera".to_owned()],
            }
        );
        assert_eq!(
            gloss(&conn, "bank", Some("two")).expect("gloss"),
            Gloss {
                part_of_speech: Some(PartOfSpeech::Verb),
                transitive: Some(true),
                translations: vec!["ladear".to_owned()],
            }
        );
        // Of no chapter in particular: the latest that says its kind.
        assert_eq!(
            gloss(&conn, "bank", None).expect("gloss").part_of_speech,
            Some(PartOfSpeech::Verb)
        );
        assert_eq!(gloss(&conn, "glen", None).expect("gloss"), Gloss::default());
        assert_eq!(
            gloss(&conn, "nowhere", None).expect("gloss"),
            Gloss::default()
        );
    }
}
