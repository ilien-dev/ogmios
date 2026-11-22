//! What the column beside a book's scene counts: how strong the words
//! learned in each chapter are. Every count is of the words the chapter's
//! panel calls learned (finished, and not marked known), so the column and
//! the panel always agree.

use std::collections::HashMap;

use rusqlite::Connection;
use tauri::AppHandle;

use super::run;
use crate::db::recall;
use crate::domain::{ChapterStrength, Strength};
use crate::error::Result;
use crate::Ctx;

/// The chapters of a book in reading order.
fn chapter_ids(conn: &Connection, book_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM book_chapters WHERE book_id = ?1 ORDER BY idx")?;
    let ids = stmt.query_map([book_id], |row| row.get(0))?;
    Ok(ids.collect::<rusqlite::Result<_>>()?)
}

/// How strong the learned words of each chapter of a book are, in reading
/// order. A word goes by its key: one learned in two chapters is as strong
/// in both. One the recall does not know yet is new.
pub fn chapter_strengths(ctx: Ctx<'_>, book_id: &str) -> Result<Vec<ChapterStrength>> {
    let conn = ctx.conn()?;
    let strengths = recall::strengths(&conn)?;
    let mut counts: HashMap<String, ChapterStrength> = HashMap::new();
    for (chapter_id, key) in recall::book_learned(&conn, book_id)? {
        let count = counts
            .entry(chapter_id.clone())
            .or_insert_with(|| ChapterStrength::empty(chapter_id));
        let level = strengths.get(&key).copied().unwrap_or(Strength::New);
        let slot = match level {
            Strength::New => &mut count.fresh,
            Strength::Settling => &mut count.settling,
            Strength::Firm => &mut count.firm,
        };
        *slot = slot.saturating_add(1);
    }
    Ok(chapter_ids(&conn, book_id)?
        .into_iter()
        .map(|id| {
            counts
                .remove(&id)
                .unwrap_or_else(|| ChapterStrength::empty(id))
        })
        .collect())
}

#[tauri::command]
pub async fn book_strengths(app: AppHandle, book_id: String) -> Result<Vec<ChapterStrength>> {
    run(app, move |_, ctx| chapter_strengths(ctx, &book_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::practice::tests::{numbered, t0, Desk};
    use crate::db::ts;

    /// A book of one chapter of `count` numbered words, each learned at `t0`.
    fn learned(desk: &Desk, book: &str, count: u32) -> String {
        let chapter = desk.chapter(book, &numbered(count));
        let (_, summary) = desk.play(&chapter, t0());
        assert_eq!(summary.open, 0, "every word is done");
        chapter
    }

    fn right(desk: &Desk, key: &str, times: u32) {
        let conn = desk.db.lock().expect("db");
        for _ in 0..times {
            conn.execute(
                "INSERT INTO word_events (key, kind, created_at) VALUES (?1, 'right', ?2)",
                [key, &ts(t0())],
            )
            .expect("event");
        }
    }

    #[test]
    fn each_chapter_counts_its_learned_words_by_how_strong_they_are() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = learned(&desk, "b", 4);
        let of = |book: &str| chapter_strengths(desk.ctx(), book).expect("strengths");

        assert_eq!(
            of("b"),
            [ChapterStrength {
                chapter_id: chapter.clone(),
                fresh: 4,
                settling: 0,
                firm: 0,
            }]
        );

        right(&desk, "w00", 4);
        right(&desk, "w01", 1);
        // A word marked known is not learned: the panel leaves it out too.
        desk.db
            .lock()
            .expect("db")
            .execute(
                "INSERT INTO known_words (key, lemma, created_at) VALUES ('w03', 'w03', ?1)",
                [ts(t0())],
            )
            .expect("known");
        assert_eq!(
            of("b"),
            [ChapterStrength {
                chapter_id: chapter,
                fresh: 1,
                settling: 1,
                firm: 1,
            }]
        );
        assert_eq!(of("elsewhere"), []);
    }

    #[test]
    fn a_chapter_with_nothing_learned_counts_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &numbered(3));
        assert_eq!(
            chapter_strengths(desk.ctx(), "b").expect("strengths"),
            [ChapterStrength::empty(chapter)]
        );
    }
}
