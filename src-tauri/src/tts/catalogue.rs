//! The voice that reads aloud, where to fetch it, and who it can sound like.
//!
//! Data, not code, like the recognisers' catalogue, and fetched the same way:
//! the model is a `stt::catalogue::Model`, every URL names a revision, every
//! file has its checksum. One model, several speakers inside it.
//!
//! Only the seven files of espeak-ng's data that English needs are listed, out
//! of 355: it is asked about a word only when the lexicon does not hold it.

use std::sync::OnceLock;

use serde::Deserialize;

use crate::domain::Variant;
use crate::stt::catalogue::Model;

const KOKORO: &str = include_str!("kokoro.json");

#[derive(Debug, Clone, Deserialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    /// Which English it speaks: the lexicon the engine is loaded with.
    pub variant: Variant,
    /// The speaker's number inside `voices.bin`.
    pub speaker: i32,
}

#[derive(Debug, Deserialize)]
pub struct Catalogue {
    pub model: Model,
    pub voices: Vec<Voice>,
}

fn parse(json: &str) -> serde_json::Result<Catalogue> {
    serde_json::from_str(json)
}

/// The model and its voices. A test proves the file parses and has a voice of
/// each variant, so `None` is only reachable from a build that failed its own
/// suite.
pub fn get() -> Option<&'static Catalogue> {
    static PARSED: OnceLock<Option<Catalogue>> = OnceLock::new();
    PARSED.get_or_init(|| parse(KOKORO).ok()).as_ref()
}

impl Catalogue {
    pub fn voice(&self, id: &str) -> Option<&Voice> {
        self.voices.iter().find(|voice| voice.id == id)
    }

    /// The voice used before the learner picks one: the first that speaks
    /// their English.
    pub fn default_voice(&self, variant: Variant) -> Option<&Voice> {
        self.voices
            .iter()
            .find(|voice| voice.variant == variant)
            .or_else(|| self.voices.first())
    }
}

/// The lexicon a variant is read with, as named in the model's folder.
pub fn lexicon(variant: Variant) -> &'static str {
    match variant {
        Variant::Us => "lexicon-us-en.txt",
        Variant::Uk => "lexicon-gb-en.txt",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_parses_with_a_voice_of_each_english() {
        let catalogue = parse(KOKORO).unwrap();
        assert_eq!(catalogue.default_voice(Variant::Us).unwrap().id, "af_heart");
        assert_eq!(catalogue.default_voice(Variant::Uk).unwrap().id, "bf_emma");
        assert!(catalogue.voice("bm_george").is_some());
        assert!(catalogue.voice("nobody").is_none());
    }

    #[test]
    fn every_file_is_pinned_checkable_and_stays_in_its_folder() {
        let catalogue = get().unwrap();
        assert!(catalogue.model.bytes() > 0);
        for file in &catalogue.model.files {
            assert!(
                file.name
                    .split('/')
                    .all(|part| !part.is_empty() && !part.starts_with('.')),
                "{}",
                file.name
            );
            assert!(!file.name.contains('\\'), "{}", file.name);
            assert_eq!(file.sha256.len(), 64);
            assert!(
                !file.url.contains("/resolve/main/"),
                "{} is not pinned",
                file.url
            );
            assert!(file.url.ends_with(&file.name), "{}", file.url);
        }
    }

    #[test]
    fn both_lexicons_are_among_the_files() {
        let names: Vec<&str> = get()
            .unwrap()
            .model
            .files
            .iter()
            .map(|file| file.name.as_str())
            .collect();
        for variant in [Variant::Us, Variant::Uk] {
            assert!(names.contains(&lexicon(variant)));
        }
    }

    #[test]
    fn a_malformed_catalogue_is_an_error_not_a_panic() {
        assert!(parse("{\"model\": 3}").is_err());
    }
}
