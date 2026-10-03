//! Speech-to-text commands. The work is in `crate::stt`; this is the bridge:
//! it turns callbacks into `stt-level` / `stt-partial` / `stt-download` events and moves the
//! blocking calls (downloads, transcription) off the async runtime's workers.
use tauri::{AppHandle, Emitter, Manager};

use crate::domain::{Recording, SttDownload, SttStatus};
use crate::error::{Error, Result};
use crate::AppState;

#[tauri::command]
pub async fn stt_status(state: tauri::State<'_, AppState>) -> Result<SttStatus> {
    Ok(state.stt.status())
}

/// Resolves once the model is on disk and its checksum matched.
#[tauri::command]
pub async fn stt_download(app: AppHandle, model_id: String) -> Result<()> {
    blocking(app, move |app| {
        app.state::<AppState>()
            .stt
            .download(&model_id, |received, total| {
                let _ = app.emit(
                    "stt-download",
                    SttDownload {
                        model_id: model_id.clone(),
                        received,
                        total,
                    },
                );
            })
    })
    .await
}

#[tauri::command]
pub async fn stt_select(state: tauri::State<'_, AppState>, model_id: String) -> Result<()> {
    state.stt.select(&model_id)
}

#[tauri::command]
pub async fn stt_start(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<()> {
    let partial = app.clone();
    // The microphone would hear the voice reading aloud.
    state.tts.stop();
    state.stt.start(
        move |level| {
            let _ = app.emit("stt-level", level);
        },
        move |text| {
            let _ = partial.emit("stt-partial", text);
        },
    )
}

#[tauri::command]
pub async fn stt_stop(app: AppHandle) -> Result<Recording> {
    blocking(app, |app| app.state::<AppState>().stt.stop()).await
}

#[tauri::command]
pub async fn stt_cancel(state: tauri::State<'_, AppState>) -> Result<()> {
    state.stt.cancel();
    Ok(())
}

/// Run `work` on the blocking pool, where a long download or a transcription
/// cannot starve the async workers.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || work(&app))
        .await
        .map_err(|e| Error::Internal(format!("speech task failed: {e}")))?
}
