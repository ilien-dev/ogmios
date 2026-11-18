//! Saying what kind of word a stored word is, whether it takes an object
//! and, of a verb, the form its sentence has it in. A chapter is told all
//! of it of each of its words when it is prepared; the words stored before
//! any of it was asked for lack it. A verb called by another form than its
//! base form is said its translations in that form here too, and only
//! here: "jurado" for "sworn", stored as "jurar". They are put to the
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
use crate::agent::protocol::{VocabCheckParams, VocabChecks, VocabLabelParams, VocabLabels};
use crate::db::words;
use crate::error::Result;
use crate::Ctx;

/// Words put to the model in one request.
const WORDS_PER_CALL: usize = 40;

/// What the model is asked for; a stub in the tests.
pub trait Model {
    fn label(&mut self, params: &VocabLabelParams) -> Result<VocabLabels>;
    fn check(&mut self, params: &VocabCheckParams) -> Result<VocabChecks>;
}

/// The model behind the sidecar.
pub(super) struct Sidecar<'a>(pub(super) Ctx<'a>);

impl Model for Sidecar<'_> {
    fn label(&mut self, params: &VocabLabelParams) -> Result<VocabLabels> {
        agent(self.0)?.vocab_label(params)
    }

    fn check(&mut self, params: &VocabCheckParams) -> Result<VocabChecks> {
        agent(self.0)?.vocab_check(params)
    }
}

/// Looks at every word not looked at yet against its sentence, of any
/// book, and puts right the ones taken for another word written the same
/// way (`words::check`); how many were. A word the model says nothing of,
/// or whose request failed, is looked at on the next run. A word put right
/// is said in its form by the labels that run after it.
pub fn check_all(ctx: Ctx<'_>, model: &mut dyn Model) -> Result<u32> {
    let (waiting, native_lang) = {
        let conn = ctx.conn()?;
        let Some(profile) = crate::db::profile::get_profile(&conn)? else {
            return Ok(0);
        };
        (words::unchecked(&conn)?, profile.native_lang)
    };
    let mut put_right = 0_u32;
    for chunk in waiting.chunks(WORDS_PER_CALL) {
        let asked = model.check(&VocabCheckParams {
            native_lang: native_lang.clone(),
            words: chunk.to_vec(),
        });
        // A request that fails leaves its words for the next run; the
        // others are looked at all the same.
        let Ok(answer) = asked.inspect_err(|err| eprintln!("check words: {err}")) else {
            continue;
        };
        let conn = ctx.conn()?;
        for look in &answer.checks {
            if chunk.iter().any(|word| word.id == look.id) && words::check(&conn, &look.id, look)? {
                put_right = put_right.saturating_add(1);
            }
        }
    }
    Ok(put_right)
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
            let Some(asked) = chunk.iter().find(|word| word.id == label.id) else {
                continue;
            };
            let kind = (label.part_of_speech, label.transitive);
            let kind = words::label(&conn, &label.id, kind, label.verb_form)?;
            let form = words::put_in_form(&conn, &label.id, &asked.translations, &label.in_form)?;
            let also = words::put_also(&conn, &label.id, &asked.translations, &label.in_form_also)?;
            let persons = words::put_persons(
                &conn,
                &label.id,
                &asked.translations,
                &label.in_form_persons,
            )?;
            if kind || form || also || persons {
                labelled = labelled.saturating_add(1);
            }
        }
    }
    // The forms just said lose what a negation beside their word gave them.
    let conn = ctx.conn()?;
    if let Some(profile) = crate::db::profile::get_profile(&conn)? {
        words::affirm(&conn, &profile.native_lang)?;
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
        // The screen stays quiet about it; the reason is said here. The
        // labels come first: the words of the chapter open are not kept
        // waiting for a look at every word of every book. The words that
        // look puts right are labelled after it.
        let labelled =
            label_all(ctx, &mut Sidecar(ctx)).inspect_err(|err| eprintln!("label words: {err}"))?;
        let put_right = check_all(ctx, &mut Sidecar(ctx))
            .inspect_err(|err| eprintln!("check words: {err}"))
            .unwrap_or(0);
        let relabelled = if put_right > 0 {
            label_all(ctx, &mut Sidecar(ctx)).inspect_err(|err| eprintln!("label words: {err}"))?
        } else {
            0
        };
        Ok(labelled
            .saturating_add(put_right)
            .saturating_add(relabelled))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::{WordCheck, WordLabel};
    use crate::books::vocab::Word;
    use crate::commands::practice::tests::{numbered, Desk};
    use crate::db::practice;
    use crate::db::words::tests::word;
    use crate::domain::{PartOfSpeech, VerbForm};

    /// A model that calls every word a verb in its base form but the ones it
    /// is told to skip, and one more that nobody asked about. It keeps what it was asked.
    #[derive(Default)]
    struct Stub {
        asked: Vec<Vec<String>>,
        looked: Vec<Vec<String>>,
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
                    verb_form: Some(VerbForm::Base),
                    in_form: word.translations.iter().map(|t| format!("{t}do")).collect(),
                    in_form_also: word.translations.iter().map(|_| Vec::new()).collect(),
                    in_form_persons: word.translations.iter().map(|_| Vec::new()).collect(),
                })
                .collect();
            labels.push(WordLabel {
                id: "nobody".into(),
                part_of_speech: PartOfSpeech::Noun,
                transitive: false,
                verb_form: None,
                in_form: Vec::new(),
                in_form_also: Vec::new(),
                in_form_persons: Vec::new(),
            });
            Ok(VocabLabels { labels })
        }

        /// Every word fits but "moped", the past of "mope" in its sentence.
        fn check(&mut self, params: &VocabCheckParams) -> Result<VocabChecks> {
            self.looked
                .push(params.words.iter().map(|word| word.lemma.clone()).collect());
            let checks = params
                .words
                .iter()
                .map(|word| {
                    let wrong = word.lemma == "moped";
                    if word.lemma == "kicked" || word.lemma == "hedge" {
                        // The same word: "kicked" lacked its base form, and
                        // "hedge" is only said in other words.
                        let kicked = word.lemma == "kicked";
                        return WordCheck {
                            id: word.id.clone(),
                            fits: false,
                            part_of_speech: word.part_of_speech.unwrap_or(PartOfSpeech::Other),
                            transitive: kicked,
                            verb_form: kicked.then_some(VerbForm::Past),
                            base: kicked.then(|| "kick".to_owned()),
                            translations: [word.translations.clone(), vec!["valla".into()]]
                                .concat(),
                            context_there: false,
                            context_back: false,
                            related: Vec::new(),
                        };
                    }
                    WordCheck {
                        id: word.id.clone(),
                        fits: !wrong,
                        part_of_speech: if wrong {
                            PartOfSpeech::Verb
                        } else {
                            word.part_of_speech.unwrap_or(PartOfSpeech::Other)
                        },
                        transitive: false,
                        verb_form: wrong.then_some(VerbForm::Past),
                        base: wrong.then(|| "mope".to_owned()),
                        translations: if wrong {
                            vec!["andar deprimido".into(), " ".into()]
                        } else {
                            word.translations.clone()
                        },
                        context_there: false,
                        context_back: false,
                        related: Vec::new(),
                    }
                })
                .collect();
            Ok(VocabChecks { checks })
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
        assert_eq!(form(&listed[0].id).verb_form, Some(VerbForm::Base));
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
    fn a_verb_called_by_another_form_is_said_its_translations_in_that_form() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let list = [
            // As stored before it was asked for: all of it but that.
            Word {
                part_of_speech: Some(PartOfSpeech::Verb),
                transitive: Some(true),
                verb_form: Some(VerbForm::PastParticiple),
                base: Some("swear".into()),
                ..word("sworn", &["jurar", "prometer"], 2)
            },
            Word {
                part_of_speech: Some(PartOfSpeech::Verb),
                transitive: Some(true),
                verb_form: Some(VerbForm::Base),
                ..word("peep", &["asomarse"], 1)
            },
        ];
        let chapter = desk.chapter("b", &list);
        let rows = || {
            let conn = desk.db.lock().expect("db");
            let listed = words::list(&conn, &chapter).expect("list");
            let row = |at: usize| practice::word(&conn, &listed[at].id).expect("word");
            (row(0), row(1))
        };
        assert_eq!(rows().0.shown_as(), ["jurar", "prometer"]);
        let waiting = words::unlabelled(&desk.db.lock().expect("db")).expect("unlabelled");
        assert_eq!(waiting.len(), 1, "one in its base form has nothing to say");
        assert_eq!(waiting[0].translations, ["jurar", "prometer"]);

        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 1);
        assert_eq!(stub.asked, [["sworn"]]);
        let (sworn, peep) = rows();
        assert_eq!(sworn.shown_as(), ["jurardo", "prometerdo"]);
        assert_eq!(sworn.shown, ["jurar", "prometer"], "it is checked by these");
        assert_eq!(peep.in_form, None);
        assert_eq!(peep.shown_as(), ["asomarse"]);
        // What it had, it keeps.
        assert_eq!(sworn.verb_form, Some(VerbForm::PastParticiple));
        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 0);
        assert_eq!(stub.asked, Vec::<Vec<String>>::new());
    }

    #[test]
    fn a_verb_its_book_has_in_a_past_written_as_it_is_called_is_said_in_that_form() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let past = |lemma: &str, sentence: &str, translations: &[&str]| Word {
            part_of_speech: Some(PartOfSpeech::Verb),
            transitive: Some(true),
            verb_form: Some(VerbForm::Past),
            sentence: sentence.into(),
            ..word(lemma, translations, 1)
        };
        let list = [
            // A past spelled as its base form: no base was kept.
            past("set off", "At dawn he set off.", &["partir", "salir"]),
            // A past the model wrote as its lemma: no base either.
            past(
                "kicked",
                "He kicked the door.",
                &["patear", "dar una patada"],
            ),
            // Called by its base form: the book has it in other words.
            Word {
                part_of_speech: Some(PartOfSpeech::PhrasalVerb),
                forms: vec!["wipe away".into(), "wiped it away".into()],
                ..past("wipe away", "He wiped it away.", &["limpiar"])
            },
        ];
        let chapter = desk.chapter("b", &list);
        let waiting = words::unlabelled(&desk.db.lock().expect("db")).expect("unlabelled");
        let asked: Vec<(&str, &[String])> = waiting
            .iter()
            .map(|word| (word.lemma.as_str(), word.translations.as_slice()))
            .collect();
        assert_eq!(asked.len(), 2, "{asked:?}");
        assert!(asked
            .iter()
            .all(|(lemma, said)| *lemma != "wipe away" && said.len() == 2));

        let mut stub = Stub::default();
        assert_eq!(label_all(desk.ctx(), &mut stub).expect("label"), 2);
        let conn = desk.db.lock().expect("db");
        let id = |key: &str| {
            words::id_by_key(&conn, &chapter, key)
                .expect("id")
                .expect("word")
        };
        let row = |key: &str| practice::word(&conn, &id(key)).expect("word");
        let (set_off, kicked, wipe) = (row("set off"), row("kicked"), row("wipe away"));
        assert_eq!(set_off.shown_as(), ["partirdo", "salirdo"]);
        assert_eq!(
            set_off.alone(),
            Some(&["partirdo".to_owned(), "salirdo".to_owned()][..])
        );
        assert_eq!(kicked.shown_as(), ["pateardo", "dar una patadado"]);
        assert_eq!(wipe.shown_as(), ["limpiar"]);
        assert_eq!(wipe.alone(), Some(&["limpiar".to_owned()][..]));
        let listed = words::list(&conn, &chapter).expect("list");
        let shown = |lemma: &str| {
            let word = listed
                .iter()
                .find(|word| word.lemma == lemma)
                .expect("listed");
            word.translations.clone()
        };
        assert_eq!(shown("kicked"), ["pateardo", "dar una patadado"]);
        assert_eq!(shown("wipe away"), ["limpiar"]);
    }

    #[test]
    fn a_word_taken_for_another_written_the_same_is_put_right_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let list = [
            Word {
                part_of_speech: Some(PartOfSpeech::Noun),
                transitive: Some(false),
                sentence: "All weekend he moped around the house.".into(),
                ..word("moped", &["ciclomotor", "moto pequeña"], 1)
            },
            Word {
                part_of_speech: Some(PartOfSpeech::Noun),
                transitive: Some(false),
                ..word("hedge", &["seto"], 2)
            },
        ];
        let chapter = desk.chapter("b", &list);
        let sentences = "SELECT COUNT(*) FROM word_sentences WHERE key = 'moped'";
        let hedges = "SELECT COUNT(*) FROM word_sentences WHERE key = 'hedge'";
        desk.db
            .lock()
            .expect("db")
            .execute_batch(
                "INSERT INTO word_sentences (id, key, source, sentence, form, hint, translation,
                                             created_at)
                 VALUES ('s', 'moped', 'model', 'He rode a moped.', 'moped', 'ciclomotor',
                         'Iba en ciclomotor.', '2026-01-01'),
                        ('h', 'hedge', 'model', 'A tall hedge.', 'hedge', 'seto',
                         'Un seto alto.', '2026-01-01')",
            )
            .expect("sentence");

        let mut stub = Stub::default();
        assert_eq!(check_all(desk.ctx(), &mut stub).expect("check"), 1);
        assert_eq!(stub.looked, [["hedge", "moped"]]);
        let row = |key: &str| {
            let conn = desk.db.lock().expect("db");
            let id = words::id_by_key(&conn, &chapter, key)
                .expect("id")
                .expect("word");
            practice::word(&conn, &id).expect("word")
        };
        let moped = row("moped");
        assert_eq!(moped.lemma, "moped", "called as before");
        // "hedge" was said not to fit, in the same kind and with its own
        // translations: it is the same word, and stays as it was.
        assert_eq!(desk.count(hedges), 1);
        assert_eq!(moped.base.as_deref(), Some("mope"));
        assert_eq!(moped.part_of_speech, Some(PartOfSpeech::Verb));
        assert_eq!(moped.verb_form, Some(VerbForm::Past));
        assert_eq!(moped.translations, ["andar deprimido"]);
        assert_eq!(desk.count(sentences), 0, "they glossed the noun");
        assert_eq!(row("hedge").translations, ["seto"]);

        // Each is looked at once.
        let mut again = Stub::default();
        assert_eq!(check_all(desk.ctx(), &mut again).expect("check"), 0);
        assert_eq!(again.looked, Vec::<Vec<String>>::new());

        // Its translations are then said in its form.
        assert_eq!(label_all(desk.ctx(), &mut again).expect("label"), 1);
        assert_eq!(again.asked, [["moped"]]);
        assert_eq!(row("moped").shown_as(), ["andar deprimidodo"]);
    }

    #[test]
    fn a_past_kept_as_the_model_wrote_it_is_only_given_its_base_form() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let list = [Word {
            part_of_speech: Some(PartOfSpeech::Verb),
            transitive: Some(true),
            verb_form: Some(VerbForm::Past),
            sentence: "He kicked the door.".into(),
            ..word("kicked", &["patear"], 1)
        }];
        let chapter = desk.chapter("b", &list);
        let mut stub = Stub::default();
        assert_eq!(check_all(desk.ctx(), &mut stub).expect("check"), 1);
        let conn = desk.db.lock().expect("db");
        let id = words::id_by_key(&conn, &chapter, "kicked")
            .expect("id")
            .expect("word");
        let kicked = practice::word(&conn, &id).expect("word");
        assert_eq!(kicked.base.as_deref(), Some("kick"));
        assert_eq!(kicked.translations, ["patear"], "its own, not the model's");
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
