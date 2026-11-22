//! What the column beside a book's scene counts: how strong the words
//! learned in each chapter are, how many of the book's words the daily
//! review asks today, and what kinds of word a chapter has. Every count is of the words the chapter's
//! panel calls learned (finished, and not marked known), so the column and
//! the panel always agree.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::recall::due;
use super::run;
use crate::books::practice::pace;
use crate::db::practice::{pace_sample, NOT_KNOWN};
use crate::db::recall::{self, Source};
use crate::domain::{BookReviews, ChapterStrength, KindCount, Strength, Ways};
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

/// About how many minutes `words` words of the daily review take at `pace`
/// milliseconds an answer: it asks each once. Rounded to the nearest minute,
/// and never less than one while there is a word to ask.
fn review_minutes(words: u32, pace: u64) -> u32 {
    const MINUTE_MS: u64 = 60_000;
    if words == 0 {
        return 0;
    }
    let total = u64::from(words).saturating_mul(pace);
    let rounded = total.saturating_add(MINUTE_MS / 2) / MINUTE_MS;
    u32::try_from(rounded.max(1)).unwrap_or(u32::MAX)
}

/// How many of the words the daily review asks today are of this book, and
/// about how long they take. A word goes by the chapter it was first
/// finished in, as the review has it.
pub fn book_reviews(ctx: Ctx<'_>, book_id: &str, now: DateTime<Utc>) -> Result<BookReviews> {
    let conn = ctx.conn()?;
    let mut stmt = conn.prepare(
        "SELECT w.id FROM chapter_words w
         JOIN book_chapters c ON c.id = w.chapter_id WHERE c.book_id = ?1",
    )?;
    let ids = stmt
        .query_map([book_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    let count = due(&conn, Ways::Both, now)?
        .iter()
        .filter(|word| matches!(&word.source, Source::Book { word_id } if ids.contains(word_id)))
        .count();
    let due = u32::try_from(count).unwrap_or(u32::MAX);
    let (answers, gaps) = pace_sample(&conn)?;
    Ok(BookReviews {
        due,
        minutes: review_minutes(due, pace(answers, &gaps)),
    })
}

/// The words of a chapter by their kind, each kind with how many of its
/// words are learned: the words the chapter's panel counts, so the kinds add
/// up to its "learned" and its total. A word nobody labelled has no kind.
pub fn chapter_kinds(ctx: Ctx<'_>, chapter_id: &str) -> Result<Vec<KindCount>> {
    let conn = ctx.conn()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT w.part_of_speech, COUNT(*), SUM(w.done_at IS NOT NULL)
         FROM chapter_words w
         WHERE w.chapter_id = ?1 AND {NOT_KNOWN}
         GROUP BY w.part_of_speech ORDER BY COUNT(*) DESC, w.part_of_speech"
    ))?;
    let rows = stmt.query_map([chapter_id], |row| {
        Ok(KindCount {
            kind: row.get(0)?,
            total: row.get(1)?,
            learned: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[tauri::command]
pub async fn chapter_kind_counts(app: AppHandle, chapter_id: String) -> Result<Vec<KindCount>> {
    run(app, move |_, ctx| chapter_kinds(ctx, &chapter_id)).await
}

#[tauri::command]
pub async fn book_due(app: AppHandle, book_id: String) -> Result<BookReviews> {
    run(app, move |_, ctx| book_reviews(ctx, &book_id, Utc::now())).await
}

#[tauri::command]
pub async fn book_strengths(app: AppHandle, book_id: String) -> Result<Vec<ChapterStrength>> {
    run(app, move |_, ctx| chapter_strengths(ctx, &book_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeDelta;

    use crate::books::practice::DEFAULT_PACE_MS;
    use crate::commands::practice::tests::{numbered, t0, Desk};
    use crate::db::ts;
    use crate::domain::PartOfSpeech;

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
    fn a_review_takes_a_minute_or_so_for_every_few_words() {
        assert_eq!(review_minutes(0, DEFAULT_PACE_MS), 0);
        assert_eq!(review_minutes(1, DEFAULT_PACE_MS), 1);
        assert_eq!(review_minutes(12, DEFAULT_PACE_MS), 2);
        assert_eq!(review_minutes(30, DEFAULT_PACE_MS), 4);
    }

    #[test]
    fn a_book_counts_the_words_of_it_due_today() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        learned(&desk, "b", 3);
        let of = |book: &str, days: i64| {
            book_reviews(desk.ctx(), book, t0() + TimeDelta::days(days)).expect("reviews")
        };

        assert_eq!(of("b", 0), BookReviews { due: 0, minutes: 0 });
        assert_eq!(of("b", 1).due, 3);
        assert!(of("b", 1).minutes >= 1);
        assert_eq!(of("elsewhere", 1), BookReviews { due: 0, minutes: 0 });
        // A word answered right in the review waits again.
        right(&desk, "w00", 1);
        assert_eq!(of("b", 1).due, 2);
    }

    #[test]
    fn a_chapter_counts_its_words_by_kind_as_its_panel_does() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let mut list = numbered(4);
        list[0].part_of_speech = Some(PartOfSpeech::Verb);
        list[1].part_of_speech = Some(PartOfSpeech::Verb);
        list[2].part_of_speech = Some(PartOfSpeech::Noun);
        let chapter = desk.chapter("b", &list);
        let conn = || desk.db.lock().expect("db");
        conn()
            .execute(
                "UPDATE chapter_words SET done_at = ?1 WHERE key IN ('w00', 'w02')",
                [ts(t0())],
            )
            .expect("done");
        let kind = |kind, learned, total| KindCount {
            kind,
            learned,
            total,
        };

        assert_eq!(
            chapter_kinds(desk.ctx(), &chapter).expect("kinds"),
            [
                kind(Some(PartOfSpeech::Verb), 1, 2),
                kind(None, 0, 1),
                kind(Some(PartOfSpeech::Noun), 1, 1),
            ]
        );
        // A word marked known leaves the count, as it leaves the panel's.
        conn()
            .execute(
                "INSERT INTO known_words (key, lemma, created_at) VALUES ('w01', 'w01', ?1)",
                [ts(t0())],
            )
            .expect("known");
        assert!(chapter_kinds(desk.ctx(), &chapter)
            .expect("kinds")
            .contains(&kind(Some(PartOfSpeech::Verb), 1, 1)));
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
