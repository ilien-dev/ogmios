//! The live preview: what the learner has said so far, while they speak.
//!
//! The model is offline, so the preview re-reads the audio every half second
//! or so. Re-reading the whole recording would grow slower with every
//! sentence; instead the audio is cut at pauses. A stretch that ended in a
//! pause is settled, its text kept, and only the stretch still being spoken is
//! read again. Release still transcribes the whole recording at once, so the
//! turn's text never depends on where these cuts fell.

/// The settled text, and where the stretch still being spoken begins.
#[derive(Default)]
pub struct Preview {
    settled: String,
    /// Raw sample where the current stretch begins.
    from: usize,
}

impl Preview {
    /// Raw sample the next read starts at.
    pub fn from(&self) -> usize {
        self.from
    }

    /// Take the text of the current stretch, read up to raw sample `end`, and
    /// return everything said so far. A stretch that ended in a pause is
    /// settled, so the next read starts at `end`.
    pub fn heard(&mut self, stretch: &str, end: usize, paused: bool) -> String {
        let said = joined(&self.settled, stretch);
        if paused {
            self.settled.clone_from(&said);
            self.from = end;
        }
        said
    }
}

fn joined(settled: &str, stretch: &str) -> String {
    match (settled.is_empty(), stretch.trim()) {
        (_, "") => settled.to_string(),
        (true, stretch) => stretch.to_string(),
        (false, stretch) => format!("{settled} {stretch}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stretch_being_spoken_is_read_again_until_a_pause() {
        let mut preview = Preview::default();
        assert_eq!(preview.heard("Yesterday I", 8_000, false), "Yesterday I");
        assert_eq!(preview.from(), 0, "no pause yet, so read from the start");
        assert_eq!(
            preview.heard("Yesterday I go to the store.", 16_000, true),
            "Yesterday I go to the store."
        );
        assert_eq!(preview.from(), 16_000);
        assert_eq!(
            preview.heard("And buy", 24_000, false),
            "Yesterday I go to the store. And buy"
        );
    }

    #[test]
    fn silence_adds_nothing() {
        let mut preview = Preview::default();
        assert_eq!(preview.heard(" ", 8_000, true), "");
        assert_eq!(preview.heard("Hi.", 16_000, true), "Hi.");
        assert_eq!(preview.heard("", 24_000, true), "Hi.");
        assert_eq!(preview.from(), 24_000);
    }
}
