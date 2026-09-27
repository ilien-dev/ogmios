//! One recording: a microphone on a thread of its own, from press to release.
//!
//! The thread creates the microphone and drops it, because `cpal::Stream` must
//! stay on one thread. About ten times a second it takes what was heard, feeds
//! the VAD and reports the level; when the session is stopped it returns the
//! whole recording, resampled to 16 kHz. A [`Listening`] handle reads what has
//! been heard so far, for the live preview.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use super::audio::{self, Heard};
use super::vad::Vad;
use crate::domain::SttLevel;
use crate::error::{Error, Result};

/// How often the level is reported: about ten times a second.
const TICK: Duration = Duration::from_millis(100);

/// What a finished recording hands back.
#[derive(Default)]
pub struct Captured {
    /// 16 kHz mono.
    pub pcm: Vec<f32>,
    pub speech_seconds: f64,
}

/// A recording in progress. Dropping it stops the microphone and discards the
/// audio, which is what cancelling is.
pub struct Session {
    /// Dropping this sender is the stop signal.
    stop: Option<Sender<()>>,
    thread: Option<JoinHandle<Captured>>,
    listening: Listening,
}

/// What has been heard so far, readable from another thread while the
/// session runs.
#[derive(Clone)]
pub struct Listening {
    /// Mono at the device's rate, from the press.
    raw: Arc<Mutex<Vec<f32>>>,
    rate: u32,
    stopped: Arc<AtomicBool>,
}

impl Listening {
    /// The audio from raw sample `from` on, at 16 kHz, and the raw length it
    /// reaches. `None` once the session has stopped.
    pub fn since(&self, from: usize) -> Option<(Vec<f32>, usize)> {
        if self.is_stopped() {
            return None;
        }
        let raw = self.raw.lock().ok()?;
        let from = from.min(raw.len());
        Some((audio::to_16k(&raw[from..], self.rate), raw.len()))
    }

    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// Raw samples in a quarter of a second.
    pub fn quarter_second(&self) -> usize {
        usize::try_from(self.rate / 4).unwrap_or(usize::MAX)
    }
}

impl Session {
    /// Open the default microphone and start recording. Returns once the
    /// microphone is open, so a refusal is reported on the press.
    pub fn begin(on_level: impl Fn(SttLevel) + Send + 'static) -> Result<Session> {
        let (stop, stopped) = mpsc::channel::<()>();
        let (ready, opened) = mpsc::sync_channel::<Result<u32>>(1);
        let shared: Arc<Mutex<Vec<f32>>> = Arc::default();
        let raw = Arc::clone(&shared);

        let thread = std::thread::spawn(move || {
            let heard: Arc<Mutex<Heard>> = Arc::default();
            let microphone = match audio::listen(Arc::clone(&heard)) {
                Ok(microphone) => {
                    let _ = ready.send(Ok(microphone.rate));
                    microphone
                }
                Err(error) => {
                    let _ = ready.send(Err(error));
                    return Captured::default();
                }
            };
            let rate = microphone.rate;
            let mut vad = Vad::new(rate);
            let gather = |vad: &mut Vad| {
                let (samples, peak) = take(&heard);
                vad.feed(&samples);
                if let Ok(mut raw) = raw.lock() {
                    raw.extend_from_slice(&samples);
                }
                peak
            };

            while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(TICK) {
                let peak = gather(&mut vad);
                on_level(SttLevel {
                    peak,
                    speech_seconds: vad.seconds(),
                });
            }

            // Closed before the last take, so the tail of the sentence is kept.
            drop(microphone);
            gather(&mut vad);
            let raw = raw.lock().map(|raw| raw.clone()).unwrap_or_default();
            Captured {
                pcm: audio::to_16k(&raw, rate),
                speech_seconds: vad.seconds(),
            }
        });

        match opened.recv() {
            Ok(Ok(rate)) => Ok(Session {
                stop: Some(stop),
                thread: Some(thread),
                listening: Listening {
                    raw: shared,
                    rate,
                    stopped: Arc::default(),
                },
            }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(Error::Stt("the microphone thread stopped".into())),
        }
    }

    pub fn listening(&self) -> Listening {
        self.listening.clone()
    }

    /// Stop recording and hand back everything heard.
    pub fn finish(mut self) -> Result<Captured> {
        self.listening.stopped.store(true, Ordering::SeqCst);
        self.stop.take();
        self.thread
            .take()
            .map_or(Ok(Captured::default()), |thread| {
                thread
                    .join()
                    .map_err(|_| Error::Stt("the microphone thread stopped".into()))
            })
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.listening.stopped.store(true, Ordering::SeqCst);
        self.stop.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn take(heard: &Mutex<Heard>) -> (Vec<f32>, f32) {
    heard.lock().map(|mut held| held.take()).unwrap_or_default()
}
