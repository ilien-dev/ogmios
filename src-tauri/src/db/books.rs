//! Books and their chapters. The chapter text is stored here; the webview
//! sees it only as the sentences of a chapter being translated or listened
//! to, and as the few lines a book without a cover opens with.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::{found, new_id, ts};
use crate::books::practice::readiness;
use crate::books::ParsedBook;
use crate::domain::{ArchivedBook, Book, BookDeletion, Chapter, Depth};
use crate::error::Result;
use crate::metrics::count_words;

/// A book about to be stored: what the file said, and where its copy lives.
pub struct NewBook<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub format: &'a str,
    pub hash: &'a str,
    pub file_name: &'a str,
    pub parsed: &'a ParsedBook,
}

/// Inserts the book and its chapters; run it inside a transaction.
pub fn insert_book(conn: &Connection, book: &NewBook<'_>, now: DateTime<Utc>) -> Result<()> {
    conn.execute(
        "INSERT INTO books (id, title, author, format, hash, file_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            book.id,
            book.title,
            book.parsed.author,
            book.format,
            book.hash,
            book.file_name,
            ts(now)
        ],
    )?;
    let mut insert = conn.prepare(
        "INSERT INTO book_chapters (id, book_id, idx, title, words, text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for (idx, chapter) in book.parsed.chapters.iter().enumerate() {
        insert.execute(params![
            new_id(),
            book.id,
            u32::try_from(idx).unwrap_or(u32::MAX),
            chapter.title,
            count_words(&chapter.text),
            chapter.text
        ])?;
    }
    Ok(())
}

/// How much of the first chapter a book without a cover shows.
const OPENING_CHARS: u32 = 320;

/// A book the learner has not deleted (`archive_book`).
const SHELVED: &str = "id NOT IN (SELECT book_id FROM archived_books)";

/// The book already made from a file with this hash, if any, deleted or not.
pub fn id_by_hash(conn: &Connection, hash: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT id FROM books WHERE hash = ?1", [hash], |row| {
            row.get(0)
        })
        .optional()?)
}

/// A chapter with how many words it has to learn, and how many of them are
/// settled: done, or known to the learner by their key.
const CHAPTER: &str = "SELECT id, idx, title, words, prepared,
       (SELECT COUNT(*) FROM chapter_words w WHERE w.chapter_id = book_chapters.id),
       (SELECT COUNT(*) FROM chapter_words w WHERE w.chapter_id = book_chapters.id
          AND (w.done_at IS NOT NULL OR EXISTS (SELECT 1 FROM known_words k WHERE k.sense_id = w.sense_id)))
     FROM book_chapters";

fn chapter(row: &rusqlite::Row<'_>) -> rusqlite::Result<Chapter> {
    let prepared: Option<Depth> = row.get(4)?;
    let (to_learn, settled): (u32, u32) = (row.get(5)?, row.get(6)?);
    Ok(Chapter {
        id: row.get(0)?,
        index: row.get(1)?,
        title: row.get(2)?,
        words: row.get(3)?,
        prepared,
        readiness: prepared.map(|_| readiness(to_learn, settled)),
    })
}

fn chapters(conn: &Connection, book_id: &str) -> Result<Vec<Chapter>> {
    let mut stmt = conn.prepare(&format!("{CHAPTER} WHERE book_id = ?1 ORDER BY idx"))?;
    let rows = stmt.query_map([book_id], chapter)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_chapter(conn: &Connection, id: &str) -> Result<Chapter> {
    found(
        conn.query_row(&format!("{CHAPTER} WHERE id = ?1"), [id], chapter),
        "chapter",
    )
}

/// The chapter as plain text. It goes to the sidecar in pieces, and to the
/// webview only cut into the sentences to translate (`commands::translate`).
pub fn chapter_text(conn: &Connection, id: &str) -> Result<String> {
    found(
        conn.query_row(
            "SELECT text FROM book_chapters WHERE id = ?1",
            [id],
            |row| row.get(0),
        ),
        "chapter",
    )
}

/// Gives a chapter the name the learner chose; an empty one takes it back to
/// the name the interface gives a part without one.
pub fn rename_chapter(conn: &Connection, id: &str, title: &str) -> Result<Chapter> {
    conn.execute(
        "UPDATE book_chapters SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    get_chapter(conn, id)
}

/// The start of the book's first chapter, enough to fill a page.
fn opening(conn: &Connection, book_id: &str) -> Result<String> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT substr(text, 1, {OPENING_CHARS}) FROM book_chapters
                 WHERE book_id = ?1 ORDER BY idx LIMIT 1"
            ),
            [book_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_default())
}

/// A book on the shelf; a deleted one is not found.
pub fn get_book(conn: &Connection, id: &str) -> Result<Book> {
    let (title, author) = found(
        conn.query_row(
            &format!("SELECT title, author FROM books WHERE id = ?1 AND {SHELVED}"),
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
        "book",
    )?;
    Ok(Book {
        id: id.to_owned(),
        title,
        author,
        opening: opening(conn, id)?,
        chapters: chapters(conn, id)?,
    })
}

/// Every book on the shelf, newest first.
pub fn list_books(conn: &Connection) -> Result<Vec<Book>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id FROM books WHERE {SHELVED} ORDER BY created_at DESC, id"
    ))?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.iter().map(|id| get_book(conn, id)).collect()
}

/// The name of the book's copy under `<data_dir>/books/`, deleted or not.
pub fn file_name(conn: &Connection, id: &str) -> Result<String> {
    found(
        conn.query_row("SELECT file_name FROM books WHERE id = ?1", [id], |row| {
            row.get(0)
        }),
        "book",
    )
}

/// A word of a chapter nobody ever answered in an exercise or finished.
const UNANSWERED: &str = "w.learned_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM word_answers a WHERE a.word_id = w.id)";

/// A word deleting its book discards: nobody answered or finished it, and
/// the learner does not know it (a known word keeps its translations).
const DISCARDED: &str = "w.learned_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM word_answers a WHERE a.word_id = w.id)
     AND NOT EXISTS (SELECT 1 FROM known_words k WHERE k.sense_id = w.sense_id)";

/// What deleting the book would do to its words ([`BookDeletion`]).
pub fn deletion(conn: &Connection, id: &str) -> Result<BookDeletion> {
    let chapters: u32 = conn.query_row(
        "SELECT COUNT(*) FROM book_chapters WHERE book_id = ?1",
        [id],
        |row| row.get(0),
    )?;
    found(
        conn.query_row("SELECT 1 FROM books WHERE id = ?1", [id], |_| Ok(())),
        "book",
    )?;
    let (kept, shared, discarded) = conn.query_row(
        &format!(
            "WITH mine AS (
               SELECT DISTINCT w.key FROM chapter_words w
               JOIN book_chapters c ON c.id = w.chapter_id
               WHERE c.book_id = ?1 AND NOT EXISTS (SELECT 1 FROM known_words k WHERE k.sense_id = w.sense_id)
             ),
             elsewhere AS (
               SELECT w.key FROM chapter_words w
               JOIN book_chapters c ON c.id = w.chapter_id
               WHERE c.book_id != ?1
                 AND c.book_id NOT IN (SELECT book_id FROM archived_books)
             ),
             answered AS (
               SELECT w.key FROM chapter_words w WHERE NOT ({UNANSWERED})
               UNION SELECT key FROM word_events
             )
             SELECT
               COALESCE(SUM(key NOT IN elsewhere AND key IN answered), 0),
               COALESCE(SUM(key IN elsewhere), 0),
               COALESCE(SUM(key NOT IN elsewhere AND key NOT IN answered), 0)
             FROM mine"
        ),
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let (purged, elsewhere) = conn.query_row(
        &format!(
            "WITH mine AS ({MINE}),
             others AS ({OTHERS})
             SELECT COALESCE(SUM(key NOT IN others), 0), COALESCE(SUM(key IN others), 0)
             FROM mine"
        ),
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(BookDeletion {
        chapters,
        kept,
        shared,
        discarded,
        purged,
        elsewhere,
    })
}

/// The keys of a book's words, once each, leaving out the known ones.
const MINE: &str = "SELECT DISTINCT w.key FROM chapter_words w
     JOIN book_chapters c ON c.id = w.chapter_id
     WHERE c.book_id = ?1 AND NOT EXISTS (SELECT 1 FROM known_words k WHERE k.sense_id = w.sense_id)";

/// The keys of every other book's words, archived or not.
const OTHERS: &str = "SELECT w.key FROM chapter_words w
     JOIN book_chapters c ON c.id = w.chapter_id
     WHERE c.book_id != ?1";

/// Deletes the book for good, with every row of it. The words no other book
/// has, archived or not, go with their history and their
/// sentences, so the daily recall forgets them; the known ones stay known.
/// The practice left half way in it by ear or on structures belongs to no
/// chapter any more. Run it inside a transaction.
pub fn purge_book(conn: &Connection, id: &str) -> Result<()> {
    found(
        conn.query_row("SELECT 1 FROM books WHERE id = ?1", [id], |_| Ok(())),
        "book",
    )?;
    for table in ["word_events", "word_sentences"] {
        conn.execute(
            &format!(
                "DELETE FROM {table}
                 WHERE key IN ({MINE}) AND key NOT IN ({OTHERS})"
            ),
            [id],
        )?;
    }
    conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
    Ok(())
}

/// The books deleted with their words kept, the latest first.
pub fn list_archived(conn: &Connection) -> Result<Vec<ArchivedBook>> {
    let mut stmt = conn.prepare(
        "SELECT b.id, b.title, b.author, a.archived_at FROM books b
         JOIN archived_books a ON a.book_id = b.id
         ORDER BY a.archived_at DESC, b.id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(id, title, author, archived_at)| {
            let words =
                conn.query_row(&format!("SELECT COUNT(*) FROM ({MINE})"), [&id], |row| {
                    row.get(0)
                })?;
            Ok(ArchivedBook {
                opening: opening(conn, &id)?,
                id,
                title,
                author,
                archived_at,
                words,
            })
        })
        .collect()
}

/// Takes the book off the shelf. The words answered or finished in it stay,
/// so what was learned still counts everywhere and comes back in the daily
/// recall; the ones nobody answered go, and a chapter that loses any is to
/// be prepared again, should the book come back. Its sentences go too, but
/// the one each word kept was learned with and those written for it. The
/// practice left half way
/// in it by ear or on structures belongs to no chapter any more, as if the
/// chapter were gone. Run it inside a transaction.
pub fn archive_book(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<()> {
    let losing = format!(
        "SELECT w.chapter_id FROM chapter_words w
         JOIN book_chapters c ON c.id = w.chapter_id
         WHERE c.book_id = ?1 AND {DISCARDED}"
    );
    conn.execute(
        &format!("UPDATE book_chapters SET prepared = NULL WHERE id IN ({losing})"),
        [id],
    )?;
    conn.execute(
        &format!("DELETE FROM chapter_chunks WHERE chapter_id IN ({losing})"),
        [id],
    )?;
    conn.execute(
        &format!(
            "DELETE FROM chapter_words AS w
             WHERE w.chapter_id IN (SELECT id FROM book_chapters WHERE book_id = ?1)
               AND {DISCARDED}"
        ),
        [id],
    )?;
    // Its sentences go: a word kept keeps only the one it was learned with,
    // and the ones written for it, which say what it was learned as. The
    // ones of a word that went go with it.
    conn.execute(
        "DELETE FROM word_sentences AS s
         WHERE s.chapter_id IN (SELECT id FROM book_chapters WHERE book_id = ?1)
           AND NOT EXISTS (
             SELECT 1 FROM chapter_words w
             WHERE w.chapter_id = s.chapter_id AND w.key = s.key
               AND (s.source = 'model'
                 OR (w.sentence != '' AND s.sentence != ''
                   AND (instr(w.sentence, s.sentence) > 0
                     OR instr(s.sentence, w.sentence) > 0)))
           )",
        [id],
    )?;
    conn.execute(
        "DELETE FROM sentence_writes AS s
         WHERE s.chapter_id IN (SELECT id FROM book_chapters WHERE book_id = ?1)
           AND NOT EXISTS (
             SELECT 1 FROM chapter_words w WHERE w.chapter_id = s.chapter_id AND w.key = s.key
           )",
        [id],
    )?;
    for sittings in ["dictation_sittings", "structure_sittings"] {
        conn.execute(
            &format!(
                "UPDATE {sittings} SET chapter_id = NULL
                 WHERE chapter_id IN (SELECT id FROM book_chapters WHERE book_id = ?1)"
            ),
            [id],
        )?;
    }
    conn.execute(
        "INSERT OR IGNORE INTO archived_books (book_id, archived_at) VALUES (?1, ?2)",
        params![id, ts(now)],
    )?;
    Ok(())
}

/// Puts a deleted book back on the shelf, as it was left; whether it had
/// been deleted.
pub fn restore_book(conn: &Connection, id: &str) -> Result<bool> {
    let restored = conn.execute("DELETE FROM archived_books WHERE book_id = ?1", [id])?;
    Ok(restored > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::books::ParsedChapter;
    use crate::db::open_in_memory;
    use crate::error::Error;

    fn parsed() -> ParsedBook {
        let chapter = |title: &str, text: &str| ParsedChapter {
            title: title.into(),
            front_matter: false,
            text: text.into(),
        };
        ParsedBook {
            title: Some("Alice".into()),
            author: Some("Lewis Carroll".into()),
            chapters: vec![
                chapter("I", "Down the rabbit hole"),
                chapter("II", "Alice was beginning to get very tired"),
            ],
        }
    }

    #[test]
    fn a_book_round_trips_and_deleting_it_takes_it_off_the_shelf() {
        let conn = open_in_memory().expect("db");
        let parsed = parsed();
        let book = NewBook {
            id: "b",
            title: "Alice",
            format: "epub",
            hash: "h",
            file_name: "b.epub",
            parsed: &parsed,
        };
        insert_book(&conn, &book, Utc::now()).expect("insert");

        assert_eq!(id_by_hash(&conn, "h").expect("hash"), Some("b".into()));
        assert_eq!(id_by_hash(&conn, "other").expect("hash"), None);
        assert_eq!(file_name(&conn, "b").expect("file"), "b.epub");
        let read = get_book(&conn, "b").expect("read");
        assert_eq!(read.author.as_deref(), Some("Lewis Carroll"));
        let outline: Vec<_> = read
            .chapters
            .iter()
            .map(|c| (c.index, c.title.as_str(), c.words))
            .collect();
        assert_eq!(outline, [(0, "I", 4), (1, "II", 7)]);
        assert_eq!(
            list_books(&conn).expect("list"),
            std::slice::from_ref(&read)
        );

        // A new name is the one read back; nothing else about the chapter moves.
        let [first, second] = read.chapters.as_slice() else {
            panic!("two chapters were stored");
        };
        let renamed = rename_chapter(&conn, &second.id, "The Pool of Tears").expect("rename");
        assert_eq!(renamed.title, "The Pool of Tears");
        assert_eq!((renamed.index, renamed.words), (second.index, second.words));
        let again = get_book(&conn, "b").expect("read");
        assert_eq!(again.chapters, [first.clone(), renamed.clone()]);

        // Deleted, it is on no shelf, and its chapters are kept.
        archive_book(&conn, "b", Utc::now()).expect("delete");
        assert!(matches!(get_book(&conn, "b"), Err(Error::NotFound(_))));
        assert_eq!(list_books(&conn).expect("list"), Vec::new());
        assert_eq!(id_by_hash(&conn, "h").expect("hash"), Some("b".into()));
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM book_chapters", [], |row| row.get(0))
            .expect("count");
        assert_eq!(left, 2);

        assert!(restore_book(&conn, "b").expect("restore"));
        assert!(!restore_book(&conn, "b").expect("again"));
        assert_eq!(get_book(&conn, "b").expect("read"), again);
    }

    #[test]
    fn a_deleted_book_keeps_what_was_learned_in_it() {
        use crate::db::words::tests::{book, word};
        use crate::db::{practice, recall, structures, words};

        let conn = open_in_memory().expect("db");
        let gone = book(&conn, "gone", &["one"]);
        let kept = book(&conn, "kept", &["one"]);
        let list = [word("peep", &["asomarse"], 2), word("bank", &["orilla"], 1)];
        for chapter in [&gone[0], &kept[0]] {
            words::finish(&conn, chapter, Depth::Most, &list, Utc::now()).expect("words");
        }
        conn.execute(
            "UPDATE chapter_words
             SET done_at = '2026-03-01T10:00:00.000Z', learned_at = '2026-03-01T10:00:00.000Z'
             WHERE chapter_id = ?1 AND key = 'peep'",
            [&gone[0]],
        )
        .expect("learned");
        conn.execute(
            "INSERT INTO structure_sittings (id, size, chapter_id, started_at)
             VALUES ('s', 5, ?1, '2026-03-01T10:00:00.000Z')",
            [&gone[0]],
        )
        .expect("sitting");
        structures::mark_opened(&conn, &gone[0], Utc::now()).expect("opened");

        archive_book(&conn, "gone", Utc::now()).expect("delete");

        // The word finished in it is still learned: asked in the recall, a
        // review word in the other book, with its translation, never
        // extracted again.
        let asked: Vec<String> = recall::words(&conn)
            .expect("recall")
            .into_iter()
            .map(|word| word.key)
            .collect();
        assert_eq!(asked, ["peep"]);
        let open = practice::open_histories(&conn, &kept[0]).expect("open");
        let review: Vec<bool> = open.iter().map(|word| word.review).collect();
        assert_eq!(review, [true, false]);
        let learned = words::learned(&conn).expect("learned");
        assert_eq!(learned[0].translation.as_deref(), Some("asomarse"));
        // Learned in the deleted book, it is not stored for another one.
        let next = words::tests::book(&conn, "next", &["one"]);
        let peep = [words::tests::word("peep", &["asomarse"], 1)];
        words::finish(&conn, &next[0], Depth::Most, &peep, Utc::now()).expect("finish");
        assert_eq!(words::list(&conn, &next[0]).expect("list").len(), 0);

        // What was left half way in it is nowhere: its chapter is not the
        // one being read, its sitting is of no chapter, and no model is
        // asked about the word nobody finished.
        assert_eq!(structures::current_chapter(&conn).expect("current"), None);
        let of: Option<String> = conn
            .query_row("SELECT chapter_id FROM structure_sittings", [], |row| {
                row.get(0)
            })
            .expect("sitting");
        assert_eq!(of, None);
        assert_eq!(words::unlabelled(&conn).expect("unlabelled").len(), 3);
    }

    /// One answer to the word with this key in this chapter.
    fn answer(conn: &Connection, chapter_id: &str, key: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO practice_sittings (id, chapter_id, started_at)
             VALUES ('sit-' || ?1, ?1, '2026-03-01T10:00:00.000Z')",
            [chapter_id],
        )
        .expect("sitting");
        conn.execute(
            "INSERT INTO word_answers (word_id, direction, sitting_id, answer, correct, created_at)
             SELECT id, 'recognition', 'sit-' || ?1, 'x', 0, '2026-03-01T10:00:00.000Z'
             FROM chapter_words WHERE chapter_id = ?1 AND key = ?2",
            [chapter_id, key],
        )
        .expect("answer");
    }

    #[test]
    fn deleting_a_book_keeps_the_answered_words_for_the_recall_and_discards_the_rest() {
        use crate::db::words::tests::{book, mark_known, word};
        use crate::db::{recall, words};

        let conn = open_in_memory().expect("db");
        let gone = book(&conn, "gone", &["one", "two"]);
        let kept = book(&conn, "kept", &["three"]);
        let first = [
            word("peep", &["asomarse"], 1),
            word("tide", &["marea"], 1),
            word("bank", &["orilla"], 1),
            word("husk", &["cáscara"], 1),
            word("dread", &["pavor"], 1),
        ];
        words::finish(&conn, &gone[0], Depth::Most, &first, Utc::now()).expect("words");
        let second = [word("sliver", &["astilla"], 1)];
        words::finish(&conn, &gone[1], Depth::Most, &second, Utc::now()).expect("words");
        words::store_chunk(&conn, &gone[1], Depth::Most, (0, 2), &[]).expect("chunk");
        words::finish(
            &conn,
            &kept[0],
            Depth::Most,
            &[word("bank", &["banco"], 1)],
            Utc::now(),
        )
        .expect("words");
        conn.execute(
            "UPDATE chapter_words SET done_at = '2026-03-01T10:00:00.000Z',
               learned_at = '2026-03-01T10:00:00.000Z'
             WHERE chapter_id = ?1 AND key = 'peep'",
            [&gone[0]],
        )
        .expect("learned");
        answer(&conn, &gone[0], "peep");
        // Answered once, missed, and never finished: still kept.
        answer(&conn, &gone[0], "tide");
        mark_known(&conn, "dread");

        // What the learner is told before deleting it, by word.
        assert_eq!(
            deletion(&conn, "gone").expect("deletion"),
            BookDeletion {
                chapters: 2,
                kept: 2,
                shared: 1,
                discarded: 2,
                purged: 4,
                elsewhere: 1,
            }
        );
        assert!(matches!(deletion(&conn, "nope"), Err(Error::NotFound(_))));

        archive_book(&conn, "gone", Utc::now()).expect("delete");

        let left: Vec<String> = conn
            .prepare(
                "SELECT w.key FROM chapter_words w JOIN book_chapters c ON c.id = w.chapter_id
                 WHERE c.book_id = 'gone' ORDER BY w.key",
            )
            .expect("stmt")
            .query_map([], |row| row.get(0))
            .expect("rows")
            .collect::<rusqlite::Result<_>>()
            .expect("keys");
        // A known word keeps its row, and with it its translations.
        assert_eq!(left, ["dread", "peep", "tide"]);
        let mut asked: Vec<String> = recall::words(&conn)
            .expect("recall")
            .into_iter()
            .map(|word| word.key)
            .collect();
        asked.sort();
        assert_eq!(asked, ["peep", "tide"]);
        // The other book still has its own copy of the shared word.
        let shelved = get_book(&conn, "kept").expect("kept");
        assert_eq!(shelved.chapters[0].prepared, Some(Depth::Most));

        // Added again, a chapter that lost words is to be prepared again, so
        // preparing brings them back.
        assert!(restore_book(&conn, "gone").expect("restore"));
        let back = get_book(&conn, "gone").expect("back");
        let prepared: Vec<Option<Depth>> = back.chapters.iter().map(|c| c.prepared).collect();
        assert_eq!(prepared, [None, None]);
        let chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM chapter_chunks", [], |row| row.get(0))
            .expect("count");
        assert_eq!(chunks, 0);
    }

    #[test]
    fn a_book_deleted_for_good_takes_the_words_only_it_had_with_their_history() {
        use crate::db::words::tests::{book, mark_known, word};
        use crate::db::{recall, words};

        let conn = open_in_memory().expect("db");
        let gone = book(&conn, "gone", &["one"]);
        let kept = book(&conn, "kept", &["two"]);
        let archived = book(&conn, "archived", &["three"]);
        let list = [
            word("peep", &["asomarse"], 1),
            word("tide", &["marea"], 1),
            word("bank", &["orilla"], 1),
            word("husk", &["cáscara"], 1),
            word("dread", &["pavor"], 1),
        ];
        words::finish(&conn, &gone[0], Depth::Most, &list, Utc::now()).expect("words");
        let banco = [word("bank", &["banco"], 1)];
        words::finish(&conn, &kept[0], Depth::Most, &banco, Utc::now()).expect("words");
        let vaina = [word("husk", &["vaina"], 1)];
        words::finish(&conn, &archived[0], Depth::Most, &vaina, Utc::now()).expect("words");
        conn.execute(
            "UPDATE chapter_words SET done_at = '2026-03-01T10:00:00.000Z',
               learned_at = '2026-03-01T10:00:00.000Z'
             WHERE key IN ('peep', 'bank', 'husk')",
            [],
        )
        .expect("learned");
        answer(&conn, &gone[0], "tide");
        conn.execute_batch(
            "INSERT INTO word_events (key, kind, created_at)
               VALUES ('peep', 'right', '2026-03-02T10:00:00.000Z'),
                      ('bank', 'right', '2026-03-02T10:00:00.000Z');",
        )
        .expect("history");
        mark_known(&conn, "dread");
        archive_book(&conn, "archived", Utc::now()).expect("archive");

        // Only peep and tide are this book's alone: bank is on the shelf,
        // husk in an archived book, and dread is known.
        let told = deletion(&conn, "gone").expect("deletion");
        assert_eq!((told.purged, told.elsewhere), (2, 2));

        purge_book(&conn, "gone").expect("purge");

        assert!(matches!(file_name(&conn, "gone"), Err(Error::NotFound(_))));
        let count =
            |sql: &str| -> i64 { conn.query_row(sql, [], |row| row.get(0)).expect("count") };
        assert_eq!(
            count("SELECT COUNT(*) FROM word_events WHERE key = 'peep'"),
            0
        );
        assert_eq!(
            count("SELECT COUNT(*) FROM word_events WHERE key = 'bank'"),
            1
        );
        assert_eq!(
            count("SELECT COUNT(*) FROM known_words WHERE key = 'dread'"),
            1
        );
        let mut asked: Vec<String> = recall::words(&conn)
            .expect("recall")
            .into_iter()
            .map(|word| word.key)
            .collect();
        asked.sort();
        assert_eq!(asked, ["bank", "husk"]);

        // An archived book is listed with the words it keeps, and can be
        // deleted for good too.
        let listed = list_archived(&conn).expect("archived");
        let shown: Vec<(&str, u32)> = listed.iter().map(|b| (b.id.as_str(), b.words)).collect();
        assert_eq!(shown, [("archived", 1)]);
        purge_book(&conn, "archived").expect("purge archived");
        assert_eq!(list_archived(&conn).expect("archived"), []);
        assert_eq!(
            count("SELECT COUNT(*) FROM chapter_words WHERE key = 'husk'"),
            0
        );
        assert!(matches!(purge_book(&conn, "nope"), Err(Error::NotFound(_))));
    }
}
