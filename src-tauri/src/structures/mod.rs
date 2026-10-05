//! Structures practised by writing sentences with them: the catalogue, and
//! everything a session decides. Which structure each sentence asks for,
//! with which word and about what; what an answer is worth; how strong a
//! structure is and when it comes back; which ones a chapter uses most. The
//! model labels a sentence and a text; nothing here is left to it.

mod catalogue;

pub use catalogue::{Structure, CATALOGUE};

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};

use crate::agent::protocol::StructureFound;
use crate::books::practice::pick;
use crate::domain::{
    ChapterStructure, PartOfSpeech, Strength, StructureVerdict, Topic, WordSource,
};

/// How many sentences a session can ask for.
pub const SIZES: [u32; 4] = [10, 20, 40, 60];
/// The share of a session that warms up on one structure, and its least.
const WARM_PERCENT: u32 = 30;
const WARM_MIN: u32 = 3;
/// Days until a structure comes back, by the step it is on.
pub const DAYS: [i64; 4] = [1, 3, 7, 21];
/// The share of a session's sentences on a structure that must be right
/// for it to climb a step.
const PASS_PERCENT: u32 = 80;
const SETTLING_STEP: u32 = 1;
/// It held for a week.
const FIRM_STEP: u32 = 3;
/// What a sentence can be about, besides the learner's own interests; each
/// is named in the interface's languages.
pub const TOPICS: [&str; 16] = [
    "travel",
    "work",
    "family",
    "food",
    "weekend",
    "home",
    "friends",
    "city",
    "weather",
    "health",
    "money",
    "films",
    "music",
    "sport",
    "childhood",
    "plans",
];
/// How many of a chapter's structures a session on it practises.
pub const CHAPTER_TOP: usize = 5;
/// How many pieces of a chapter are read to rank its structures: enough to
/// tell which ones it uses most, at a bounded cost.
pub const SCAN_PIECES: usize = 6;
/// A conversation takes a structure as a target only while its targets are
/// fewer than this (SPEC §8.3: three active patterns at most).
pub const CHAT_ROOM: usize = 3;

const TOPIC_SALT: u64 = 0x746f_7069_6373;
const WORD_SALT: u64 = 0x0076_6572_6273;

pub fn find(key: &str) -> Option<&'static Structure> {
    CATALOGUE.iter().find(|each| each.key == key)
}

/// How many sentences of a session of `size` warm up.
pub fn warm(size: u32) -> u32 {
    (size * WARM_PERCENT / 100).max(WARM_MIN).min(size)
}

/// `items` in an order drawn for the `round` of the session `seed` is of.
fn shuffled(items: &[String], seed: u64, round: usize) -> Vec<String> {
    let mut left = items.to_vec();
    let mut drawn = Vec::with_capacity(left.len());
    while let Some(at) = pick(seed, round * items.len() + drawn.len(), left.len()) {
        drawn.push(left.swap_remove(at));
    }
    drawn
}

/// One sentence a session asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Slot {
    pub structure: String,
    /// It is one of the first, all on the same structure, with its form in
    /// sight.
    pub warm: bool,
}

/// The sentences of a session of `size` over these structures: it warms up
/// on one of them, drawn, and then goes through all of them again and
/// again, each time in another order.
pub fn plan(keys: &[String], size: u32, seed: u64) -> Vec<Slot> {
    let mut once = HashSet::new();
    let keys: Vec<String> = keys
        .iter()
        .filter(|key| once.insert(key.as_str()))
        .cloned()
        .collect();
    let Some(first) = shuffled(&keys, seed, 0).into_iter().next() else {
        return Vec::new();
    };
    let size = usize::try_from(size).unwrap_or(0);
    let warm = usize::try_from(warm(u32::try_from(size).unwrap_or(0))).unwrap_or(0);
    let mut slots = vec![
        Slot {
            structure: first,
            warm: true,
        };
        warm
    ];
    let mut order = Vec::new();
    let mut round = 1;
    while slots.len() < size {
        if order.is_empty() {
            order = shuffled(&keys, seed, round);
            round += 1;
        }
        if let Some(structure) = order.pop() {
            slots.push(Slot {
                structure,
                warm: false,
            });
        }
    }
    slots
}

/// What the sentence at `turn` is about: one of the learner's interests or
/// one of [`TOPICS`], drawn.
pub fn topic(interests: &[String], seed: u64, turn: usize) -> Topic {
    let at = pick(seed ^ TOPIC_SALT, turn, interests.len() + TOPICS.len()).unwrap_or(0);
    interests.get(at).map_or_else(
        || Topic::Preset {
            key: TOPICS
                .get(at - interests.len())
                .copied()
                .unwrap_or(TOPICS[0])
                .to_owned(),
        },
        |label| Topic::Interest {
            label: label.clone(),
        },
    )
}

/// A word a sentence is asked to use, as a session keeps it: what kind of
/// word it is and what it means are read from the books when it is shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asked {
    /// Its base form.
    pub english: String,
    pub source: WordSource,
}

/// A word a session can ask for, with what the books say of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Met {
    pub asked: Asked,
    /// None for a word nobody labelled.
    pub kind: Option<PartOfSpeech>,
    /// A verb that takes an object; none when nobody said.
    pub transitive: Option<bool>,
}

/// The structures built around a verb that takes an object: a sentence
/// with one of them has no natural place for another word.
const ON_A_VERB: [&str; 2] = ["passive", "causative"];

/// Whether a sentence with `structure` has a natural place for the word.
/// Most structures take a word of any kind; one built on a verb that takes
/// an object takes such a verb alone, and never one nobody said is one.
pub fn fits(structure: &str, met: &Met) -> bool {
    !ON_A_VERB.contains(&structure)
        || (met.transitive == Some(true)
            && matches!(
                met.kind,
                Some(PartOfSpeech::Verb | PartOfSpeech::PhrasalVerb)
            ))
}

/// The word the sentence at `turn` is asked to use, drawn from the ones
/// that fit its structure; none when none does.
pub fn word(pool: &[Met], structure: &str, seed: u64, turn: usize) -> Option<Asked> {
    let fitting: Vec<&Met> = pool.iter().filter(|met| fits(structure, met)).collect();
    pick(seed ^ WORD_SALT, turn, fitting.len())
        .and_then(|at| fitting.get(at))
        .map(|met| met.asked.clone())
}

/// What the model says of a sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Labels {
    pub uses_structure: bool,
    pub well_formed: bool,
    pub uses_word: bool,
    pub slips: bool,
}

/// How a sentence was written, as the app knows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Written {
    /// Something was typed.
    pub answered: bool,
    /// The form was asked for after the warm-up.
    pub peeked: bool,
    /// A word was asked for.
    pub word_asked: bool,
}

/// What a sentence is worth. Wrong without the structure, well formed;
/// right only with help when the word is missing, the form was looked at or
/// something else in it is off; otherwise right.
pub fn verdict(labels: Labels, written: Written) -> StructureVerdict {
    if !written.answered || !labels.uses_structure || !labels.well_formed {
        StructureVerdict::Wrong
    } else if (written.word_asked && !labels.uses_word) || written.peeked || labels.slips {
        StructureVerdict::Partial
    } else {
        StructureVerdict::Correct
    }
}

/// The sentences one finished session asked on a structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Round {
    pub at: DateTime<Utc>,
    /// Sentences not wrong.
    pub right: u32,
    pub total: u32,
}

/// Where a practised structure stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Standing {
    pub step: u32,
    pub due_at: DateTime<Utc>,
}

/// Where a structure stands after these sessions, oldest first; none for
/// one never practised. A session with enough right sends it a step
/// further away, any other brings it a step back.
pub fn standing(rounds: &[Round]) -> Option<Standing> {
    let last = rounds.last()?;
    let top = u32::try_from(DAYS.len()).unwrap_or(u32::MAX);
    let step = rounds.iter().fold(0_u32, |step, round| {
        if round.right * 100 >= round.total * PASS_PERCENT {
            (step + 1).min(top)
        } else {
            step.saturating_sub(1)
        }
    });
    let at = usize::try_from(step).map_or(DAYS.len() - 1, |step| step.min(DAYS.len() - 1));
    Some(Standing {
        step,
        due_at: last.at + Duration::days(DAYS[at]),
    })
}

/// How strong a structure on this step is. Never "mastered": that is
/// earned in conversation.
pub fn strength(step: u32) -> Strength {
    if step >= FIRM_STEP {
        Strength::Firm
    } else if step >= SETTLING_STEP {
        Strength::Settling
    } else {
        Strength::New
    }
}

fn plain(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The structures a chapter uses, the most used first, from what the model
/// found in its pieces. A key outside the catalogue is dropped; an example
/// is kept only when the chapter has it, word for word.
pub fn rank(found: &[StructureFound], text: &str) -> Vec<ChapterStructure> {
    let text = plain(text);
    let mut counts: HashMap<&str, (u32, String)> = HashMap::new();
    for each in found {
        let Some(structure) = find(&each.key) else {
            continue;
        };
        let entry = counts.entry(structure.key).or_default();
        entry.0 += each.count;
        let sentence = plain(&each.sentence);
        if entry.1.is_empty() && !sentence.is_empty() && text.contains(&sentence) {
            entry.1 = sentence;
        }
    }
    let mut ranked: Vec<ChapterStructure> = CATALOGUE
        .iter()
        .filter_map(|structure| {
            counts
                .remove(structure.key)
                .map(|(count, example)| ChapterStructure {
                    key: structure.key.to_owned(),
                    count,
                    example,
                })
        })
        .collect();
    // Stable: equal counts stay in the catalogue's order.
    ranked.sort_by_key(|each| std::cmp::Reverse(each.count));
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::books::practice::seed;
    use crate::domain::Level;

    fn keys(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    fn at(day: u32) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(&format!("2026-03-{day:02}T10:00:00Z"))
            .expect("a date")
            .with_timezone(&Utc)
    }

    #[test]
    fn the_catalogue_has_twelve_structures_a_level_under_keys_of_their_own() {
        let unique: HashSet<_> = CATALOGUE.iter().map(|each| each.key).collect();
        assert_eq!(unique.len(), CATALOGUE.len());
        for level in [Level::Basic, Level::Intermediate, Level::Advanced] {
            assert_eq!(CATALOGUE.iter().filter(|s| s.level == level).count(), 12);
        }
        assert_eq!(
            find("present-perfect").map(|s| s.level),
            Some(Level::Intermediate)
        );
        assert_eq!(find("nothing"), None);
    }

    #[test]
    fn every_structure_and_topic_is_named_in_both_languages() {
        for text in [
            include_str!("../../../src/lib/i18n/structures.en.ts"),
            include_str!("../../../src/lib/i18n/structures.es.ts"),
        ] {
            for structure in &CATALOGUE {
                let key = structure.key;
                assert!(
                    text.contains(&format!("\"{key}\": {{"))
                        || text.contains(&format!(" {key}: {{")),
                    "{key} is missing"
                );
            }
            for topic in TOPICS {
                assert!(text.contains(&format!("{topic}: \"")), "{topic} is missing");
            }
        }
    }

    #[test]
    fn a_session_warms_up_on_one_structure_and_then_mixes_them_all() {
        let chosen = keys(&["can", "will", "passive"]);
        let slots = plan(&chosen, 20, seed("a sitting"));
        assert_eq!(slots.len(), 20);
        let (warm, mixed) = slots.split_at(6);
        assert!(warm.iter().all(|slot| slot.warm));
        assert!(warm.iter().all(|slot| slot.structure == warm[0].structure));
        assert!(mixed.iter().all(|slot| !slot.warm));
        // Every three in a row after the warm-up are the three, in some order.
        for round in mixed.as_chunks::<3>().0 {
            let mut seen: Vec<_> = round.iter().map(|slot| slot.structure.clone()).collect();
            seen.sort();
            assert_eq!(seen, keys(&["can", "passive", "will"]));
        }
        let orders: HashSet<Vec<&String>> = mixed
            .as_chunks::<3>()
            .0
            .iter()
            .map(|round| round.iter().map(|slot| &slot.structure).collect())
            .collect();
        assert!(orders.len() > 1, "a round has an order of its own");
    }

    #[test]
    fn a_session_is_the_same_for_its_seed_and_another_for_another() {
        let chosen = keys(&["can", "will", "passive", "wish", "cleft"]);
        let once = plan(&chosen, 40, seed("a"));
        assert_eq!(once, plan(&chosen, 40, seed("a")));
        assert_ne!(once, plan(&chosen, 40, seed("b")));
    }

    #[test]
    fn a_session_counts_a_structure_chosen_twice_once_and_none_is_no_session() {
        let slots = plan(&keys(&["can", "can"]), 10, seed("a"));
        assert_eq!(slots.len(), 10);
        assert_eq!(slots.iter().filter(|slot| slot.warm).count(), 3);
        assert_eq!(plan(&[], 10, seed("a")), []);
        assert_eq!(warm(10), 3);
        assert_eq!(warm(60), 18);
    }

    #[test]
    fn a_topic_is_an_interest_or_one_of_the_list() {
        let interests = keys(&["chess"]);
        let drawn: Vec<Topic> = (0..60)
            .map(|turn| topic(&interests, seed("a"), turn))
            .collect();
        assert!(drawn.contains(&Topic::Interest {
            label: "chess".into()
        }));
        assert!(drawn.iter().any(|t| matches!(t, Topic::Preset { .. })));
        for each in &drawn {
            if let Topic::Preset { key } = each {
                assert!(TOPICS.contains(&key.as_str()));
            }
        }
    }

    /// A word met, a verb that takes an object when it is a verb.
    fn met(english: &str, kind: Option<PartOfSpeech>) -> Met {
        Met {
            asked: Asked {
                english: english.to_owned(),
                source: WordSource::Chapter,
            },
            kind,
            transitive: kind
                .map(|kind| matches!(kind, PartOfSpeech::Verb | PartOfSpeech::PhrasalVerb)),
        }
    }

    #[test]
    fn a_word_is_drawn_from_the_ones_met_and_none_when_none_was() {
        let pool = [
            met("stir", Some(PartOfSpeech::Verb)),
            met("bank", Some(PartOfSpeech::Noun)),
            met("glen", None),
        ];
        let drawn: HashSet<String> = (0..40)
            .filter_map(|turn| word(&pool, "can", seed("a"), turn))
            .map(|word| word.english)
            .collect();
        assert_eq!(drawn.len(), 3, "a word of any kind");
        assert_eq!(word(&[], "can", seed("a"), 0), None);
    }

    #[test]
    fn a_structure_built_on_a_verb_is_asked_with_a_verb_that_takes_an_object() {
        let pool = [
            met("stir", Some(PartOfSpeech::Verb)),
            met("give up", Some(PartOfSpeech::PhrasalVerb)),
            // Verbs too, but one takes no object and of one nobody said.
            Met {
                transitive: Some(false),
                ..met("trot", Some(PartOfSpeech::Verb))
            },
            Met {
                transitive: None,
                ..met("peep", Some(PartOfSpeech::Verb))
            },
            // Not a verb, whatever was said of it.
            Met {
                transitive: Some(true),
                ..met("bank", Some(PartOfSpeech::Noun))
            },
            met("steep", Some(PartOfSpeech::Adjective)),
            met("glen", None),
        ];
        let any: HashSet<String> = (0..200)
            .filter_map(|turn| word(&pool, "can", seed("a"), turn))
            .map(|word| word.english)
            .collect();
        assert_eq!(any.len(), pool.len(), "any other takes them all");
        for structure in ON_A_VERB {
            assert!(find(structure).is_some(), "{structure} is in the catalogue");
            let drawn: HashSet<String> = (0..60)
                .filter_map(|turn| word(&pool, structure, seed("a"), turn))
                .map(|word| word.english)
                .collect();
            let verbs: HashSet<String> = ["stir", "give up"].map(str::to_owned).into();
            assert_eq!(drawn, verbs, "{structure}");
        }
        // With no verb met, it is asked with no word at all.
        assert_eq!(word(&pool[2..], "passive", seed("a"), 0), None);
    }

    #[test]
    fn a_sentence_is_right_with_help_or_wrong_by_what_it_holds() {
        let all = Labels {
            uses_structure: true,
            well_formed: true,
            uses_word: true,
            slips: false,
        };
        let plainly = Written {
            answered: true,
            peeked: false,
            word_asked: true,
        };
        assert_eq!(verdict(all, plainly), StructureVerdict::Correct);
        let wordless = Labels {
            uses_word: false,
            ..all
        };
        assert_eq!(verdict(wordless, plainly), StructureVerdict::Partial);
        let free = Written {
            word_asked: false,
            ..plainly
        };
        assert_eq!(verdict(wordless, free), StructureVerdict::Correct);
        let slipped = Labels { slips: true, ..all };
        assert_eq!(verdict(slipped, plainly), StructureVerdict::Partial);
        let peeked = Written {
            peeked: true,
            ..plainly
        };
        assert_eq!(verdict(all, peeked), StructureVerdict::Partial);
        let broken = Labels {
            well_formed: false,
            ..all
        };
        assert_eq!(verdict(broken, plainly), StructureVerdict::Wrong);
        let other = Labels {
            uses_structure: false,
            ..all
        };
        assert_eq!(verdict(other, plainly), StructureVerdict::Wrong);
        let empty = Written {
            answered: false,
            ..plainly
        };
        assert_eq!(verdict(all, empty), StructureVerdict::Wrong);
    }

    #[test]
    fn a_structure_climbs_with_a_good_session_and_comes_back_later_each_time() {
        assert_eq!(standing(&[]), None);
        let good = |day| Round {
            at: at(day),
            right: 8,
            total: 10,
        };
        let bad = |day| Round {
            at: at(day),
            right: 7,
            total: 10,
        };
        let once = standing(&[good(1)]).expect("practised");
        assert_eq!((once.step, once.due_at), (1, at(4)));
        let missed = standing(&[bad(1)]).expect("practised");
        assert_eq!((missed.step, missed.due_at), (0, at(2)));
        let fell = standing(&[good(1), good(2), bad(3)]).expect("practised");
        assert_eq!((fell.step, fell.due_at), (1, at(6)));
        let held = standing(&[good(1), good(2), good(3), good(4), good(5)]).expect("practised");
        assert_eq!(held.step, 4, "the last step holds");
        assert_eq!(held.due_at, at(26));
        assert_eq!(strength(0), Strength::New);
        assert_eq!(strength(1), Strength::Settling);
        assert_eq!(strength(3), Strength::Firm);
    }

    #[test]
    fn a_chapter_ranks_what_was_found_in_its_pieces() {
        let found = |key: &str, count, sentence: &str| StructureFound {
            key: key.to_owned(),
            count,
            sentence: sentence.to_owned(),
        };
        let text = "Spring was moving\nin the air. He scraped and scratched.";
        let ranked = rank(
            &[
                found("past-continuous", 2, "Spring was moving in the air."),
                found("past-simple", 5, "He never scraped."),
                found("invented", 9, "He scraped and scratched."),
                found("past-simple", 4, "He scraped and scratched."),
                found("can", 2, ""),
            ],
            text,
        );
        let seen: Vec<_> = ranked
            .iter()
            .map(|each| (each.key.as_str(), each.count, each.example.as_str()))
            .collect();
        assert_eq!(
            seen,
            [
                ("past-simple", 9, "He scraped and scratched."),
                ("can", 2, ""),
                ("past-continuous", 2, "Spring was moving in the air."),
            ]
        );
    }
}
