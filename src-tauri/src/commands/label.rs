//! Saying what kind of word a stored word is, whether it takes an object
//! and, of a verb, the form its sentence has it in. A chapter is told all
//! of it of each of its words when it is prepared; the words stored before
//! any of it was asked for lack it. They are put to the
//! model here, with the sentence each was taken from, and what it answers is
//! kept.
//!
//! The model labels, this code decides: only a word that was asked about is
//! labelled, what it has already is never said again, and a word the model
//! says nothing of stays as it was, to be asked about on the next run. It runs in the background, a few
//! words a request, each answer stored as it arrives. The database is never
//! held while the model answers.

use std::sync::Mutex;

use tauri::AppHandle;

use super::profile::agent;
use super::run;
use crate::agent::protocol::{VocabLabelParams, VocabLabels};
use crate::db::words;
use crate::error::Result;
use crate::Ctx;

/// Words put to the model in one request.
const WORDS_PER_CALL: usize = 40;

/// The one thing the model is asked for; a stub in the tests.
pub trait Model {
    fn label(&mut self, params: &VocabLabelParams) -> Result<VocabLabels>;
}

/// The model behind the sidecar.
pub(super) struct Sidecar<'a>(pub(super) Ctx<'a>);

impl Model for Sidecar<'_> {
    fn label(&mut self, params: &VocabLabelParams) -> Result<VocabLabels> {
        agent(self.0)?.vocab_label(params)
    }
}

/// Labels every word still to be labelled, of any book; how many were.
pub fn label_all(ctx: Ctx<'_>, model: &mut dyn Model) -> Result<u32> {
    let waiting = words::unlabelled(&*ctx.conn()?)?;
    let mut labelled = 0_u32;
    for chunk in waiting.chunks(WORDS_PER_CALL) {
        let answer = model.label(&VocabLabelParams {
            words: chunk.to_vec(),
        })?;
        let conn = ctx.conn()?;
        for label in &answer.labels {
            let asked = chunk.iter().any(|word| word.id == label.id);
            let kind = (label.part_of_speech, label.transitive);
            if asked && words::label(&conn, &label.id, kind, label.verb_form)? {
                labelled = labelled.saturating_add(1);
            }
        }
    }
    Ok(labelled)
}

/// One run at a time: a second one waits, and then finds nothing to do.
static RUNNING: Mutex<()> = Mutex::new(());

/// Labels each stored word still to be labelled; how many were.
#[tauri::command]
pub async fn label_words(app: AppHandle) -> Result<u32> {
    run(app, move |_, ctx| {
        let _one = RUNNING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // The screen stays quiet about it; the reason is said here.
        label_all(ctx, &mut Sidecar(ctx)).inspect_err(|err| eprintln!("label words: {err}"))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::WordLabel;
    use crate::books::vocab::Word;
    use crate::commands::practice::tests::{numbered, Desk};
    use crate::db::practice;
    use crate::db::words::tests::word;
    use crate::domain::{PartOfSpeech, VerbForm};

    /// A model that calls every word a verb but the ones it is told to skip,
    /// and one more that nobody asked about. It keeps what it was asked.
    #[derive(Default)]
    struct Stub {
        asked: Vec<Vec<String>>,
        skips: Vec<&'static str>,
    }

    impl Model for Stub {
        fn label(&mut self, params: &VocabLabelParams) -> Result<VocabLabels> {
            self.asked
                .push(params.words.iter().map(|word| word.lemma.clone()).collect());
            let mut labels: Vec<WordLabel> = params
                .words
                .iter()
                .filter(|word| !self.skips.contains(&word.lemma.as_str()))
                .map(|word| WordLabel {
                    id: word.id.clone(),
                    part_of_speech: PartOfSpeech::Verb,
                    transitive: true,
                    verb_form: Some(VerbForm::Past),
                })
                .collect();
            labels.push(WordLabel {
                id: "nobody".into(),
                part_of_speech: PartOfSpeech::Noun,
                transitive: false,
                verb_form: None,
            });
            Ok(VocabLabels { labels })
        }
    }

    /// The kind of each word of the chapter, by its base form.
    fn kinds(desk: &Desk, chapter: &str) -> Vec<(String, Option<PartOfSpeech>)> {
        words::list(&desk.db.lock().expect("db"), chapter)
            .expect("list")
            .into_iter()
            .map(|word| (word.lemma, word.part_of_speech))
            .collect()
    }

    #[test]
    fn a_word_without_a_kind_is_given_one_and_one_that_has_it_keeps_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let list = [
            Word {
                part_of_speech: Some(PartOfSpeech::Noun),
                ..word("hedge", &["seto"], 3)
            },
            Word {
                sentence: "She peeped in.".into(),
                ..word("peep", &["asomarse"], 2)
            },
            word("fog", &["niebla"], 1),
        ];
        let chapter = desk.chapter("b", &list);

        let mut stub = Stub {
            skips: vec!["fog"],
            ..Stub::default()
        };
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 1);
        // Only the words without a kind are asked about.
        assert_eq!(stub.asked, [["peep", "fog"]]);
        assert_eq!(
            kinds(&desk, &chapter),
            [
                ("hedge".to_owned(), Some(PartOfSpeech::Noun)),
                ("peep".to_owned(), Some(PartOfSpeech::Verb)),
                ("fog".to_owned(), None),
            ]
        );

        // The one the model said nothing of is asked about again, alone.
        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 1);
        assert_eq!(stub.asked, [["fog"]]);
        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 0);
        assert_eq!(stub.asked, Vec::<Vec<String>>::new());
    }

    #[test]
    fn a_verb_nobody_said_all_of_is_asked_about_and_keeps_what_it_has() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let list = [
            // As stored before it was asked for: a kind, and no more.
            Word {
                part_of_speech: Some(PartOfSpeech::PhrasalVerb),
                ..word("give up", &["rendirse"], 3)
            },
            Word {
                part_of_speech: Some(PartOfSpeech::Verb),
                transitive: Some(false),
                ..word("trot", &["trotar"], 2)
            },
            Word {
                part_of_speech: Some(PartOfSpeech::Noun),
                ..word("hedge", &["seto"], 1)
            },
        ];
        let chapter = desk.chapter("b", &list);
        let transitive = |lemma: &str| -> Option<bool> {
            desk.db
                .lock()
                .expect("db")
                .query_row(
                    "SELECT transitive FROM chapter_words WHERE lemma = ?1",
                    [lemma],
                    |row| row.get(0),
                )
                .expect("word")
        };

        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 2);
        // Each lacks the form its sentence has it in; not a noun.
        assert_eq!(stub.asked, [["give up", "trot"]]);
        assert_eq!(transitive("give up"), Some(true));
        assert_eq!(transitive("trot"), Some(false), "what it said stays");
        assert_eq!(transitive("hedge"), None);
        let forms: Vec<Option<VerbForm>> = words::unlabelled(&desk.db.lock().expect("db"))
            .expect("unlabelled")
            .into_iter()
            .map(|_| None)
            .collect();
        assert_eq!(forms, [], "none is left to ask about");
        let form = |id: &str| practice::word(&desk.db.lock().expect("db"), id).expect("word");
        let listed = words::list(&desk.db.lock().expect("db"), &chapter).expect("list");
        assert_eq!(form(&listed[0].id).verb_form, Some(VerbForm::Past));
        assert_eq!(form(&listed[2].id).verb_form, None, "a noun has none");
        // The model called it a verb: it stays what its chapter said.
        assert_eq!(
            kinds(&desk, &chapter)[0],
            ("give up".to_owned(), Some(PartOfSpeech::PhrasalVerb))
        );
        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 0);
    }

    #[test]
    fn the_words_of_every_book_are_asked_about_a_few_a_request() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        desk.chapter("a", &numbered(30));
        desk.chapter("b", &numbered(30));
        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 60);
        let sizes: Vec<usize> = stub.asked.iter().map(Vec::len).collect();
        assert_eq!(sizes, [WORDS_PER_CALL, 20]);
    }
}
