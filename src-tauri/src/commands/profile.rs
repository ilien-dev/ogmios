//! Profile, settings and the connection to Claude (SPEC §5, §13).

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::run;
use crate::agent::protocol::ConfigureParams;
use crate::agent::Agent;
use crate::db::profile as repo;
use crate::domain::{Profile, ProfileFact, ProviderCheck, ProviderMode, Settings};
use crate::error::{Error, Result};
use crate::{AppState, Ctx};

/// The API key lives in the OS credential store under this service.
const KEYRING_SERVICE: &str = "dev.ilien.ogmios";
const KEYRING_USER: &str = "anthropic-api-key";

fn keyring_error(err: keyring::Error) -> Error {
    Error::Internal(format!("credential store: {err}"))
}

fn key_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(keyring_error)
}

fn read_api_key() -> Result<Option<String>> {
    match key_entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(keyring_error(err)),
    }
}

fn write_api_key(key: Option<&str>) -> Result<()> {
    let entry = key_entry()?;
    match key {
        Some(key) => entry.set_password(key).map_err(keyring_error),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(keyring_error(err)),
        },
    }
}

/// Hands the current settings and key to the agent; they reach the sidecar
/// with its next call.
fn configure(ctx: Ctx<'_>) -> Result<()> {
    let settings = repo::get_settings(&*ctx.conn()?)?;
    let api_key = match settings.provider_mode {
        ProviderMode::ApiKey => read_api_key()?,
        ProviderMode::ClaudeCode => None,
    };
    ctx.agent.configure(ConfigureParams {
        mode: settings.provider_mode,
        model: settings.model,
        api_key,
        claude_path: settings.claude_path,
    });
    Ok(())
}

/// The agent, configured from the stored settings on first use.
pub fn agent(ctx: Ctx<'_>) -> Result<&Agent> {
    if !ctx.agent.is_configured() {
        configure(ctx)?;
    }
    Ok(ctx.agent)
}

/// The profile every conversation needs; missing only before onboarding.
pub fn require_profile(conn: &rusqlite::Connection) -> Result<Profile> {
    repo::get_profile(conn)?.ok_or_else(|| Error::NotFound("profile not found".into()))
}

/// The first `claude` on `PATH`, then the installer's usual places.
fn find_claude(path: Option<OsString>, home: Option<&Path>) -> Option<PathBuf> {
    let name = format!("claude{}", std::env::consts::EXE_SUFFIX);
    let on_path = path
        .iter()
        .flat_map(std::env::split_paths)
        .map(|dir| dir.join(&name));
    let usual = home.into_iter().flat_map(|h| {
        [
            h.join(".local/bin").join(&name),
            h.join(".claude/local").join(&name),
        ]
    });
    on_path.chain(usual).find(|p| p.is_file())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[tauri::command]
pub async fn get_profile(app: AppHandle) -> Result<Option<Profile>> {
    run(app, |_, ctx| repo::get_profile(&*ctx.conn()?)).await
}

#[tauri::command]
pub async fn save_profile(app: AppHandle, profile: Profile) -> Result<()> {
    if profile.native_lang.trim().is_empty() {
        return Err(Error::Invalid("native language is required".into()));
    }
    run(app, move |_, ctx| {
        repo::save_profile(&*ctx.conn()?, &profile)
    })
    .await
}

#[tauri::command]
pub async fn list_profile_facts(app: AppHandle) -> Result<Vec<ProfileFact>> {
    run(app, |_, ctx| repo::list_facts(&*ctx.conn()?)).await
}

#[tauri::command]
pub async fn delete_profile_fact(app: AppHandle, id: String) -> Result<()> {
    run(app, move |_, ctx| repo::delete_fact(&*ctx.conn()?, &id)).await
}

/// `sttModel` lives with the speech module (`<data_dir>/stt.json`); the
/// rest in SQLite.
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings> {
    run(app, |app, ctx| {
        let mut settings = repo::get_settings(&*ctx.conn()?)?;
        settings.stt_model = app.state::<AppState>().stt.status().selected;
        Ok(settings)
    })
    .await
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Result<()> {
    if settings.model.trim().is_empty() {
        return Err(Error::Invalid("model is required".into()));
    }
    run(app, move |app, ctx| {
        if let Some(model) = settings.stt_model.as_deref() {
            app.state::<AppState>().stt.select(model)?;
        }
        repo::save_settings(&*ctx.conn()?, &settings)?;
        configure(ctx)
    })
    .await
}

#[tauri::command]
pub async fn set_api_key(app: AppHandle, key: Option<String>) -> Result<()> {
    let key = key.map(|k| k.trim().to_owned()).filter(|k| !k.is_empty());
    run(app, move |_, ctx| {
        write_api_key(key.as_deref())?;
        configure(ctx)
    })
    .await
}

#[tauri::command]
pub async fn has_api_key(app: AppHandle) -> Result<bool> {
    run(app, |_, _| Ok(read_api_key()?.is_some())).await
}

#[tauri::command]
pub async fn detect_claude(app: AppHandle) -> Result<Option<String>> {
    run(app, |_, _| {
        let found = find_claude(std::env::var_os("PATH"), home_dir().as_deref());
        Ok(found.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}

/// A provider error is an answer here ("the key is wrong"), not a failure.
#[tauri::command]
pub async fn check_provider(app: AppHandle) -> Result<ProviderCheck> {
    run(app, |_, ctx| match agent(ctx)?.check() {
        Err(Error::Provider(message)) => Ok(ProviderCheck {
            ok: false,
            message: Some(message),
        }),
        other => other,
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_claude_on_path_before_the_usual_places() {
        let dir = tempfile::tempdir().expect("tempdir");
        let name = format!("claude{}", std::env::consts::EXE_SUFFIX);
        let bin = dir.path().join("bin");
        let local = dir.path().join(".local/bin");
        std::fs::create_dir_all(&bin).expect("bin");
        std::fs::create_dir_all(&local).expect("local");
        std::fs::write(local.join(&name), "").expect("local claude");
        let path = std::env::join_paths([&bin]).expect("path");
        assert_eq!(
            find_claude(Some(path.clone()), Some(dir.path())),
            Some(local.join(&name))
        );
        std::fs::write(bin.join(&name), "").expect("path claude");
        assert_eq!(
            find_claude(Some(path), Some(dir.path())),
            Some(bin.join(&name))
        );
        assert_eq!(find_claude(None, None), None);
    }
}
