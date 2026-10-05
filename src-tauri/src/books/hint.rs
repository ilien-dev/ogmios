//! A hint to a word the learner is asked for: its sentence, when it was
//! kept back, then how long the answer is, and its first letters, one more
//! each time they ask. Made by code from the answer itself: no request to
//! the model. Nothing here touches the
//! database or the clock.

/// What stands for a letter not given yet.
const HIDDEN: char = '_';

/// The most letters a hint gives: all but the last, so that it is never the
/// answer.
pub fn most(answer: &str) -> usize {
    answer
        .chars()
        .filter(|c| c.is_alphanumeric())
        .count()
        .saturating_sub(1)
}

/// The answer with its first `shown` letters in place and a mark for every
/// other: how long it is, and how it starts. Spaces, hyphens and apostrophes
/// stay, so "give up" reads as two words. Never more than [`most`] letters.
pub fn mask(answer: &str, shown: usize) -> String {
    let shown = shown.min(most(answer));
    let mut given = 0_usize;
    answer
        .trim()
        .chars()
        .map(|c| {
            if !c.is_alphanumeric() {
                c
            } else if given < shown {
                given += 1;
                c
            } else {
                HIDDEN
            }
        })
        .collect()
}

/// What a hint gives once `asked` others were given: the sentence alone
/// first, for a word whose `sentence` is kept back, then how long the answer
/// is, then one more letter each time. None is the sentence alone; otherwise
/// how many letters of the answer are given.
pub fn letters(asked: usize, sentence: bool) -> Option<usize> {
    if sentence {
        asked.checked_sub(1)
    } else {
        Some(asked)
    }
}

/// How many hints it takes to give the first letter of the answer: what
/// tells it from another word that means the same.
pub fn first_letter(sentence: bool) -> usize {
    usize::from(sentence) + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_letter_comes_after_the_sentence_and_the_length() {
        for sentence in [true, false] {
            assert_eq!(letters(first_letter(sentence), sentence), Some(1));
        }
    }

    #[test]
    fn a_sentence_kept_back_is_the_first_hint_before_any_letter() {
        assert_eq!(letters(0, true), None);
        assert_eq!(letters(1, true), Some(0));
        assert_eq!(letters(3, true), Some(2));
        // No sentence to show: the length at once.
        assert_eq!(letters(0, false), Some(0));
        assert_eq!(letters(2, false), Some(2));
    }

    #[test]
    fn a_hint_says_how_long_the_answer_is_and_then_its_first_letters() {
        assert_eq!(mask("stirred", 0), "_______");
        assert_eq!(mask("stirred", 1), "s______");
        assert_eq!(mask("stirred", 3), "sti____");
        assert_eq!(mask(" removió ", 2), "re_____");
    }

    #[test]
    fn what_is_not_a_letter_stays_and_is_not_counted() {
        assert_eq!(mask("give up", 0), "____ __");
        assert_eq!(mask("give up", 5), "give u_");
        assert_eq!(mask("queer-looking", 6), "queer-l______");
        assert_eq!(mask("don't", 4), "don't".replace('t', "_"));
    }

    #[test]
    fn a_hint_is_never_the_whole_answer() {
        assert_eq!(most("stirred"), 6);
        assert_eq!(mask("stirred", 99), "stirre_");
        assert_eq!((most("a"), mask("a", 3)), (0, "_".to_owned()));
        assert_eq!((most(""), mask("", 3)), (0, String::new()));
    }
}
