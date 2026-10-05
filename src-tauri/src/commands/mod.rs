pub mod book;
pub mod chapter;
pub mod dispute;
pub mod drill;
pub mod label;
pub mod listening;
pub mod practice;
pub mod profile;
pub mod progress;
pub mod recall;
pub mod refresh;
pub mod sentences;
pub mod session;
pub mod structures;
pub mod stt;
#[cfg(test)]
mod tests;
pub mod translate;
pub mod tts;
pub mod update;

use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};
use crate::{AppState, Ctx};

/// Runs command logic on the blocking pool: it locks SQLite and waits on the
/// sidecar, neither of which may stall the async runtime.
async fn run<T, F>(app: AppHandle, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle, Ctx<'_>) -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&app, app.state::<AppState>().ctx()))
        .await
        .map_err(|e| Error::Internal(format!("command task failed: {e}")))?
}
