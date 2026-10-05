//! Text-to-speech commands. The work is in `crate::tts`; this is the bridge:
//! it finds which English the learner chose, turns download progress into
//! `tts-download` events, and keeps the blocking calls (the download, a
//! sentence being read) off the async runtime's workers.
use tauri::{AppHandle, Emitter, Manager};

use super::run;
use crate::db::profile as repo;
use crate::domain::{Pace, TtsDownload, TtsStatus, Variant};
use crate::error::Result;
use crate::{AppState, Ctx};

/// The learner's English; American before there is a profile to say.
pub(super) fn variant(ctx: Ctx<'_>) -> Result<Variant> {
    Ok(repo::get_profile(&*ctx.conn()?)?.map_or(Variant::Us, |profile| profile.variant))
}

#[tauri::command]
pub async fn tts_status(app: AppHandle) -> Result<TtsStatus> {
    run(app, |app, ctx| {
        app.state::<AppState>().tts.status(variant(ctx)?)
    })
    .await
}

/// Resolves once the voice is on disk and its checksums matched.
#[tauri::command]
pub async fn tts_download(app: AppHandle) -> Result<()> {
    run(app, |app, _| {
        app.state::<AppState>().tts.download(|received, total| {
            let _ = app.emit("tts-download", TtsDownload { received, total });
        })
    })
    .await
}

/// Picks the voice and whether anything is read aloud; resolves to the
/// status as it stands after it.
#[tauri::command]
pub async fn tts_configure(app: AppHandle, voice: String, enabled: bool) -> Result<TtsStatus> {
    run(app, move |app, ctx| {
        let tts = &app.state::<AppState>().tts;
        tts.configure(&voice, enabled)?;
        tts.status(variant(ctx)?)
    })
    .await
}

/// Reads `text` aloud. Resolves when it has been heard to the end, or when
/// something else was said over it or `tts_stop` silenced it.
#[tauri::command]
pub async fn tts_speak(app: AppHandle, text: String) -> Result<()> {
    run(app, move |app, ctx| {
        app.state::<AppState>()
            .tts
            .speak(&text, variant(ctx)?, Pace::Normal)
    })
    .await
}

#[tauri::command]
pub async fn tts_stop(state: tauri::State<'_, AppState>) -> Result<()> {
    state.tts.stop();
    Ok(())
}
