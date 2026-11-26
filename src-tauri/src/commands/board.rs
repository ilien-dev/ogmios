//! What the column beside a book's scene counts: how strong the words
//! learned in each chapter are, how many of the book's words the daily
//! review asks today, what kinds of word a chapter has, and at the
//! learner's pace how long until a chapter can be read. Every count is of the words the chapter's
//! panel calls learned (finished, and not marked known), so the column and
//! the panel always agree.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, TimeDelta, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::recall::due;
use super::run;
use crate::books::practice::pace;
use crate::db::practice::{pace_sample, NOT_KNOWN};
use crate::db::recall::{self, Source};
use crate::db::{parse_ts, ts};
use crate::domain::{BookReviews, ChapterStrength, KindCount, LearningPace, Strength, Ways};
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
pub(super) fn review_minutes(words: u32, pace: u64) -> u32 {
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

/// How many days the pace is read over.
pub const PACE_DAYS: u32 = 14;

/// How many days `left` words take at the pace of `learned` words in the
/// last [`PACE_DAYS`] days, rounded up: none left is no day, and no word
/// learned is no pace to tell by.
pub fn days_to_read(left: u32, learned: u32) -> Option<u32> {
    if left == 0 {
        return Some(0);
    }
    if learned == 0 {
        return None;
    }
    let days = u64::from(left)
        .saturating_mul(u64::from(PACE_DAYS))
        .div_ceil(u64::from(learned));
    Some(u32::try_from(days).unwrap_or(u32::MAX))
}

/// The words finished in each of the last [`PACE_DAYS`] days up to `now`, in
/// any book, oldest first: a day is the 24 hours before the next one starts.
fn learned_by_day(conn: &Connection, now: DateTime<Utc>) -> Result<Vec<u32>> {
    let from = now - TimeDelta::days(i64::from(PACE_DAYS));
    let mut stmt =
        conn.prepare("SELECT done_at FROM chapter_words WHERE done_at > ?1 AND done_at <= ?2")?;
    let times = stmt
        .query_map([ts(from), ts(now)], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut daily = vec![0_u32; usize::try_from(PACE_DAYS).unwrap_or(0)];
    for at in times {
        let ago = (now - parse_ts(&at)?).num_days();
        let day = i64::from(PACE_DAYS) - 1 - ago;
        if let Some(count) = usize::try_from(day).ok().and_then(|day| daily.get_mut(day)) {
            *count = count.saturating_add(1);
        }
    }
    Ok(daily)
}

/// How many words of a chapter are still to learn before it is ready, as
/// its readiness counts them; None for a chapter not prepared.
fn left_to_learn(conn: &Connection, chapter_id: &str) -> Result<Option<u32>> {
    let prepared: Option<String> = conn.query_row(
        "SELECT prepared FROM book_chapters WHERE id = ?1",
        [chapter_id],
        |row| row.get(0),
    )?;
    if prepared.is_none() {
        return Ok(None);
    }
    let left = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM chapter_words w
             WHERE w.chapter_id = ?1 AND w.done_at IS NULL AND {NOT_KNOWN}"
        ),
        [chapter_id],
        |row| row.get(0),
    )?;
    Ok(Some(left))
}

/// The learner's pace over the last [`PACE_DAYS`] days, and at it how many
/// days until the chapter can be read.
pub fn chapter_pace(ctx: Ctx<'_>, chapter_id: &str, now: DateTime<Utc>) -> Result<LearningPace> {
    let conn = ctx.conn()?;
    let daily = learned_by_day(&conn, now)?;
    let left = left_to_learn(&conn, chapter_id)?;
    let learned = daily
        .iter()
        .fold(0_u32, |all, day| all.saturating_add(*day));
    Ok(LearningPace {
        days: left.and_then(|left| days_to_read(left, learned)),
        daily,
        left,
    })
}

#[tauri::command]
pub async fn learning_pace(app: AppHandle, chapter_id: String) -> Result<LearningPace> {
    run(app, move |_, ctx| {
        chapter_pace(ctx, &chapter_id, Utc::now())
    })
    .await
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
    fn the_days_left_are_rounded_up_at_the_pace_of_two_weeks() {
        // 28 words in 14 days is 2 a day: 7 words take 4 days.
        assert_eq!(days_to_read(7, 28), Some(4));
        assert_eq!(days_to_read(8, 28), Some(4));
        assert_eq!(days_to_read(1, 1), Some(14));
        assert_eq!(days_to_read(0, 0), Some(0));
        assert_eq!(days_to_read(5, 0), None);
    }

    #[test]
    fn the_pace_counts_the_words_finished_each_day_and_what_the_chapter_has_left() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let done = desk.chapter("done", &numbered(3));
        let open = desk.chapter("open", &numbered(4));
        let finish = |chapter: &str, at: DateTime<Utc>| {
            desk.db
                .lock()
                .expect("db")
                .execute(
                    "UPDATE chapter_words SET done_at = ?1 WHERE chapter_id = ?2",
                    [ts(at), chapter.to_owned()],
                )
                .expect("done");
        };
        finish(&done, t0());
        let now = t0() + TimeDelta::hours(30);
        let pace = chapter_pace(desk.ctx(), &open, now).expect("pace");

        let mut daily = vec![0; 14];
        daily[12] = 3;
        assert_eq!(pace.daily, daily);
        assert_eq!(pace.left, Some(4));
        // 3 words in 14 days: 4 words take 19 days.
        assert_eq!(pace.days, Some(19));
        // Two weeks later the pace is gone.
        let later = chapter_pace(desk.ctx(), &open, t0() + TimeDelta::days(15)).expect("pace");
        assert_eq!((later.left, later.days), (Some(4), None));
        // A chapter all learned is ready now.
        assert_eq!(
            chapter_pace(desk.ctx(), &done, now).expect("pace").days,
            Some(0)
        );
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
