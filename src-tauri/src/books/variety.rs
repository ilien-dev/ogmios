//! The variety of the learner's language the app writes: Spanish is neutral
//! Latin American Spanish, which says "ustedes" where Spain says "vosotros".
//! The prompts ask for it (`sidecar/prompts/common.ts`); code finds the text
//! that came out of Spain all the same, so it is written again.

/// Words only Spain's Spanish has: "vosotros" and what goes with it.
const PENINSULAR: [&str; 8] = [
    "vosotros", "vosotras", "os", "vuestro", "vuestra", "vuestros", "vuestras", "sois",
];

/// The verb endings of "vosotros" ("tenéis", "habláis"): no other Spanish
/// word ends in them.
const PENINSULAR_ENDINGS: [&str; 2] = ["áis", "éis"];

/// Whether `text`, in the learner's `lang`, speaks to "vosotros". Only
/// Spanish has such forms: in any other language nothing is.
pub fn peninsular(text: &str, lang: &str) -> bool {
    let primary = lang.split(['-', '_']).next().unwrap_or(lang);
    if !primary.eq_ignore_ascii_case("es") {
        return false;
    }
    text.split(|c: char| !c.is_alphabetic())
        .map(str::to_lowercase)
        .any(|word| {
            PENINSULAR.contains(&word.as_str())
                || PENINSULAR_ENDINGS
                    .iter()
                    .any(|end| word.len() > end.len() && word.ends_with(end))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vosotros_and_its_verbs_are_spains() {
        for text in [
            "Vosotros sois los afortunados.",
            "¿Os habéis dado cuenta?",
            "Es vuestra casa.",
            "Tenéis razón.",
            "Si habláis claro, os entienden.",
        ] {
            assert!(peninsular(text, "es"), "{text}");
        }
    }

    #[test]
    fn neutral_spanish_is_not() {
        for text in [
            "Ustedes son los afortunados.",
            "Ella vive en otro país.",
            "Tiene seis hermanos y un maíz.",
            "Los osos comen miel.",
            "",
        ] {
            assert!(!peninsular(text, "es"), "{text}");
        }
    }

    #[test]
    fn only_spanish_has_a_vosotros() {
        assert!(peninsular("Vosotros sois", "es-MX"));
        assert!(!peninsular("os amigos", "pt"));
    }
}
