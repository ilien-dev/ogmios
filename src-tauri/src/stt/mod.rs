//! Speech to text, local and in Rust (SPEC §12).
//!
//! Press to talk, release to transcribe: [`Dictation::start`] opens the
//! microphone and reports the level; [`Dictation::stop`] closes it, keeps the
//! audio as a WAV for later review, and runs the selected Parakeet model over
//! the whole recording. The model is offline, so nothing truly streams; while
//! the learner speaks, [`preview`] re-reads the recent audio so the text
//! appears as they go.
//!
//! On disk, under the app's data directory:
//!
//! - `models/<id>/model.gguf` — downloaded weights, see [`fetch`];
//! - `audio/<uuid>.wav` — each recording, 16 kHz mono 16-bit;
//! - `stt.json` — the selected model. Kept here rather than in the settings
//!   table so the choice lives with the models it names.

pub(crate) mod audio;
pub(crate) mod catalogue;
mod engine;
pub(crate) mod fetch;
mod filler;
mod preview;
mod session;
mod vad;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use self::catalogue::Model;
use self::engine::Engine;
use self::preview::Preview;
use self::session::{Listening, Session};
use crate::domain::{Recording, SttLevel, SttModel, SttPartial, SttStatus};
use crate::error::{Error, Result};

/// Shorter than this is a tap on the button, not speech; the model is not
/// asked about it.
const SHORTEST_SAMPLES: usize = audio::RATE as usize / 10;

/// How often the preview looks for new audio. A read slower than this simply
/// makes the next one later.
const PREVIEW_EVERY: Duration = Duration::from_millis(400);

/// Everything speech to text holds between commands.
pub struct Dictation {
    data_dir: PathBuf,
    /// The recording in progress. One at a time.
    running: Mutex<Option<Session>>,
    /// The last model loaded, kept warm: loading the 0.6B model reads 740 MB,
    /// and doing that on every release would be most of the wait.
    engine: Arc<Mutex<Option<Loaded>>>,
    /// Models being fetched right now, so a second press does not race the first.
    downloading: Mutex<HashSet<String>>,
}

struct Loaded {
    model_id: String,
    engine: Engine,
}

#[derive(Default, Serialize, Deserialize)]
struct Choice {
    selected: Option<String>,
}

impl Dictation {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            running: Mutex::default(),
            engine: Arc::default(),
            downloading: Mutex::default(),
        }
    }

    pub fn status(&self) -> SttStatus {
        SttStatus {
            available: library().is_some(),
            models: catalogue::all()
                .iter()
                .map(|model| SttModel {
                    id: model.id.clone(),
                    name: model.name.clone(),
                    bytes: model.bytes(),
                    languages: model.languages.clone(),
                    downloaded: fetch::is_downloaded(&self.data_dir, model),
                })
                .collect(),
            selected: self.selected().ok().map(|model| model.id.clone()),
        }
    }

    /// Fetch a model, blocking until it is on disk and verified.
    pub fn download(&self, model_id: &str, on_progress: impl FnMut(u64, u64)) -> Result<()> {
        let model = find(model_id)?;
        {
            let mut busy = lock(&self.downloading)?;
            if !busy.insert(model.id.clone()) {
                return Err(Error::Stt(format!("{} is already downloading", model.name)));
            }
        }
        let fetched = fetch::download(&self.data_dir, model, on_progress);
        lock(&self.downloading)?.remove(&model.id);
        fetched
    }

    /// Pick the model to use. Only one already on disk.
    pub fn select(&self, model_id: &str) -> Result<()> {
        let model = find(model_id)?;
        if !fetch::is_downloaded(&self.data_dir, model) {
            return Err(Error::Stt(format!("{} is not downloaded yet", model.name)));
        }
        let choice = Choice {
            selected: Some(model.id.clone()),
        };
        std::fs::write(self.choice_path(), serde_json::to_vec(&choice)?)?;
        Ok(())
    }

    /// Open the microphone. `on_level` is called about ten times a second, on
    /// the microphone's thread; `on_partial` whenever the preview has read
    /// more, with everything said so far.
    pub fn start(
        &self,
        on_level: impl Fn(SttLevel) + Send + 'static,
        on_partial: impl Fn(SttPartial) + Send + 'static,
    ) -> Result<()> {
        let library = library().ok_or_else(|| {
            Error::Stt("voice input is not available on this platform yet".into())
        })?;
        let model = self.selected()?;

        let session = Session::begin(on_level)?;
        let listening = session.listening();
        // Replacing a running session drops it, which stops its microphone.
        *lock(&self.running)? = Some(session);

        // Warm the model while the learner speaks, so release only
        // transcribes, then keep the preview going until release.
        let engine = Arc::clone(&self.engine);
        let data_dir = self.data_dir.clone();
        std::thread::spawn(move || {
            let warmed = engine
                .lock()
                .is_ok_and(|mut held| load(&mut held, &library, &data_dir, model).is_ok());
            if warmed {
                preview(&listening, &engine, model, &on_partial);
            }
        });
        Ok(())
    }

    /// Stop recording, save the audio and transcribe it. Blocking: call it off
    /// the main thread.
    pub fn stop(&self) -> Result<Recording> {
        let session = lock(&self.running)?
            .take()
            .ok_or_else(|| Error::Invalid("nothing is being recorded".into()))?;
        let captured = session.finish()?;

        let audio_id = uuid::Uuid::new_v4().to_string();
        let audio_dir = self.data_dir.join("audio");
        std::fs::create_dir_all(&audio_dir)?;
        let wav = audio_dir.join(format!("{audio_id}.wav"));
        audio::write_wav(&wav, &captured.pcm)?;

        match self.transcribe(&captured.pcm) {
            Ok(text) => Ok(Recording {
                text,
                audio_id,
                speech_seconds: captured.speech_seconds,
            }),
            Err(error) => {
                // No turn will point at it, so it would only be an orphan.
                let _ = std::fs::remove_file(&wav);
                Err(error)
            }
        }
    }

    /// Stop recording and throw it away. Quiet when nothing is recording.
    pub fn cancel(&self) {
        let session = self.running.lock().ok().and_then(|mut held| held.take());
        drop(session);
    }

    fn transcribe(&self, pcm: &[f32]) -> Result<String> {
        if !worth_reading(pcm) {
            return Ok(String::new());
        }
        let library = library().ok_or_else(|| {
            Error::Stt("voice input is not available on this platform yet".into())
        })?;
        let model = self.selected()?;
        let mut held = lock(&self.engine)?;
        let engine = load(&mut held, &library, &self.data_dir, model)?;
        Ok(filler::without_fillers(
            &engine.transcribe(pcm, &model.hint)?,
        ))
    }

    /// The model the learner picked, while it is still on disk. Never a model
    /// they did not pick: none is in use until they download and choose one.
    fn selected(&self) -> Result<&'static Model> {
        std::fs::read(self.choice_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Choice>(&bytes).ok())
            .and_then(|choice| choice.selected)
            .and_then(|id| catalogue::find(&id))
            .filter(|model| fetch::is_downloaded(&self.data_dir, model))
            .ok_or_else(|| Error::Stt("no speech model is chosen yet".into()))
    }

    fn choice_path(&self) -> PathBuf {
        self.data_dir.join("stt.json")
    }
}

/// Read what has been heard so far, again and again, until the session stops.
/// A failed read ends the preview quietly: release will say what went wrong.
fn preview(
    listening: &Listening,
    engine: &Mutex<Option<Loaded>>,
    model: &Model,
    on_partial: &impl Fn(SttPartial),
) {
    let mut so_far = Preview::default();
    let mut read_to = 0;
    loop {
        std::thread::sleep(PREVIEW_EVERY);
        let Some((pcm, end)) = listening.since(so_far.from()) else {
            return;
        };
        if end < read_to + listening.quarter_second() || pcm.len() < SHORTEST_SAMPLES {
            continue;
        }
        read_to = end;
        let Ok(mut held) = engine.lock() else {
            return;
        };
        let Some(loaded) = held.as_mut().filter(|loaded| loaded.model_id == model.id) else {
            return;
        };
        // A silent stretch adds nothing, and still settles once it is a pause.
        let stretch = if worth_reading(&pcm) {
            let Ok(text) = loaded.engine.transcribe(&pcm, &model.hint) else {
                return;
            };
            filler::without_fillers(&text)
        } else {
            String::new()
        };
        // Checked with the engine still held: release transcribes under the
        // same lock, so no preview can land after the final text.
        if listening.is_stopped() {
            return;
        }
        let text = so_far.heard(&stretch, end, vad::ends_in_pause(&pcm, audio::RATE));
        on_partial(SttPartial { text });
    }
}

/// Long enough to be more than a tap, and with speech in it. Parakeet answers
/// silence and room noise with invented words ("Yeah.", "Oh"), so it is never
/// asked about them.
fn worth_reading(pcm: &[f32]) -> bool {
    pcm.len() >= SHORTEST_SAMPLES && vad::has_speech(pcm, audio::RATE)
}

/// The engine for `model`, loading it (and unloading any other) if needed.
fn load<'a>(
    held: &'a mut Option<Loaded>,
    library: &Path,
    data_dir: &Path,
    model: &Model,
) -> Result<&'a mut Engine> {
    if held
        .as_ref()
        .is_none_or(|loaded| loaded.model_id != model.id)
    {
        // Free the old one first: two models at once can be 1 GB of RAM.
        *held = None;
        let file = model
            .files
            .first()
            .ok_or_else(|| Error::Stt(format!("{} has no weights", model.name)))?;
        *held = Some(Loaded {
            model_id: model.id.clone(),
            engine: Engine::open(library, &fetch::path_of(data_dir, model, file))?,
        });
    }
    held.as_mut()
        .map(|loaded| &mut loaded.engine)
        .ok_or_else(|| Error::Internal("the speech model vanished".into()))
}

/// The recogniser library beside our own binary, if this platform has one.
fn library() -> Option<PathBuf> {
    engine::library_beside(&std::env::current_exe().ok()?)
}

fn find(model_id: &str) -> Result<&'static Model> {
    catalogue::find(model_id)
        .ok_or_else(|| Error::NotFound(format!("no speech model called {model_id:?}")))
}

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| Error::Internal("speech state is poisoned".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pretend `id` is on disk: a sparse file of the exact size is what
    /// `fetch::is_downloaded` checks, without writing hundreds of megabytes.
    fn fake_download(dir: &Path, id: &str) {
        let model = catalogue::find(id).unwrap();
        for file in &model.files {
            let path = fetch::path_of(dir, model, file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::File::create(&path)
                .unwrap()
                .set_len(file.bytes)
                .unwrap();
        }
    }

    #[test]
    fn a_fresh_install_has_no_model_in_use() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Dictation::new(dir.path()).status().selected, None);
    }

    #[test]
    fn a_downloaded_model_is_not_used_until_the_learner_picks_it() {
        let dir = tempfile::tempdir().unwrap();
        fake_download(dir.path(), "parakeet-tdt-ctc-110m");
        fake_download(dir.path(), "parakeet-tdt-0.6b-v3");
        assert_eq!(Dictation::new(dir.path()).status().selected, None);
    }

    #[test]
    fn the_learners_choice_is_used_and_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let stt = Dictation::new(dir.path());
        fake_download(dir.path(), "parakeet-tdt-ctc-110m");
        stt.select("parakeet-tdt-ctc-110m").unwrap();
        assert_eq!(
            Dictation::new(dir.path()).status().selected.as_deref(),
            Some("parakeet-tdt-ctc-110m")
        );
    }

    #[test]
    fn only_a_downloaded_model_can_be_picked() {
        let dir = tempfile::tempdir().unwrap();
        let stt = Dictation::new(dir.path());
        assert_eq!(
            stt.select("parakeet-tdt-ctc-110m").unwrap_err().kind(),
            "stt"
        );
        assert_eq!(stt.select("nope").unwrap_err().kind(), "notFound");
        assert_eq!(stt.status().selected, None);
    }

    #[test]
    fn a_choice_whose_files_are_gone_is_no_choice() {
        let dir = tempfile::tempdir().unwrap();
        let stt = Dictation::new(dir.path());
        fake_download(dir.path(), "parakeet-tdt-ctc-110m");
        stt.select("parakeet-tdt-ctc-110m").unwrap();
        std::fs::remove_dir_all(dir.path().join("models")).unwrap();
        assert_eq!(stt.status().selected, None);
    }

    #[test]
    fn status_lists_both_models_not_downloaded() {
        let dir = tempfile::tempdir().unwrap();
        let status = Dictation::new(dir.path()).status();
        assert_eq!(status.models.len(), 2);
        assert!(status.models.iter().all(|m| !m.downloaded && m.bytes > 0));
    }

    #[test]
    fn stopping_or_cancelling_with_nothing_running_is_harmless() {
        let dir = tempfile::tempdir().unwrap();
        let stt = Dictation::new(dir.path());
        stt.cancel();
        assert_eq!(stt.stop().unwrap_err().kind(), "invalid");
    }

    /// Parakeet answers silence with "Yeah." or "Oh": audio with no speech
    /// never reaches it, so no model is needed here.
    #[test]
    fn silence_is_never_transcribed() {
        let dir = tempfile::tempdir().unwrap();
        let stt = Dictation::new(dir.path());
        let quiet = vec![0.005; audio::RATE as usize * 3];
        assert_eq!(stt.transcribe(&quiet).unwrap(), "");
    }

    #[test]
    fn starting_without_the_model_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let stt = Dictation::new(dir.path());
        assert_eq!(stt.start(|_| {}, |_| {}).unwrap_err().kind(), "stt");
    }

    /// End to end: download the 110M model, load it through the engine and
    /// transcribe WAV files. Needs the network and speech clips, so ignored:
    ///
    /// `STT_E2E_DIR=<dir with *.wav> cargo test stt::tests::e2e_needs_network_and_clips -- --ignored --nocapture`
    ///
    /// Without `STT_E2E_DIR` it says so and passes, so `--include-ignored`
    /// does not fail on a machine with no clips.
    ///
    /// `STT_E2E_MODEL` picks another catalogue id.
    #[test]
    #[ignore = "downloads a 143 MB model and needs STT_E2E_DIR; run by hand"]
    fn e2e_needs_network_and_clips() {
        let Ok(clips) = std::env::var("STT_E2E_DIR").map(PathBuf::from) else {
            println!("STT_E2E_DIR is not set; skipping");
            return;
        };
        let model_id =
            std::env::var("STT_E2E_MODEL").unwrap_or_else(|_| "parakeet-tdt-ctc-110m".into());
        let stt = Dictation::new(&clips);

        let began = std::time::Instant::now();
        stt.download(&model_id, |_, _| {}).unwrap();
        println!("download+verify: {:?}", began.elapsed());
        stt.select(&model_id).unwrap();

        let began = std::time::Instant::now();
        let mut held = stt.engine.lock().unwrap();
        load(
            &mut held,
            &library().unwrap(),
            &clips,
            stt.selected().unwrap(),
        )
        .unwrap();
        println!("load: {:?}", began.elapsed());
        drop(held);

        let mut wavs: Vec<PathBuf> = std::fs::read_dir(&clips)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "wav"))
            .collect();
        wavs.sort();
        for wav in wavs {
            let pcm: Vec<f32> = hound::WavReader::open(&wav)
                .unwrap()
                .samples::<i16>()
                .map(|s| f32::from(s.unwrap()) / f32::from(i16::MAX))
                .collect();
            let mut vad = vad::Vad::new(audio::RATE);
            vad.feed(&pcm);
            let began = std::time::Instant::now();
            let text = stt.transcribe(&pcm).unwrap();
            println!(
                "{}: {:.2} s audio, {:.2} s speech, {:?} -> {text:?}",
                wav.display(),
                crate::convert::len_f64(pcm.len()) / f64::from(audio::RATE),
                vad.seconds(),
                began.elapsed()
            );
        }
    }
}
