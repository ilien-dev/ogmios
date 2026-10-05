//! Text to speech, local and in Rust: the English on the screen, read aloud.
//!
//! One model, Kokoro, run on the CPU through sherpa-onnx, which is linked in
//! and keeps its own `unsafe`. [`Speech::speak`] loads it on first use, hands
//! each sentence to the speakers as soon as it is synthesised, and returns
//! when the last one has been heard. [`Speech::read`] does the same for a
//! whole chapter, a sentence after another, saying which one is being heard.
//! Speaking again, or [`Speech::stop`], silences whatever was being said.
//!
//! On disk, under the app's data directory:
//!
//! - `models/<id>/` — the downloaded model, fetched like a recogniser;
//! - `tts.json` — the voice picked and whether reading aloud is on.

mod catalogue;
mod player;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig};

use self::catalogue::{Catalogue, Voice};
use self::player::Speaker;
use crate::domain::{Pace, TtsStatus, TtsVoice, Variant};
use crate::error::{Error, Result};
use crate::stt::fetch;

/// Threads the model may use. More than this gains little on a sentence.
const THREADS: usize = 4;

/// How many things said are kept for "again": a word and its sentence, the
/// last few lines of a conversation.
const REMEMBERED: usize = 8;

/// Longer than this is not read: nothing on the screen is, and the model
/// would hold the CPU for a minute.
const LONGEST: usize = 4_000;

/// Everything text to speech holds between commands.
pub struct Speech {
    data_dir: PathBuf,
    /// The model, kept warm: loading it reads 330 MB and takes a second.
    engine: Mutex<Option<Loaded>>,
    /// Counts what was asked to be said. Whoever holds an older number has
    /// been talked over, and stops.
    turn: Arc<AtomicU64>,
    recent: Mutex<VecDeque<Said>>,
    downloading: Mutex<bool>,
}

struct Loaded {
    /// The lexicon it was loaded with: the other English needs a reload.
    variant: Variant,
    tts: OfflineTts,
}

/// Something already said, ready to be said again at once.
struct Said {
    voice: String,
    pace: Pace,
    text: String,
    pcm: Vec<f32>,
    rate: u32,
}

#[derive(Serialize, Deserialize)]
struct Choice {
    voice: Option<String>,
    #[serde(default = "on")]
    enabled: bool,
}

fn on() -> bool {
    true
}

impl Default for Choice {
    fn default() -> Self {
        Self {
            voice: None,
            enabled: true,
        }
    }
}

impl Speech {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            engine: Mutex::default(),
            turn: Arc::default(),
            recent: Mutex::default(),
            downloading: Mutex::default(),
        }
    }

    /// `variant` is the learner's English: it picks the voice until they do.
    pub fn status(&self, variant: Variant) -> Result<TtsStatus> {
        let catalogue = catalogue()?;
        let choice = self.choice();
        Ok(TtsStatus {
            bytes: catalogue.model.bytes(),
            downloaded: fetch::is_downloaded(&self.data_dir, &catalogue.model),
            voices: catalogue
                .voices
                .iter()
                .map(|voice| TtsVoice {
                    id: voice.id.clone(),
                    name: voice.name.clone(),
                    variant: voice.variant,
                })
                .collect(),
            voice: voice(catalogue, &choice, variant)?.id.clone(),
            enabled: choice.enabled,
        })
    }

    /// Fetch the model, blocking until it is on disk and verified.
    pub fn download(&self, on_progress: impl FnMut(u64, u64)) -> Result<()> {
        let catalogue = catalogue()?;
        {
            let mut busy = lock(&self.downloading)?;
            if *busy {
                return Err(Error::Stt("the voice is already downloading".into()));
            }
            *busy = true;
        }
        let fetched = fetch::download(&self.data_dir, &catalogue.model, on_progress);
        *lock(&self.downloading)? = false;
        fetched
    }

    /// Pick the voice, and whether anything is read aloud at all.
    pub fn configure(&self, voice_id: &str, enabled: bool) -> Result<()> {
        let voice = catalogue()?
            .voice(voice_id)
            .ok_or_else(|| Error::NotFound(format!("no voice called {voice_id:?}")))?;
        if !enabled {
            self.stop();
        }
        let choice = Choice {
            voice: Some(voice.id.clone()),
            enabled,
        };
        std::fs::write(self.choice_path(), serde_json::to_vec(&choice)?)?;
        Ok(())
    }

    /// Say `text` at `pace` and return once it has been heard, or once
    /// something else was said over it. Blocking: call it off the main thread.
    pub fn speak(&self, text: &str, variant: Variant, pace: Pace) -> Result<()> {
        let text = text.trim();
        if text.is_empty() || text.len() > LONGEST {
            return Ok(());
        }
        let voice = self.voice(variant)?;
        let live = self.take_turn();

        let speaker = Speaker::open()?;
        let feed = speaker.feed();
        if let Some((pcm, rate)) = self.remembered(&voice.id, pace, text) {
            feed.push(&pcm, rate);
        } else {
            let said = self.synthesise(voice, pace, text, &live, move |sentence, rate| {
                feed.push(sentence, rate);
            })?;
            if let Some((pcm, rate)) = said {
                self.remember(&voice.id, pace, text, &pcm, rate);
            }
        }
        speaker.finish(live);
        Ok(())
    }

    /// Read `sentences` aloud from the one at `from`, one after another, and
    /// return once the last has been heard, or once something else was said
    /// over them: whether they were heard to the end. `on_sentence` is told
    /// each one as it starts. The next is made while one is heard, so
    /// nothing is waited for between them. Blocking.
    pub fn read(
        &self,
        sentences: &[String],
        from: usize,
        variant: Variant,
        pace: Pace,
        on_sentence: impl Fn(usize),
    ) -> Result<bool> {
        let voice = self.voice(variant)?;
        let live = self.take_turn();

        let speaker = Speaker::open()?;
        let feed = speaker.feed();
        for (at, sentence) in sentences.iter().enumerate().skip(from) {
            let text = sentence.trim();
            if text.is_empty() || text.len() > LONGEST {
                continue;
            }
            let Some((pcm, rate)) = self.synthesise(voice, pace, text, &live, |_, _| {})? else {
                return Ok(false);
            };
            speaker.drain(&live);
            if !live() {
                return Ok(false);
            }
            feed.push(&pcm, rate);
            on_sentence(at);
        }
        speaker.finish(live.clone());
        Ok(live())
    }

    /// The voice to speak with, once the model is on disk.
    fn voice(&self, variant: Variant) -> Result<&'static Voice> {
        let catalogue = catalogue()?;
        if !fetch::is_downloaded(&self.data_dir, &catalogue.model) {
            return Err(Error::Stt("the voice is not downloaded yet".into()));
        }
        voice(catalogue, &self.choice(), variant)
    }

    /// Becomes what is being said: whatever was is talked over. What comes
    /// back says whether this still is.
    fn take_turn(&self) -> impl Fn() -> bool + Clone + 'static {
        let mine = self.turn.fetch_add(1, Ordering::SeqCst) + 1;
        let turn = Arc::clone(&self.turn);
        move || turn.load(Ordering::SeqCst) == mine
    }

    /// Makes the audio of `text`, handing each sentence of it to `each` as
    /// it is made. None when it was talked over on the way.
    fn synthesise(
        &self,
        voice: &Voice,
        pace: Pace,
        text: &str,
        live: &(impl Fn() -> bool + Clone + 'static),
        mut each: impl FnMut(&[f32], u32) + 'static,
    ) -> Result<Option<(Vec<f32>, u32)>> {
        // Whoever was talking gives the model up at its next sentence.
        let mut held = lock(&self.engine)?;
        if !live() {
            return Ok(None);
        }
        let tts = load(&mut held, &self.data_dir, catalogue()?, voice.variant)?;
        let rate = u32::try_from(tts.sample_rate())
            .map_err(|_| Error::Stt("the voice has no sample rate".into()))?;
        let hearing = live.clone();
        let said = tts.generate_with_config(
            text,
            &GenerationConfig {
                sid: voice.speaker,
                speed: speed(pace),
                ..GenerationConfig::default()
            },
            Some(move |sentence: &[f32], _progress: f32| {
                each(sentence, rate);
                hearing()
            }),
        );
        drop(held);
        // Talked over, whatever came back is not the whole of it.
        if !live() {
            return Ok(None);
        }
        let audio = said.ok_or_else(|| Error::Stt("the voice could not say that".into()))?;
        Ok(Some((audio.samples().to_vec(), rate)))
    }

    /// Silence whatever is being said. Quiet when nothing is.
    pub fn stop(&self) {
        self.turn.fetch_add(1, Ordering::SeqCst);
    }

    fn remembered(&self, voice: &str, pace: Pace, text: &str) -> Option<(Vec<f32>, u32)> {
        let recent = self.recent.lock().ok()?;
        recent
            .iter()
            .find(|said| said.voice == voice && said.pace == pace && said.text == text)
            .map(|said| (said.pcm.clone(), said.rate))
    }

    fn remember(&self, voice: &str, pace: Pace, text: &str, pcm: &[f32], rate: u32) {
        if let Ok(mut recent) = self.recent.lock() {
            if recent.len() == REMEMBERED {
                recent.pop_front();
            }
            recent.push_back(Said {
                voice: voice.to_string(),
                pace,
                text: text.to_string(),
                pcm: pcm.to_vec(),
                rate,
            });
        }
    }

    fn choice(&self) -> Choice {
        std::fs::read(self.choice_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn choice_path(&self) -> PathBuf {
        self.data_dir.join("tts.json")
    }
}

/// How fast the model speaks at each pace: slow enough to tell the words
/// apart, and fast enough to run them together as people do.
fn speed(pace: Pace) -> f32 {
    match pace {
        Pace::Slow => 0.75,
        Pace::Normal => 1.0,
        Pace::Fast => 1.25,
    }
}

/// The voice the learner picked, or the one for their English until they do.
fn voice<'a>(catalogue: &'a Catalogue, choice: &Choice, variant: Variant) -> Result<&'a Voice> {
    choice
        .voice
        .as_deref()
        .and_then(|id| catalogue.voice(id))
        .or_else(|| catalogue.default_voice(variant))
        .ok_or_else(|| Error::Internal("the voice catalogue is empty".into()))
}

/// The engine reading `variant`, loading it (and unloading the other) if needed.
fn load<'a>(
    held: &'a mut Option<Loaded>,
    data_dir: &Path,
    catalogue: &Catalogue,
    variant: Variant,
) -> Result<&'a OfflineTts> {
    if held.as_ref().is_none_or(|loaded| loaded.variant != variant) {
        // Free the old one first: two at once is 700 MB of RAM.
        *held = None;
        let folder = data_dir.join("models").join(&catalogue.model.id);
        let file = |name: &str| Some(folder.join(name).to_string_lossy().into_owned());
        let mut config = OfflineTtsConfig::default();
        config.model.kokoro.model = file("model.onnx");
        config.model.kokoro.voices = file("voices.bin");
        config.model.kokoro.tokens = file("tokens.txt");
        config.model.kokoro.data_dir = file("espeak-ng-data");
        config.model.kokoro.lexicon = file(catalogue::lexicon(variant));
        config.model.num_threads = threads();
        // A sentence at a time, so the first is heard while the rest is made.
        config.max_num_sentences = 1;
        let tts = OfflineTts::create(&config).ok_or_else(|| {
            Error::Stt("the voice would not load; try downloading it again".into())
        })?;
        *held = Some(Loaded { variant, tts });
    }
    held.as_ref()
        .map(|loaded| &loaded.tts)
        .ok_or_else(|| Error::Internal("the voice vanished".into()))
}

fn threads() -> i32 {
    let cores = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
    i32::try_from(cores.min(THREADS)).unwrap_or(1)
}

fn catalogue() -> Result<&'static Catalogue> {
    catalogue::get().ok_or_else(|| Error::Internal("the voice catalogue is unreadable".into()))
}

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| Error::Internal("speech state is poisoned".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pretend the model is on disk: sparse files of the exact sizes are what
    /// `fetch::is_downloaded` checks.
    fn fake_download(dir: &Path) {
        let model = &catalogue().unwrap().model;
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
    fn a_fresh_install_has_no_voice_yet_and_would_read_aloud() {
        let dir = tempfile::tempdir().unwrap();
        let status = Speech::new(dir.path()).status(Variant::Us).unwrap();
        assert!(!status.downloaded);
        assert!(status.enabled);
        assert!(status.bytes > 300_000_000);
        assert_eq!(status.voices.len(), 4);
    }

    #[test]
    fn the_voice_follows_the_learners_english_until_they_pick_one() {
        let dir = tempfile::tempdir().unwrap();
        let speech = Speech::new(dir.path());
        assert_eq!(speech.status(Variant::Us).unwrap().voice, "af_heart");
        assert_eq!(speech.status(Variant::Uk).unwrap().voice, "bf_emma");

        speech.configure("bm_george", true).unwrap();
        assert_eq!(speech.status(Variant::Us).unwrap().voice, "bm_george");
    }

    #[test]
    fn the_choice_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        Speech::new(dir.path())
            .configure("am_michael", false)
            .unwrap();
        let status = Speech::new(dir.path()).status(Variant::Uk).unwrap();
        assert_eq!(status.voice, "am_michael");
        assert!(!status.enabled);
    }

    #[test]
    fn an_unknown_voice_cannot_be_picked() {
        let dir = tempfile::tempdir().unwrap();
        let speech = Speech::new(dir.path());
        assert_eq!(
            speech.configure("nobody", true).unwrap_err().kind(),
            "notFound"
        );
        assert_eq!(speech.status(Variant::Us).unwrap().voice, "af_heart");
    }

    #[test]
    fn the_model_on_disk_is_seen() {
        let dir = tempfile::tempdir().unwrap();
        fake_download(dir.path());
        assert!(
            Speech::new(dir.path())
                .status(Variant::Us)
                .unwrap()
                .downloaded
        );
    }

    #[test]
    fn speaking_without_the_model_says_so_and_nothing_is_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let speech = Speech::new(dir.path());
        assert_eq!(
            speech
                .speak("Hello there.", Variant::Us, Pace::Normal)
                .unwrap_err()
                .kind(),
            "stt"
        );
        speech.speak("   ", Variant::Us, Pace::Normal).unwrap();
        let read = speech.read(
            &["Hello there.".to_owned()],
            0,
            Variant::Us,
            Pace::Slow,
            |_| {},
        );
        assert_eq!(read.unwrap_err().kind(), "stt");
        speech.stop();
    }

    #[test]
    fn what_was_said_is_kept_for_again_and_the_oldest_goes_first() {
        let dir = tempfile::tempdir().unwrap();
        let speech = Speech::new(dir.path());
        for index in 0..=REMEMBERED {
            let line = format!("line {index}");
            speech.remember("af_heart", Pace::Normal, &line, &[0.5], 24_000);
        }
        assert!(speech
            .remembered("af_heart", Pace::Normal, "line 0")
            .is_none());
        assert_eq!(
            speech.remembered("af_heart", Pace::Normal, "line 1"),
            Some((vec![0.5], 24_000))
        );
        // Another voice says it differently, and so does another pace.
        assert!(speech
            .remembered("bf_emma", Pace::Normal, "line 1")
            .is_none());
        assert!(speech
            .remembered("af_heart", Pace::Slow, "line 1")
            .is_none());
    }

    /// End to end: download Kokoro, load it and say a sentence out loud.
    /// Needs the network and speakers, so ignored:
    ///
    /// `TTS_E2E_DIR=<dir> cargo test tts::tests::e2e_needs_network_and_speakers -- --ignored --nocapture`
    ///
    /// Without `TTS_E2E_DIR` it says so and passes.
    #[test]
    #[ignore = "downloads a 367 MB model and plays sound; run by hand"]
    fn e2e_needs_network_and_speakers() {
        let Ok(dir) = std::env::var("TTS_E2E_DIR").map(PathBuf::from) else {
            println!("TTS_E2E_DIR is not set; skipping");
            return;
        };
        let speech = Speech::new(&dir);
        speech.download(|_, _| {}).unwrap();
        for variant in [Variant::Us, Variant::Uk] {
            let began = std::time::Instant::now();
            speech
                .speak(
                    "I read that book last year. Do you read every night?",
                    variant,
                    Pace::Normal,
                )
                .unwrap();
            println!("{variant:?}: {:?}", began.elapsed());
        }
        let began = std::time::Instant::now();
        speech
            .speak(
                "I read that book last year. Do you read every night?",
                Variant::Uk,
                Pace::Fast,
            )
            .unwrap();
        println!("again: {:?}", began.elapsed());
    }
}
