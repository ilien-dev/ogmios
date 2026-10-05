//! When a learned word comes back, and how strong it is: the daily recall.
//!
//! A word is learned once, in a chapter or by asking for it in a
//! conversation. From then on it stands on a step, read off what happened to
//! it since, oldest first ([`standing`]): a right answer of the recall takes
//! it one up, a miss one down, and using it in a conversation, which no
//! exercise can stand in for, [`USE_STEPS`] up. The step says how many days
//! pass before it is asked again, and how strong it is. Nothing here touches
//! the database or the clock.

use chrono::{DateTime, Duration, Utc};

use crate::books::vocab::tokens;
use crate::domain::{Direction, Strength, Ways};

/// Days until a word comes back, by its step; the last one from then on.
pub const DAYS: [i64; 5] = [1, 3, 7, 21, 60];
/// The same for a word that keeps slipping ([`is_stubborn`]): it is seen
/// more often.
pub const STUBBORN_DAYS: [i64; 5] = [1, 2, 4, 10, 30];
/// Misses, in practice and in the recall together, that make a word one
/// that keeps slipping.
pub const STUBBORN_MISSES: u32 = 3;
/// Steps a word goes up when the learner uses it in a conversation.
pub const USE_STEPS: u32 = 2;
/// The step a word is settling from: it has come back once and held.
pub const SETTLING_STEP: u32 = 1;
/// The step a word is firm from: it held after three weeks away.
pub const FIRM_STEP: u32 = 4;
/// Words a run of the recall asks at most.
pub const SIZE: usize = 10;
/// Learned words the partner is given to use in a conversation.
pub const CHAT_WORDS: usize = 5;

/// What happened to a learned word.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    /// Answered right in the recall.
    Right,
    /// Missed in the recall.
    Miss,
    /// Used by the learner in a conversation.
    Used,
}

impl Mark {
    pub fn as_str(self) -> &'static str {
        match self {
            Mark::Right => "right",
            Mark::Miss => "miss",
            Mark::Used => "used",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "right" => Mark::Right,
            "miss" => Mark::Miss,
            "used" => Mark::Used,
            _ => return None,
        })
    }
}

/// One thing that happened to a word, and when.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Event {
    pub mark: Mark,
    pub at: DateTime<Utc>,
}

/// How a word stands: its step, and when it is due again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Standing {
    pub step: u32,
    pub due_at: DateTime<Utc>,
}

/// Whether a word keeps slipping: missed [`STUBBORN_MISSES`] times, the
/// misses of practice and those among `events` together.
pub fn is_stubborn(practice_misses: u32, events: &[Event]) -> bool {
    let recalled = events
        .iter()
        .filter(|event| event.mark == Mark::Miss)
        .count();
    let recalled = u32::try_from(recalled).unwrap_or(u32::MAX);
    practice_misses.saturating_add(recalled) >= STUBBORN_MISSES
}

/// Where a word learned at `learned_at` stands after `events`, oldest
/// first. It is due the days of its step after the last thing that happened
/// to it, or after it was learned; a `stubborn` one sooner.
pub fn standing(learned_at: DateTime<Utc>, events: &[Event], stubborn: bool) -> Standing {
    let step = events.iter().fold(0_u32, |step, event| match event.mark {
        Mark::Right => step.saturating_add(1),
        Mark::Miss => step.saturating_sub(1),
        Mark::Used => step.saturating_add(USE_STEPS),
    });
    let days = if stubborn { STUBBORN_DAYS } else { DAYS };
    let at = usize::try_from(step).map_or(days.len() - 1, |step| step.min(days.len() - 1));
    let last = events.last().map_or(learned_at, |event| event.at);
    Standing {
        step,
        due_at: last + Duration::days(days[at]),
    }
}

/// How strong a word on this step is.
pub fn strength(step: u32) -> Strength {
    if step >= FIRM_STEP {
        Strength::Firm
    } else if step >= SETTLING_STEP {
        Strength::Settling
    } else {
        Strength::New
    }
}

/// Which way a word on this step is asked in a run of these `ways`: the one
/// way of a run of one, and by turns in a run of both, so that a word is
/// not always met from the same side.
pub fn direction(step: u32, ways: Ways) -> Direction {
    match ways {
        Ways::Recognition => Direction::Recognition,
        Ways::Both if step.is_multiple_of(2) => Direction::Recognition,
        Ways::Production | Ways::Both => Direction::Production,
    }
}

/// Whether a run of words is in a text, both cut into tokens
/// (`books::vocab::tokens`).
fn has(text: &[String], run: &[String]) -> bool {
    !run.is_empty() && text.windows(run.len()).any(|window| window == run)
}

/// Whether the learner used a word in a conversation of their own accord:
/// one of their turns has one of its `forms`, and the partner's turn just
/// before it does not. Saying back what was just heard is no proof of
/// knowing it. Each turn is whether it is the learner's, and its tokens.
pub fn is_used(forms: &[String], turns: &[(bool, Vec<String>)]) -> bool {
    let forms: Vec<Vec<String>> = forms.iter().map(|form| tokens(form)).collect();
    let said = |text: &[String]| forms.iter().any(|form| has(text, form));
    turns.iter().enumerate().any(|(at, (learner, text))| {
        let heard = at
            .checked_sub(1)
            .and_then(|before| turns.get(before))
            .is_some_and(|(theirs, before)| !theirs && said(before));
        *learner && said(text) && !heard
    })
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use Mark::{Miss, Right, Used};

    fn day(n: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0)
            .single()
            .expect("valid date")
            + Duration::days(n)
    }

    fn ev(mark: Mark, at: i64) -> Event {
        Event { mark, at: day(at) }
    }

    fn stands(events: &[Event]) -> (u32, DateTime<Utc>) {
        let standing = standing(day(0), events, false);
        (standing.step, standing.due_at)
    }

    #[test]
    fn a_word_just_learned_is_due_the_next_day() {
        assert_eq!(stands(&[]), (0, day(1)));
    }

    #[test]
    fn each_right_answer_takes_it_a_step_up_and_further_away() {
        assert_eq!(stands(&[ev(Right, 1)]), (1, day(4)));
        assert_eq!(stands(&[ev(Right, 1), ev(Right, 4)]), (2, day(11)));
        assert_eq!(
            stands(&[ev(Right, 1), ev(Right, 4), ev(Right, 11)]),
            (3, day(32))
        );
    }

    #[test]
    fn a_miss_takes_it_one_step_down_never_below_the_first() {
        assert_eq!(
            stands(&[ev(Right, 1), ev(Right, 4), ev(Miss, 11)]),
            (1, day(14))
        );
        assert_eq!(stands(&[ev(Miss, 1), ev(Miss, 2)]), (0, day(3)));
    }

    #[test]
    fn past_the_last_step_it_keeps_the_longest_wait() {
        let events: Vec<Event> = (0..8).map(|n| ev(Right, n * 100)).collect();
        assert_eq!(stands(&events), (8, day(760)));
    }

    #[test]
    fn using_it_in_a_conversation_counts_twice() {
        assert_eq!(stands(&[ev(Used, 2)]), (2, day(9)));
    }

    #[test]
    fn it_is_due_from_the_last_thing_that_happened_to_it() {
        // Answered late: the wait starts at the answer, not at the due day.
        assert_eq!(stands(&[ev(Right, 30)]), (1, day(33)));
    }

    #[test]
    fn a_word_that_keeps_slipping_comes_back_sooner() {
        let events = [ev(Right, 1), ev(Right, 4)];
        assert_eq!(standing(day(0), &events, true).due_at, day(8));
    }

    #[test]
    fn three_misses_in_all_make_a_word_one_that_keeps_slipping() {
        assert!(!is_stubborn(2, &[ev(Right, 1)]));
        assert!(is_stubborn(3, &[]));
        assert!(is_stubborn(1, &[ev(Miss, 1), ev(Right, 2), ev(Miss, 5)]));
        // Using it is no miss.
        assert!(!is_stubborn(2, &[ev(Used, 1)]));
    }

    #[test]
    fn strength_is_read_off_the_step() {
        let strengths: Vec<Strength> = (0..=5).map(strength).collect();
        assert_eq!(
            strengths,
            [
                Strength::New,
                Strength::Settling,
                Strength::Settling,
                Strength::Settling,
                Strength::Firm,
                Strength::Firm
            ]
        );
    }

    #[test]
    fn a_run_of_both_ways_asks_a_word_by_turns() {
        assert_eq!(direction(0, Ways::Both), Direction::Recognition);
        assert_eq!(direction(1, Ways::Both), Direction::Production);
        assert_eq!(direction(2, Ways::Both), Direction::Recognition);
        assert_eq!(direction(1, Ways::Recognition), Direction::Recognition);
        assert_eq!(direction(0, Ways::Production), Direction::Production);
    }

    fn talk(turns: &[(bool, &str)]) -> Vec<(bool, Vec<String>)> {
        turns
            .iter()
            .map(|(learner, text)| (*learner, tokens(text)))
            .collect()
    }

    #[test]
    fn a_word_is_used_when_the_learner_says_it_unprompted() {
        let forms = ["stir".to_owned(), "stirred".to_owned()];
        let used = |turns: &[(bool, &str)]| is_used(&forms, &talk(turns));
        assert!(used(&[
            (false, "What did you cook?"),
            (true, "I Stirred the soup.")
        ]));
        // The partner's use is not the learner's.
        assert!(!used(&[(false, "Did you stir it?"), (true, "Yes, I did.")]));
        // Said back right after hearing it: no proof.
        assert!(!used(&[(false, "Did you stir it?"), (true, "I stir it.")]));
        // Heard earlier, said later of their own accord.
        assert!(used(&[
            (false, "Did you stir it?"),
            (true, "Yes."),
            (false, "And then?"),
            (true, "Then I stirred again.")
        ]));
        // Part of another word is not the word.
        assert!(!used(&[(true, "It was stirring.")]));
    }

    #[test]
    fn an_expression_is_used_only_whole() {
        let forms = ["give up".to_owned()];
        assert!(is_used(&forms, &talk(&[(true, "I never give up.")])));
        assert!(!is_used(&forms, &talk(&[(true, "I give it up.")])));
        assert!(!is_used(&[], &talk(&[(true, "Anything.")])));
    }

    #[test]
    fn marks_round_trip_as_text() {
        for mark in [Right, Miss, Used] {
            assert_eq!(Mark::parse(mark.as_str()), Some(mark));
        }
        assert_eq!(Mark::parse("other"), None);
    }
}
