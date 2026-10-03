//! The running version and in-app updates from the GitHub release.

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::domain::UpdateInfo;
use crate::error::{Error, Result};

fn update_error(err: tauri_plugin_updater::Error) -> Error {
    Error::Update(err.to_string())
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The newer release, or `None` when this one is the latest.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>> {
    let update = app
        .updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
        notes: update.body,
    }))
}

/// Downloads and installs the newer release, then restarts into it.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<()> {
    let update = app
        .updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?
        .ok_or_else(|| Error::NotFound("no newer version".into()))?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(update_error)?;
    app.restart()
}
