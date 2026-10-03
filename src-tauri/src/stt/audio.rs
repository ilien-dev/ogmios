//! The microphone, the resampler, and the WAV file a recording is kept in.
//!
//! Capture happens here in Rust rather than through `getUserMedia`, which is
//! unreliable in `WebKitGTK` (SPEC §12). The audio never leaves this process.

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::error::{Error, Result};

/// What every model in the catalogue is trained on, and what recordings are
/// saved at.
pub const RATE: u32 = 16_000;

/// Mono samples at the device's rate, heard but not yet taken, and how loud
/// they were.
#[derive(Default)]
pub struct Heard {
    samples: Vec<f32>,
    /// The loudest sample since the last take, nought to one.
    peak: f32,
}

impl Heard {
    /// Everything heard since the last take, and its peak.
    pub fn take(&mut self) -> (Vec<f32>, f32) {
        let peak = std::mem::take(&mut self.peak);
        (std::mem::take(&mut self.samples), peak)
    }

    fn push(&mut self, samples: &[f32]) {
        for sample in samples {
            self.peak = self.peak.max(sample.abs());
        }
        self.samples.extend_from_slice(samples);
    }
}

/// Average interleaved frames down to one channel. A laptop microphone often
/// reports stereo with the same signal twice; averaging keeps all of it.
pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks(channels)
        .map(|frame| {
            // A frame holds one sample per channel, and channel counts fit u16.
            let channels = f32::from(u16::try_from(frame.len()).unwrap_or(u16::MAX));
            frame.iter().sum::<f32>() / channels
        })
        .collect()
}

/// Resample mono audio to 16 kHz, linearly.
///
/// Run once over the whole recording rather than per callback, so there is no
/// phase jump at buffer boundaries. Linear is enough for speech headed into a
/// model trained on 16 kHz: what it aliases lies above anything the model hears.
pub fn to_16k(samples: &[f32], from: u32) -> Vec<f32> {
    if from == RATE || samples.is_empty() {
        return samples.to_vec();
    }
    // Integer positions: output sample `i` sits at `i * from / RATE` input
    // samples, and the remainder over RATE is the interpolation fraction.
    let last = samples.len() - 1;
    let total = u64::try_from(samples.len()).unwrap_or(u64::MAX);
    let out_len = usize::try_from(total * u64::from(RATE) / u64::from(from)).unwrap_or(0);
    let rate = f32::from(u16::try_from(RATE).unwrap_or(u16::MAX));
    (0..out_len)
        .map(|index| {
            let at = u64::try_from(index).unwrap_or(u64::MAX) * u64::from(from);
            let left = usize::try_from(at / u64::from(RATE))
                .unwrap_or(last)
                .min(last);
            let right = (left + 1).min(last);
            let frac = f32::from(u16::try_from(at % u64::from(RATE)).unwrap_or(0)) / rate;
            samples[left] + (samples[right] - samples[left]) * frac
        })
        .collect()
}

/// Save 16 kHz mono audio as 16-bit PCM WAV.
pub fn write_wav(path: &Path, pcm: &[f32]) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let wav = |e: hound::Error| Error::Stt(format!("the recording could not be saved: {e}"));
    let mut writer = hound::WavWriter::create(path, spec).map_err(wav)?;
    for sample in pcm {
        writer
            .write_sample(crate::convert::pcm16(*sample))
            .map_err(wav)?;
    }
    writer.finalize().map_err(wav)
}

/// An open microphone. Capture stops when this is dropped.
///
/// `cpal::Stream` is not `Send` on every host, so this is created and dropped on
/// one thread (the session's); only [`Heard`] crosses threads.
pub struct Microphone {
    _stream: cpal::Stream,
    /// The device's sample rate, which is what [`Heard`] holds.
    pub rate: u32,
}

/// Open the default input device and start filling `heard`.
pub fn listen(heard: Arc<Mutex<Heard>>) -> Result<Microphone> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| Error::Stt("no microphone was found".into()))?;
    let config = device
        .default_input_config()
        .map_err(|e| Error::Stt(format!("the microphone would not open: {e}")))?;

    let rate = config.sample_rate().0;
    let format = config.sample_format();
    let stream = match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, &config.into(), heard),
        cpal::SampleFormat::I16 => build::<i16>(&device, &config.into(), heard),
        cpal::SampleFormat::U16 => build::<u16>(&device, &config.into(), heard),
        cpal::SampleFormat::I32 => build::<i32>(&device, &config.into(), heard),
        other => {
            return Err(Error::Stt(format!(
                "the microphone speaks a sample format this cannot read: {other}"
            )))
        }
    }?;
    stream
        .play()
        .map_err(|e| Error::Stt(format!("the microphone would not start: {e}")))?;

    Ok(Microphone {
        _stream: stream,
        rate,
    })
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    heard: Arc<Mutex<Heard>>,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    use cpal::traits::DeviceTrait;

    let channels = usize::from(config.channels);
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let floats: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
                let mono = to_mono(&floats, channels);
                if let Ok(mut held) = heard.lock() {
                    held.push(&mono);
                }
            },
            // Nothing to do from inside the audio callback; the level meter
            // shows silence, which is what the learner sees.
            |error| eprintln!("stt: microphone error: {error}"),
            None,
        )
        .map_err(|e| Error::Stt(format!("the microphone would not start: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_channels_are_averaged() {
        assert_eq!(to_mono(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(to_mono(&[0.1, 0.2], 1), vec![0.1, 0.2]);
    }

    #[test]
    fn audio_at_16k_is_untouched_and_48k_shrinks_by_three() {
        let samples = vec![0.1, 0.2, 0.3];
        assert_eq!(to_16k(&samples, RATE), samples);
        assert_eq!(to_16k(&vec![0.0; 48_000], 48_000).len(), 16_000);
        assert_eq!(to_16k(&vec![0.0; 44_100], 44_100).len(), 16_000);
        assert_eq!(to_16k(&[], 48_000), [] as [f32; 0]);
    }

    #[test]
    fn resampling_keeps_the_shape_of_a_ramp() {
        let samples: Vec<f32> = (0..32u8).map(f32::from).collect();
        let found = to_16k(&samples, 32_000);
        assert_eq!(found.len(), 16);
        assert!((found[8] - 16.0).abs() < 0.001);
        // A non-integer ratio interpolates between neighbours.
        let found = to_16k(&samples, 24_000);
        assert!((found[1] - 1.5).abs() < 0.001, "{}", found[1]);
    }

    #[test]
    fn taking_what_was_heard_leaves_it_empty() {
        let mut heard = Heard::default();
        heard.push(&[0.1, -0.5, 0.2]);
        let (samples, peak) = heard.take();
        assert_eq!(samples, vec![0.1, -0.5, 0.2]);
        assert!(
            (peak - 0.5).abs() < f32::EPSILON,
            "peak is the loudest, not the last"
        );
        assert_eq!(heard.take(), (vec![], 0.0));
    }

    #[test]
    fn a_recording_is_saved_as_16k_mono_16_bit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("take.wav");
        write_wav(&path, &[0.0, 0.5, -1.0, 2.0]).unwrap();

        let mut reader = hound::WavReader::open(&path).unwrap();
        let spec = reader.spec();
        assert_eq!(
            (spec.channels, spec.sample_rate, spec.bits_per_sample),
            (1, RATE, 16)
        );
        assert_eq!(spec.sample_format, hound::SampleFormat::Int);
        let samples: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        // Out-of-range input is clamped rather than wrapped.
        assert_eq!(samples, vec![0, 16_384, -32_767, 32_767]);
    }
}
