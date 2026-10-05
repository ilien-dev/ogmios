//! The rules of translating a chapter. The model labels a paragraph with
//! notes, writes its version and sums an attempt up; where a note goes in
//! what the learner wrote, what a paragraph scores, how much of a summary
//! is kept and whether a version fits its paragraph is decided here.

use crate::agent::protocol;
use crate::books::spelling::{only_respells, Spelling};
use crate::books::vocab::key;
use crate::domain::{
    AttemptSummary, ParagraphReview, Repeated, ReviewMark, ReviewPart, ReviewWord, Severity,
};

/// The longest a written sentence may be, in characters.
pub const SENTENCE_CHARS: usize = 2000;
/// How much of a chapter is read for its brief, in characters.
pub const BRIEF_CHARS: usize = 60_000;
/// The best a paragraph scores, and the least: a score is never nothing.
pub const FULL_SCORE: u32 = 100;
const LEAST_SCORE: u32 = 1;
/// A summary keeps this many points and habits, and examples of a habit.
const SUMMARY_ITEMS: usize = 3;
/// How many notes of an attempt its summary is written from.
pub const SUMMARY_NOTES: usize = 150;

fn count(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

/// How many words a text has.
pub fn words(text: &str) -> u32 {
    count(text.split_whitespace().count())
}

fn tidy(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Whether a version has a sentence for each one of its paragraph: the
/// marker moves over both together.
pub fn fits(version: &[String], sentences: usize) -> bool {
    version.len() == sentences && version.iter().all(|sentence| !sentence.trim().is_empty())
}

/// Where a fragment is in a sentence, clear of the marks already placed:
/// its first occurrence that overlaps none of them.
fn place(sentence: &str, fragment: &str, placed: &[(usize, usize, usize)]) -> Option<usize> {
    sentence
        .match_indices(fragment)
        .map(|(start, _)| start)
        .find(|start| {
            let end = start + fragment.len();
            placed
                .iter()
                .all(|(from, to, _)| end <= *from || *start >= *to)
        })
}

/// The word a note asks to practise, if it names one with a translation.
fn word(note: &protocol::ParagraphNote, practised: &dyn Fn(&str) -> bool) -> Option<ReviewWord> {
    let named = note.word.as_ref()?;
    let english = tidy(&named.english).to_lowercase();
    let mut translations: Vec<String> = Vec::new();
    for translation in named.translations.iter().map(|each| tidy(each)) {
        if !translation.is_empty() && !translations.contains(&translation) {
            translations.push(translation);
        }
    }
    if key(&english).is_empty() || translations.is_empty() {
        return None;
    }
    Some(ReviewWord {
        in_practice: practised(&key(&english)),
        english,
        translations,
    })
}

/// Whether a note is only about how a word is spelled, and spelling is not
/// asked to count.
fn is_forgiven(note: &protocol::ParagraphNote, spelling: Spelling) -> bool {
    spelling == Spelling::Lenient
        && note.severity == Severity::Slip
        && only_respells(note.fragment.trim(), note.better.trim())
}

/// What a mark takes off a paragraph, in half words: an error counts every
/// word of its fragment, a slip half of each.
fn penalty(mark: &ReviewMark) -> u32 {
    let weight = match mark.severity {
        Severity::Error => 2,
        Severity::Slip => 1,
    };
    words(&mark.fragment).max(1) * weight
}

/// What a paragraph scores out of 100: the share of its words that are
/// right. It goes by how many words were written and how many are wrong,
/// and by nothing the model says about how good it is.
pub fn score(written: &[String], marks: &[ReviewMark]) -> u32 {
    let total = written.iter().map(|each| words(each)).sum::<u32>().max(1);
    let lost = marks.iter().map(penalty).sum::<u32>();
    let off = (FULL_SCORE * lost / (2 * total)).min(FULL_SCORE);
    (FULL_SCORE - off).max(LEAST_SCORE)
}

/// What several paragraphs score together: each one by its words.
pub fn overall(paragraphs: &[(u32, u32)]) -> Option<u32> {
    let total: u32 = paragraphs.iter().map(|(_, words)| (*words).max(1)).sum();
    let sum: u32 = paragraphs
        .iter()
        .map(|(score, words)| score * (*words).max(1))
        .sum();
    (total > 0).then(|| (sum / total).max(LEAST_SCORE))
}

/// The review of a paragraph as the learner sees it: what they wrote, cut
/// where the notes fall, and its score. A note is kept when its fragment is
/// in the sentence it names, word for word, clear of the notes before it,
/// and it says why; the others are dropped. Under lenient spelling so is a
/// slip that only respells its fragment: an accent, a typo. One that changes
/// a comma, a full stop or a capital stays. `practised` says whether the
/// chapter already asks a word, by its key.
pub fn shown(
    review: &protocol::ParagraphReview,
    written: &[String],
    practised: &dyn Fn(&str) -> bool,
    spelling: Spelling,
) -> ParagraphReview {
    let mut marks: Vec<ReviewMark> = Vec::new();
    let mut sentences = Vec::new();
    for (at, sentence) in written.iter().enumerate() {
        // (start, end, which note) of every mark of this sentence.
        let mut placed: Vec<(usize, usize, usize)> = Vec::new();
        for (which, note) in review.notes.iter().enumerate() {
            let fragment = note.fragment.trim();
            if usize::try_from(note.sentence).ok() != Some(at)
                || fragment.is_empty()
                || note.why.trim().is_empty()
                || is_forgiven(note, spelling)
            {
                continue;
            }
            if let Some(start) = place(sentence, fragment, &placed) {
                placed.push((start, start + fragment.len(), which));
            }
        }
        placed.sort_unstable();
        let mut parts = Vec::new();
        let mut from = 0;
        for (start, end, which) in placed {
            let note = &review.notes[which];
            if start > from {
                parts.push(ReviewPart {
                    text: sentence[from..start].to_owned(),
                    mark: None,
                });
            }
            parts.push(ReviewPart {
                text: sentence[start..end].to_owned(),
                mark: Some(count(marks.len())),
            });
            marks.push(ReviewMark {
                fragment: sentence[start..end].to_owned(),
                severity: note.severity,
                better: tidy(&note.better),
                why: tidy(&note.why),
                word: word(note, practised),
            });
            from = end;
        }
        if from < sentence.len() || parts.is_empty() {
            parts.push(ReviewPart {
                text: sentence[from..].to_owned(),
                mark: None,
            });
        }
        sentences.push(parts);
    }
    ParagraphReview {
        score: score(written, &marks),
        good: review
            .good
            .as_deref()
            .map(tidy)
            .filter(|good| !good.is_empty()),
        sentences,
        marks,
    }
}

fn kept(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .map(|line| tidy(line))
        .filter(|line| !line.is_empty())
        .take(SUMMARY_ITEMS)
        .collect()
}

/// The summary as the learner sees it: its first points and habits, and no
/// empty one.
pub fn summarised(summary: &protocol::AttemptSummary) -> AttemptSummary {
    AttemptSummary {
        points: kept(&summary.points),
        habits: summary
            .habits
            .iter()
            .map(|each| Repeated {
                habit: tidy(&each.habit),
                advice: tidy(&each.advice),
                examples: kept(&each.examples),
            })
            .filter(|each| !each.habit.is_empty() && !each.advice.is_empty())
            .take(SUMMARY_ITEMS)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::protocol::{NoteWord, ParagraphNote, SummaryHabit};

    fn note(sentence: u32, fragment: &str, severity: Severity) -> ParagraphNote {
        ParagraphNote {
            sentence,
            fragment: fragment.into(),
            severity,
            better: format!(" mejor  {fragment} "),
            why: " porque sí ".into(),
            word: None,
        }
    }

    fn written() -> Vec<String> {
        vec![
            "El niño despertó antes de las sirenas.".to_owned(),
            "Se quedó quieto y conto las grietas; el niño miró.".to_owned(),
        ]
    }

    fn unasked(_: &str) -> bool {
        false
    }

    /// The text of every part of a sentence, the marked ones in brackets.
    fn drawn(parts: &[ReviewPart]) -> String {
        parts
            .iter()
            .map(|part| match part.mark {
                Some(which) => format!("[{}:{}]", which, part.text),
                None => part.text.clone(),
            })
            .collect()
    }

    #[test]
    fn notes_are_placed_in_what_the_learner_wrote_in_reading_order() {
        let review = protocol::ParagraphReview {
            good: Some("  Buen ritmo.  ".into()),
            notes: vec![
                note(1, "conto", Severity::Slip),
                note(0, "antes de las sirenas", Severity::Error),
                note(1, "el niño", Severity::Error),
                note(0, "niño", Severity::Error),
                note(0, "no such words", Severity::Error),
                note(7, "niño", Severity::Error),
                note(0, " ", Severity::Error),
                // Over a mark already placed: it has nowhere to go.
                note(0, "las sirenas", Severity::Slip),
            ],
        };
        let seen = shown(&review, &written(), &unasked, Spelling::Strict);
        assert_eq!(seen.good.as_deref(), Some("Buen ritmo."));
        assert_eq!(
            seen.sentences.iter().map(|s| drawn(s)).collect::<Vec<_>>(),
            [
                "El [0:niño] despertó [1:antes de las sirenas].",
                "Se quedó quieto y [2:conto] las grietas; [3:el niño] miró.",
            ]
        );
        let marks: Vec<_> = seen
            .marks
            .iter()
            .map(|mark| (mark.fragment.as_str(), mark.severity))
            .collect();
        assert_eq!(
            marks,
            [
                ("niño", Severity::Error),
                ("antes de las sirenas", Severity::Error),
                ("conto", Severity::Slip),
                ("el niño", Severity::Error),
            ]
        );
        assert_eq!(seen.marks[0].better, "mejor niño");
        assert_eq!(seen.marks[0].why, "porque sí");
        // 17 words; 1 + 4 + 2 wrong and half of one: 7.5 of 17 lost.
        assert_eq!(seen.score, 56);
    }

    #[test]
    fn a_note_without_a_reason_is_dropped_and_a_right_paragraph_scores_full() {
        let silent = ParagraphNote {
            why: "  ".into(),
            ..note(0, "niño", Severity::Error)
        };
        let review = protocol::ParagraphReview {
            good: Some(" ".into()),
            notes: vec![silent],
        };
        let seen = shown(&review, &written(), &unasked, Spelling::Strict);
        assert_eq!((seen.score, seen.good, seen.marks.len()), (100, None, 0));
        assert_eq!(drawn(&seen.sentences[0]), written()[0]);
    }

    #[test]
    fn a_slip_of_spelling_is_dropped_unless_spelling_is_strict() {
        let slip = |fragment: &str, better: &str| ParagraphNote {
            better: better.into(),
            ..note(1, fragment, Severity::Slip)
        };
        let review = protocol::ParagraphReview {
            good: None,
            notes: vec![
                slip("conto", "contó"),
                // A missing comma is not spelling, and neither is an error.
                slip("quieto", "quieto,"),
                ParagraphNote {
                    better: "miro".into(),
                    ..note(1, "miró", Severity::Error)
                },
            ],
        };
        let fragments = |spelling| -> Vec<String> {
            shown(&review, &written(), &unasked, spelling)
                .marks
                .into_iter()
                .map(|mark| mark.fragment)
                .collect()
        };
        assert_eq!(fragments(Spelling::Lenient), ["quieto", "miró"]);
        assert_eq!(fragments(Spelling::Strict), ["quieto", "conto", "miró"]);
        let score = |spelling| shown(&review, &written(), &unasked, spelling).score;
        assert!(score(Spelling::Lenient) > score(Spelling::Strict));
    }

    #[test]
    fn a_score_goes_by_the_words_written_and_the_words_wrong() {
        let mark = |fragment: &str, severity| ReviewMark {
            fragment: fragment.into(),
            severity,
            better: String::new(),
            why: String::new(),
            word: None,
        };
        let ten = vec!["uno dos tres cuatro cinco seis siete ocho nueve diez".to_owned()];
        assert_eq!(score(&ten, &[]), 100);
        assert_eq!(score(&ten, &[mark("uno", Severity::Error)]), 90);
        assert_eq!(score(&ten, &[mark("uno", Severity::Slip)]), 95);
        assert_eq!(score(&ten, &[mark("uno dos tres", Severity::Error)]), 70);
        let all = mark(&ten[0], Severity::Error);
        assert_eq!(score(&ten, std::slice::from_ref(&all)), 1, "never nothing");
        assert_eq!(score(&["uno".to_owned()], &[all]), 1, "never under it");

        // Together, each paragraph weighs what it has of words.
        assert_eq!(overall(&[(100, 30), (50, 10)]), Some(87));
        assert_eq!(overall(&[]), None);
    }

    #[test]
    fn a_note_about_a_word_offers_it_unless_the_chapter_asks_it_already() {
        let about = |english: &str, translations: &[&str]| ParagraphNote {
            word: Some(NoteWord {
                english: english.into(),
                translations: translations.iter().map(|t| (*t).to_owned()).collect(),
            }),
            ..note(0, "niño", Severity::Error)
        };
        let ask = |note: ParagraphNote, practised: &dyn Fn(&str) -> bool| {
            let review = protocol::ParagraphReview {
                good: None,
                notes: vec![note],
            };
            shown(&review, &written(), practised, Spelling::Strict).marks[0]
                .word
                .clone()
        };
        let stray = ask(
            about("  Stray  Dog ", &[" callejero ", "", "callejero"]),
            &unasked,
        );
        assert_eq!(
            stray,
            Some(ReviewWord {
                english: "stray dog".into(),
                translations: vec!["callejero".into()],
                in_practice: false,
            })
        );
        let asked = ask(about("to stray", &["vagar"]), &|key| key == "stray");
        assert_eq!(asked.map(|word| word.in_practice), Some(true));
        assert_eq!(ask(about("stray", &[" "]), &unasked), None);
        assert_eq!(ask(about(" ", &["vagar"]), &unasked), None);
    }

    #[test]
    fn a_summary_keeps_its_first_points_and_habits_and_no_empty_one() {
        let habit = |habit: &str, advice: &str| SummaryHabit {
            habit: habit.into(),
            advice: advice.into(),
            examples: vec![
                " uno ".into(),
                String::new(),
                "dos".into(),
                "tres".into(),
                "cuatro".into(),
            ],
        };
        let summary = summarised(&protocol::AttemptSummary {
            points: vec![
                " Uno. ".into(),
                " ".into(),
                "Dos.".into(),
                "Tres.".into(),
                "Cuatro.".into(),
            ],
            habits: vec![
                habit(" «trial» como juicio ", " Es  prueba. "),
                habit("", "sin nombre"),
                habit("sin consejo", " "),
            ],
        });
        assert_eq!(summary.points, ["Uno.", "Dos.", "Tres."]);
        assert_eq!(summary.habits.len(), 1);
        let kept = &summary.habits[0];
        assert_eq!(
            (kept.habit.as_str(), kept.advice.as_str()),
            ("«trial» como juicio", "Es prueba.")
        );
        assert_eq!(kept.examples, ["uno", "dos", "tres"]);
    }

    #[test]
    fn a_version_fits_with_a_sentence_for_each_of_the_paragraph() {
        let version = vec!["Uno.".to_owned(), "Dos.".to_owned()];
        assert!(fits(&version, 2));
        assert!(!fits(&version, 3));
        assert!(!fits(&["Uno.".to_owned(), " ".to_owned()], 2));
    }
}
