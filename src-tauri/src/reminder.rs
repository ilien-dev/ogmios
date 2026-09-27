//! Daily practice reminder (SPEC §11): once a minute, if the reminder time
//! has passed, nobody practised today and no reminder went out today, one
//! desktop notification.

use std::time::Duration;

use chrono::{Local, NaiveDate, NaiveTime};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::{profile, sessions};
use crate::domain::UiLang;
use crate::error::Result;
use crate::AppState;

const CHECK_EVERY: Duration = Duration::from_secs(60);
/// Settings key holding the local date of the last reminder.
const LAST_REMINDED: &str = "reminderSentOn";

pub fn spawn(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("ogmios-reminder".into())
        .spawn(move || loop {
            if let Err(err) = tick(&app) {
                eprintln!("reminder: {err}");
            }
            std::thread::sleep(CHECK_EVERY);
        });
    if let Err(err) = spawned {
        eprintln!("reminder thread did not start: {err}");
    }
}

fn text(lang: UiLang) -> (&'static str, &'static str) {
    match lang {
        UiLang::En => (
            "Time for English",
            "A few minutes of conversation today? Ogmios is ready.",
        ),
        UiLang::Es => (
            "Hora de inglés",
            "¿Unos minutos de conversación hoy? Ogmios te espera.",
        ),
    }
}

/// Whether to remind now, given the stored `HH:MM` and what happened today.
pub fn due(
    reminder_time: Option<&str>,
    now: NaiveTime,
    practiced_today: bool,
    reminded_today: bool,
) -> bool {
    let Some(at) = reminder_time.and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()) else {
        return false;
    };
    now >= at && !practiced_today && !reminded_today
}

fn tick(app: &AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    let ctx = state.ctx();
    let now = Local::now();
    let today: NaiveDate = now.date_naive();
    let lang = {
        let conn = ctx.conn()?;
        let Some(profile) = profile::get_profile(&conn)? else {
            return Ok(());
        };
        let practiced = sessions::practice_days(&conn)?.contains(&today);
        let reminded = profile::get_setting(&conn, LAST_REMINDED)?.as_deref()
            == Some(today.to_string().as_str());
        if !due(
            profile.reminder_time.as_deref(),
            now.time(),
            practiced,
            reminded,
        ) {
            return Ok(());
        }
        profile::set_setting(&conn, LAST_REMINDED, Some(&today.to_string()))?;
        profile.ui_lang
    };
    let (title, body) = text(lang);
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| crate::error::Error::Internal(format!("notification: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).expect("valid time")
    }

    #[test]
    fn reminds_once_after_the_time_unless_practised() {
        assert!(!due(None, t(20, 0), false, false));
        assert!(!due(Some("19:30"), t(19, 29), false, false));
        assert!(due(Some("19:30"), t(19, 30), false, false));
        assert!(!due(Some("19:30"), t(21, 0), true, false));
        assert!(!due(Some("19:30"), t(21, 0), false, true));
        assert!(!due(Some("bad"), t(21, 0), false, false));
    }
}
