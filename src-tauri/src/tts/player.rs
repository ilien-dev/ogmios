//! The speakers, for as long as one thing is read aloud.
//!
//! Played here in Rust rather than by the webview, which refuses to start
//! sound nobody clicked for. The thread creates the output and drops it,
//! because `cpal::Stream` must stay on one thread; what is to be played waits
//! in a queue the engine fills sentence by sentence through a [`Feed`].

use std::collections::VecDeque;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::error::{Error, Result};
use crate::stt::audio::resample;

/// How often the end of the queue is looked for.
const TICK: Duration = Duration::from_millis(40);

/// What the sound card still holds once the queue is empty.
const TAIL: Duration = Duration::from_millis(250);

/// Mono samples at the device's rate, not played yet.
type Queue = Arc<Mutex<VecDeque<f32>>>;

/// An open output. Dropping it is silence at once.
pub struct Speaker {
    queue: Queue,
    rate: u32,
    /// Dropping this sender closes the output.
    stop: Option<Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

/// Where the engine puts what it has said so far.
#[derive(Clone)]
pub struct Feed {
    queue: Queue,
    rate: u32,
}

impl Feed {
    /// Queue mono audio recorded at `from` Hz.
    pub fn push(&self, samples: &[f32], from: u32) {
        let ready = resample(samples, from, self.rate);
        if let Ok(mut queue) = self.queue.lock() {
            queue.extend(ready);
        }
    }
}

impl Speaker {
    /// Open the default output. Returns once it is open, so a machine with
    /// no speakers says so before anything is synthesised.
    pub fn open() -> Result<Speaker> {
        let (stop, stopped) = mpsc::channel::<()>();
        let (ready, opened) = mpsc::sync_channel::<Result<u32>>(1);
        let queue = Queue::default();
        let playing = Arc::clone(&queue);

        let thread = std::thread::spawn(move || match output(playing) {
            Ok((stream, rate)) => {
                let _ = ready.send(Ok(rate));
                // Until the sender is dropped: there is nothing to receive.
                let _ = stopped.recv();
                drop(stream);
            }
            Err(error) => {
                let _ = ready.send(Err(error));
            }
        });

        match opened.recv() {
            Ok(Ok(rate)) => Ok(Speaker {
                queue,
                rate,
                stop: Some(stop),
                thread: Some(thread),
            }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(Error::Stt("the speaker thread stopped".into())),
        }
    }

    pub fn feed(&self) -> Feed {
        Feed {
            queue: Arc::clone(&self.queue),
            rate: self.rate,
        }
    }

    /// Wait until everything queued has been heard, or until `live` says this
    /// is no longer the thing to hear, then close the output.
    pub fn finish(self, live: impl Fn() -> bool) {
        while live() && self.queue.lock().is_ok_and(|queue| !queue.is_empty()) {
            std::thread::sleep(TICK);
        }
        if live() {
            std::thread::sleep(TAIL);
        }
    }
}

impl Drop for Speaker {
    fn drop(&mut self) {
        self.stop.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Open the default output device, playing whatever is in `queue`, and say
/// the rate it plays at.
fn output(queue: Queue) -> Result<(cpal::Stream, u32)> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let device = cpal::default_host()
        .default_output_device()
        .ok_or_else(|| Error::Stt("no speakers were found".into()))?;
    let config = device
        .default_output_config()
        .map_err(|e| Error::Stt(format!("the speakers would not open: {e}")))?;

    let rate = config.sample_rate().0;
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config.into(), queue),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config.into(), queue),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config.into(), queue),
        cpal::SampleFormat::I32 => build::<i32>(&device, &config.into(), queue),
        other => {
            return Err(Error::Stt(format!(
                "the speakers take a sample format this cannot write: {other}"
            )))
        }
    }?;
    stream
        .play()
        .map_err(|e| Error::Stt(format!("the speakers would not start: {e}")))?;
    Ok((stream, rate))
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Queue,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    use cpal::traits::DeviceTrait;

    let channels = usize::from(config.channels).max(1);
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let mut queue = queue.lock().ok();
                for frame in data.chunks_mut(channels) {
                    // An empty queue is silence: the next sentence is on its way.
                    let sample = queue
                        .as_mut()
                        .and_then(|queue| queue.pop_front())
                        .unwrap_or(0.0);
                    frame.fill(T::from_sample_(sample));
                }
            },
            |error| eprintln!("tts: speaker error: {error}"),
            None,
        )
        .map_err(|e| Error::Stt(format!("the speakers would not start: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_fed_waits_in_the_queue_at_the_devices_rate() {
        let queue = Queue::default();
        let feed = Feed {
            queue: Arc::clone(&queue),
            rate: 48_000,
        };
        feed.push(&[0.0, 1.0], 24_000);
        feed.push(&[1.0], 48_000);
        let held: Vec<f32> = queue.lock().unwrap().iter().copied().collect();
        assert_eq!(held.len(), 5);
        assert!((held[1] - 0.5).abs() < 0.001, "{held:?}");
    }
}
