//! Which recognisers exist, where to fetch them, and what language to ask for.
//!
//! Data, not code: adding a model is an entry in `models.json`. Compiled in, so
//! the catalogue cannot go missing, and every URL names a revision rather than
//! `main`, so a checksum cannot start failing because upstream replaced a file.
//!
//! ## The language hint
//!
//! Each model carries the locale handed to `transcribe_pcm_lang`:
//!
//! - **Parakeet TDT 0.6B v3** gets `auto`. A beginner drops into their own
//!   language when a word is missing ("I work in a *ferretería*"). Forcing
//!   `en` would turn that word into English-sounding noise; `auto` keeps it
//!   readable, so Claude can offer the English word back (SPEC §6.3) and the
//!   report can collect it as vocabulary.
//!
//! None of them is a default: no model is in use until the learner downloads
//! one and picks it.
//! - **Parakeet TDT-CTC 110M** gets `en`: it only knows English.

use std::sync::OnceLock;

use serde::Deserialize;

const MODELS: &str = include_str!("models.json");

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    /// Also the folder name under `<data_dir>/models/`.
    pub id: String,
    pub name: String,
    pub languages: Vec<String>,
    /// Locale passed to the engine: a two-letter tag or `auto`.
    pub hint: String,
    pub files: Vec<File>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct File {
    /// Where it lands inside the model's folder.
    pub name: String,
    pub url: String,
    /// Lowercase hex.
    pub sha256: String,
    pub bytes: u64,
}

impl Model {
    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|file| file.bytes).sum()
    }
}

#[derive(Deserialize)]
struct Catalogue {
    models: Vec<Model>,
}

fn parse(json: &str) -> serde_json::Result<Vec<Model>> {
    serde_json::from_str::<Catalogue>(json).map(|catalogue| catalogue.models)
}

/// Every model this build can fetch. A test proves the list parses, so the
/// empty fallback is only reachable from a build that failed its own suite.
pub fn all() -> &'static [Model] {
    static PARSED: OnceLock<Vec<Model>> = OnceLock::new();
    PARSED.get_or_init(|| parse(MODELS).unwrap_or_default())
}

pub fn find(id: &str) -> Option<&'static Model> {
    all().iter().find(|model| model.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_parses_and_holds_both_models() {
        let models = parse(MODELS).unwrap();
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["parakeet-tdt-0.6b-v3", "parakeet-tdt-ctc-110m"]);
    }

    #[test]
    fn the_multilingual_model_speaks_english_and_spanish() {
        let model = find("parakeet-tdt-0.6b-v3").unwrap();
        assert!(model.languages.iter().any(|l| l == "en"));
        assert!(model.languages.iter().any(|l| l == "es"));
        assert_eq!(model.hint, "auto");
    }

    #[test]
    fn every_entry_is_safe_to_join_onto_a_path_and_checkable() {
        let segment = |s: &str| {
            !s.is_empty()
                && !s.starts_with('.')
                && s.chars().all(|c| {
                    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.' | '_')
                })
        };
        for model in all() {
            assert!(segment(&model.id), "{}", model.id);
            assert!(model.bytes() > 0, "{} weighs nothing", model.id);
            assert!(
                model.hint == "auto" || model.hint.len() == 2,
                "{}",
                model.hint
            );
            for file in &model.files {
                assert!(segment(&file.name), "{}", file.name);
                assert_eq!(file.sha256.len(), 64);
                assert!(file
                    .sha256
                    .chars()
                    .all(|c| matches!(c, '0'..='9' | 'a'..='f')));
                assert!(
                    !file.url.contains("/resolve/main/"),
                    "{} is not pinned",
                    file.url
                );
            }
        }
    }

    #[test]
    fn a_malformed_catalogue_is_an_error_not_a_panic() {
        assert!(parse("{\"models\": [{\"id\": 3}]}").is_err());
    }
}
