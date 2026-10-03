//! Voice-activity detection: how many seconds of a recording are speech.
//!
//! The duration goal counts minutes of speech, not minutes on screen (SPEC
//! §6.4), so ten minutes of silence must count for nothing. A plain energy gate
//! is enough for that: speech into a laptop microphone sits far above room
//! noise, and the number only fills a progress bar.
//!
//! The audio is cut into [`FRAME_MS`] frames; a frame whose RMS (root mean
//! square, the average loudness) reaches [`SPEECH_RMS`] is speech, and so are the
//! [`HANGOVER_FRAMES`] after it, which bridges the quiet consonants and short
//! gaps inside a sentence.

/// Length of one decision, in milliseconds.
pub const FRAME_MS: u32 = 30;

/// RMS at or above which a frame is speech, on a 0–1 scale.
///
/// 0.02 is about −34 dBFS. Conversational speech a hand's width to an arm's
/// length from a laptop microphone lands around −30 to −20 dBFS; a quiet room,
/// a fan or keyboard clicks between words stay near −50 to −60.
pub const SPEECH_RMS: f32 = 0.02;

/// Frames still counted as speech after the last loud one: 150 ms.
pub const HANGOVER_FRAMES: u32 = 5;

/// Quiet this long at the end of the audio is a pause between sentences, not
/// a gap inside a word: 600 ms.
pub const PAUSE_FRAMES: usize = 20;

/// A running count, fed in arbitrary slices at any sample rate.
pub struct Vad {
    frame_len: usize,
    /// `frame_len` as a divisor; a frame is at most a few thousand samples.
    frame_len_f: f32,
    filled: usize,
    sum_sq: f32,
    /// Hangover frames still to count.
    hang: u32,
    speech_frames: u32,
}

impl Vad {
    pub fn new(rate: u32) -> Vad {
        let frame_len = usize::try_from(rate * FRAME_MS / 1000).unwrap_or(1).max(1);
        Vad {
            frame_len,
            frame_len_f: f32::from(u16::try_from(frame_len).unwrap_or(u16::MAX)),
            filled: 0,
            sum_sq: 0.0,
            hang: 0,
            speech_frames: 0,
        }
    }

    pub fn feed(&mut self, samples: &[f32]) {
        for sample in samples {
            self.sum_sq += sample * sample;
            self.filled += 1;
            if self.filled == self.frame_len {
                let rms = (self.sum_sq / self.frame_len_f).sqrt();
                if rms >= SPEECH_RMS {
                    self.speech_frames = self.speech_frames.saturating_add(1);
                    self.hang = HANGOVER_FRAMES;
                } else if self.hang > 0 {
                    self.speech_frames = self.speech_frames.saturating_add(1);
                    self.hang -= 1;
                }
                self.filled = 0;
                self.sum_sq = 0.0;
            }
        }
    }

    pub fn seconds(&self) -> f64 {
        f64::from(self.speech_frames) * f64::from(FRAME_MS) / 1000.0
    }
}

/// Whether any frame of `samples` reaches the speech gate. Audio without one
/// is silence or room noise, which the model would answer with invented words.
pub fn has_speech(samples: &[f32], rate: u32) -> bool {
    let frame_len = frame_len(rate);
    samples
        .chunks(frame_len)
        .any(|frame| is_loud(frame, frame_len))
}

/// Whether the last [`PAUSE_FRAMES`] of `samples` are all below the speech
/// gate. Audio shorter than that is not a pause yet.
pub fn ends_in_pause(samples: &[f32], rate: u32) -> bool {
    let frame_len = frame_len(rate);
    let wanted = frame_len * PAUSE_FRAMES;
    let Some(tail) = samples.len().checked_sub(wanted).map(|at| &samples[at..]) else {
        return false;
    };
    !tail
        .chunks(frame_len)
        .any(|frame| is_loud(frame, frame_len))
}

fn frame_len(rate: u32) -> usize {
    usize::try_from(rate * FRAME_MS / 1000).unwrap_or(1).max(1)
}

/// A frame at the speech gate, its RMS taken over a whole `frame_len`.
fn is_loud(frame: &[f32], frame_len: usize) -> bool {
    let frame_len_f = f32::from(u16::try_from(frame_len).unwrap_or(u16::MAX));
    (frame.iter().map(|s| s * s).sum::<f32>() / frame_len_f).sqrt() >= SPEECH_RMS
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    fn tone(ms: u32, amplitude: f32) -> Vec<f32> {
        let mut phase = 0.0f32;
        (0..RATE * ms / 1000)
            .map(|_| {
                phase += 0.05;
                amplitude * phase.sin()
            })
            .collect()
    }

    #[test]
    fn silence_counts_for_nothing() {
        let mut vad = Vad::new(RATE);
        vad.feed(&vec![0.0; RATE as usize * 10]);
        assert!(vad.seconds().abs() < f64::EPSILON);
    }

    #[test]
    fn room_noise_below_the_gate_counts_for_nothing() {
        let mut vad = Vad::new(RATE);
        vad.feed(&tone(3000, 0.01)); // RMS ≈ 0.007
        assert!(vad.seconds().abs() < f64::EPSILON);
    }

    #[test]
    fn speech_counts_its_own_length_plus_one_hangover() {
        let mut vad = Vad::new(RATE);
        vad.feed(&tone(900, 0.3));
        vad.feed(&vec![0.0; RATE as usize * 2]);
        // 30 loud frames, then 5 frames of hangover.
        assert!((vad.seconds() - 1.05).abs() < 1e-9, "{}", vad.seconds());
    }

    #[test]
    fn slicing_the_input_does_not_change_the_count() {
        let audio: Vec<f32> = [tone(500, 0.3), vec![0.0; 8_000], tone(300, 0.3)].concat();
        let mut whole = Vad::new(RATE);
        whole.feed(&audio);
        let mut sliced = Vad::new(RATE);
        for chunk in audio.chunks(337) {
            sliced.feed(chunk);
        }
        assert!((whole.seconds() - sliced.seconds()).abs() < f64::EPSILON);
        assert!(whole.seconds() > 0.8);
    }

    #[test]
    fn frames_follow_the_device_rate() {
        let mut vad = Vad::new(48_000);
        vad.feed(&vec![0.3; 48_000]);
        assert!((vad.seconds() - 0.99).abs() < 1e-9, "{}", vad.seconds());
    }

    #[test]
    fn a_quiet_tail_after_speech_is_a_pause() {
        let audio = [tone(800, 0.3), vec![0.0; 16 * 700]].concat();
        assert!(ends_in_pause(&audio, RATE));
    }

    #[test]
    fn speech_or_a_short_breath_at_the_end_is_not_a_pause() {
        assert!(!ends_in_pause(&tone(1000, 0.3), RATE));
        let breath = [tone(800, 0.3), vec![0.0; 16 * 300]].concat();
        assert!(!ends_in_pause(&breath, RATE));
    }

    #[test]
    fn only_a_frame_above_the_gate_is_speech() {
        assert!(!has_speech(&vec![0.0; RATE as usize * 2], RATE));
        assert!(!has_speech(&tone(2000, 0.01), RATE));
        let word = [vec![0.0; 16 * 900], tone(200, 0.3), vec![0.0; 16 * 900]].concat();
        assert!(has_speech(&word, RATE));
    }

    #[test]
    fn audio_shorter_than_a_pause_is_not_one() {
        assert!(!ends_in_pause(&[0.0; 100], RATE));
    }
}
