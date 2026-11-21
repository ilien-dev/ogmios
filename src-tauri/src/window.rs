//! The main window between launches: maximized the first time on every
//! system, then as the learner left it.
//!
//! tauri-plugin-window-state keeps the size, place and state, but only ever
//! maximizes a window on restore and never un-maximizes one: a window that
//! opened maximized from the config would stay so whatever was saved. So the
//! config opens it plain, and it is maximized here only when nothing was saved.

use std::path::Path;

use tauri::plugin::TauriPlugin;
use tauri::{App, AppHandle, Manager, Wry};
use tauri_plugin_window_state::{AppHandleExt, Builder, StateFlags, DEFAULT_FILENAME};

/// What is kept of a window: everything but its visibility, since a window
/// saved hidden would never show again.
const KEPT: StateFlags = StateFlags::all().difference(StateFlags::VISIBLE);

pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new().with_state_flags(KEPT).build()
}

/// Whether no window state was ever saved in `config_dir`.
fn first_launch(config_dir: &Path) -> bool {
    !config_dir.join(DEFAULT_FILENAME).exists()
}

/// Maximizes the main window when this is the first launch.
pub fn open(app: &App) -> tauri::Result<()> {
    if first_launch(&app.path().app_config_dir()?) {
        if let Some(main) = app.get_webview_window("main") {
            main.maximize()?;
        }
    }
    Ok(())
}

/// Saves the window now. An update on Windows ends the app with
/// `process::exit`, which skips the save the plugin makes on close.
pub fn save(app: &AppHandle) {
    let _ = app.save_window_state(KEPT);
}

#[cfg(test)]
mod tests {
    use super::{first_launch, DEFAULT_FILENAME};

    #[test]
    fn without_a_saved_state_it_is_the_first_launch() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(first_launch(dir.path()));
        assert!(first_launch(&dir.path().join("not-created-yet")));
    }

    #[test]
    fn with_a_saved_state_it_is_not() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::write(dir.path().join(DEFAULT_FILENAME), "{}").expect("state file");
        assert!(!first_launch(dir.path()));
    }
}
