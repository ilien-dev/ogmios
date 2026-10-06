//! "I was right": a missed answer the learner stands by is put to the model,
//! which only says whether it is a right translation. What that changes is
//! decided here: an upheld answer becomes a correct one, which undoes the
//! miss and gives back the run it broke, and is accepted from then on without
//! asking again.

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use tauri::AppHandle;

use super::practice::{blanked, english, judged, step, Meaning};
use super::profile::{agent, require_profile};
use super::run;
use crate::agent::protocol::{VocabJudgeParams, VocabVerdict};
use crate::books::practice::{
    accepts, accepts_english, accepts_native, articles, inflects, off_base,
};
use crate::books::sentences::{or_other, Verdict};
use crate::db::practice::{self, AnswerRow};
use crate::db::{profile, sentences};
use crate::domain::{Direction, DisputeResult};
use crate::error::{Error, Result};
use crate::Ctx;

/// The answer, if it can be disputed: a miss the learner typed in a sitting
/// of "Practice", not judged before. "I don't know" is no answer to stand
/// by, and the refresh before reading does not offer it: what comes next
/// here is a step of practice. Nor is another form of the word, native →
/// English, when its sentence was blanked: code already said it does not
/// fill the blank, and the model, which takes any form of the word for
/// right, is not asked to say otherwise. Nor is another English word for
/// what was shown: the learner was told it is not the word asked for, and
/// the model, which takes a word that means the same for right, would make
/// it one. Nor, English → native, is a base translation given to a word
/// asked in a sentence: it was a miss only because the sentence has the
/// word in another form, and the model would take it for right. Nor a
/// translation of a verb asked on its own, in another form than its base
/// form: upheld, it would be accepted as it is from then on.
fn disputable(conn: &Connection, answer_id: i64) -> Result<AnswerRow> {
    let answer = practice::answer(conn, answer_id)?;
    if practice::sitting(conn, &answer.sitting_id)?.refresh {
        return Err(Error::Invalid(
            "an answer of a refresh is not disputed".into(),
        ));
    }
    if answer.disputed {
        return Err(Error::Invalid("this answer was already judged".into()));
    }
    if answer.correct || answer.answer.is_empty() {
        return Err(Error::Invalid(
            "this answer is not a miss to dispute".into(),
        ));
    }
    if answer.direction == Direction::Recognition && answer.sentence_id.is_some() {
        let word = practice::word(conn, &answer.word_id)?;
        let native_lang = require_profile(conn)?.native_lang;
        let spelling = profile::spelling(conn)?;
        if accepts(
            &answer.answer,
            &word.shown,
            articles(&native_lang),
            spelling,
        ) {
            return Err(Error::Invalid(
                "the base translation is not the form the sentence has".into(),
            ));
        }
        let id = answer.sentence_id.as_deref().unwrap_or_default();
        if let Some(sentence) = sentences::usable(conn, id)? {
            let judged = judged(
                conn,
                &Meaning::of(conn, &word)?,
                &sentence,
                (answer.direction, &answer.answer),
                (&native_lang, spelling),
            )?;
            if judged.verdict == Verdict::WrongForm {
                return Err(Error::Invalid(
                    "another form of the word is not the form the sentence has".into(),
                ));
            }
        }
    }
    if answer.direction == Direction::Recognition && answer.sentence_id.is_none() {
        let word = practice::word(conn, &answer.word_id)?;
        let native_lang = require_profile(conn)?.native_lang;
        let spelling = profile::spelling(conn)?;
        let native = (native_lang.as_str(), inflects(word.part_of_speech));
        let asked = (native_lang.as_str(), word.part_of_speech);
        if accepts_native(&answer.answer, &word.translations, native, spelling)
            && off_base(&answer.answer, &word.translations, asked, spelling)
        {
            return Err(Error::Invalid(
                "another form of the translation is not its base form".into(),
            ));
        }
    }
    if answer.direction == Direction::Production {
        let word = practice::word(conn, &answer.word_id)?;
        let spelling = profile::spelling(conn)?;
        // Asked with a sentence of its bank the word is always blanked, and
        // the forms its other sentences have it in are forms of it too.
        let in_sentence = answer.sentence_id.is_some();
        let mut forms = english(&word);
        if in_sentence {
            forms.extend(sentences::forms(conn, &word.key)?);
        }
        // So is a verb shown in the form it is called by: that form is
        // what was asked for.
        let in_form = in_sentence || !blanked(&word).is_empty() || word.in_form.is_some();
        if in_form && accepts_english(&answer.answer, &word.lemma, &forms, spelling) {
            return Err(Error::Invalid(
                "another form of the word does not fill the blank".into(),
            ));
        }
        let mut rivals = sentences::rivals(conn, &word.key, &word.shown)?;
        if let Some(id) = answer.sentence_id.as_deref() {
            rivals.extend(sentences::also(conn, id)?);
        }
        if or_other(Verdict::Miss, &answer.answer, &rivals, spelling) == Verdict::OtherWord {
            return Err(Error::Invalid(
                "another word for what was shown is not the word asked for".into(),
            ));
        }
    }
    Ok(answer)
}

/// The first line of what the model wrote, without the space around it.
fn one_line(reason: &str) -> &str {
    reason
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
}

/// Puts one missed answer to `judge` and keeps the verdict. The database is
/// not held while the model is asked, and the sitting does not wait either:
/// whatever was answered meanwhile stands, and so does a word marked as known
/// or finished since. A failed request keeps nothing, so it can be asked
/// again; a verdict is final.
pub fn dispute(
    ctx: Ctx<'_>,
    answer_id: i64,
    judge: &mut dyn FnMut(&VocabJudgeParams) -> Result<VocabVerdict>,
    now: DateTime<Utc>,
) -> Result<DisputeResult> {
    let params = {
        let conn = ctx.conn()?;
        let answer = disputable(&conn, answer_id)?;
        let word = practice::word(&conn, &answer.word_id)?;
        // The sentence the answer was given to, not the one of the chapter.
        let shown = answer
            .sentence_id
            .as_deref()
            .map(|id| sentences::text(&conn, id))
            .transpose()?
            .flatten();
        let (sentence, form) = match shown {
            Some((sentence, form)) => (sentence, Some(form)),
            None => (word.sentence, None),
        };
        // English → native the learner saw the form of the sentence, and
        // native → English only that form fills its blank.
        let (lemma, blank) = match (answer.direction, form) {
            (Direction::Recognition, Some(form)) => (form, None),
            (_, form) => (word.lemma, form),
        };
        VocabJudgeParams {
            native_lang: require_profile(&conn)?.native_lang,
            direction: answer.direction,
            lemma,
            sentence,
            blank,
            translations: word.translations,
            answer: answer.answer,
            strict_spelling: profile::spelling(&conn)?.is_strict(),
        }
    };
    let verdict = judge(&params)?;
    let reason = one_line(&verdict.reason);

    let mut conn = ctx.conn()?;
    let tx = conn.transaction()?;
    // Asked twice at once, the first verdict to arrive is the one kept.
    let answer = disputable(&tx, answer_id)?;
    practice::settle(&tx, &answer, (verdict.correct, reason), now)?;
    let step = step(&tx, &practice::sitting(&tx, &answer.sitting_id)?, now)?;
    tx.commit()?;
    Ok(DisputeResult {
        upheld: verdict.correct,
        reason: reason.to_owned(),
        step,
    })
}

#[tauri::command]
pub async fn dispute_answer(app: AppHandle, answer_id: i64) -> Result<DisputeResult> {
    run(app, move |_, ctx| {
        dispute(
            ctx,
            answer_id,
            &mut |params| agent(ctx)?.vocab_judge(params),
            Utc::now(),
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::books::practice::{is_open, owed, Answer};
    use crate::books::vocab::Word;
    use crate::commands::practice::tests::{bar, ended, item, owes, shown, t0, Desk};
    use crate::commands::practice::{answer, know};
    use crate::db::words;
    use crate::db::words::tests::word;
    use crate::domain::{Direction, PracticeItem};

    const THERE: Direction = Direction::Recognition;
    const BACK: Direction = Direction::Production;

    fn verdict(correct: bool, reason: &str) -> VocabVerdict {
        VocabVerdict {
            correct,
            reason: reason.into(),
        }
    }

    fn upheld() -> VocabVerdict {
        verdict(true, "Sí, también vale.")
    }

    fn rejected() -> VocabVerdict {
        verdict(false, "Eso es otro sentido de la palabra.")
    }

    fn unasked(_: &VocabJudgeParams) -> Result<VocabVerdict> {
        panic!("the model is not asked")
    }

    fn bank() -> Word {
        Word {
            needs_context: true,
            forms: vec!["bank".into(), "banks".into()],
            sentence: "She sat on the bank.".into(),
            ..word("bank", &["orilla", "la ribera"], 5)
        }
    }

    /// "bank" asked English → native, whichever word the sitting shows:
    /// which of its words comes first is drawn.
    fn asking_bank(desk: &Desk, chapter: &str) -> PracticeItem {
        let listed = words::list(&desk.db.lock().expect("db"), chapter).expect("list");
        PracticeItem {
            word_id: listed[0].id.clone(),
            direction: THERE,
            prompt: "bank".into(),
            part_of_speech: None,
            context: None,
            sentence_id: None,
            verb_form: None,
        }
    }

    /// (text, source) of every stored translation, in order.
    fn translations(desk: &Desk) -> Vec<(String, String)> {
        let conn = desk.db.lock().expect("db");
        let mut stmt = conn
            .prepare("SELECT text, source FROM word_translations ORDER BY rowid")
            .expect("translations");
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("rows");
        rows.collect::<rusqlite::Result<_>>().expect("rows")
    }

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter()
            .map(|(text, source)| ((*text).to_owned(), (*source).to_owned()))
            .collect()
    }

    /// The sentence of an item, piece by piece, as owned text.
    fn pieces(item: &PracticeItem) -> Vec<(String, bool)> {
        shown(item)
            .into_iter()
            .map(|(text, marked)| (text.to_owned(), marked))
            .collect()
    }

    #[test]
    fn an_upheld_dispute_undoes_the_miss_and_accepts_the_answer_from_then_on() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank(), word("peep", &["asomarse"], 1)]);
        let sitting = desk.start(&chapter, t0());
        let first = asking_bank(&desk, &chapter);
        let id = first.word_id.clone();

        let miss = desk.answer(&sitting, &first, " Margen ", t0());
        assert!(!miss.correct);
        assert_eq!(owes(&desk, &chapter, &id), [(THERE, 2)]);

        let mut asked = Vec::new();
        let result = dispute(
            desk.ctx(),
            miss.answer_id,
            &mut |params| {
                asked.push(params.clone());
                Ok(verdict(
                    true,
                    "\n  Sí, «margen» también vale aquí.  \nY algo más.",
                ))
            },
            t0(),
        )
        .expect("judged");
        assert_eq!(
            asked,
            [VocabJudgeParams {
                native_lang: "es".into(),
                direction: THERE,
                lemma: "bank".into(),
                sentence: "She sat on the bank.".into(),
                translations: vec!["orilla".into(), "la ribera".into()],
                answer: "Margen".into(),
                strict_spelling: false,
                blank: None,
            }]
        );
        assert!(result.upheld);
        assert_eq!(result.reason, "Sí, «margen» también vale aquí.", "one line");
        // As if the answer had been right: one in a row, and one to go.
        assert_eq!(owes(&desk, &chapter, &id), [(THERE, 1)]);
        assert_eq!(item(&result.step).prompt, "peep");

        // The answer is kept as one a dispute brought in.
        assert_eq!(
            translations(&desk),
            pairs(&[
                ("orilla", "extraction"),
                ("la ribera", "extraction"),
                ("asomarse", "extraction"),
                ("Margen", "dispute"),
            ])
        );
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_english"), 0);

        // It is accepted, not shown: not as what was asked for on a miss,
        // not in the native → English prompt, not in the word list.
        let other = desk.answer(&sitting, &first, "banco", t0());
        assert_eq!(other.accepted, ["orilla", "la ribera"]);
        assert_eq!(owes(&desk, &chapter, &id), [(THERE, 2)]);

        // Next time code accepts it: this desk has no sidecar to ask.
        for text in ["el margen", "Margen."] {
            assert!(desk.answer(&sitting, &first, text, t0()).correct, "{text}");
        }
        assert_eq!(owes(&desk, &chapter, &id), [(BACK, 2)]);
        let back = answer(desk.ctx(), &sitting.id, (&id, BACK), "bank", t0()).expect("back");
        assert!(back.correct);
        let mut step = back.step;
        while (item(&step).word_id.as_str(), item(&step).direction) != (id.as_str(), BACK) {
            let asked = item(&step).clone();
            step = desk.answer(&sitting, &asked, "x", t0()).step;
        }
        assert_eq!(item(&step).prompt, "orilla, la ribera");
        let listed = words::list(&desk.db.lock().expect("db"), &chapter).expect("list");
        assert_eq!(listed[0].translations, ["orilla", "la ribera"]);
    }

    #[test]
    fn an_upheld_dispute_on_the_miss_after_a_right_answer_finishes_the_direction() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank(), word("peep", &["asomarse"], 1)]);
        let sitting = desk.start(&chapter, t0());
        let first = asking_bank(&desk, &chapter);
        let id = first.word_id.clone();

        // Right, then a miss: the run is gone and the other way is closed.
        assert!(desk.answer(&sitting, &first, "orilla", t0()).correct);
        let miss = desk.answer(&sitting, &first, "margen", t0());
        assert!(!miss.correct);
        assert_eq!(owes(&desk, &chapter, &id), [(THERE, 2)]);

        // Upheld, the two answers are two in a row: that way is finished and
        // the other one opens.
        let result =
            dispute(desk.ctx(), miss.answer_id, &mut |_| Ok(upheld()), t0()).expect("judged");
        assert!(result.upheld);
        assert_eq!(owes(&desk, &chapter, &id), [(BACK, 2)]);
        let stale = answer(desk.ctx(), &sitting.id, (&id, THERE), "orilla", t0());
        assert_eq!(stale.expect_err("finished").kind(), "invalid");
    }

    #[test]
    fn an_upheld_dispute_gives_the_bar_back_the_step_the_miss_took() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank(), word("peep", &["asomarse"], 1)]);
        let sitting = desk.start(&chapter, t0());
        let first = asking_bank(&desk, &chapter);
        let say = |text: &str| desk.answer(&sitting, &first, text, t0());

        // A rejected one leaves the bar where the miss left it.
        assert_eq!(bar(&say("orilla").step), (1, 8));
        let miss = say("banco");
        assert_eq!(bar(&miss.step), (0, 8), "the miss took the step");
        let result =
            dispute(desk.ctx(), miss.answer_id, &mut |_| Ok(rejected()), t0()).expect("judged");
        assert_eq!(bar(&result.step), (0, 8));

        // An upheld one is the answer having been right: the step the miss
        // took is back, with the one the answer was worth.
        assert_eq!(bar(&say("ribera").step), (1, 8));
        let miss = say("margen");
        assert_eq!(bar(&miss.step), (0, 8));
        let result =
            dispute(desk.ctx(), miss.answer_id, &mut |_| Ok(upheld()), t0()).expect("judged");
        assert!(result.upheld);
        assert_eq!(bar(&result.step), (2, 8));
    }

    #[test]
    fn a_rejected_dispute_changes_nothing_and_an_answer_is_judged_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank(), word("peep", &["asomarse"], 1)]);
        let sitting = desk.start(&chapter, t0());
        let first = asking_bank(&desk, &chapter);
        let id = first.word_id.clone();
        let miss = desk.answer(&sitting, &first, "banco", t0());
        let before = translations(&desk);

        let result =
            dispute(desk.ctx(), miss.answer_id, &mut |_| Ok(rejected()), t0()).expect("judged");
        assert!(!result.upheld);
        assert_eq!(result.reason, "Eso es otro sentido de la palabra.");
        assert_eq!(result.step, miss.step, "the sitting goes on as it was");
        assert_eq!(owes(&desk, &chapter, &id), [(THERE, 2)]);
        assert_eq!(translations(&desk), before);
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM word_answers WHERE correct"),
            0
        );
        assert!(!desk.answer(&sitting, &first, "banco", t0()).correct);

        // A verdict is final, whichever it was.
        let again = dispute(desk.ctx(), miss.answer_id, &mut unasked, t0()).expect_err("once");
        assert_eq!(again.kind(), "invalid");
        let second = desk.answer(&sitting, &first, "margen", t0());
        dispute(desk.ctx(), second.answer_id, &mut |_| Ok(upheld()), t0()).expect("upheld");
        let again = dispute(desk.ctx(), second.answer_id, &mut unasked, t0()).expect_err("once");
        assert_eq!(again.kind(), "invalid");
        assert_eq!(desk.count("SELECT COUNT(*) FROM answer_disputes"), 2);
    }

    #[test]
    fn only_a_typed_miss_can_be_disputed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank()]);
        let sitting = desk.start(&chapter, t0());
        let first = item(&sitting.step).clone();

        let unknown = desk.answer(&sitting, &first, "  ", t0());
        let right = desk.answer(&sitting, &first, "orilla", t0());
        for (answer_id, kind) in [
            (unknown.answer_id, "invalid"),
            (right.answer_id, "invalid"),
            (right.answer_id + 1, "notFound"),
        ] {
            let refused = dispute(desk.ctx(), answer_id, &mut unasked, t0()).expect_err("refused");
            assert_eq!(refused.kind(), kind);
        }
        assert_eq!(desk.count("SELECT COUNT(*) FROM answer_disputes"), 0);
    }

    #[test]
    fn a_verdict_that_arrives_after_later_answers_still_undoes_exactly_the_miss() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank(), word("peep", &["asomarse"], 1)]);
        let sitting = desk.start(&chapter, t0());
        let first = asking_bank(&desk, &chapter);
        let id = first.word_id.clone();
        let miss = desk.answer(&sitting, &first, "margen", t0());

        // The sitting does not wait: while the model thinks, the word is
        // answered right once, enough to finish that way had the first
        // answer counted, and then missed.
        let result = dispute(
            desk.ctx(),
            miss.answer_id,
            &mut |_| {
                for text in ["orilla", "banco"] {
                    desk.answer(&sitting, &first, text, t0());
                }
                assert_eq!(owes(&desk, &chapter, &id), [(THERE, 2)]);
                Ok(upheld())
            },
            t0(),
        )
        .expect("judged");
        assert!(result.upheld);

        let right = Answer {
            direction: THERE,
            correct: true,
            refresh: false,
        };
        let wrong = Answer {
            correct: false,
            ..right
        };
        // The later miss stands, so that way owes again; but it was
        // finished before it, and the other way is open for good.
        let as_if = [right, right, wrong];
        assert_eq!(owed(THERE, &as_if), 2, "finished after two, then missed");
        assert!(is_open(BACK, &as_if));
        assert_eq!(owes(&desk, &chapter, &id), [(THERE, 2), (BACK, 2)]);
    }

    #[test]
    fn an_upheld_dispute_can_finish_the_word_and_the_step_no_longer_asks_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank()]);
        let sitting = desk.start(&chapter, t0());
        let first = item(&sitting.step).clone();
        let id = first.word_id.clone();
        for text in ["orilla", "ribera"] {
            assert!(desk.answer(&sitting, &first, text, t0()).correct);
        }
        let say =
            |text: &str| answer(desk.ctx(), &sitting.id, (&id, BACK), text, t0()).expect("back");
        assert!(say("bank").correct);
        // One answer from done, and it is a miss: alone, the word comes back.
        let miss = say("shore");
        assert!(!miss.correct);
        let again = item(&miss.step);
        assert_eq!((again.word_id.as_str(), again.direction), (&id[..], BACK));
        assert_eq!(owes(&desk, &chapter, &id), [(BACK, 2)]);

        let later = t0() + chrono::TimeDelta::seconds(30);
        let result =
            dispute(desk.ctx(), miss.answer_id, &mut |_| Ok(upheld()), later).expect("judged");
        assert_eq!(result.step, ended(1, 0, 1));
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL"),
            1
        );
        // The item the miss left on the screen is not asked any more.
        let stale = answer(desk.ctx(), &sitting.id, (&id, BACK), "bank", later);
        assert_eq!(stale.expect_err("finished").kind(), "invalid");
    }

    #[test]
    fn a_word_marked_known_after_the_miss_is_still_settled_without_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank(), word("peep", &["asomarse"], 1)]);
        let sitting = desk.start(&chapter, t0());
        let first = asking_bank(&desk, &chapter);
        let miss = desk.answer(&sitting, &first, "margen", t0());

        let result = dispute(
            desk.ctx(),
            miss.answer_id,
            &mut |_| {
                know(desk.ctx(), &sitting.id, &first.word_id, t0()).expect("known");
                Ok(upheld())
            },
            t0(),
        )
        .expect("judged");
        assert!(result.upheld);
        assert_eq!(item(&result.step).prompt, "peep");
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM word_answers WHERE correct"),
            1
        );
        assert_eq!(
            desk.count("SELECT COUNT(*) FROM chapter_words WHERE done_at IS NOT NULL"),
            0
        );
        // Taken back, the word stands as if it had been answered right.
        words::set_known(&desk.db.lock().expect("db"), &first.word_id, false, t0()).expect("back");
        assert_eq!(owes(&desk, &chapter, &first.word_id), [(THERE, 1)]);
    }

    #[test]
    fn an_upheld_english_answer_is_accepted_native_to_english_and_nowhere_else() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let run = Word {
            needs_context: true,
            forms: vec!["run".into(), "ran".into()],
            sentence: "He ran, and would sprint again.".into(),
            ..word("run", &["correr", "huir"], 9)
        };
        let chapter = desk.chapter("b", &[run]);
        let sitting = desk.start(&chapter, t0());
        let first = item(&sitting.step).clone();
        let id = first.word_id.clone();
        let say = |direction: Direction, text: &str| {
            answer(desk.ctx(), &sitting.id, (&id, direction), text, t0()).expect("answer")
        };
        assert!(say(THERE, "correr").correct);
        let asked = item(&say(THERE, "huir").step).clone();
        assert_eq!(asked.direction, BACK);
        let blanked = pieces(&asked);
        let before = translations(&desk);

        // The base form does not fill the blank, and that is not put to the
        // model: it would take any form of the word for right.
        let base = say(BACK, "to run");
        assert!(!base.correct);
        let refused = dispute(desk.ctx(), base.answer_id, &mut unasked, t0());
        assert_eq!(
            refused.expect_err("not a miss to dispute").kind(),
            "invalid"
        );
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_english"), 0);

        let miss = say(BACK, "Sprint");
        assert!(!miss.correct);
        assert_eq!(owes(&desk, &chapter, &id), [(BACK, 2)]);
        let mut judged = Vec::new();
        let result = dispute(
            desk.ctx(),
            miss.answer_id,
            &mut |params| {
                judged.push((params.direction, params.answer.clone()));
                assert_eq!(params.translations, ["correr", "huir"]);
                Ok(upheld())
            },
            t0(),
        )
        .expect("judged");
        assert!(result.upheld);
        assert_eq!(judged, [(BACK, "Sprint".to_owned())]);
        assert_eq!(owes(&desk, &chapter, &id), [(BACK, 1)]);

        // Kept as an English answer, never as a translation: it would be
        // shown in the prompt and accepted English → native, which is
        // checked against the translations alone.
        assert_eq!(translations(&desk), before);
        assert_eq!(desk.count("SELECT COUNT(*) FROM word_english"), 1);

        // Nor is it a form of the word: the sentence blanks what it blanked.
        let step = result.step;
        assert_eq!(item(&step).direction, BACK);
        assert_eq!(item(&step).prompt, "correr, huir");
        assert_eq!(pieces(item(&step)), blanked);
        assert!(blanked.contains(&(", and would sprint again.".to_owned(), false)));

        // From then on code accepts it, and here it finishes the word.
        assert!(say(BACK, "to sprint").correct);
        assert_eq!(owes(&desk, &chapter, &id), []);
    }

    #[test]
    fn a_failed_request_keeps_the_miss_and_can_be_asked_again() {
        let dir = tempfile::tempdir().expect("tempdir");
        let desk = Desk::new(&dir);
        let chapter = desk.chapter("b", &[bank()]);
        let sitting = desk.start(&chapter, t0());
        let first = item(&sitting.step).clone();
        let miss = desk.answer(&sitting, &first, "margen", t0());

        let failed = dispute(
            desk.ctx(),
            miss.answer_id,
            &mut |_| Err(Error::Provider("Claude took too long to answer".into())),
            t0(),
        )
        .expect_err("no verdict");
        assert_eq!(failed.kind(), "provider");
        assert_eq!(owes(&desk, &chapter, &first.word_id), [(THERE, 2)]);
        assert_eq!(desk.count("SELECT COUNT(*) FROM answer_disputes"), 0);

        // Asked twice at once, the verdict that arrives first is the one kept.
        let late = dispute(
            desk.ctx(),
            miss.answer_id,
            &mut |_| {
                dispute(desk.ctx(), miss.answer_id, &mut |_| Ok(upheld()), t0()).expect("first");
                Ok(rejected())
            },
            t0(),
        )
        .expect_err("already judged");
        assert_eq!(late.kind(), "invalid");
        assert_eq!(desk.count("SELECT COUNT(*) FROM answer_disputes"), 1);
        assert_eq!(owes(&desk, &chapter, &first.word_id), [(THERE, 1)]);
    }
}
