//! The penalty review: a word that keeps being missed is asked on its own,
//! over and over, until it is answered right every time in a row. These are
//! its rules; when one is due and where it stands is kept by
//! `db::penalty`, and asked by `commands::penalty`.
//!
//! - It is due once the word is missed [`STREAK`] times in a row, in either
//!   direction, "I don't know" included.
//! - It asks the word [`reps`] times each way, in an [`order`] drawn at
//!   random. A miss starts it over, in a new order, at the same rung.
//! - Every time it is due again it asks twice as many, up to [`TOP`].
//! - A rung is taken back by [`CLEAN`] clean sessions in a row, on
//!   different days: the word answered right the first time it is asked in
//!   a sitting, with no hint ([`after_clean`]). A miss starts that count
//!   over ([`after_slip`]).

use chrono::NaiveDate;

use super::practice::pick;
use crate::domain::Direction;

/// Misses in a row that make a penalty due.
pub const STREAK: u32 = 3;

/// The highest rung: its penalty asks 24 each way, and a penalty due on it
/// asks the same again.
pub const TOP: u32 = 4;

/// Clean sessions in a row that take a rung back.
pub const CLEAN: u32 = 2;

/// How many times a penalty on `rung` asks the word each way: 3, 6, 12, 24.
pub fn reps(rung: u32) -> u32 {
    3 << (rung.clamp(1, TOP) - 1)
}

/// The rung a penalty due on a word at `rung` is asked on: one higher, and
/// never past [`TOP`].
pub fn raised(rung: u32) -> u32 {
    (rung + 1).min(TOP)
}

/// The misses at the end of a word's answers, oldest first: how long the
/// streak it ends on is.
pub fn streak(correct: &[bool]) -> u32 {
    let misses = correct.iter().rev().take_while(|right| !**right).count();
    u32::try_from(misses).unwrap_or(u32::MAX)
}

/// Whether the order goes one way, the other, one way and so on: a pattern
/// the learner would come to expect.
fn alternates(order: &[Direction]) -> bool {
    order.windows(2).all(|pair| pair[0] != pair[1])
}

/// The order a penalty asks its word in: `reps` times English → native and
/// `reps` times native → English, shuffled from `seed`. The same seed is the
/// same order, so the screen reads the question it was showing. An order
/// that alternates is drawn again: it would be learned, not read.
pub fn order(seed: u64, reps: u32) -> Vec<Direction> {
    let each = usize::try_from(reps).unwrap_or(0);
    let mut draw = 0_u64;
    loop {
        let mut order = [
            vec![Direction::Recognition; each],
            vec![Direction::Production; each],
        ]
        .concat();
        for place in (1..order.len()).rev() {
            let other =
                pick(seed ^ draw.wrapping_mul(0x9e37_79b9), place, place + 1).unwrap_or(place);
            order.swap(place, other);
        }
        if !alternates(&order) || order.len() < 2 {
            return order;
        }
        draw += 1;
    }
}

/// Where a word stands with its penalties: the rung it reached, and the
/// clean sessions it has had in a row since, the last one on `clean_on`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Standing {
    pub rung: u32,
    pub clean: u32,
    pub clean_on: Option<NaiveDate>,
}

/// A clean session on `day`. One on the day of the last one counted adds
/// nothing; the [`CLEAN`]th in a row takes a rung back and starts the count
/// again. A word on no rung has nothing to take back.
pub fn after_clean(standing: Standing, day: NaiveDate) -> Standing {
    if standing.rung == 0 || standing.clean_on == Some(day) {
        return standing;
    }
    let clean = standing.clean + 1;
    if clean < CLEAN {
        return Standing {
            clean,
            clean_on: Some(day),
            ..standing
        };
    }
    Standing {
        rung: standing.rung - 1,
        clean: 0,
        clean_on: Some(day),
    }
}

/// A miss, or an answer that was helped: the clean sessions start over. The
/// rung stays where it is: only a streak raises it.
pub fn after_slip(standing: Standing) -> Standing {
    Standing {
        clean: 0,
        clean_on: None,
        ..standing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: Direction = Direction::Recognition;
    const P: Direction = Direction::Production;

    fn day(n: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, n).expect("a day")
    }

    #[test]
    fn each_rung_asks_twice_as_many_up_to_twenty_four() {
        assert_eq!(
            [1, 2, 3, 4].map(reps),
            [3, 6, 12, 24],
            "three, then twice as many each rung"
        );
        assert_eq!(reps(5), 24, "nothing past the top");
        assert_eq!(reps(0), 3, "a word on no rung starts at three");
    }

    #[test]
    fn a_penalty_due_climbs_one_rung_and_stays_on_the_top() {
        assert_eq!(raised(0), 1);
        assert_eq!(raised(3), 4);
        assert_eq!(raised(4), 4, "due again on the top, it asks 24 again");
    }

    #[test]
    fn the_streak_is_the_misses_at_the_end() {
        assert_eq!(streak(&[]), 0);
        assert_eq!(streak(&[false, false, true]), 0);
        assert_eq!(streak(&[true, false, false]), 2);
        assert_eq!(streak(&[false, true, false, false, false]), STREAK);
    }

    #[test]
    fn the_order_has_as_many_each_way_and_never_alternates() {
        for seed in 0..200 {
            for rung in 1..=TOP {
                let order = order(seed, reps(rung));
                let each = usize::try_from(reps(rung)).expect("small");
                assert_eq!(order.len(), 2 * each);
                assert_eq!(order.iter().filter(|way| **way == R).count(), each);
                assert!(!alternates(&order), "seed {seed}: {order:?}");
            }
        }
    }

    #[test]
    fn the_order_is_the_same_for_the_same_seed_and_differs_between_seeds() {
        assert_eq!(order(7, 3), order(7, 3));
        let drawn: std::collections::HashSet<Vec<Direction>> =
            (0..40).map(|seed| order(seed, 3)).collect();
        assert!(drawn.len() > 5, "the orders are many: {}", drawn.len());
        assert!(
            drawn
                .iter()
                .any(|each| each[..3] == [R, R, R] || each[..3] == [P, P, P]),
            "three the same way in a row can come"
        );
    }

    #[test]
    fn alternating_orders_are_the_ones_refused() {
        assert!(alternates(&[R, P, R, P, R, P]));
        assert!(alternates(&[P, R, P, R]));
        assert!(!alternates(&[R, R, P, P, R, P]));
    }

    #[test]
    fn two_clean_sessions_on_different_days_take_a_rung_back() {
        let on = Standing {
            rung: 3,
            ..Standing::default()
        };
        let once = after_clean(on, day(15));
        assert_eq!((once.rung, once.clean), (3, 1));
        let same_day = after_clean(once, day(15));
        assert_eq!(same_day, once, "a second session that day adds nothing");
        let twice = after_clean(once, day(17));
        assert_eq!((twice.rung, twice.clean), (2, 0));
    }

    #[test]
    fn a_slip_starts_the_clean_count_over_and_keeps_the_rung() {
        let once = after_clean(
            Standing {
                rung: 2,
                ..Standing::default()
            },
            day(15),
        );
        let slipped = after_slip(once);
        assert_eq!((slipped.rung, slipped.clean), (2, 0));
        let after = after_clean(slipped, day(15));
        assert_eq!(after.clean, 1, "the count starts again, that same day too");
    }

    #[test]
    fn a_word_on_no_rung_is_left_as_it_is() {
        let free = Standing::default();
        assert_eq!(after_clean(free, day(15)), free);
    }

    #[test]
    fn clean_sessions_bring_the_top_down_to_free() {
        let mut standing = Standing {
            rung: TOP,
            ..Standing::default()
        };
        for n in 1..=8 {
            standing = after_clean(standing, day(n));
        }
        assert_eq!(standing.rung, 0, "eight clean sessions, four rungs");
    }
}
