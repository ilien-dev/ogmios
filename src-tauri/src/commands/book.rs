//! Books: a file the learner picks is copied into the app data directory and
//! split into chapters.

use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::run;
use crate::books::{epub, pdf, refused, ParsedBook, UNREADABLE};
use crate::db::books::{self, NewBook};
use crate::db::new_id;
use crate::domain::{Book, Chapter};
use crate::error::Result;
use crate::Ctx;

const EPUB: &str = "epub";
const PDF: &str = "pdf";
/// How a PDF starts, whatever the file is called; anything else is read as
/// an EPUB.
const PDF_MAGIC: &[u8] = b"%PDF-";
/// A chapter name the learner types is cut to this many characters.
const MAX_TITLE_CHARS: usize = 120;

/// The format of a file, by what it holds, and its chapters: the cover, the
/// contents and the rest of its front matter are left out.
fn parse(bytes: &[u8]) -> Result<(&'static str, ParsedBook)> {
    let (format, book) = if bytes.starts_with(PDF_MAGIC) {
        (PDF, pdf::parse(bytes)?)
    } else {
        (EPUB, epub::parse(bytes)?)
    };
    Ok((format, book.chapters_only()))
}

/// Where the copies live: `<data_dir>/books/<bookId>.<format>`.
fn books_dir(ctx: Ctx<'_>) -> PathBuf {
    ctx.data_dir.join("books")
}

pub fn list(ctx: Ctx<'_>) -> Result<Vec<Book>> {
    books::list_books(&*ctx.conn()?)
}

/// Adds the file at `path`. The same file twice is the same book.
pub fn import(ctx: Ctx<'_>, path: &Path) -> Result<Book> {
    let bytes = std::fs::read(path).map_err(|_| refused(UNREADABLE))?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    {
        let conn = ctx.conn()?;
        if let Some(id) = books::id_by_hash(&conn, &hash)? {
            return books::get_book(&conn, &id);
        }
    }
    let (format, parsed) = parse(&bytes)?;

    let id = new_id();
    let file_name = format!("{id}.{format}");
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned());
    let title = parsed.title.clone().or(stem).unwrap_or_default();
    let dir = books_dir(ctx);
    std::fs::create_dir_all(&dir)?;
    let copy = dir.join(&file_name);
    std::fs::write(&copy, &bytes)?;

    let book = NewBook {
        id: &id,
        title: &title,
        format,
        hash: &hash,
        file_name: &file_name,
        parsed: &parsed,
    };
    let stored = (|| {
        let mut conn = ctx.conn()?;
        let tx = conn.transaction()?;
        books::insert_book(&tx, &book, Utc::now())?;
        let stored = books::get_book(&tx, &id)?;
        tx.commit()?;
        Ok(stored)
    })();
    if stored.is_err() {
        // Best effort: without its row the copy is only wasted space.
        let _ = std::fs::remove_file(&copy);
    }
    stored
}

/// Deletes the book's rows and its copy of the file.
pub fn remove(ctx: Ctx<'_>, id: &str) -> Result<()> {
    let conn = ctx.conn()?;
    let file = books_dir(ctx).join(books::file_name(&conn, id)?);
    books::delete_book(&conn, id)?;
    match std::fs::remove_file(file) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Names a chapter. Runs of spaces become one and a long name is cut; an
/// empty name gives the chapter back the name it had without one.
pub fn rename(ctx: Ctx<'_>, id: &str, title: &str) -> Result<Chapter> {
    let words: Vec<&str> = title.split_whitespace().collect();
    let title: String = words.join(" ").chars().take(MAX_TITLE_CHARS).collect();
    books::rename_chapter(&*ctx.conn()?, id, title.trim_end())
}

#[tauri::command]
pub async fn list_books(app: AppHandle) -> Result<Vec<Book>> {
    run(app, |_, ctx| list(ctx)).await
}

#[tauri::command]
pub async fn import_book(app: AppHandle, path: String) -> Result<Book> {
    run(app, move |_, ctx| import(ctx, Path::new(&path))).await
}

#[tauri::command]
pub async fn delete_book(app: AppHandle, id: String) -> Result<()> {
    run(app, move |_, ctx| remove(ctx, &id)).await
}

#[tauri::command]
pub async fn rename_chapter(app: AppHandle, id: String, title: String) -> Result<Chapter> {
    run(app, move |_, ctx| rename(ctx, &id, &title)).await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::agent::Agent;
    use crate::books::epub::fixtures;
    use crate::books::pdf::fixtures as pdf_fixtures;
    use crate::books::{DRM, SCANNED};
    use crate::db::open_in_memory;
    use crate::error::Error;

    /// A data directory, a database, and a book file outside both.
    struct Desk {
        dir: tempfile::TempDir,
        db: Mutex<rusqlite::Connection>,
        agent: Agent,
    }

    impl Desk {
        fn new() -> Self {
            Self {
                dir: tempfile::tempdir().expect("tempdir"),
                db: Mutex::new(open_in_memory().expect("db")),
                agent: Agent::new(None),
            }
        }

        fn ctx(&self) -> Ctx<'_> {
            Ctx {
                db: &self.db,
                agent: &self.agent,
                data_dir: self.dir.path(),
            }
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.dir.path().join(name);
            std::fs::write(&path, bytes).expect("write book");
            path
        }

        fn count(&self, table: &str) -> i64 {
            self.db
                .lock()
                .expect("db")
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count")
        }

        fn copies(&self) -> usize {
            std::fs::read_dir(self.dir.path().join("books")).map_or(0, Iterator::count)
        }
    }

    #[test]
    fn an_epub_imports_to_its_chapters_in_order_with_text() {
        let desk = Desk::new();
        let path = desk.file("alice.epub", &fixtures::alice());
        let book = import(desk.ctx(), &path).expect("import");

        assert_eq!(book.title, "Alice's Adventures in Wonderland");
        assert_eq!(book.author.as_deref(), Some("Lewis Carroll"));
        let outline: Vec<_> = book
            .chapters
            .iter()
            .map(|c| (c.index, c.title.as_str()))
            .collect();
        // The cover and the title page are not chapters: they are left out.
        assert_eq!(
            outline,
            [
                (0, "I. Down the Rabbit-Hole"),
                (1, "II. The Pool of Tears"),
                (2, "III. A Caucus-Race and a Long Tale"),
            ]
        );
        assert!(book.chapters.iter().all(|c| c.words > 0));
        let empty: i64 = desk
            .db
            .lock()
            .expect("db")
            .query_row(
                "SELECT COUNT(*) FROM book_chapters WHERE trim(text) = ''",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(empty, 0);
        assert_eq!(list(desk.ctx()).expect("list"), std::slice::from_ref(&book));
        let copy = desk
            .dir
            .path()
            .join("books")
            .join(format!("{}.epub", book.id));
        assert_eq!(std::fs::read(copy).expect("copy"), fixtures::alice());
    }

    #[test]
    fn the_same_file_twice_is_one_book() {
        let desk = Desk::new();
        let first = import(desk.ctx(), &desk.file("alice.epub", &fixtures::alice()));
        let again = import(desk.ctx(), &desk.file("copy.epub", &fixtures::alice()));
        assert_eq!(first.expect("first"), again.expect("again"));
        assert_eq!(desk.count("books"), 1);
        assert_eq!(desk.count("book_chapters"), 3);
        assert_eq!(desk.copies(), 1);
    }

    #[test]
    fn a_protected_or_unreadable_file_is_refused_and_leaves_nothing() {
        let desk = Desk::new();
        let drm = import(
            desk.ctx(),
            &desk.file("drm.epub", &fixtures::alice_with_drm()),
        );
        let Err(error) = drm else {
            panic!("a protected book was imported");
        };
        assert_eq!(error.kind(), "invalid");
        assert_eq!(error.to_string(), DRM);

        let broken = import(desk.ctx(), &desk.file("notes.epub", b"plain text"));
        assert!(matches!(broken, Err(Error::Invalid(why)) if why == UNREADABLE));
        let missing = import(desk.ctx(), &desk.dir.path().join("nowhere.epub"));
        assert!(matches!(missing, Err(Error::Invalid(why)) if why == UNREADABLE));

        assert_eq!(desk.count("books"), 0);
        assert_eq!(desk.copies(), 0);
    }

    #[test]
    fn a_pdf_with_bookmarks_imports_to_its_chapters_in_order() {
        let desk = Desk::new();
        // The name lies; what the file holds decides how it is read.
        let path = desk.file("alice.epub", &pdf_fixtures::alice());
        let book = import(desk.ctx(), &path).expect("import");

        assert_eq!(book.title, "Alice's Adventures in Wonderland");
        assert_eq!(book.author.as_deref(), Some("Lewis Carroll"));
        let outline: Vec<_> = book
            .chapters
            .iter()
            .map(|c| (c.index, c.title.as_str()))
            .collect();
        assert_eq!(
            outline,
            [(0, "I. Down the Rabbit-Hole"), (1, "II. The Pool of Tears")]
        );
        assert!(book.chapters.iter().all(|c| c.words > 0));
        let copy = desk
            .dir
            .path()
            .join("books")
            .join(format!("{}.pdf", book.id));
        assert_eq!(std::fs::read(copy).expect("copy"), pdf_fixtures::alice());
        let format: String = desk
            .db
            .lock()
            .expect("db")
            .query_row("SELECT format FROM books", [], |row| row.get(0))
            .expect("format");
        assert_eq!(format, "pdf");
    }

    #[test]
    fn a_pdf_without_bookmarks_imports_to_sections_named_by_the_file() {
        let desk = Desk::new();
        let path = desk.file("wonderland.pdf", &pdf_fixtures::alice_without_bookmarks());
        let book = import(desk.ctx(), &path).expect("import");

        assert_eq!(book.title, "wonderland");
        assert_eq!(book.author, None);
        let sections: Vec<_> = book
            .chapters
            .iter()
            .map(|c| (c.index, c.title.as_str()))
            .collect();
        assert_eq!(sections, [(0, ""), (1, ""), (2, "")]);
        // Every word of the file is in one section or another.
        let page = pdf_fixtures::plain_page(1).join(" ");
        let words: u32 = book.chapters.iter().map(|c| c.words).sum();
        assert_eq!(words, crate::metrics::count_words(&page) * 20);
    }

    #[test]
    fn a_scanned_pdf_is_refused_and_leaves_nothing() {
        let desk = Desk::new();
        let scan = import(
            desk.ctx(),
            &desk.file("scan.pdf", &pdf_fixtures::alice_scanned()),
        );
        let Err(error) = scan else {
            panic!("a scanned book was imported");
        };
        assert_eq!(error.kind(), "invalid");
        assert_eq!(error.to_string(), SCANNED);

        let broken = import(
            desk.ctx(),
            &desk.file("broken.pdf", b"%PDF-1.7 and no more"),
        );
        assert!(matches!(broken, Err(Error::Invalid(why)) if why == UNREADABLE));
        assert_eq!(desk.count("books"), 0);
        assert_eq!(desk.copies(), 0);
    }

    #[test]
    fn a_renamed_section_keeps_its_name() {
        let desk = Desk::new();
        let path = desk.file("wonderland.pdf", &pdf_fixtures::alice_without_bookmarks());
        let book = import(desk.ctx(), &path).expect("import");
        let second = book.chapters.get(1).expect("a second section");

        let renamed = rename(desk.ctx(), &second.id, "  The   Pool of Tears ").expect("rename");
        assert_eq!(renamed.title, "The Pool of Tears");
        assert_eq!((renamed.index, renamed.words), (1, second.words));
        let titles = |book: &Book| -> Vec<String> {
            book.chapters.iter().map(|c| c.title.clone()).collect()
        };
        let shelf = list(desk.ctx()).expect("list");
        let read = shelf.first().expect("the book");
        assert_eq!(titles(read), ["", "The Pool of Tears", ""]);
        // The same file again is the same book, with the name it was given.
        let again = import(desk.ctx(), &path).expect("again");
        assert_eq!(titles(&again), ["", "The Pool of Tears", ""]);

        let long = rename(desk.ctx(), &second.id, &"a".repeat(500)).expect("long");
        assert_eq!(long.title.chars().count(), MAX_TITLE_CHARS);
        let cleared = rename(desk.ctx(), &second.id, "   ").expect("clear");
        assert_eq!(cleared.title, "");
        assert!(matches!(
            rename(desk.ctx(), "nowhere", "A name"),
            Err(Error::NotFound(_))
        ));
    }

    #[test]
    fn deleting_a_book_removes_its_rows_and_its_file() {
        let desk = Desk::new();
        let book =
            import(desk.ctx(), &desk.file("alice.epub", &fixtures::alice())).expect("import");
        assert_eq!(desk.copies(), 1);

        remove(desk.ctx(), &book.id).expect("delete");
        assert_eq!(desk.count("books"), 0);
        assert_eq!(desk.count("book_chapters"), 0);
        assert_eq!(desk.copies(), 0);
        assert_eq!(list(desk.ctx()).expect("list"), Vec::new());
        assert!(matches!(
            remove(desk.ctx(), &book.id),
            Err(Error::NotFound(_))
        ));
    }
}
