//! Ogmios backend: SQLite, the error memory, speech both ways, and the bridge to
//! the `ogmios-agent` sidecar that talks to Claude.

mod agent;
mod books;
mod commands;
mod convert;
mod db;
mod domain;
mod error;
mod listening;
mod memory;
mod metrics;
mod phrases;
mod reminder;
mod structures;
mod stt;
mod tts;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use tauri::Manager;

/// Everything the commands share. Rust owns all data; the sidecar owns none.
pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub agent: agent::Agent,
    pub stt: stt::Dictation,
    pub tts: tts::Speech,
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

/// Opens what the commands share, in the app's data directory.
fn setup(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let conn = db::open(&data_dir.join("ogmios.sqlite"))?;
    let agent = agent::Agent::new(agent::locate_sidecar()).in_dir(data_dir.join("agent"));
    let stt = stt::Dictation::new(&data_dir);
    let tts = tts::Speech::new(&data_dir);
    app.manage(AppState {
        db: Mutex::new(conn),
        agent,
        stt,
        tts,
        data_dir,
    });
    reminder::spawn(app.handle().clone());
    Ok(())
}

/// The builder with every command the webview may call.
fn with_commands(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        commands::profile::get_profile,
        commands::profile::save_profile,
        commands::profile::list_profile_facts,
        commands::profile::delete_profile_fact,
        commands::profile::get_settings,
        commands::profile::save_settings,
        commands::profile::set_api_key,
        commands::profile::has_api_key,
        commands::profile::detect_claude,
        commands::profile::list_models,
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
        commands::session::delete_session,
        commands::drill::start_drill,
        commands::drill::answer_drill,
        commands::book::list_books,
        commands::book::import_book,
        commands::book::delete_book,
        commands::book::rename_chapter,
        commands::chapter::get_chapter_words,
        commands::chapter::prepare_chapter,
        commands::chapter::set_word_known,
        commands::chapter::set_word_sorted,
        commands::chapter::restart_sorting,
        commands::chapter::list_known_words,
        commands::chapter::forget_known_word,
        commands::practice::practice_options,
        commands::practice::start_sitting,
        commands::practice::answer_word,
        commands::practice::know_word,
        commands::practice::sitting_step,
        commands::refresh::start_refresh,
        commands::refresh::answer_refresh,
        commands::recall::recall_state,
        commands::recall::start_recall,
        commands::recall::answer_recall,
        commands::recall::save_word_note,
        commands::label::label_words,
        commands::sentences::write_sentences,
        commands::practice::discard_sentence,
        commands::practice::hint_word,
        commands::recall::hint_recall,
        commands::recall::discard_recall_sentence,
        commands::dispute::dispute_answer,
        commands::translate::list_attempts,
        commands::translate::start_attempt,
        commands::translate::get_attempt,
        commands::translate::close_attempt,
        commands::translate::delete_attempt,
        commands::translate::write_sentence,
        commands::translate::prepare_paragraph,
        commands::translate::review_paragraph,
        commands::translate::summarize_attempt,
        commands::translate::practise_word,
        commands::structures::structures_state,
        commands::structures::scan_chapter_structures,
        commands::structures::start_structure_sitting,
        commands::structures::get_structure_sitting,
        commands::structures::drop_structure_word,
        commands::structures::answer_structure,
        commands::structures::close_structure_sitting,
        commands::listening::listening_state,
        commands::listening::chapter_reading,
        commands::listening::listen_chapter,
        commands::listening::start_dictation,
        commands::listening::get_dictation,
        commands::listening::hear_dictation,
        commands::listening::answer_dictation,
        commands::listening::close_dictation,
        commands::progress::get_progress,
        commands::stt::stt_status,
        commands::stt::stt_download,
        commands::stt::stt_select,
        commands::stt::stt_start,
        commands::stt::stt_stop,
        commands::stt::stt_cancel,
        commands::tts::tts_status,
        commands::tts::tts_download,
        commands::tts::tts_configure,
        commands::tts::tts_speak,
        commands::tts::tts_stop,
        commands::update::app_version,
        commands::update::check_update,
        commands::update::install_update,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(setup);
    with_commands(builder)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
