//! Hesitation sounds, taken out of what the recogniser heard.
//!
//! Parakeet writes down every "uh" and "um", and its ABI has no prompt or
//! token list to tell it otherwise, so they are removed from its text instead.
//! Only sounds that are not words go: "like", "well" and "you know" are the
//! learner's English, and "uh-huh" is an answer.

/// Compared without case, as whole words.
const FILLERS: &[&str] = &[
    "ah", "er", "erm", "hm", "hmm", "mm", "mmm", "uh", "uhh", "uhm", "um", "umm",
];

/// `text` without its hesitation sounds, and without the commas that only
/// held them. Words are joined by single spaces.
pub fn without_fillers(text: &str) -> String {
    let mut kept: Vec<String> = Vec::new();
    // The filler dropped last opened a sentence with a capital the next word
    // has to carry.
    let mut capitalise = false;
    for token in text.split_whitespace() {
        let Some(tail) = filler_tail(token) else {
            kept.push(if capitalise {
                capitalised(token)
            } else {
                token.to_string()
            });
            capitalise = false;
            continue;
        };
        let Some(last) = kept.last_mut().filter(|last| !ends_sentence(last)) else {
            capitalise = capitalise || starts_upper(token);
            continue;
        };
        if ends_sentence(tail) {
            // The filler closed the sentence: the word before it does now.
            last.truncate(last.trim_end_matches(',').len());
            last.push_str(tail);
        } else if tail.ends_with(',') && last.ends_with(',') {
            last.pop();
        }
    }
    kept.join(" ")
}

/// The punctuation after `token`'s word when that word is a filler.
fn filler_tail(token: &str) -> Option<&str> {
    let word = token.trim_start_matches(not_a_letter);
    let tail = &word[word.trim_end_matches(not_a_letter).len()..];
    let word = &word[..word.len() - tail.len()];
    FILLERS
        .iter()
        .any(|filler| filler.eq_ignore_ascii_case(word))
        .then_some(tail)
}

fn not_a_letter(c: char) -> bool {
    !c.is_alphanumeric()
}

fn ends_sentence(text: &str) -> bool {
    text.ends_with(['.', '?', '!', '…'])
}

fn starts_upper(token: &str) -> bool {
    token
        .chars()
        .find(|c| c.is_alphabetic())
        .is_some_and(char::is_uppercase)
}

fn capitalised(token: &str) -> String {
    let Some((at, first)) = token.char_indices().find(|(_, c)| c.is_alphabetic()) else {
        return token.to_string();
    };
    let rest = &token[at + first.len_utf8()..];
    format!("{}{}{rest}", &token[..at], first.to_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_without_fillers_is_left_alone() {
        assert_eq!(
            without_fillers("Yesterday I go to the store."),
            "Yesterday I go to the store."
        );
        assert_eq!(without_fillers(""), "");
    }

    #[test]
    fn a_filler_goes_with_the_commas_around_it() {
        assert_eq!(without_fillers("to the, uh, store"), "to the store");
        assert_eq!(without_fillers("I um went home"), "I went home");
        assert_eq!(without_fillers("I, uh, um, went"), "I went");
    }

    #[test]
    fn a_filler_that_opened_a_sentence_hands_on_its_capital() {
        assert_eq!(without_fillers("Uh, I went"), "I went");
        assert_eq!(without_fillers("Um, then I left."), "Then I left.");
        assert_eq!(
            without_fillers("I went. Um, then I left."),
            "I went. Then I left."
        );
        assert_eq!(without_fillers("uh the store"), "the store");
    }

    #[test]
    fn a_filler_that_closed_a_sentence_hands_back_its_full_stop() {
        assert_eq!(without_fillers("the store, um."), "the store.");
        assert_eq!(without_fillers("Is it, uh? Yes."), "Is it? Yes.");
        assert_eq!(
            without_fillers("I went. Um. Then I left."),
            "I went. Then I left."
        );
        assert_eq!(
            without_fillers("I was... um... thinking"),
            "I was... thinking"
        );
    }

    #[test]
    fn nothing_but_fillers_is_nothing() {
        assert_eq!(without_fillers("Um."), "");
        assert_eq!(without_fillers("uh um, UH"), "");
    }

    #[test]
    fn words_that_only_look_like_fillers_stay() {
        assert_eq!(without_fillers("Uh-huh, I know."), "Uh-huh, I know.");
        assert_eq!(without_fillers("uh-oh"), "uh-oh");
        assert_eq!(
            without_fillers("Well, you know, I like the umbrella."),
            "Well, you know, I like the umbrella."
        );
    }
}
