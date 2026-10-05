//! The learner's profile, the facts learned about them, and app settings.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use super::{new_id, ts};
use crate::books::spelling::Spelling;
use crate::domain::{Effort, Profile, ProfileFact, ProviderMode, Settings};
use crate::error::Result;

/// Model until the learner picks one from the provider's own list (SPEC §13).
pub const DEFAULT_MODEL: &str = "claude-sonnet-5-5";

const PROVIDER_MODE: &str = "providerMode";
const MODEL: &str = "model";
const EFFORT: &str = "effort";
const CLAUDE_PATH: &str = "claudePath";
/// Present when the learner asked for strict spelling.
const STRICT_SPELLING: &str = "strictSpelling";

pub fn get_profile(conn: &Connection) -> Result<Option<Profile>> {
    let row = conn
        .query_row(
            "SELECT name, native_lang, ui_lang, goal, variant, interests, level, reminder_time,
                    onboarded
             FROM profile WHERE id = 1",
            [],
            |row| {
                Ok((
                    Profile {
                        name: row.get(0)?,
                        native_lang: row.get(1)?,
                        ui_lang: row.get(2)?,
                        goal: row.get(3)?,
                        variant: row.get(4)?,
                        interests: Vec::new(),
                        level: row.get(6)?,
                        reminder_time: row.get(7)?,
                        onboarded: row.get(8)?,
                    },
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    row.map(|(mut profile, interests)| {
        profile.interests = serde_json::from_str(&interests)?;
        Ok(profile)
    })
    .transpose()
}

pub fn save_profile(conn: &Connection, profile: &Profile) -> Result<()> {
    conn.execute(
        "INSERT INTO profile (id, name, native_lang, ui_lang, goal, variant, interests, level,
                              reminder_time, onboarded)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, native_lang = excluded.native_lang,
           ui_lang = excluded.ui_lang, goal = excluded.goal, variant = excluded.variant,
           interests = excluded.interests, level = excluded.level,
           reminder_time = excluded.reminder_time, onboarded = excluded.onboarded",
        params![
            profile.name,
            profile.native_lang,
            profile.ui_lang,
            profile.goal,
            profile.variant,
            serde_json::to_string(&profile.interests)?,
            profile.level,
            profile.reminder_time,
            profile.onboarded,
        ],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?)
}

/// `None` removes the key.
pub fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<()> {
    match value {
        Some(value) => conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?,
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [key])?,
    };
    Ok(())
}

pub fn get_settings(conn: &Connection) -> Result<Settings> {
    Ok(Settings {
        provider_mode: get_setting(conn, PROVIDER_MODE)?
            .and_then(|m| ProviderMode::parse(&m))
            .unwrap_or(ProviderMode::ApiKey),
        model: get_setting(conn, MODEL)?.unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
        effort: get_setting(conn, EFFORT)?.and_then(|e| Effort::parse(&e)),
        claude_path: get_setting(conn, CLAUDE_PATH)?,
        // The speech module owns the selection; commands fill it in.
        stt_model: None,
        strict_spelling: get_setting(conn, STRICT_SPELLING)?.is_some(),
    })
}

pub fn save_settings(conn: &Connection, settings: &Settings) -> Result<()> {
    set_setting(conn, PROVIDER_MODE, Some(settings.provider_mode.as_str()))?;
    set_setting(conn, MODEL, Some(&settings.model))?;
    set_setting(conn, EFFORT, settings.effort.map(Effort::as_str))?;
    set_setting(conn, CLAUDE_PATH, settings.claude_path.as_deref())?;
    let strict = settings.strict_spelling.then_some("1");
    set_setting(conn, STRICT_SPELLING, strict)
}

/// How the learner's spelling is read: lenient until they ask for strict.
pub fn spelling(conn: &Connection) -> Result<Spelling> {
    Ok(Spelling::of(get_setting(conn, STRICT_SPELLING)?.is_some()))
}

pub fn list_facts(conn: &Connection) -> Result<Vec<ProfileFact>> {
    let mut stmt = conn.prepare(
        "SELECT id, text FROM profile_facts WHERE deleted = 0 ORDER BY created_at, rowid",
    )?;
    let facts = stmt
        .query_map([], |row| {
            Ok(ProfileFact {
                id: row.get(0)?,
                text: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(facts)
}

/// Skips facts already known, deleted ones included: a fact the learner
/// removed must not come back from the next analysis.
pub fn add_fact(conn: &Connection, text: &str, session_id: &str, now: DateTime<Utc>) -> Result<()> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO profile_facts (id, text, source_session_id, created_at)
         SELECT ?1, ?2, ?3, ?4
         WHERE NOT EXISTS (SELECT 1 FROM profile_facts WHERE lower(text) = lower(?2))",
        params![new_id(), text, session_id, ts(now)],
    )?;
    Ok(())
}

pub fn delete_fact(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("UPDATE profile_facts SET deleted = 1 WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::domain::{Goal, Level, UiLang, Variant};

    pub fn profile() -> Profile {
        Profile {
            name: Some("Ana".into()),
            native_lang: "es".into(),
            ui_lang: UiLang::Es,
            goal: Goal::Work,
            variant: Variant::Us,
            interests: vec!["cooking".into(), "chess".into()],
            level: Level::Intermediate,
            reminder_time: Some("19:30".into()),
            onboarded: true,
        }
    }

    #[test]
    fn profile_round_trips() {
        let conn = open_in_memory().expect("db");
        assert_eq!(get_profile(&conn).expect("empty"), None);
        save_profile(&conn, &profile()).expect("insert");
        let mut changed = profile();
        changed.level = Level::Advanced;
        save_profile(&conn, &changed).expect("update");
        assert_eq!(get_profile(&conn).expect("read"), Some(changed));
    }

    #[test]
    fn settings_have_defaults_and_round_trip() {
        let conn = open_in_memory().expect("db");
        let defaults = get_settings(&conn).expect("defaults");
        assert_eq!(defaults.provider_mode, ProviderMode::ApiKey);
        assert_eq!(defaults.model, DEFAULT_MODEL);
        assert_eq!(defaults.effort, None);
        assert!(!defaults.strict_spelling);
        assert_eq!(spelling(&conn).expect("spelling"), Spelling::Lenient);
        let mut settings = Settings {
            provider_mode: ProviderMode::ClaudeCode,
            model: "opus".into(),
            effort: Some(Effort::High),
            claude_path: Some("/usr/bin/claude".into()),
            stt_model: None,
            strict_spelling: true,
        };
        save_settings(&conn, &settings).expect("save");
        assert_eq!(get_settings(&conn).expect("read"), settings);
        assert_eq!(spelling(&conn).expect("spelling"), Spelling::Strict);
        settings.effort = None;
        settings.strict_spelling = false;
        save_settings(&conn, &settings).expect("back to automatic");
        assert_eq!(get_settings(&conn).expect("read"), settings);
    }

    #[test]
    fn deleted_facts_stay_deleted() {
        let conn = open_in_memory().expect("db");
        conn.execute(
            "INSERT INTO sessions (id, started_at, setup, topic, level, mode)
             VALUES ('s', 'x', '{}', 't', 'basic', 'casual')",
            [],
        )
        .expect("session");
        let now = Utc::now();
        add_fact(&conn, "Works in logistics", "s", now).expect("add");
        add_fact(&conn, "works in logistics", "s", now).expect("duplicate");
        let facts = list_facts(&conn).expect("list");
        assert_eq!(facts.len(), 1);
        delete_fact(&conn, &facts[0].id).expect("delete");
        add_fact(&conn, "Works in logistics", "s", now).expect("again");
        assert_eq!(list_facts(&conn).expect("list"), [] as [ProfileFact; 0]);
    }
}
