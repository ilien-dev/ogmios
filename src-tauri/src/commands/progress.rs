//! The progress map and the soft streak (SPEC §11).

use std::cmp::Reverse;
use std::collections::BTreeSet;

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::run;
use crate::books::vocab::key;
use crate::db::{patterns, recall, sessions, words};
use crate::domain::{
    CefrPoint, DatedText, Progress, SessionSummary, Streak, TrendPoint, VocabEntry, WeekMinutes,
};
use crate::error::Result;
use crate::Ctx;

/// Rest days per ISO week that do not break the streak.
pub const FREEZES_PER_WEEK: u32 = 2;
/// Weeks shown in the speech-minutes chart.
const WEEKS_SHOWN: i64 = 12;

pub fn local_date(time: DateTime<Utc>) -> NaiveDate {
    time.with_timezone(&Local).date_naive()
}

/// Consecutive practiced days, walking back from today. A missed day is
/// forgiven while its ISO week has freezes left; today not practiced yet
/// breaks nothing. Freezes count only when a practiced day lies behind them.
pub fn streak(days: &BTreeSet<NaiveDate>, today: NaiveDate) -> Streak {
    let practiced_today = days.contains(&today);
    let mut count = 0;
    let mut used: Vec<NaiveDate> = Vec::new();
    let mut gap: Vec<NaiveDate> = Vec::new();
    if let Some(&first) = days.first() {
        let mut day = if practiced_today {
            Some(today)
        } else {
            today.pred_opt()
        };
        while let Some(d) = day.filter(|d| *d >= first) {
            if days.contains(&d) {
                count += 1;
                used.append(&mut gap);
            } else {
                let week = d.iso_week();
                let taken = used
                    .iter()
                    .chain(&gap)
                    .filter(|f| f.iso_week() == week)
                    .count();
                if taken >= usize::try_from(FREEZES_PER_WEEK).unwrap_or(usize::MAX) {
                    break;
                }
                gap.push(d);
            }
            day = d.pred_opt();
        }
    }
    let this_week = used
        .iter()
        .filter(|f| f.iso_week() == today.iso_week())
        .count();
    Streak {
        days: count,
        freezes_left: FREEZES_PER_WEEK.saturating_sub(u32::try_from(this_week).unwrap_or(u32::MAX)),
        practiced_today,
    }
}

fn week_label(day: NaiveDate) -> String {
    let week = day.iso_week();
    format!("{}-W{:02}", week.year(), week.week())
}

fn weekly_minutes(rows: &[sessions::SessionRow], today: NaiveDate) -> Vec<WeekMinutes> {
    (0..WEEKS_SHOWN)
        .rev()
        .map(|back| {
            let label = week_label(today - Duration::weeks(back));
            let minutes = rows
                .iter()
                .filter(|s| week_label(local_date(s.started_at)) == label)
                .map(|s| s.speech_minutes)
                .sum();
            WeekMinutes {
                week: label,
                minutes,
            }
        })
        .collect()
}

/// The words the learner has learned, the latest first: the ones asked for
/// in conversations, and the book words finished in practice, each with its
/// translation.
fn vocabulary(conn: &Connection) -> Result<Vec<VocabEntry>> {
    let asked = sessions::list_vocab(conn, None)?
        .into_iter()
        .map(|(item, at)| (at, item.asked, item.english));
    let read = words::learned(conn)?
        .into_iter()
        .map(|word| (word.done_at, word.translation, word.lemma));
    let mut all: Vec<_> = asked.chain(read).collect();
    all.sort_by_key(|(at, ..)| Reverse(*at));
    let strengths = recall::strengths(conn)?;
    Ok(all
        .into_iter()
        .map(|(at, asked, english)| VocabEntry {
            strength: strengths.get(&key(&english)).copied(),
            asked,
            english,
            date: local_date(at).to_string(),
        })
        .collect())
}

pub fn progress(ctx: Ctx<'_>, today: NaiveDate) -> Result<Progress> {
    let conn = ctx.conn()?;
    let events = patterns::events_by_pattern(&conn)?;
    let pattern_views = patterns::list_patterns(&conn)?
        .iter()
        .map(|p| patterns::view(p, events.get(&p.id).map_or(&[][..], Vec::as_slice)))
        .collect();
    let rows = sessions::list_sessions(&conn)?;
    let oldest_first = || rows.iter().rev();
    let date = |t: DateTime<Utc>| local_date(t).to_string();
    Ok(Progress {
        patterns: pattern_views,
        weekly_minutes: weekly_minutes(&rows, today),
        cefr_history: oldest_first()
            .filter_map(|s| {
                Some(CefrPoint {
                    date: date(s.started_at),
                    cefr: s.estimated_cefr?,
                })
            })
            .collect(),
        best_sentences: sessions::list_best_sentences(&conn)?
            .into_iter()
            .map(|(text, at)| DatedText {
                date: date(at),
                text,
            })
            .collect(),
        vocabulary: vocabulary(&conn)?,
        trend: oldest_first()
            .filter_map(|s| {
                Some(TrendPoint {
                    metrics: s.metrics.clone()?,
                    date: date(s.started_at),
                })
            })
            .collect(),
        sessions: rows
            .iter()
            .map(|s| SessionSummary {
                id: s.id.clone(),
                started_at: crate::db::ts(s.started_at),
                topic: s.setup.topic.clone(),
                mode: s.setup.mode,
                level: s.setup.level,
                speech_minutes: s.speech_minutes,
                has_report: s.report.is_some(),
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn get_progress(app: AppHandle) -> Result<Progress> {
    run(app, |_, ctx| progress(ctx, Local::now().date_naive())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, month, day).expect("valid date")
    }

    fn set(days: &[NaiveDate]) -> BTreeSet<NaiveDate> {
        days.iter().copied().collect()
    }

    // 2026-09-21 is a Monday; 2026-09-24 a Thursday.

    #[test]
    fn empty_history_has_no_streak() {
        let s = streak(&BTreeSet::new(), d(9, 24));
        assert_eq!((s.days, s.freezes_left, s.practiced_today), (0, 2, false));
    }

    #[test]
    fn today_not_practiced_yet_does_not_break_it() {
        let s = streak(&set(&[d(9, 22), d(9, 23)]), d(9, 24));
        assert_eq!((s.days, s.freezes_left, s.practiced_today), (2, 2, false));
        let s = streak(&set(&[d(9, 22), d(9, 23), d(9, 24)]), d(9, 24));
        assert_eq!((s.days, s.practiced_today), (3, true));
    }

    #[test]
    fn two_missed_days_a_week_are_forgiven() {
        // Practiced Mon and Thu; missed Tue and Wed.
        let s = streak(&set(&[d(9, 21), d(9, 24)]), d(9, 24));
        assert_eq!((s.days, s.freezes_left), (2, 0));
    }

    #[test]
    fn a_third_missed_day_in_a_week_breaks_it() {
        // Sun 20 practiced, then Mon, Tue, Wed missed.
        let s = streak(&set(&[d(9, 20), d(9, 24)]), d(9, 24));
        assert_eq!(
            (s.days, s.freezes_left),
            (1, 2),
            "unused gap freezes are not charged"
        );
    }

    #[test]
    fn freezes_reset_each_iso_week() {
        // Missed Sat 19 and Sun 20 (week 38), and Mon 21, Tue 22 (week 39).
        let days = set(&[d(9, 17), d(9, 18), d(9, 23), d(9, 24)]);
        let s = streak(&days, d(9, 24));
        assert_eq!((s.days, s.freezes_left), (4, 0));
    }

    #[test]
    fn a_long_break_ends_it() {
        let s = streak(&set(&[d(9, 1)]), d(9, 24));
        assert_eq!(s.days, 0);
        assert_eq!(s.freezes_left, 2);
    }

    #[test]
    fn finished_book_words_are_listed_once_with_their_translation() {
        use crate::db::words::tests::{book, mark_done, mark_known, word};
        use crate::db::{open_in_memory, words};
        use crate::domain::Depth;

        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one", "two"]);
        let list = [
            word("peep", &["asomarse", "echar un vistazo"], 2),
            word("bank", &["orilla"], 1),
            word("hedge", &["seto"], 1),
        ];
        for chapter in &chapters {
            words::finish(&conn, chapter, Depth::Most, &list, Utc::now()).expect("words");
            mark_done(&conn, chapter, "peep");
        }
        // Known is not learned here, and an open word is not learned yet.
        mark_known(&conn, "hedge");

        let listed = vocabulary(&conn).expect("vocabulary");
        assert_eq!(
            listed,
            [VocabEntry {
                asked: Some("asomarse".into()),
                english: "peep".into(),
                date: local_date(Utc::now()).to_string(),
                strength: None,
            }]
        );
        for table in ["patterns", "pattern_events", "vocab"] {
            let rows: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count");
            assert_eq!(rows, 0, "book words never touch {table}");
        }
    }

    #[test]
    fn weeks_are_labelled_by_iso_week() {
        assert_eq!(week_label(d(9, 24)), "2026-W39");
        assert_eq!(
            week_label(NaiveDate::from_ymd_opt(2027, 1, 1).expect("date")),
            "2026-W53"
        );
    }
}
