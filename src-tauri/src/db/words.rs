//! The words of prepared chapters, the pieces of an extraction still under
//! way, and the words the learner already knows.

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

use super::{found, new_id, parse_ts, ts};
use crate::agent::protocol::VocabItem;
use crate::books::vocab::Word;
use crate::domain::{BookWord, Depth, KnownWord};
use crate::error::Result;

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
            created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
            ts(now)
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

/// Takes back that the learner knows the word with this key: it is asked
/// again wherever a chapter has it. A key that is not known changes nothing.
pub fn forget(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM known_words WHERE key = ?1", [key])?;
    Ok(())
}

/// Every word the learner said they know, the latest first. Its translations
/// are the ones the first chapter that has it was prepared with; a word whose
/// books are all gone has none.
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
        "SELECT text FROM word_translations
         WHERE source = 'extraction' AND word_id =
           (SELECT id FROM chapter_words WHERE key = ?1 ORDER BY created_at, id LIMIT 1)
         ORDER BY rowid",
    )?;
    for word in &mut words {
        word.translations = stmt
            .query_map([&word.key], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(words)
}

/// A finished book word for the progress map.
#[derive(Debug, Clone, PartialEq)]
pub struct Learned {
    pub lemma: String,
    /// Its first translation.
    pub translation: Option<String>,
    pub done_at: DateTime<Utc>,
}

/// Every finished word, once each however many chapters have it, with the
/// first time it was finished; the earliest first.
pub fn learned(conn: &Connection) -> Result<Vec<Learned>> {
    let mut stmt = conn.prepare(
        "SELECT w.lemma, MIN(w.done_at),
                (SELECT text FROM word_translations t WHERE t.word_id = w.id
                 ORDER BY t.rowid LIMIT 1)
         FROM chapter_words w WHERE w.done_at IS NOT NULL
         GROUP BY w.key ORDER BY MIN(w.done_at), w.key",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(lemma, done_at, translation)| {
            Ok(Learned {
                lemma,
                translation,
                done_at: parse_ts(&done_at)?,
            })
        })
        .collect()
}

/// The chapter's words, most frequent in it first.
pub fn list(conn: &Connection, chapter_id: &str) -> Result<Vec<BookWord>> {
    let mut stmt = conn.prepare(
        "SELECT id, lemma, occurrences, done_at IS NOT NULL,
                key IN (SELECT key FROM known_words)
         FROM chapter_words
         WHERE chapter_id = ?1 ORDER BY occurrences DESC, key",
    )?;
    let mut words = stmt
        .query_map([chapter_id], |row| {
            Ok(BookWord {
                id: row.get(0)?,
                lemma: row.get(1)?,
                translations: Vec::new(),
                count: row.get(2)?,
                done: row.get(3)?,
                known: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // What the chapter was prepared with: an answer a dispute upheld is
    // accepted in practice, as the learner typed it, and listed nowhere.
    let mut stmt = conn.prepare(
        "SELECT text FROM word_translations
         WHERE word_id = ?1 AND source = 'extraction' ORDER BY rowid",
    )?;
    for word in &mut words {
        word.translations = stmt
            .query_map([&word.id], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(words)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::books::{ParsedBook, ParsedChapter};
    use crate::db::books::{self, NewBook};
    use crate::db::open_in_memory;

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
            forms: vec![lemma.into()],
            sentence: format!("A sentence with {lemma}."),
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
            word("peep", &["asomarse", "echar un vistazo"], 2),
            word("bank", &["orilla"], 5),
            word("ache", &["doler"], 2),
        ];
        finish(&conn, &chapters[0], Depth::Relevant, &words, Utc::now()).expect("finish");

        let listed = list(&conn, &chapters[0]).expect("list");
        assert_eq!(lemmas(&listed), [("bank", 5), ("ache", 2), ("peep", 2)]);
        assert_eq!(listed[2].translations, ["asomarse", "echar un vistazo"]);
        let chapter = books::get_chapter(&conn, &chapters[0]).expect("chapter");
        assert_eq!(chapter.prepared, Some(Depth::Relevant));
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
            translations: vec!["asomarse".into()],
            proper_noun: false,
            needs_context: true,
        };
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
