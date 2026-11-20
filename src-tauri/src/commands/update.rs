//! The running version and in-app updates from the GitHub release.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::domain::{UpdateDownload, UpdateInfo};
use crate::error::{Error, Result};

/// The release `download_update` fetched, kept until `install_update`
/// restarts into it. Never on disk: closing the app first drops it.
#[derive(Default)]
pub struct Downloaded(Mutex<Option<(Update, Vec<u8>)>>);

/// How often a download says how far it is. The updater hands over one chunk
/// per network read, thousands for a release; an event for each restarts the
/// bar's transition before it can move, so the bar stalls while the text runs.
const REPORT_EVERY: Duration = Duration::from_millis(100);

/// Whether the chunk that brought the download to `received` is worth an
/// event: the first, the last, and then one per `REPORT_EVERY`.
fn due(last: Option<Instant>, now: Instant, received: u64, total: Option<u64>) -> bool {
    last.is_none_or(|at| now.duration_since(at) >= REPORT_EVERY)
        || total.is_some_and(|total| received >= total)
}

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
    let mut reported: Option<Instant> = None;
    let bytes = update
        .download(
            |chunk, total| {
                received = received.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
                let now = Instant::now();
                if due(reported, now, received, total) {
                    reported = Some(now);
                    let _ = app.emit("update-download", UpdateDownload { received, total });
                }
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

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{due, REPORT_EVERY};

    const SOON: Duration = Duration::from_millis(5);

    #[test]
    fn the_first_chunk_is_reported() {
        assert!(due(None, Instant::now(), 8_192, Some(52_000_000)));
    }

    #[test]
    fn chunks_closer_than_the_interval_are_not() {
        let at = Instant::now();
        assert!(!due(Some(at), at + SOON, 16_384, Some(52_000_000)));
        assert!(!due(Some(at), at + SOON, 16_384, None));
    }

    #[test]
    fn a_chunk_after_the_interval_is() {
        let at = Instant::now();
        assert!(due(Some(at), at + REPORT_EVERY, 16_384, Some(52_000_000)));
        assert!(due(Some(at), at + REPORT_EVERY, 16_384, None));
    }

    #[test]
    fn the_last_chunk_is_reported_however_soon() {
        let at = Instant::now();
        assert!(due(Some(at), at + SOON, 52_000_000, Some(52_000_000)));
    }
}
