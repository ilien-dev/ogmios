//! Ogmios backend: SQLite, the error memory, speech to text, and the bridge to
//! the `ogmios-agent` sidecar that talks to Claude.

mod agent;
mod commands;
mod convert;
mod db;
mod domain;
mod error;
mod memory;
mod metrics;
mod reminder;
mod stt;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::Manager;

/// Everything the commands share. Rust owns all data; the sidecar owns none.
pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub agent: agent::Agent,
    pub stt: stt::Dictation,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn ctx(&self) -> Ctx<'_> {
        Ctx {
            db: &self.db,
            agent: &self.agent,
            data_dir: &self.data_dir,
        }
    }
}

/// What the command logic needs, borrowed from `AppState`, or built by tests
/// around an in-memory database and a fake sidecar.
#[derive(Clone, Copy)]
pub struct Ctx<'a> {
    pub db: &'a Mutex<rusqlite::Connection>,
    pub agent: &'a agent::Agent,
    pub data_dir: &'a Path,
}

impl Ctx<'_> {
    /// The database, never held across a sidecar call: those take seconds.
    pub fn conn(&self) -> error::Result<MutexGuard<'_, rusqlite::Connection>> {
        self.db
            .lock()
            .map_err(|_| error::Error::Internal("database lock poisoned".into()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("ogmios.sqlite"))?;
            let agent = agent::Agent::new(agent::locate_sidecar()).in_dir(data_dir.join("agent"));
            let stt = stt::Dictation::new(&data_dir);
            app.manage(AppState {
                db: Mutex::new(conn),
                agent,
                stt,
                data_dir,
            });
            reminder::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::profile::get_profile,
            commands::profile::save_profile,
            commands::profile::list_profile_facts,
            commands::profile::delete_profile_fact,
            commands::profile::get_settings,
            commands::profile::save_settings,
            commands::profile::set_api_key,
            commands::profile::has_api_key,
            commands::profile::detect_claude,
            commands::profile::check_provider,
            commands::session::home_state,
            commands::session::start_session,
            commands::session::send_turn,
            commands::session::help_translate,
            commands::session::end_session,
            commands::session::get_report,
            commands::session::self_check,
            commands::session::dispute_item,
            commands::session::delete_session_audio,
            commands::drill::start_drill,
            commands::drill::answer_drill,
            commands::progress::get_progress,
            commands::stt::stt_status,
            commands::stt::stt_download,
            commands::stt::stt_select,
            commands::stt::stt_start,
            commands::stt::stt_stop,
            commands::stt::stt_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
