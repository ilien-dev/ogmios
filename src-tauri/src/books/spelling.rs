//! How closely what the learner types is read. Lenient, the default, lets a
//! special character go: a missing accent, an ñ typed as n. Strict takes
//! those too. Either way every letter has to be there, once and in its
//! place: "abrrir" is not "abrir", and "bearingh" is not "bearings". Case
//! never counts in a word that is compared; punctuation is no part of one.

use crate::books::vocab::{split, tokens};

/// How spelling is read: the learner's choice, lenient unless they say so.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Spelling {
    Lenient,
    Strict,
}

impl Spelling {
    pub fn of(strict: bool) -> Self {
        if strict {
            Self::Strict
        } else {
            Self::Lenient
        }
    }

    pub fn is_strict(self) -> bool {
        self == Self::Strict
    }
}

/// The words of a text as they are compared under `spelling`: lowercase,
/// split as [`tokens`] splits them. Lenient, without accents and with ñ as
/// n; strict, with every letter as it was typed.
pub fn words(text: &str, spelling: Spelling) -> Vec<String> {
    match spelling {
        Spelling::Lenient => tokens(text)
            .iter()
            .map(|word| word.replace('ñ', "n"))
            .collect(),
        Spelling::Strict => split(&text.to_lowercase().replace(['’', '‘'], "'")),
    }
}

/// What of a piece of text is not its letters: its punctuation, and which
/// of its letters are capitals.
fn frame(piece: &str) -> (Vec<char>, Vec<bool>) {
    let (letters, marks): (Vec<char>, Vec<char>) = piece.chars().partition(|c| c.is_alphanumeric());
    (marks, letters.iter().map(|c| c.is_uppercase()).collect())
}

/// Whether `better` only puts back the special characters of `written`: word
/// for word the same letters under lenient spelling, with the same
/// punctuation and capitals. A letter, a comma, a full stop or a capital
/// that changes is more than that.
pub fn only_respells(written: &str, better: &str) -> bool {
    let (written, better): (Vec<&str>, Vec<&str>) = (
        written.split_whitespace().collect(),
        better.split_whitespace().collect(),
    );
    written.len() == better.len()
        && written.iter().zip(&better).all(|(a, b)| {
            frame(a) == frame(b) && words(a, Spelling::Lenient) == words(b, Spelling::Lenient)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use Spelling::{Lenient, Strict};

    #[test]
    fn lenient_words_lose_their_accents_and_strict_ones_keep_every_letter() {
        assert_eq!(words("¡Grisáceo, Año!", Lenient), ["grisaceo", "ano"]);
        assert_eq!(words("¡Grisáceo, Año!", Strict), ["grisáceo", "año"]);
        assert_eq!(words("Don’t  stop", Strict), ["don't", "stop"]);
    }

    #[test]
    fn a_respelling_changes_no_punctuation_and_no_capital() {
        for (written, better) in [
            ("conto", "contó"),
            ("conto las grietas;", "contó las grietas;"),
            ("blanco grisaceo", "blanco grisáceo"),
            ("ano", "año"),
        ] {
            assert!(only_respells(written, better), "{written}");
        }
        for (written, better) in [
            ("sirenas", "sirenas,"),
            ("el niño", "El niño"),
            ("niño", "chico"),
            ("el niño", "niño"),
            ("dont", "don't"),
            ("blango", "blanco"),
            ("abrrir", "abrir"),
            ("bearingh", "bearings"),
        ] {
            assert!(!only_respells(written, better), "{written}");
        }
    }
}
