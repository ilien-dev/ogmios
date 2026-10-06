//! How closely what the learner types is read. Lenient, the default, lets a
//! special character go: a missing accent, an ñ typed as n. Strict takes
//! those too. Either way every letter has to be there, once and in its
//! place: "abrrir" is not "abrir", and "bearingh" is not "bearings". Case
//! never counts in a word that is compared; punctuation is no part of one,
//! but for the apostrophe inside it.

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

/// Which of the letters of a text are capitals.
fn capitals(text: &str) -> Vec<bool> {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .map(char::is_uppercase)
        .collect()
}

/// Whether `better` only changes of `written` what `spelling` does not read:
/// its punctuation, an opening ¿ or ¡, a comma, a full stop; and, lenient,
/// its special characters too. The words and their capitals are the same. A
/// letter, a capital or an apostrophe inside a word that changes is more
/// than that.
pub fn only_respells(written: &str, better: &str, spelling: Spelling) -> bool {
    capitals(written) == capitals(better) && words(written, spelling) == words(better, spelling)
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
    fn a_respelling_changes_no_letter_and_no_capital() {
        for (written, better) in [
            ("conto", "contó"),
            ("conto las grietas;", "contó las grietas;"),
            ("blanco grisaceo", "blanco grisáceo"),
            ("ano", "año"),
            ("Por que", "¿Por qué"),
        ] {
            assert!(only_respells(written, better, Lenient), "{written}");
            assert!(!only_respells(written, better, Strict), "{written}");
        }
        // Punctuation is read by neither.
        for (written, better) in [
            ("sirenas", "sirenas,"),
            ("Auch!", "¡Auch!"),
            ("Un arma?", "¿Un arma?"),
            ("Esto duele mucho!", "¡Esto duele mucho!"),
            ("dijo: no", "dijo: «no»"),
        ] {
            assert!(only_respells(written, better, Lenient), "{written}");
            assert!(only_respells(written, better, Strict), "{written}");
        }
        for (written, better) in [
            ("el niño", "El niño"),
            ("niño", "chico"),
            ("el niño", "niño"),
            ("dont", "don't"),
            ("blango", "blanco"),
            ("abrrir", "abrir"),
            ("bearingh", "bearings"),
            ("Auch!", "¡Ay!"),
        ] {
            assert!(!only_respells(written, better, Lenient), "{written}");
        }
    }
}
