//! Phrases the partner is asked to use, taken from recorded speech rather
//! than from anyone's sense of what sounds natural (SPEC §16).
//!
//! `work.txt` holds what native speakers said in the ICSI Meeting Corpus
//! (CC BY 4.0, <https://groups.inf.ed.ac.uk/ami/icsi/>): each phrase comes from
//! eight speakers or more across twelve meetings or more, and is also heard at
//! least once per million words in The People's Speech (CC BY 4.0), which
//! keeps the lab's own jargon out. Fragments were removed by hand; nothing was
//! added.

use chrono::{DateTime, Utc};

use crate::domain::{Goal, Level, Variant};

const WORK: &str = include_str!("work.txt");

/// A few per session: the partner works them in, it does not recite a list.
pub const PER_SESSION: usize = 8;

/// A step with no factor in common with the list's length, so one session's
/// phrases are spread over the list and the next session's are other ones.
const STRIDE: usize = 7;

fn work() -> Vec<&'static str> {
    WORK.lines().filter(|line| !line.is_empty()).collect()
}

/// The phrases for one session, the same on each of its turns. The meetings
/// are American and their hedges are above a basic level, so anyone else gets
/// none; a goal other than work has no recorded evidence yet.
pub fn for_session(
    goal: Goal,
    level: Level,
    variant: Variant,
    started_at: DateTime<Utc>,
) -> Vec<String> {
    if goal != Goal::Work || level == Level::Basic || variant != Variant::Us {
        return Vec::new();
    }
    let all = work();
    let Ok(len) = u64::try_from(all.len()) else {
        return Vec::new();
    };
    if len == 0 {
        return Vec::new();
    }
    let Ok(start) = usize::try_from(started_at.timestamp().unsigned_abs() % len) else {
        return Vec::new();
    };
    (0..PER_SESSION.min(all.len()))
        .map(|i| all[(start + i * STRIDE) % all.len()].to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use chrono::TimeZone;

    use super::*;

    fn at(seconds: i64) -> DateTime<Utc> {
        Utc.timestamp_opt(seconds, 0).single().expect("time")
    }

    #[test]
    fn only_a_us_work_learner_above_basic_gets_phrases() {
        let now = at(1_700_000_000);
        assert_eq!(
            for_session(Goal::Work, Level::Intermediate, Variant::Us, now).len(),
            PER_SESSION
        );
        assert_eq!(
            for_session(Goal::Social, Level::Advanced, Variant::Us, now),
            Vec::<String>::new()
        );
        assert_eq!(
            for_session(Goal::Work, Level::Basic, Variant::Us, now),
            Vec::<String>::new()
        );
        assert_eq!(
            for_session(Goal::Work, Level::Advanced, Variant::Uk, now),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_session_keeps_its_phrases_and_the_next_one_gets_others() {
        let first = for_session(Goal::Work, Level::Advanced, Variant::Us, at(1_700_000_000));
        let again = for_session(Goal::Work, Level::Advanced, Variant::Us, at(1_700_000_000));
        let next = for_session(Goal::Work, Level::Advanced, Variant::Us, at(1_700_003_611));
        assert_eq!(first, again);
        assert_ne!(first, next);
        let distinct: HashSet<&String> = first.iter().collect();
        assert_eq!(distinct.len(), PER_SESSION);
    }

    #[test]
    fn the_list_is_short_phrases_with_no_repeats() {
        let all = work();
        assert!(all.len() > PER_SESSION * STRIDE);
        assert_ne!(all.len() % STRIDE, 0);
        let distinct: HashSet<&&str> = all.iter().collect();
        assert_eq!(distinct.len(), all.len());
        for phrase in all {
            let words = phrase.split(' ').count();
            assert!((2..=5).contains(&words), "{phrase}");
            assert_eq!(phrase.trim(), phrase);
        }
    }
}
