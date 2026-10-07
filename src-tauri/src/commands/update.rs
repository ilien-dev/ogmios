//! The running version and in-app updates from the GitHub release.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::domain::{UpdateDownload, UpdateInfo};
use crate::error::{Error, Result};

/// The release `download_update` fetched, kept until `install_update`
/// restarts into it. Never on disk: closing the app first drops it.
#[derive(Default)]
pub struct Downloaded(Mutex<Option<(Update, Vec<u8>)>>);

fn update_error(err: tauri_plugin_updater::Error) -> Error {
    Error::Update(err.to_string())
}

async fn newer(app: &AppHandle) -> Result<Option<Update>> {
    app.updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The newer release, or `None` when this one is the latest.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>> {
    Ok(newer(&app).await?.map(|update| UpdateInfo {
        version: update.version,
        notes: update.body,
    }))
}

/// Downloads the newer release while the app stays in use, reporting
/// `update-download` on its way. Nothing is installed yet.
#[tauri::command]
pub async fn download_update(app: AppHandle, held: State<'_, Downloaded>) -> Result<()> {
    let update = newer(&app)
        .await?
        .ok_or_else(|| Error::NotFound("no newer version".into()))?;
    let mut received: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received = received.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
                let _ = app.emit("update-download", UpdateDownload { received, total });
            },
            || {},
        )
        .await
        .map_err(update_error)?;
    *held
        .0
        .lock()
        .map_err(|_| Error::Internal("update lock poisoned".into()))? = Some((update, bytes));
    Ok(())
}

/// Installs the downloaded release, then restarts into it.
#[tauri::command]
pub async fn install_update(app: AppHandle, held: State<'_, Downloaded>) -> Result<()> {
    let (update, bytes) = held
        .0
        .lock()
        .map_err(|_| Error::Internal("update lock poisoned".into()))?
        .take()
        .ok_or_else(|| Error::NotFound("no downloaded update".into()))?;
    update.install(bytes).map_err(update_error)?;
    app.restart()
}
