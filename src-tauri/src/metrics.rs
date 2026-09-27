//! Per-session metrics computed from the turns (SPEC §10). Error counts and
//! complexity come from the analysis; everything else is counted here.

use std::collections::HashSet;

use crate::domain::{Modality, SessionMetrics};

/// Typed turns count as speech at this rate (SPEC §6.4, open question 2).
pub const TYPED_WORDS_PER_MINUTE: f64 = 100.0;

// McCarthy & Jarvis (2010): a factor is complete when the type-token ratio
// falls to this value.
const MTLD_THRESHOLD: f64 = 0.72;
/// Below this many tokens MTLD is too noisy to show.
const MTLD_MIN_TOKENS: usize = 50;

/// A learner turn as the metrics see it.
#[derive(Debug, Clone, PartialEq)]
pub struct UserTurn<'a> {
    pub text: &'a str,
    /// Seconds of detected speech; `None` for a typed turn.
    pub speech_seconds: Option<f64>,
}

/// What the analysis contributes.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AnalysisCounts {
    pub errors: u32,
    pub global_errors: u32,
    pub clauses_per_unit: Option<f64>,
    pub subordination_ratio: Option<f64>,
}

/// Lowercased words with surrounding punctuation stripped; "don't" stays one.
pub fn tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| {
            w.trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect()
}

pub fn count_words(text: &str) -> u32 {
    u32::try_from(tokens(text).len()).unwrap_or(u32::MAX)
}

/// Minutes of speech for one turn: measured for voice, estimated for typing.
pub fn turn_speech_minutes(turn: &UserTurn<'_>) -> f64 {
    match turn.speech_seconds {
        Some(seconds) => seconds / 60.0,
        None => f64::from(count_words(turn.text)) / TYPED_WORDS_PER_MINUTE,
    }
}

pub fn speech_minutes(turns: &[UserTurn<'_>]) -> f64 {
    turns.iter().map(turn_speech_minutes).sum()
}

pub fn modality(turns: &[UserTurn<'_>]) -> Modality {
    let voiced = turns.iter().filter(|t| t.speech_seconds.is_some()).count();
    if voiced == 0 {
        Modality::Text
    } else if voiced == turns.len() {
        Modality::Voice
    } else {
        Modality::Mixed
    }
}

/// Measure of textual lexical diversity, averaged over a forward and a
/// backward pass. `None` under 50 tokens.
pub fn mtld(tokens: &[String]) -> Option<f64> {
    if tokens.len() < MTLD_MIN_TOKENS {
        return None;
    }
    let forward = mtld_pass(tokens.iter());
    let backward = mtld_pass(tokens.iter().rev());
    Some(f64::midpoint(forward, backward))
}

fn mtld_pass<'a>(tokens: impl Iterator<Item = &'a String>) -> f64 {
    let mut factors = 0.0;
    let mut total = 0_u32;
    let mut types: HashSet<&str> = HashSet::new();
    let mut count = 0_u32;
    for token in tokens {
        total += 1;
        count += 1;
        types.insert(token);
        if ratio(&types, count) <= MTLD_THRESHOLD {
            factors += 1.0;
            types.clear();
            count = 0;
        }
    }
    if count > 0 {
        factors += (1.0 - ratio(&types, count)) / (1.0 - MTLD_THRESHOLD);
    }
    if factors == 0.0 {
        // Every word distinct: no factor ever closed.
        f64::from(total)
    } else {
        f64::from(total) / factors
    }
}

fn ratio(types: &HashSet<&str>, count: u32) -> f64 {
    f64::from(u32::try_from(types.len()).unwrap_or(u32::MAX)) / f64::from(count)
}

fn per_100(count: u32, words: u32) -> f64 {
    if words == 0 {
        0.0
    } else {
        f64::from(count) * 100.0 / f64::from(words)
    }
}

pub fn compute(
    user_turns: &[UserTurn<'_>],
    partner_words: u32,
    analysis: &AnalysisCounts,
) -> SessionMetrics {
    let all_tokens: Vec<String> = user_turns.iter().flat_map(|t| tokens(t.text)).collect();
    let user_words = u32::try_from(all_tokens.len()).unwrap_or(u32::MAX);
    let total = user_words.saturating_add(partner_words);
    let turn_count = u32::try_from(user_turns.len()).unwrap_or(u32::MAX);
    SessionMetrics {
        modality: modality(user_turns),
        speech_minutes: speech_minutes(user_turns),
        user_words,
        user_share: if total == 0 {
            0.0
        } else {
            f64::from(user_words) / f64::from(total)
        },
        words_per_turn: if turn_count == 0 {
            0.0
        } else {
            f64::from(user_words) / f64::from(turn_count)
        },
        mtld: mtld(&all_tokens),
        errors_per100: per_100(analysis.errors, user_words),
        global_errors_per100: per_100(analysis.global_errors, user_words),
        clauses_per_unit: analysis.clauses_per_unit,
        subordination_ratio: analysis.subordination_ratio,
    }
}

/// Field-by-field mean, for "compared with your last sessions".
pub fn mean(sessions: &[SessionMetrics]) -> Option<SessionMetrics> {
    let first = sessions.first()?;
    let n = crate::convert::len_f64(sessions.len());
    let avg = |f: fn(&SessionMetrics) -> f64| sessions.iter().map(f).sum::<f64>() / n;
    let avg_opt = |f: fn(&SessionMetrics) -> Option<f64>| {
        let values: Vec<f64> = sessions.iter().filter_map(f).collect();
        let count = f64::from(u32::try_from(values.len()).unwrap_or(u32::MAX));
        (!values.is_empty()).then(|| values.iter().sum::<f64>() / count)
    };
    let words = avg(|m| f64::from(m.user_words));
    Some(SessionMetrics {
        modality: first.modality,
        speech_minutes: avg(|m| m.speech_minutes),
        user_words: crate::convert::round_count(words),
        user_share: avg(|m| m.user_share),
        words_per_turn: avg(|m| m.words_per_turn),
        mtld: avg_opt(|m| m.mtld),
        errors_per100: avg(|m| m.errors_per100),
        global_errors_per100: avg(|m| m.global_errors_per100),
        clauses_per_unit: avg_opt(|m| m.clauses_per_unit),
        subordination_ratio: avg_opt(|m| m.subordination_ratio),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn words(text: &str) -> Vec<String> {
        tokens(text)
    }

    #[test]
    fn tokens_strip_punctuation_and_case() {
        assert_eq!(
            words("Well, I don't KNOW... — really!"),
            ["well", "i", "don't", "know", "really"]
        );
        assert_eq!(count_words("  "), 0);
    }

    #[test]
    fn mtld_needs_fifty_tokens() {
        assert_eq!(mtld(&words(&"word ".repeat(49))), None);
        assert!(mtld(&words(&"word ".repeat(50))).is_some());
    }

    #[test]
    fn mtld_of_a_repeated_word_is_low() {
        // "a b" repeated: TTR hits 0.667 at the third token, so each factor
        // spans three tokens.
        let text = "a b ".repeat(30);
        let value = mtld(&words(&text)).expect("enough tokens");
        assert!(close(value, 3.0), "{value}");
    }

    #[test]
    fn mtld_counts_the_partial_factor() {
        // 60 distinct words: no factor closes, the partial one is
        // (1 - 1) / 0.28 = 0, so the value is the token count.
        let text = (0..60)
            .map(|i| format!("w{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        let value = mtld(&words(&text)).expect("enough tokens");
        assert!(close(value, 60.0), "{value}");
    }

    #[test]
    fn mtld_rises_with_diversity() {
        let dull = "the cat sat on the mat and the cat sat on the mat ".repeat(5);
        let rich = "yesterday my younger sister finally finished painting her tiny apartment \
                    while our neighbours argued loudly about parking spaces near the old \
                    bakery which sells amazing croissants every single morning before \
                    sunrise so tourists queue patiently outside despite freezing winter \
                    temperatures and occasional rain showers blowing across narrow streets \
                    lined with crooked lamps, painted doors, stray cats, bicycles, flowers";
        let dull = mtld(&words(&dull)).expect("dull");
        let rich = mtld(&words(rich)).expect("rich");
        assert!(rich > dull * 3.0, "{rich} vs {dull}");
    }

    #[test]
    fn speech_minutes_mix_voice_and_typing() {
        let turns = [
            UserTurn {
                text: "one two three",
                speech_seconds: Some(90.0),
            },
            UserTurn {
                text: &"word ".repeat(50),
                speech_seconds: None,
            },
        ];
        assert!(close(speech_minutes(&turns), 1.5 + 0.5));
        assert_eq!(modality(&turns), Modality::Mixed);
        assert_eq!(modality(&turns[..1]), Modality::Voice);
        assert_eq!(modality(&turns[1..]), Modality::Text);
    }

    #[test]
    fn compute_counts_share_and_rates() {
        let turns = [
            UserTurn {
                text: "I have went there",
                speech_seconds: None,
            },
            UserTurn {
                text: "It was nice",
                speech_seconds: None,
            },
        ];
        let counts = AnalysisCounts {
            errors: 1,
            global_errors: 0,
            ..AnalysisCounts::default()
        };
        let m = compute(&turns, 7, &counts);
        assert_eq!(m.user_words, 7);
        assert!(close(m.user_share, 0.5));
        assert!(close(m.words_per_turn, 3.5));
        assert!(close(m.errors_per100, 100.0 / 7.0));
        assert_eq!(m.mtld, None);
    }

    #[test]
    fn mean_skips_missing_optionals() {
        let turns = [UserTurn {
            text: "a b",
            speech_seconds: None,
        }];
        let mut a = compute(&turns, 2, &AnalysisCounts::default());
        let mut b = a.clone();
        a.mtld = Some(40.0);
        b.speech_minutes = a.speech_minutes + 2.0;
        let m = mean(&[a.clone(), b]).expect("non-empty");
        assert_eq!(m.mtld, Some(40.0));
        assert!(close(m.speech_minutes, a.speech_minutes + 1.0));
        assert_eq!(mean(&[]), None);
    }
}
