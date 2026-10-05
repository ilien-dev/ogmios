//! Listening, decided by code alone: no model is asked anything.
//!
//! A dictation plays a sentence of the book and compares what the learner
//! typed with it, word by word. There are no points. What says how the
//! learner is doing is the fastest pace they understand: the one where
//! nearly every word of the last sentences was heard. A word missed again
//! and again is reinforced: later sessions keep some of their sentences for
//! it, from anywhere in the book, until it is heard a few times running.
//! None of it reaches the recall of words: an ear is not a vocabulary.

use std::collections::{HashMap, HashSet};

use crate::books::practice::pick;
use crate::domain::{MissedWord, Pace, PaceHint, PaceStanding, StructureVerdict};

/// How many sentences a session dictates, before a missed one comes back.
pub const SIZE: usize = 10;

/// How many of them are kept for the words being reinforced.
pub const REINFORCED_SLOTS: usize = 3;

/// A sentence shorter than this is guessed, and a longer one is not held in
/// the head long enough to type.
const SHORTEST: usize = 6;
const LONGEST: usize = 14;

/// Listening to a sentence more often than this is help.
pub const FREE_LISTENS: u32 = 2;

/// The sentences a pace is judged on: its latest.
pub const WINDOW: usize = 30;

/// Fewer sentences than this at a pace say nothing about it yet.
const ENOUGH: u32 = 10;

/// A pace is understood with this many words heard in a hundred.
const HELD: u32 = 90;

/// A session under this many is one to slow down after.
const LOST: u32 = 60;

/// A word missed this often is reinforced, and left alone again once it
/// was heard this many times running.
const MISSES: u32 = 3;
const STREAK: u32 = 3;

/// How many words are reinforced at once; the rest wait.
const REINFORCED_AT_ONCE: usize = 5;

/// How many missed words the menu shows, each missed at least twice.
const MISSED_SHOWN: usize = 6;
const MISSED_TWICE: u32 = 2;

/// Every pace, slowest first.
pub const PACES: [Pace; 3] = [Pace::Slow, Pace::Normal, Pace::Fast];

fn is_apostrophe(c: char) -> bool {
    matches!(c, '\'' | '’' | '‘')
}

/// A word as it is told apart from another: lowercase, its apostrophes
/// straight, without the marks around it. None for a dash or a row of dots.
pub fn key(word: &str) -> Option<String> {
    let bare = word.trim_matches(|c: char| !c.is_alphanumeric());
    (!bare.is_empty()).then(|| {
        bare.chars()
            .map(|c| if is_apostrophe(c) { '\'' } else { c })
            .flat_map(char::to_lowercase)
            .collect()
    })
}

/// A contraction written out, where it can only be one thing: "don't" is
/// "do not" to the ear. "'s" and "'d" are two things each, and stay.
fn written_out(token: &str) -> Vec<String> {
    let whole = |words: &[&str]| words.iter().map(|word| (*word).to_owned()).collect();
    match token {
        "can't" | "cannot" => return whole(&["can", "not"]),
        "won't" => return whole(&["will", "not"]),
        "shan't" => return whole(&["shall", "not"]),
        "i'm" => return whole(&["i", "am"]),
        _ => {}
    }
    for (ending, word) in [
        ("n't", "not"),
        ("'re", "are"),
        ("'ve", "have"),
        ("'ll", "will"),
    ] {
        if let Some(stem) = token.strip_suffix(ending).filter(|stem| !stem.is_empty()) {
            return vec![stem.to_owned(), word.to_owned()];
        }
    }
    vec![token.to_owned()]
}

/// What is heard of a word as it is written: "well-known" is two words to
/// the ear, and a dash none.
fn tokens(word: &str) -> Vec<String> {
    word.split(|c: char| !c.is_alphanumeric() && !is_apostrophe(c))
        .filter_map(key)
        .flat_map(|token| written_out(&token))
        .collect()
}

/// One word of a dictated sentence, as it is written there, and whether the
/// learner typed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Word {
    pub text: String,
    /// None for a mark alone: there is nothing to hear.
    pub key: Option<String>,
    pub heard: bool,
}

/// A sentence against what was typed for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Compared {
    pub words: Vec<Word>,
    /// Every word was typed, and nothing else was.
    pub whole: bool,
}

/// Which of `target` are in `typed`, in order: the longest run both share.
fn shared(target: &[String], typed: &[String]) -> Vec<bool> {
    let mut longest = vec![vec![0_usize; typed.len() + 1]; target.len() + 1];
    for at in (0..target.len()).rev() {
        for with in (0..typed.len()).rev() {
            longest[at][with] = if target[at] == typed[with] {
                longest[at + 1][with + 1] + 1
            } else {
                longest[at + 1][with].max(longest[at][with + 1])
            };
        }
    }
    let mut found = vec![false; target.len()];
    let (mut at, mut with) = (0, 0);
    while at < target.len() && with < typed.len() {
        if target[at] == typed[with] {
            found[at] = true;
            at += 1;
            with += 1;
        } else if longest[at + 1][with] >= longest[at][with + 1] {
            at += 1;
        } else {
            with += 1;
        }
    }
    found
}

/// Compares what was typed with the sentence dictated, word by word. Case
/// and punctuation are not heard, and a contraction is its words.
pub fn compare(sentence: &str, typed: &str) -> Compared {
    let shown: Vec<&str> = sentence.split_whitespace().collect();
    let parts: Vec<Vec<String>> = shown.iter().map(|word| tokens(word)).collect();
    let target: Vec<String> = parts.iter().flatten().cloned().collect();
    let typed: Vec<String> = typed.split_whitespace().flat_map(tokens).collect();
    let found = shared(&target, &typed);
    let mut from = 0;
    let words = shown
        .iter()
        .zip(&parts)
        .map(|(text, part)| {
            let heard = found[from..from + part.len()].iter().all(|found| *found);
            from += part.len();
            Word {
                text: (*text).to_owned(),
                key: key(text),
                heard,
            }
        })
        .collect();
    Compared {
        words,
        whole: found.iter().all(|found| *found) && typed.len() == target.len(),
    }
}

/// What a dictated sentence is worth: red with a word missing or one too
/// many; amber when it is whole with help, listened to more than twice or
/// slowed down once it had been heard; green otherwise.
pub fn verdict(whole: bool, listens: u32, slowed: bool) -> StructureVerdict {
    if !whole {
        StructureVerdict::Wrong
    } else if listens > FREE_LISTENS || slowed {
        StructureVerdict::Partial
    } else {
        StructureVerdict::Correct
    }
}

/// How many words of a sentence there are to hear.
fn length(sentence: &str) -> usize {
    sentence.split_whitespace().filter_map(key).count()
}

/// Whether a sentence is one to dictate: neither guessed nor too long to
/// hold.
pub fn fits(sentence: &str) -> bool {
    (SHORTEST..=LONGEST).contains(&length(sentence))
}

fn has(sentence: &str, word: &str) -> bool {
    sentence
        .split_whitespace()
        .filter_map(key)
        .any(|key| key == word)
}

/// One sentence a session dictates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Planned {
    pub sentence: String,
    /// The word it is there to reinforce, when it is.
    pub reinforces: Option<String>,
}

/// The sentences among `from` that fit and are not `taken`, in an order
/// drawn from `seed`: those never dictated first.
fn drawn<'a>(
    from: &'a [String],
    taken: &HashSet<&str>,
    asked: &HashSet<String>,
    seed: u64,
) -> Vec<&'a str> {
    let mut met = HashSet::new();
    let open: Vec<&str> = from
        .iter()
        .map(String::as_str)
        .filter(|sentence| fits(sentence) && !taken.contains(sentence) && met.insert(*sentence))
        .collect();
    let (mut fresh, mut old): (Vec<&str>, Vec<&str>) = open
        .into_iter()
        .partition(|sentence| !asked.contains(*sentence));
    let mut order = Vec::with_capacity(fresh.len() + old.len());
    for left in [&mut fresh, &mut old] {
        while let Some(at) = pick(seed, order.len(), left.len()) {
            order.push(left.swap_remove(at));
        }
    }
    order
}

/// The sentences of a session: one from anywhere in the `book` for each of
/// the first words being `reinforced`, and the rest from the `chapter`, all
/// in an order drawn from `seed`. A sentence dictated before (`asked`) is
/// taken only when no other is left.
pub fn plan(
    chapter: &[String],
    book: &[String],
    asked: &HashSet<String>,
    reinforced: &[String],
    seed: u64,
) -> Vec<Planned> {
    let mut taken: HashSet<&str> = HashSet::new();
    let mut planned = Vec::new();
    for word in reinforced.iter().take(REINFORCED_SLOTS) {
        let with = drawn(book, &taken, asked, seed)
            .into_iter()
            .find(|sentence| has(sentence, word));
        if let Some(sentence) = with {
            taken.insert(sentence);
            planned.push(Planned {
                sentence: sentence.to_owned(),
                reinforces: Some(word.clone()),
            });
        }
    }
    let rest = SIZE.saturating_sub(planned.len());
    for sentence in drawn(chapter, &taken, asked, seed).into_iter().take(rest) {
        planned.push(Planned {
            sentence: sentence.to_owned(),
            reinforces: None,
        });
    }
    let mut order = Vec::with_capacity(planned.len());
    while let Some(at) = pick(seed, SIZE + order.len(), planned.len()) {
        order.push(planned.swap_remove(at));
    }
    order
}

/// One sentence answered: the pace it counts at, and how many of its words
/// were heard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Heard {
    pub pace: Pace,
    pub right: u32,
    pub total: u32,
}

/// How the learner stands at each pace, slowest first, over the latest
/// `window` sentences answered at it. `log` is newest first.
pub fn standings(log: &[Heard], window: usize) -> Vec<PaceStanding> {
    PACES
        .iter()
        .map(|pace| {
            let latest = log.iter().filter(|heard| heard.pace == *pace).take(window);
            let (right, total, sentences) =
                latest.fold((0, 0, 0), |(right, total, sentences), heard| {
                    (right + heard.right, total + heard.total, sentences + 1)
                });
            PaceStanding {
                pace: *pace,
                right,
                total,
                sentences,
                held: sentences >= ENOUGH && right * 100 >= total * HELD,
            }
        })
        .collect()
}

/// The fastest pace the learner understands; none before any is held.
pub fn understood(standings: &[PaceStanding]) -> Option<Pace> {
    standings
        .iter()
        .filter(|standing| standing.held)
        .map(|standing| standing.pace)
        .max()
}

fn faster(pace: Pace) -> Option<Pace> {
    PACES.iter().copied().find(|other| *other > pace)
}

fn slower(pace: Pace) -> Option<Pace> {
    PACES.iter().rev().copied().find(|other| *other < pace)
}

/// The pace a session is offered at: the one above what is understood, the
/// next thing to earn; the normal one before anything is.
pub fn offered(understood: Option<Pace>) -> Pace {
    understood.map_or(Pace::Normal, |pace| faster(pace).unwrap_or(pace))
}

/// The pace most of a session was answered at; the slower one in a tie.
pub fn pace_of(session: &[Heard]) -> Option<Pace> {
    PACES
        .iter()
        .rev()
        .copied()
        .max_by_key(|pace| session.iter().filter(|heard| heard.pace == *pace).count())
        .filter(|pace| session.iter().any(|heard| heard.pace == *pace))
}

/// What a finished session suggests, and the learner decides: slowing down
/// after one that was mostly lost, speeding up once the last two sessions'
/// worth of sentences at its pace were understood. `log` is newest first
/// and holds the session.
pub fn hint(session: &[Heard], log: &[Heard]) -> Option<PaceHint> {
    let pace = pace_of(session)?;
    let (right, total) = session.iter().fold((0, 0), |(right, total), heard| {
        (right + heard.right, total + heard.total)
    });
    if right * 100 < total * LOST {
        return slower(pace).map(|_| PaceHint::Slower);
    }
    let two = SIZE * 2;
    let lately = standings(log, two)
        .into_iter()
        .find(|standing| standing.pace == pace)?;
    let enough = usize::try_from(lately.sentences).is_ok_and(|sentences| sentences >= two);
    (enough && lately.held)
        .then(|| faster(pace).map(|_| PaceHint::Faster))
        .flatten()
}

/// How a word went each time it was dictated, oldest first.
fn by_word(log: &[(String, bool)]) -> Vec<(&str, u32, u32)> {
    let mut order: Vec<&str> = Vec::new();
    let mut tallies: HashMap<&str, (u32, u32)> = HashMap::new();
    for (word, heard) in log {
        let tally = tallies.entry(word.as_str()).or_insert_with(|| {
            order.push(word.as_str());
            (0, 0)
        });
        *tally = if *heard {
            (tally.0, tally.1 + 1)
        } else {
            (tally.0 + 1, 0)
        };
    }
    let mut words: Vec<(&str, u32, u32)> = order
        .into_iter()
        .map(|word| {
            let (misses, streak) = tallies[word];
            (word, misses, streak)
        })
        .collect();
    // The most missed first; among equals, the one missed first.
    words.sort_by_key(|(_, misses, _)| std::cmp::Reverse(*misses));
    words
}

/// The words being reinforced, the most missed first: missed often, and not
/// yet heard enough times running since. `log` is oldest first.
pub fn reinforced(log: &[(String, bool)]) -> Vec<String> {
    by_word(log)
        .into_iter()
        .filter(|(_, misses, streak)| *misses >= MISSES && *streak < STREAK)
        .take(REINFORCED_AT_ONCE)
        .map(|(word, _, _)| word.to_owned())
        .collect()
}

/// The words that escape the learner most. `log` is oldest first.
pub fn missed(log: &[(String, bool)]) -> Vec<MissedWord> {
    by_word(log)
        .into_iter()
        .filter(|(_, misses, _)| *misses >= MISSED_TWICE)
        .take(MISSED_SHOWN)
        .map(|(word, times, _)| MissedWord {
            word: word.to_owned(),
            times,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SENTENCE: &str = "Graham maneuvered through the maze of tables with exaggerated care.";

    fn heard(compared: &Compared) -> Vec<bool> {
        compared.words.iter().map(|word| word.heard).collect()
    }

    #[test]
    fn a_sentence_typed_as_it_sounds_is_whole_whatever_its_case_and_marks() {
        let compared = compare(
            "“Just got done with it,” he said.",
            "just got done with it he said",
        );
        assert!(compared.whole);
        assert!(heard(&compared).iter().all(|heard| *heard));
        assert_eq!(compared.words[0].text, "“Just");
        assert_eq!(compared.words[0].key.as_deref(), Some("just"));
    }

    #[test]
    fn the_words_not_typed_are_the_ones_missed() {
        let compared = compare(
            SENTENCE,
            "Graham moved through the maze of tables with care",
        );
        assert!(!compared.whole);
        let missed: Vec<&str> = compared
            .words
            .iter()
            .filter(|word| !word.heard)
            .map(|word| word.text.as_str())
            .collect();
        assert_eq!(missed, ["maneuvered", "exaggerated"]);
    }

    #[test]
    fn a_word_too_many_is_not_the_sentence() {
        let compared = compare("He ran home.", "he ran back home");
        assert!(heard(&compared).iter().all(|heard| *heard));
        assert!(!compared.whole);
        assert!(!compare("He ran home.", "").whole);
    }

    #[test]
    fn a_contraction_is_its_words_to_the_ear() {
        assert!(compare("I don’t know; we’ll see.", "I do not know we will see").whole);
        assert!(compare("They do not know.", "they don't know").whole);
        assert!(compare("You cannot stay.", "you can't stay").whole);
        // "'d" is "had" or "would": it stays as it is written.
        assert!(!compare("He'd gone.", "he would gone").whole);
        assert!(compare("He'd gone.", "he'd gone").whole);
    }

    #[test]
    fn a_dash_is_not_heard_and_a_hyphen_joins_two_words() {
        let compared = compare("A well-known inn — empty.", "a well known inn empty");
        assert!(compared.whole);
        assert_eq!(compared.words[3].key, None);
        let half = compare("A well-known inn.", "a well inn");
        assert_eq!(heard(&half), [true, false, true]);
    }

    #[test]
    fn help_turns_a_whole_sentence_amber_and_nothing_saves_a_missed_one() {
        assert_eq!(verdict(true, 2, false), StructureVerdict::Correct);
        assert_eq!(verdict(true, 0, false), StructureVerdict::Correct);
        assert_eq!(verdict(true, 3, false), StructureVerdict::Partial);
        assert_eq!(verdict(true, 1, true), StructureVerdict::Partial);
        assert_eq!(verdict(false, 1, false), StructureVerdict::Wrong);
    }

    #[test]
    fn a_sentence_to_dictate_is_neither_short_nor_long() {
        assert!(!fits("He ran home — fast."));
        assert!(fits("He ran all the way home."));
        assert!(fits(SENTENCE));
        assert!(!fits(
            "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen."
        ));
    }

    fn sentences(count: usize, about: &str) -> Vec<String> {
        (0..count)
            .map(|at| format!("The {about} number {at} sat by the old door."))
            .collect()
    }

    #[test]
    fn a_session_is_ten_sentences_of_the_chapter_each_once() {
        let chapter = sentences(25, "cat");
        let planned = plan(&chapter, &chapter, &HashSet::new(), &[], 7);
        assert_eq!(planned.len(), SIZE);
        let unique: HashSet<&str> = planned.iter().map(|each| each.sentence.as_str()).collect();
        assert_eq!(unique.len(), SIZE);
        assert!(planned.iter().all(|each| each.reinforces.is_none()));
        assert_eq!(planned, plan(&chapter, &chapter, &HashSet::new(), &[], 7));
        assert_ne!(planned, plan(&chapter, &chapter, &HashSet::new(), &[], 8));
    }

    #[test]
    fn sentences_dictated_before_wait_until_no_other_is_left() {
        let chapter = sentences(12, "cat");
        let asked: HashSet<String> = chapter[..4].iter().cloned().collect();
        let planned = plan(&chapter, &chapter, &asked, &[], 3);
        let old = planned
            .iter()
            .filter(|each| asked.contains(&each.sentence))
            .count();
        assert_eq!((planned.len(), old), (SIZE, 2));
    }

    #[test]
    fn a_short_chapter_gives_the_sentences_it_has() {
        let mut chapter = sentences(3, "cat");
        chapter.push("Too short.".into());
        chapter.push(chapter[0].clone());
        assert_eq!(plan(&chapter, &chapter, &HashSet::new(), &[], 1).len(), 3);
    }

    #[test]
    fn up_to_three_sentences_are_kept_for_the_words_being_reinforced() {
        let chapter = sentences(20, "cat");
        let mut book = chapter.clone();
        book.push("She said she’d never seen them before today.".into());
        book.push("Most of them were asleep by the fire.".into());
        book.push("None of them ever came back to the inn.".into());
        let words: Vec<String> = ["she'd", "of", "them", "door", "missing"]
            .iter()
            .map(|word| (*word).to_owned())
            .collect();
        let planned = plan(&chapter, &book, &HashSet::new(), &words, 5);
        assert_eq!(planned.len(), SIZE);
        let kept: Vec<(&str, &str)> = planned
            .iter()
            .filter_map(|each| Some((each.reinforces.as_deref()?, each.sentence.as_str())))
            .collect();
        assert_eq!(kept.len(), REINFORCED_SLOTS);
        for (word, sentence) in kept {
            assert!(has(sentence, word), "{word} is in {sentence}");
        }
    }

    fn at(pace: Pace, right: u32, total: u32) -> Heard {
        Heard { pace, right, total }
    }

    #[test]
    fn the_pace_understood_is_the_fastest_held_over_its_latest_sentences() {
        assert_eq!(understood(&standings(&[], WINDOW)), None);
        // Nine sentences say nothing yet.
        let few = vec![at(Pace::Normal, 10, 10); 9];
        assert_eq!(understood(&standings(&few, WINDOW)), None);

        let mut log = vec![at(Pace::Fast, 8, 10); 10];
        log.extend(vec![at(Pace::Normal, 9, 10); 10]);
        log.extend(vec![at(Pace::Slow, 10, 10); 10]);
        let stand = standings(&log, WINDOW);
        assert_eq!(
            stand[1],
            PaceStanding {
                pace: Pace::Normal,
                right: 90,
                total: 100,
                sentences: 10,
                held: true
            }
        );
        assert_eq!(understood(&stand), Some(Pace::Normal));

        // Only the latest sentences of a pace count: old misses are left behind.
        let mut better = vec![at(Pace::Fast, 10, 10); WINDOW];
        better.extend(log);
        assert_eq!(understood(&standings(&better, WINDOW)), Some(Pace::Fast));
    }

    #[test]
    fn a_session_is_offered_a_pace_above_the_one_understood() {
        assert_eq!(offered(None), Pace::Normal);
        assert_eq!(offered(Some(Pace::Slow)), Pace::Normal);
        assert_eq!(offered(Some(Pace::Normal)), Pace::Fast);
        assert_eq!(offered(Some(Pace::Fast)), Pace::Fast);
    }

    #[test]
    fn a_lost_session_suggests_slowing_down_and_two_understood_speeding_up() {
        let lost = vec![at(Pace::Normal, 5, 10); 10];
        assert_eq!(hint(&lost, &lost), Some(PaceHint::Slower));
        let lost_slow = vec![at(Pace::Slow, 5, 10); 10];
        assert_eq!(hint(&lost_slow, &lost_slow), None);

        let good = vec![at(Pace::Normal, 10, 10); 10];
        assert_eq!(hint(&good, &good), None, "one session is not two");
        let twice = vec![at(Pace::Normal, 10, 10); 20];
        assert_eq!(hint(&good, &twice), Some(PaceHint::Faster));
        let fast = vec![at(Pace::Fast, 10, 10); 20];
        assert_eq!(hint(&fast[..10], &fast), None, "nothing is faster");
        assert_eq!(hint(&[], &twice), None);
    }

    #[test]
    fn the_pace_of_a_session_is_the_one_most_of_it_was_answered_at() {
        let mut session = vec![at(Pace::Fast, 1, 1); 5];
        session.extend(vec![at(Pace::Slow, 1, 1); 5]);
        assert_eq!(pace_of(&session), Some(Pace::Slow));
        session.push(at(Pace::Fast, 1, 1));
        assert_eq!(pace_of(&session), Some(Pace::Fast));
    }

    fn met(log: &[(&str, bool)]) -> Vec<(String, bool)> {
        log.iter()
            .map(|(word, heard)| ((*word).to_owned(), *heard))
            .collect()
    }

    #[test]
    fn a_word_missed_three_times_is_reinforced_until_heard_three_times_running() {
        let mut log = met(&[("of", false), ("of", false), ("the", true)]);
        assert_eq!(reinforced(&log), Vec::<String>::new());
        log.extend(met(&[("of", false)]));
        assert_eq!(reinforced(&log), ["of"]);
        log.extend(met(&[("of", true), ("of", true)]));
        assert_eq!(reinforced(&log), ["of"]);
        log.extend(met(&[("of", true)]));
        assert_eq!(reinforced(&log), Vec::<String>::new());
        // Missed again, it is back at once.
        log.extend(met(&[("of", false)]));
        assert_eq!(reinforced(&log), ["of"]);
    }

    #[test]
    fn five_words_are_reinforced_at_once_the_most_missed_first() {
        let mut log = Vec::new();
        for (word, misses) in [("a", 3), ("b", 5), ("c", 3), ("d", 4), ("e", 3), ("f", 3)] {
            log.extend(std::iter::repeat_n((word.to_owned(), false), misses));
        }
        assert_eq!(reinforced(&log), ["b", "d", "a", "c", "e"]);
        let shown = missed(&log);
        assert_eq!(shown.len(), MISSED_SHOWN);
        assert_eq!(
            shown[0],
            MissedWord {
                word: "b".into(),
                times: 5
            }
        );
        assert_eq!(missed(&met(&[("of", false), ("in", true)])), []);
    }
}
