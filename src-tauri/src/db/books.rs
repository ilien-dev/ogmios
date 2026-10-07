//! Books and their chapters. The chapter text is stored here; the webview
//! sees it only as the sentences of a chapter being translated or listened
//! to.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::{found, new_id, ts};
use crate::books::practice::readiness;
use crate::books::ParsedBook;
use crate::domain::{Book, Chapter, Depth};
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
          AND (w.done_at IS NOT NULL OR w.key IN (SELECT key FROM known_words)))
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

/// Takes the book off the shelf. Its rows stay, so what was learned in it
/// still counts everywhere; the practice left half way in it by ear or on
/// structures belongs to no chapter any more, as if the chapter were gone.
/// Run it inside a transaction.
pub fn archive_book(conn: &Connection, id: &str, now: DateTime<Utc>) -> Result<()> {
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
        let excluded = words::excluded(&conn, &kept[0]).expect("excluded");
        assert!(excluded.contains("peep"));

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
}
