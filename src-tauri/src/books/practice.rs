//! Practising a chapter's words: how many correct answers in a row a word
//! needs, when it is done, whether an answer is right, which question a
//! session asks next and when it ends, how far it is, and how long a session
//! of a size is likely to take. Nothing here touches the database or the
//! clock: the answers given so far come in, the decision goes out.
//!
//! A word's standing is never stored. It is read off its answers, oldest
//! first ([`owed`]), so undoing a miss later is changing that one answer.

use super::vocab::{tokens, LEADING};
use crate::domain::{Direction, SentencePart, SessionSize, SittingProgress};

/// Correct answers in a row that finish a word in a direction.
pub const IN_A_ROW: u32 = 2;
/// Correct answers native → English that finish a review word, one finished
/// in another chapter, while it has not been missed that way in this one.
pub const REVIEW_CHECK: u32 = 1;
/// The readiness of a chapter that can be read: every word done or known.
pub const READY: u32 = 100;
/// Other questions that come between two questions about the same word, in
/// either direction, after a right answer as after a miss: an answer is never
/// read off what was on the screen a moment ago. Near the end of a session,
/// when fewer words are open than this takes, the gap is the widest there is.
pub const SPACING: usize = 5;
/// The sizes a session is offered in, in words, beside "every open word".
pub const SIZES: [u32; 3] = [10, 20, 40];
/// Answers a word is expected to take: two each way and one miss.
pub const ANSWERS_PER_WORD: u32 = 5;
/// How long an answer is taken to last, in milliseconds, until the learner
/// has given [`OWN_PACE_AFTER`] of them.
pub const DEFAULT_PACE_MS: u64 = 8_000;
/// Recorded answers from which the learner's own pace is used.
pub const OWN_PACE_AFTER: usize = 30;
/// The longest time between two answers that counts as answering, in
/// milliseconds: a longer one is a break, and says nothing of the pace.
pub const LONGEST_GAP_MS: i64 = 60_000;

/// One answer of a word's history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Answer {
    pub direction: Direction,
    pub correct: bool,
}

/// The run of correct answers in `direction` as it stood after each answer
/// given that way, oldest first: one more for a correct answer, never past
/// [`IN_A_ROW`]; back to none for a miss. Answers the other way are not part
/// of it and do not break it.
fn runs(direction: Direction, answers: &[Answer]) -> impl Iterator<Item = u32> + '_ {
    answers
        .iter()
        .filter(move |answer| answer.direction == direction)
        .scan(0_u32, |run, answer| {
            *run = if answer.correct {
                run.saturating_add(1).min(IN_A_ROW)
            } else {
                0
            };
            Some(*run)
        })
}

/// Correct answers in a row the word stands on in `direction`, from its
/// answers oldest first: those at the end of what it was asked that way, at
/// most [`IN_A_ROW`]. A miss leaves none, whatever came before it.
pub fn run(direction: Direction, answers: &[Answer]) -> u32 {
    runs(direction, answers).last().unwrap_or(0)
}

/// Correct answers in a row the word still owes in `direction`: what its
/// [`run`] lacks to reach [`IN_A_ROW`]. A miss adds nothing beyond undoing
/// the run, and a direction that was finished owes again after one: that is
/// how a miss in the refresh before reading sends a word back.
pub fn owed(direction: Direction, answers: &[Answer]) -> u32 {
    IN_A_ROW.saturating_sub(run(direction, answers))
}

/// Whether a word that is not a review word is finished, from its answers
/// alone ([`SessionWord::is_done`]).
#[cfg(test)]
pub fn is_done(answers: &[Answer]) -> bool {
    let word = SessionWord {
        word_id: String::new(),
        review: false,
        answers: answers.to_vec(),
    };
    word.is_done()
}

/// How ready a prepared chapter is to be read, as a percentage: the share of
/// its `words` that are `settled`, done or already known. Rounded down, so it
/// says 100 only when every word is settled; a chapter with no word to learn
/// is ready as it is.
pub fn readiness(words: u32, settled: u32) -> u32 {
    if settled >= words {
        return READY;
    }
    let share = u64::from(settled) * u64::from(READY) / u64::from(words);
    u32::try_from(share).unwrap_or(READY)
}

/// Whether the word is asked in `direction` yet. English → native always
/// is; native → English opens once English → native has been finished, at
/// any point of the answers, and stays open even if a later miss makes
/// English → native owe again.
pub fn is_open(direction: Direction, answers: &[Answer]) -> bool {
    match direction {
        Direction::Recognition => true,
        Direction::Production => runs(Direction::Recognition, answers).any(|run| run >= IN_A_ROW),
    }
}

/// Articles that may lead an answer in the learner's language. An entry
/// ending in an apostrophe is written joined to its noun ("l'eau").
const ARTICLES: [(&str, &[&str]); 7] = [
    (
        "es",
        &["el", "la", "los", "las", "un", "una", "unos", "unas"],
    ),
    ("pt", &["o", "a", "os", "as", "um", "uma", "uns", "umas"]),
    ("fr", &["le", "la", "les", "un", "une", "des", "l'"]),
    (
        "it",
        &[
            "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "l'", "un'",
        ],
    ),
    ("de", &["der", "die", "das", "ein", "eine"]),
    ("nl", &["de", "het", "een"]),
    ("ca", &["el", "la", "els", "les", "un", "una", "l'"]),
];

/// The leading articles of a language, by its tag ("es", "es-MX"); none for
/// a language without a table.
pub fn articles(lang: &str) -> &'static [&'static str] {
    let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
    ARTICLES
        .iter()
        .find(|(tag, _)| *tag == primary)
        .map_or(&[], |(_, list)| list)
}

/// An answer as it is compared: lowercase, without accents, punctuation or
/// surrounding spaces, and without a leading article. An article alone stays:
/// it is the whole answer.
fn normal(text: &str, articles: &[&str]) -> String {
    let mut words = tokens(text);
    if words.len() > 1 && articles.contains(&words[0].as_str()) {
        words.remove(0);
    } else if let Some(first) = words.first_mut() {
        let joined = articles
            .iter()
            .filter(|article| article.ends_with('\''))
            .find_map(|article| first.strip_prefix(article))
            .filter(|rest| !rest.is_empty())
            .map(str::to_owned);
        if let Some(rest) = joined {
            *first = rest;
        }
    }
    words.join(" ")
}

/// Whether `answer` is one of the `accepted` translations, ignoring case,
/// accents, punctuation, surrounding spaces and a leading article from
/// `articles`. An empty answer is never right.
pub fn accepts(answer: &str, accepted: &[String], articles: &[&str]) -> bool {
    let given = normal(answer, articles);
    !given.is_empty()
        && accepted
            .iter()
            .any(|translation| normal(translation, articles) == given)
}

/// Whether `answer` is the English word: its base form or any form the book
/// uses, ignoring case, punctuation, surrounding spaces and a leading "to" or
/// article.
pub fn accepts_english(answer: &str, lemma: &str, forms: &[String]) -> bool {
    let mut accepted = forms.to_vec();
    accepted.push(lemma.to_owned());
    accepts(answer, &accepted, &LEADING)
}

/// One word of a session, with every answer it was ever given, in any
/// sitting, oldest first: what it owes is read off them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionWord {
    pub word_id: String,
    /// A review word: one that was finished in another chapter. It is only
    /// checked here, once, native → English.
    pub review: bool,
    pub answers: Vec<Answer>,
}

impl SessionWord {
    /// Whether the word is only checked in `direction`: it is a review word
    /// and was never missed that way in this chapter. A miss puts the
    /// direction back under the rule of any other word, two in a row from
    /// there: that is how a missed check, or a miss in the refresh, is made
    /// up for.
    fn is_spared(&self, direction: Direction) -> bool {
        let missed = |answer: &Answer| answer.direction == direction && !answer.correct;
        self.review && !self.answers.iter().any(missed)
    }

    /// Correct answers in a row the word still owes in `direction`: what
    /// [`owed`] says, unless the word is only checked that way. Then it owes
    /// nothing English → native, and [`REVIEW_CHECK`] native → English.
    pub fn owed(&self, direction: Direction) -> u32 {
        match (self.is_spared(direction), direction) {
            (false, _) => owed(direction, &self.answers),
            (true, Direction::Recognition) => 0,
            (true, Direction::Production) => {
                REVIEW_CHECK.saturating_sub(run(direction, &self.answers))
            }
        }
    }

    /// Whether the word is asked in `direction` yet: what [`is_open`] says,
    /// and a review word either way from the start. Its check is native →
    /// English, and waits for nothing.
    pub fn is_open(&self, direction: Direction) -> bool {
        self.review || is_open(direction, &self.answers)
    }

    /// THE rule for a finished word, and the only place it is written: the
    /// word owes nothing in either direction.
    pub fn is_done(&self) -> bool {
        DIRECTIONS
            .iter()
            .all(|direction| self.owed(*direction) == 0)
    }
}

/// One answer given in a session. A session's log is these, oldest first:
/// the order its questions were asked in, which is what spacing counts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asked {
    pub word_id: String,
    pub direction: Direction,
    pub correct: bool,
}

/// A word in one direction that is open and still owes something.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Question<'a> {
    pub word_id: &'a str,
    pub direction: Direction,
    /// Correct answers in a row it still owes in this direction.
    pub owed: u32,
}

/// The two ways a word is asked, the one reading needs first.
const DIRECTIONS: [Direction; 2] = [Direction::Recognition, Direction::Production];

/// What is left to ask of `words`, in their order, English → native before
/// native → English: one question for every direction of a word that is open
/// and still owes something. A finished word has none, so it is never asked.
pub fn open_questions(words: &[SessionWord]) -> Vec<Question<'_>> {
    let mut open = Vec::new();
    for word in words {
        for direction in DIRECTIONS {
            let owed = word.owed(direction);
            if owed > 0 && word.is_open(direction) {
                open.push(Question {
                    word_id: &word.word_id,
                    direction,
                    owed,
                });
            }
        }
    }
    open
}

/// The question a session asks next, or none when it is over: every one of
/// its words is finished in both directions.
///
/// `words` is the session's words the learner has not said they know, most
/// frequent in the chapter first; `log` the answers given in this session,
/// oldest first. A word is *spaced* when it was never asked in the session or
/// at least [`SPACING`] other questions were asked since its last one, in
/// either direction. Only the session's own log counts, so a session left and
/// gone on with later counts on from where it stopped.
///
/// 1. A missed question comes back as soon as its word is spaced: among the
///    open questions whose latest answer in the session was a miss, the one
///    missed longest ago.
/// 2. Otherwise the pass goes on: among the open questions of spaced words,
///    the one whose word was asked longest ago, a word never asked first and
///    then by frequency; English → native before native → English.
/// 3. With no spaced word left, near the end, the open question whose word
///    was asked longest ago: the gap shrinks to the widest there is, and the
///    same word never comes twice in a row while another is open.
pub fn next<'a>(words: &'a [SessionWord], log: &[Asked]) -> Option<Question<'a>> {
    let open = open_questions(words);
    let asked_at = |word: &str| log.iter().rposition(|asked| asked.word_id == word);
    let spaced = |question: &&Question<'a>| {
        asked_at(question.word_id).is_none_or(|at| log.len() - at > SPACING)
    };
    let missed_at = |question: &Question<'a>| {
        let at = log.iter().rposition(|asked| {
            asked.word_id == question.word_id && asked.direction == question.direction
        })?;
        (!log[at].correct).then_some(at)
    };
    // The first of the least: the words' own order settles a tie.
    let longest_ago = |questions: Vec<&Question<'a>>| {
        questions
            .into_iter()
            .min_by_key(|question| asked_at(question.word_id))
            .copied()
    };
    open.iter()
        .filter(spaced)
        .filter_map(|question| Some((missed_at(question)?, *question)))
        .min_by_key(|(at, _)| *at)
        .map(|(_, question)| question)
        .or_else(|| longest_ago(open.iter().filter(spaced).collect()))
        .or_else(|| longest_ago(open.iter().collect()))
}

/// The steps `words` words take: [`IN_A_ROW`] correct answers each way.
fn steps(words: usize) -> u32 {
    let ways = u32::try_from(DIRECTIONS.len()).unwrap_or(u32::MAX);
    u32::try_from(words)
        .unwrap_or(u32::MAX)
        .saturating_mul(IN_A_ROW.saturating_mul(ways))
}

/// How far a session is, for the bar at its top: the correct answers in a
/// row its `words` stand on now, each way ([`run`]), out of the ones they
/// take in all. `words` is the session's words the learner has not said they
/// know, so a word marked as known leaves both numbers.
///
/// What is missing to the total is exactly what the words still owe
/// ([`owed`]). So a correct answer is one step more; a miss takes back the
/// run it broke, which in a session is one step, since a finished direction
/// is not asked, and none on a word with no run; and a miss turned right
/// later gives the step back.
///
/// A run counts whether or not its direction is asked yet. Answers kept
/// under an older rule can leave native → English with a run while English →
/// native is unfinished. Those answers are not asked for again, so they are
/// progress, and leaving them out would make the answer that opens the
/// direction worth more than one step. The bar is still full only when the
/// session is over: full is every word owing nothing either way, which is
/// [`is_done`] for each, and a word that is not done always has a question
/// open ([`open_questions`]), because finishing English → native is what
/// opens the other way.
///
/// A word that comes into a session with a run already standing (sent back
/// by a miss in the refresh, or answered before the session took it) brings
/// it along: the bar starts at none only for words never answered.
pub fn progress(words: &[SessionWord]) -> SittingProgress {
    let value = words
        .iter()
        .flat_map(|word| DIRECTIONS.map(|direction| run(direction, &word.answers)))
        .fold(0_u32, u32::saturating_add);
    SittingProgress {
        value,
        total: steps(words.len()),
    }
}

/// The bar of a session that is over: full. Its words were all done when it
/// ended, and it shows its summary whatever happened to them afterwards, a
/// miss in the refresh included. With no word left to count it is none out
/// of none, which the screen draws full too.
pub fn progress_over(words: &[SessionWord]) -> SittingProgress {
    let total = steps(words.len());
    SittingProgress {
        value: total,
        total,
    }
}

/// How far a pass of the refresh is: the words it has `asked`, out of those
/// and the ones `left` to ask. Each word is asked once, so it only grows,
/// and it is full when none is left.
pub fn pass_progress(asked: u32, left: usize) -> SittingProgress {
    SittingProgress {
        value: asked,
        total: asked.saturating_add(u32::try_from(left).unwrap_or(u32::MAX)),
    }
}

/// The middle of sorted values; of two middles, their mean.
fn median(sorted: &[u64]) -> Option<u64> {
    let upper = sorted.get(sorted.len() / 2)?;
    if sorted.len() % 2 == 1 {
        return Some(*upper);
    }
    let lower = sorted.get(sorted.len() / 2 - 1)?;
    Some(u64::midpoint(*lower, *upper))
}

/// How long one answer takes this learner, in milliseconds. With fewer than
/// [`OWN_PACE_AFTER`] recorded `answers` it is [`DEFAULT_PACE_MS`]; from
/// then on the median of `gaps`, the milliseconds between consecutive answers
/// of the same sitting, leaving out the ones over [`LONGEST_GAP_MS`]: those
/// are breaks. With no gap left to go by it is the default again.
pub fn pace(answers: usize, gaps: &[i64]) -> u64 {
    if answers < OWN_PACE_AFTER {
        return DEFAULT_PACE_MS;
    }
    let mut own: Vec<u64> = gaps
        .iter()
        .filter(|gap| **gap <= LONGEST_GAP_MS)
        .filter_map(|gap| u64::try_from(*gap).ok())
        .collect();
    own.sort_unstable();
    median(&own).unwrap_or(DEFAULT_PACE_MS)
}

/// About how many minutes a session of `words` words takes at `pace`
/// milliseconds an answer: [`ANSWERS_PER_WORD`] answers a word, rounded to
/// the nearest minute and never less than one while there is a word to ask.
pub fn minutes(words: u32, pace: u64) -> u32 {
    const MINUTE_MS: u64 = 60_000;
    if words == 0 {
        return 0;
    }
    let total = u64::from(words)
        .saturating_mul(u64::from(ANSWERS_PER_WORD))
        .saturating_mul(pace);
    let rounded = total.saturating_add(MINUTE_MS / 2) / MINUTE_MS;
    u32::try_from(rounded).unwrap_or(u32::MAX).max(1)
}

/// The sizes a session is offered in for a chapter with `open` words to
/// practise, each with its estimate at `pace`: every size of [`SIZES`] the
/// chapter has more open words than, and then all of them, which is always
/// there and is the one chosen unless the learner picks another.
pub fn sizes(open: u32, pace: u64) -> Vec<SessionSize> {
    let all = SessionSize {
        size: None,
        words: open,
        minutes: minutes(open, pace),
    };
    SIZES
        .iter()
        .filter(|size| open > **size)
        .map(|size| SessionSize {
            size: Some(*size),
            words: *size,
            minutes: minutes(*size, pace),
        })
        .chain([all])
        .collect()
}

/// A word of a sentence: where it lies, and how it compares.
struct Span {
    start: usize,
    end: usize,
    token: String,
}

fn in_word(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '\'' | '’' | '‘')
}

/// The words of a sentence with their place in it, cut the way
/// [`tokens`] cuts them.
fn spans(sentence: &str) -> Vec<Span> {
    let mut found = Vec::new();
    let mut rest = sentence;
    let mut offset = 0;
    while let Some(skip) = rest.find(in_word) {
        let from = &rest[skip..];
        let len = from.find(|c| !in_word(c)).unwrap_or(from.len());
        let run = &from[..len];
        let word = run.trim_matches(['\'', '’', '‘']);
        let token = tokens(word).concat();
        if !token.is_empty() {
            let start =
                offset + skip + (run.len() - run.trim_start_matches(['\'', '’', '‘']).len());
            found.push(Span {
                start,
                end: start + word.len(),
                token,
            });
        }
        offset += skip + len;
        rest = &from[len..];
    }
    found
}

/// The sentence in pieces, with every occurrence of any of the word's
/// `forms` marked and nothing else. A form that is not there as written (a
/// phrasal verb split by its object) leaves the sentence unmarked.
pub fn mark(sentence: &str, forms: &[String]) -> Vec<SentencePart> {
    let mut runs: Vec<Vec<String>> = forms
        .iter()
        .map(|form| tokens(form))
        .filter(|run| !run.is_empty())
        .collect();
    // The longest form first: "rabbit hole" before "rabbit".
    runs.sort_by_key(|run| std::cmp::Reverse(run.len()));

    let words = spans(sentence);
    let mut parts = Vec::new();
    let mut plain_from = 0;
    let mut at = 0;
    while at < words.len() {
        let matched = runs.iter().find(|run| {
            words
                .get(at..at + run.len())
                .is_some_and(|window| window.iter().map(|span| &span.token).eq(run.iter()))
        });
        let Some(run) = matched else {
            at += 1;
            continue;
        };
        let (start, end) = (words[at].start, words[at + run.len() - 1].end);
        if start > plain_from {
            parts.push(part(&sentence[plain_from..start], false));
        }
        parts.push(part(&sentence[start..end], true));
        plain_from = end;
        at += run.len();
    }
    if plain_from < sentence.len() {
        parts.push(part(&sentence[plain_from..], false));
    }
    parts
}

/// The sentence for asking the word itself: every occurrence of its `forms`
/// is a marked piece with no text, so the word is not there to be read. None
/// when no form is found as written: the sentence would give the word away.
pub fn blank(sentence: &str, forms: &[String]) -> Option<Vec<SentencePart>> {
    let mut parts = mark(sentence, forms);
    let mut hidden = false;
    for part in parts.iter_mut().filter(|part| part.marked) {
        part.text.clear();
        hidden = true;
    }
    hidden.then_some(parts)
}

fn part(text: &str, marked: bool) -> SentencePart {
    SentencePart {
        text: text.to_owned(),
        marked,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    const RIGHT: Answer = Answer {
        direction: Direction::Recognition,
        correct: true,
    };
    const MISS: Answer = Answer {
        direction: Direction::Recognition,
        correct: false,
    };

    const SAID: Answer = Answer {
        direction: Direction::Production,
        correct: true,
    };
    const UNSAID: Answer = Answer {
        direction: Direction::Production,
        correct: false,
    };

    #[test]
    fn readiness_is_the_share_settled_and_full_only_when_all_are() {
        assert_eq!(readiness(8, 0), 0);
        assert_eq!(readiness(8, 2), 25);
        assert_eq!(readiness(3, 2), 66, "rounded down");
        assert_eq!(readiness(300, 299), 99, "never ready with a word open");
        assert_eq!(readiness(8, 8), READY);
        assert_eq!(readiness(0, 0), READY, "nothing to learn is ready");
        assert_eq!(readiness(u32::MAX, u32::MAX - 1), 99);
    }

    #[test]
    fn two_correct_answers_in_a_row_finish_a_direction() {
        assert_eq!(owed(Direction::Recognition, &[]), 2);
        assert_eq!(owed(Direction::Recognition, &[RIGHT]), 1);
        assert_eq!(owed(Direction::Recognition, &[RIGHT, RIGHT]), 0);
        // One more changes nothing.
        assert_eq!(owed(Direction::Recognition, &[RIGHT; 3]), 0);
        assert_eq!(owed(Direction::Production, &[]), 2);
        assert_eq!(owed(Direction::Production, &[SAID, SAID]), 0);
    }

    #[test]
    fn a_miss_resets_the_run_and_adds_nothing() {
        assert_eq!(owed(Direction::Recognition, &[MISS]), 2);
        assert_eq!(owed(Direction::Recognition, &[MISS, MISS, MISS]), 2);
        assert_eq!(owed(Direction::Recognition, &[MISS, RIGHT, RIGHT]), 0);
        assert_eq!(owed(Direction::Recognition, &[MISS, MISS, RIGHT, RIGHT]), 0);
        // One right answer either side of a miss is not two in a row.
        assert_eq!(owed(Direction::Recognition, &[RIGHT, MISS, RIGHT]), 1);
        assert_eq!(owed(Direction::Recognition, &[RIGHT, MISS]), 2);
    }

    #[test]
    fn the_run_is_what_stands_at_the_end_and_never_more_than_it_takes() {
        assert_eq!(run(Direction::Recognition, &[]), 0);
        assert_eq!(run(Direction::Recognition, &[RIGHT]), 1);
        assert_eq!(run(Direction::Recognition, &[RIGHT; 5]), IN_A_ROW);
        assert_eq!(run(Direction::Recognition, &[RIGHT, RIGHT, MISS]), 0);
        assert_eq!(run(Direction::Recognition, &[MISS, RIGHT]), 1);
        assert_eq!(run(Direction::Production, &[RIGHT, RIGHT, SAID]), 1);
    }

    #[test]
    fn a_word_is_done_only_with_both_directions_complete() {
        assert!(!is_done(&[]));
        assert!(!is_done(&[RIGHT; 2]), "only English → native");
        assert!(!is_done(&[SAID; 2]), "only native → English");
        assert!(!is_done(&[RIGHT, RIGHT, SAID]));
        assert!(is_done(&[RIGHT, RIGHT, SAID, SAID]));
        assert!(is_done(&[RIGHT, SAID, RIGHT, SAID]));
    }

    #[test]
    fn answers_given_under_the_old_rule_are_read_the_same_way() {
        // Three correct each way, as the old rule asked for: done.
        assert!(is_done(&[RIGHT, SAID, RIGHT, SAID, RIGHT, SAID]));
        // A miss paid off the old way ended on correct answers: done too.
        let paid = [
            SAID, SAID, SAID, RIGHT, RIGHT, MISS, RIGHT, RIGHT, RIGHT, RIGHT,
        ];
        assert!(is_done(&paid));
    }

    #[test]
    fn a_miss_in_one_direction_leaves_the_other_untouched() {
        let history = [RIGHT, SAID, UNSAID];
        assert_eq!(owed(Direction::Recognition, &history), 1);
        assert_eq!(owed(Direction::Production, &history), 2);
        let history = [RIGHT, MISS, SAID];
        assert_eq!(owed(Direction::Recognition, &history), 2);
        assert_eq!(owed(Direction::Production, &history), 1);
        // A finished direction stays finished while the other is missed.
        let history = [RIGHT, RIGHT, UNSAID, UNSAID];
        assert_eq!(owed(Direction::Recognition, &history), 0);
        assert_eq!(owed(Direction::Production, &history), 2);
        // And an answer the other way does not break a run.
        assert_eq!(owed(Direction::Recognition, &[RIGHT, UNSAID, RIGHT]), 0);
    }

    #[test]
    fn native_to_english_opens_once_recognition_has_been_finished() {
        assert!(is_open(Direction::Recognition, &[]));
        assert!(!is_open(Direction::Production, &[]));
        assert!(!is_open(Direction::Production, &[MISS, MISS]));
        assert!(!is_open(Direction::Production, &[RIGHT]));
        assert!(!is_open(Direction::Production, &[MISS, RIGHT]));
        assert!(!is_open(Direction::Production, &[RIGHT, MISS, RIGHT]));
        assert!(is_open(Direction::Production, &[RIGHT, RIGHT]));
        assert!(is_open(Direction::Production, &[RIGHT, MISS, RIGHT, RIGHT]));
        // Its own answers neither open it nor come between the two.
        assert!(!is_open(Direction::Production, &[SAID, SAID]));
        assert!(is_open(Direction::Production, &[RIGHT, UNSAID, RIGHT]));
    }

    #[test]
    fn a_later_miss_reopens_a_finished_direction_owing_two_in_a_row() {
        // Only the refresh before reading asks a finished direction again.
        let mut history = vec![RIGHT, RIGHT, SAID, SAID];
        assert!(is_done(&history));
        history.push(MISS);
        assert_eq!(owed(Direction::Recognition, &history), 2);
        assert_eq!(owed(Direction::Production, &history), 0);
        assert!(!is_done(&history));
        // Native → English stays open: it opened when the first was finished.
        assert!(is_open(Direction::Production, &history));
        history.push(UNSAID);
        assert!(is_open(Direction::Production, &history));
        history.extend([RIGHT, RIGHT, SAID, SAID]);
        assert!(is_done(&history));
    }

    /// A word finished in another chapter, with these answers in this one.
    fn review(answers: &[Answer]) -> SessionWord {
        SessionWord {
            word_id: "w".to_owned(),
            review: true,
            answers: answers.to_vec(),
        }
    }

    #[test]
    fn a_word_finished_elsewhere_is_checked_once_native_to_english() {
        let (there, back) = (Direction::Recognition, Direction::Production);
        let fresh = review(&[]);
        let check = Question {
            word_id: "w",
            direction: back,
            owed: 1,
        };
        assert_eq!(open_questions(std::slice::from_ref(&fresh)), [check]);
        assert!(!fresh.is_done());
        assert!(review(&[SAID]).is_done(), "one right answer and it is done");

        // A missed check owes two in a row that way, and nothing the other.
        let missed = review(&[UNSAID]);
        assert_eq!((missed.owed(back), missed.owed(there)), (2, 0));
        assert!(!review(&[UNSAID, SAID]).is_done());
        assert!(review(&[UNSAID, SAID, SAID]).is_done());
        assert_eq!(review(&[SAID, UNSAID]).owed(back), 2);
    }

    #[test]
    fn a_review_word_missed_english_to_native_here_owes_two_in_a_row_that_way() {
        let (there, back) = (Direction::Recognition, Direction::Production);
        // Answers it already had here keep counting; none are asked for.
        assert_eq!(review(&[RIGHT]).owed(there), 0);
        assert_eq!(review(&[RIGHT, RIGHT]).owed(there), 0);
        assert_eq!(review(&[MISS]).owed(there), 2);
        assert_eq!(review(&[MISS, RIGHT]).owed(there), 1);
        assert_eq!(review(&[MISS]).owed(back), 1, "each way on its own");

        // Done by its check, then missed in the refresh of this chapter.
        let reopened = review(&[SAID, MISS]);
        assert!(!reopened.is_done());
        let open = open_questions(std::slice::from_ref(&reopened));
        assert_eq!(open.len(), 1);
        assert_eq!((open[0].direction, open[0].owed), (there, 2));
        assert!(review(&[SAID, MISS, RIGHT, RIGHT]).is_done());
    }

    #[test]
    fn a_missed_check_comes_back_after_five_others_until_two_in_a_row() {
        let back = Direction::Production;
        let mut session = Session::of(8);
        session.words[0].review = true;
        let turns = session.play(|turn| turn != 0);
        assert_eq!((turns[0].word.as_str(), turns[0].direction), ("w00", back));
        assert!(!words_of(&turns[1..=SPACING]).contains(&"w00"));
        let again = &turns[SPACING + 1];
        assert_eq!((again.word.as_str(), again.direction), ("w00", back));
        let asked = turns.iter().filter(|turn| turn.word == "w00");
        assert!(asked.clone().all(|turn| turn.direction == back));
        assert_eq!(asked.count(), 3, "the miss and two in a row");
        assert_eq!(turns.len(), 3 + 7 * 4);
        assert_spaced(&turns);

        // Answered right at once, it is asked that once.
        let mut session = Session::of(8);
        session.words[0].review = true;
        let turns = session.play(|_| true);
        assert_eq!(turns.len(), 1 + 7 * 4);
    }

    #[test]
    fn each_direction_has_its_own_run() {
        assert_eq!(owed(Direction::Recognition, &[RIGHT, UNSAID, MISS]), 2);
        assert_eq!(owed(Direction::Production, &[SAID, MISS, MISS]), 1);
    }

    #[test]
    fn an_undone_miss_is_the_history_with_that_answer_right() {
        let missed = [RIGHT, MISS];
        let upheld = [RIGHT, RIGHT];
        assert_eq!(owed(Direction::Recognition, &missed), 2);
        assert!(!is_open(Direction::Production, &missed));
        assert_eq!(owed(Direction::Recognition, &upheld), 0);
        assert!(is_open(Direction::Production, &upheld));
    }

    #[test]
    fn checking_ignores_case_accents_punctuation_spaces_and_a_leading_article() {
        let spanish = articles("es");
        let casa = ["casa".to_owned(), "el hogar".to_owned()];
        for answer in ["La Casa", "casa", "cása ", "  ¡Casa!", "una casa", "hogar"] {
            assert!(accepts(answer, &casa, spanish), "{answer}");
        }
        for answer in ["cosa", "", "  ", "la", "casa hogar", "casas"] {
            assert!(!accepts(answer, &casa, spanish), "{answer}");
        }
        // ñ is a letter of its own, not an accent.
        assert!(!accepts("ano", &["año".to_owned()], spanish));
        // A translation that is an article is asked as it is.
        assert!(accepts("la", &["la".to_owned()], spanish));
        assert!(accepts(
            "Echar un vistazo.",
            &["echar un vistazo".to_owned()],
            spanish
        ));
    }

    #[test]
    fn articles_depend_on_the_language() {
        let casa = ["casa".to_owned()];
        assert!(!accepts("la casa", &casa, articles("ja")));
        assert!(accepts("la casa", &casa, articles("es-MX")));
        let eau = ["eau".to_owned()];
        assert!(accepts("l’eau", &eau, articles("fr")));
        assert!(accepts("L'eau", &["l'eau".to_owned()], articles("fr")));
        assert!(accepts("das Haus", &["Haus".to_owned()], articles("de")));
        assert!(!accepts("das Haus", &["Haus".to_owned()], articles("es")));
    }

    #[test]
    fn the_english_word_is_its_base_form_or_a_form_in_the_book() {
        let forms = ["run".to_owned(), "ran".to_owned(), "running".to_owned()];
        for answer in ["run", "to run", "ran", "Run.", " RAN ", "the run", "a run"] {
            assert!(accepts_english(answer, "run", &forms), "{answer}");
        }
        for answer in ["walk", "", "to", "runs", "run ran", "to to run", "el run"] {
            assert!(!accepts_english(answer, "run", &forms), "{answer}");
        }
        // The base form counts even when the book never uses it.
        assert!(accepts_english(
            "give up",
            "give up",
            &["gave up".to_owned()]
        ));
        assert!(accepts_english("to give up", "to give up", &[]));
        assert!(accepts_english("An Apple", "apple", &[]));
    }

    /// One question of a simulated session, as it was asked and answered.
    #[derive(Debug, Clone, PartialEq)]
    struct Turn {
        word: String,
        direction: Direction,
        correct: bool,
        /// Words with something left to ask when this question was picked.
        open: usize,
        /// Other open questions whose latest answer was a miss, then.
        missed: usize,
    }

    /// A session played in memory: its words, and the answers given in it.
    struct Session {
        words: Vec<SessionWord>,
        log: Vec<Asked>,
    }

    impl Session {
        /// `count` words never answered, the first the most frequent.
        fn of(count: usize) -> Self {
            let words = (0..count)
                .map(|n| SessionWord {
                    word_id: format!("w{n:02}"),
                    review: false,
                    answers: Vec::new(),
                })
                .collect();
            Self {
                words,
                log: Vec::new(),
            }
        }

        fn ask(&self) -> Option<(String, Direction)> {
            next(&self.words, &self.log)
                .map(|question| (question.word_id.to_owned(), question.direction))
        }

        fn open_words(&self) -> usize {
            let open = open_questions(&self.words);
            let words: HashSet<&str> = open.iter().map(|question| question.word_id).collect();
            words.len()
        }

        /// Open questions other than this one whose latest answer in the
        /// session was a miss.
        fn missed(&self, word: &str, direction: Direction) -> usize {
            open_questions(&self.words)
                .iter()
                .filter(|question| (question.word_id, question.direction) != (word, direction))
                .filter(|question| {
                    self.log
                        .iter()
                        .rfind(|asked| {
                            asked.word_id == question.word_id
                                && asked.direction == question.direction
                        })
                        .is_some_and(|asked| !asked.correct)
                })
                .count()
        }

        fn answer(&mut self, word: &str, direction: Direction, correct: bool) {
            let held = self.words.iter_mut().find(|held| held.word_id == word);
            held.expect("a word of the session")
                .answers
                .push(Answer { direction, correct });
            self.log.push(Asked {
                word_id: word.to_owned(),
                direction,
                correct,
            });
        }

        /// Plays the session to its end, each answer right or wrong as
        /// `right` says of its turn. A finished word is never asked again.
        fn play(&mut self, right: impl Fn(usize) -> bool) -> Vec<Turn> {
            let mut turns: Vec<Turn> = Vec::new();
            let mut finished: HashSet<String> = HashSet::new();
            while let Some((word, direction)) = self.ask() {
                assert!(turns.len() < 2_000, "the session never ends");
                assert!(!finished.contains(&word), "{word} was finished");
                let open = self.open_words();
                let correct = right(turns.len());
                let missed = self.missed(&word, direction);
                self.answer(&word, direction, correct);
                let held = self.words.iter().find(|held| held.word_id == word);
                if held.expect("a word of the session").is_done() {
                    finished.insert(word.clone());
                }
                turns.push(Turn {
                    word,
                    direction,
                    correct,
                    open,
                    missed,
                });
            }
            assert_eq!(finished.len(), self.words.len(), "every word is done");
            turns
        }
    }

    fn words_of(turns: &[Turn]) -> Vec<&str> {
        turns.iter().map(|turn| turn.word.as_str()).collect()
    }

    /// The turn before `at` that asked the same word, in either direction.
    fn before(turns: &[Turn], at: usize) -> Option<usize> {
        turns[..at]
            .iter()
            .rposition(|turn| turn.word == turns[at].word)
    }

    /// Every rule of spacing a played session has to keep.
    fn assert_spaced(turns: &[Turn]) {
        for at in 0..turns.len() {
            let Some(last) = before(turns, at) else {
                continue;
            };
            let between = at - last - 1;
            if turns[at].open > SPACING {
                assert!(
                    between >= SPACING,
                    "{} came back after {between} questions at turn {at}",
                    turns[at].word
                );
            }
            if turns[at].open > 1 {
                assert!(between > 0, "{} twice in a row", turns[at].word);
            }
        }
    }

    #[test]
    fn a_session_goes_round_in_passes_and_ends_when_every_word_is_done() {
        let mut session = Session::of(10);
        let turns = session.play(|_| true);
        let pass: Vec<String> = (0..10).map(|n| format!("w{n:02}")).collect();
        let (there, back) = (Direction::Recognition, Direction::Production);
        // The first look, the second look, and then the same the other way.
        for (round, direction) in [there, there, back, back].into_iter().enumerate() {
            let asked = &turns[round * 10..(round + 1) * 10];
            assert_eq!(words_of(asked), pass, "pass {round}");
            assert!(asked.iter().all(|turn| turn.direction == direction));
        }
        assert_eq!(turns.len(), 40, "two right answers each way");
        assert_eq!(session.ask(), None);
        assert_spaced(&turns);
    }

    #[test]
    fn the_same_question_is_asked_until_it_is_answered() {
        let mut session = Session::of(3);
        let first = session.ask().expect("a word to ask");
        assert_eq!(first, ("w00".to_owned(), Direction::Recognition));
        assert_eq!(session.ask(), Some(first), "left and gone on with");
        session.answer("w00", Direction::Recognition, true);
        assert_eq!(session.ask().expect("the next word").0, "w01");
        assert_eq!(Session::of(0).ask(), None, "nothing to ask");
    }

    #[test]
    fn a_word_is_never_asked_again_before_five_other_questions_while_six_are_open() {
        let mut session = Session::of(10);
        // Wrong answers all over the session.
        let turns = session.play(|turn| turn >= 100 || (turn % 7 != 3 && turn % 11 != 5));
        assert!(turns.iter().filter(|turn| !turn.correct).count() > 8);
        assert_spaced(&turns);
        assert!(
            turns.iter().any(|turn| turn.open == 2) && turns.iter().any(|turn| turn.open == 1),
            "the session narrows down to its last words"
        );
        // After a miss as after a right answer.
        let after_miss = (0..turns.len())
            .filter_map(|at| Some((before(&turns, at)?, at)))
            .filter(|(last, at)| !turns[*last].correct && turns[*at].open > SPACING)
            .map(|(last, at)| at - last - 1)
            .min();
        assert_eq!(after_miss, Some(SPACING));
    }

    #[test]
    fn a_single_missed_question_comes_back_after_exactly_five_others() {
        let mut session = Session::of(20);
        // One miss on a first look, one on a second look, one the other way.
        let missed = [7, 30, 55];
        let turns = session.play(|turn| !missed.contains(&turn));
        for miss in missed {
            let again = miss + SPACING + 1;
            let between = words_of(&turns[miss + 1..again]);
            assert!(!between.contains(&turns[miss].word.as_str()));
            assert_eq!(
                (&turns[again].word, turns[again].direction),
                (&turns[miss].word, turns[miss].direction),
                "the miss of turn {miss}"
            );
        }
        // Not at the end of the pass: the first one came back within it.
        assert_eq!(turns[7].word, "w07");
        assert_eq!(turns[13].word, "w07");
        assert_eq!(turns[14].word, "w13", "and the pass goes on");
        assert_eq!(turns[55].direction, Direction::Production);
        assert_spaced(&turns);
        // A right first look waits for the pass to come round.
        assert_eq!(before(&turns, 21), Some(0));
    }

    #[test]
    fn a_missed_question_waits_for_the_ones_missed_before_it_and_no_longer() {
        let mut session = Session::of(20);
        let wrong =
            |turn: usize| turn < 120 && (turn.is_multiple_of(3) || (40..48).contains(&turn));
        let turns = session.play(|turn| !wrong(turn));
        let mut checked = 0;
        for (at, miss) in turns.iter().enumerate().filter(|(_, turn)| !turn.correct) {
            let again = turns[at + 1..]
                .iter()
                .position(|turn| (&turn.word, turn.direction) == (&miss.word, miss.direction));
            let between = again.expect("a missed question is asked again");
            assert!(
                between <= SPACING + miss.missed,
                "turn {at} came back after {between} with {} waiting",
                miss.missed
            );
            checked += 1;
        }
        assert!(checked > 40);
        assert!(turns.iter().any(|turn| !turn.correct && turn.missed >= 3));
        assert_spaced(&turns);
    }

    #[test]
    fn the_oldest_miss_comes_first_and_ahead_of_words_not_seen_yet() {
        let mut session = Session::of(12);
        let (there, back) = (Direction::Recognition, Direction::Production);
        for (word, correct) in [("w00", false), ("w01", false), ("w02", true)] {
            session.answer(word, there, correct);
        }
        // Neither miss is five questions back yet: the pass goes on.
        for word in ["w03", "w04", "w05"] {
            assert_eq!(session.ask(), Some((word.to_owned(), there)));
            session.answer(word, there, true);
        }
        assert_eq!(session.ask(), Some(("w00".to_owned(), there)));
        session.answer("w00", there, false);
        assert_eq!(session.ask(), Some(("w01".to_owned(), there)));
        session.answer("w01", there, true);
        assert_eq!(session.ask(), Some(("w06".to_owned(), there)));

        // A word open both ways, as a miss in the refresh leaves it, is asked
        // English → native first.
        let mut both = Session::of(1);
        for direction in [there, there, back, back] {
            both.words[0].answers.push(Answer {
                direction,
                correct: true,
            });
        }
        both.words[0].answers.push(RIGHT);
        both.words[0].answers.push(MISS);
        both.words[0].answers.push(UNSAID);
        assert_eq!(both.ask(), Some(("w00".to_owned(), there)));
    }

    #[test]
    fn only_the_answers_of_the_session_count_for_its_order() {
        // Answered in an earlier session, "w01" owes one more and "w02" was
        // missed: here they are words not asked yet, in their own order.
        let mut session = Session::of(8);
        session.words[1].answers.push(RIGHT);
        session.words[2].answers.push(MISS);
        let turns = session.play(|_| true);
        let first: Vec<String> = (0..8).map(|n| format!("w{n:02}")).collect();
        assert_eq!(words_of(&turns[..8]), first);
        assert_eq!(turns.len(), 31, "one answer was already given");
    }

    #[test]
    fn the_last_two_words_alternate_and_the_last_one_is_asked_alone() {
        let mut pair = Session::of(2);
        let turns = pair.play(|turn| turn != 2 && turn != 5);
        let asked = words_of(&turns);
        let last = turns.len() - 1;
        let together = turns.iter().rposition(|turn| turn.open == 2);
        let together = together.expect("two words were open");
        for at in 1..=together {
            assert_ne!(asked[at], asked[at - 1], "turn {at}");
        }
        assert!(turns[..=together].iter().all(|turn| turn.open == 2));
        assert!(together >= 8, "they went on alternating: {asked:?}");
        assert!(turns[together + 1..=last].iter().all(|turn| turn.open == 1));

        // Alone, a word has to come again; it still ends.
        let mut alone = Session::of(1);
        let turns = alone.play(|turn| turn != 1);
        assert_eq!(turns.len(), 6, "the miss cost its own answer and one more");

        // Six words down to two: the gap is the widest there is.
        let mut session = Session::of(6);
        let turns = session.play(|turn| turn % 5 != 4 || turn > 60);
        assert_spaced(&turns);
        for at in 0..turns.len() {
            if let Some(last) = before(&turns, at) {
                let between = at - last - 1;
                assert!(
                    between >= turns[at].open.min(SPACING + 1) - 1,
                    "turn {at}: {between} between with {} open",
                    turns[at].open
                );
            }
        }
    }

    fn bar(session: &Session) -> SittingProgress {
        progress(&session.words)
    }

    fn steps_of(value: u32, total: u32) -> SittingProgress {
        SittingProgress { value, total }
    }

    #[test]
    fn the_bar_is_the_runs_standing_out_of_four_steps_a_word() {
        let there = Direction::Recognition;
        let mut session = Session::of(3);
        assert_eq!(bar(&session), steps_of(0, 12), "words never answered");

        // A miss on a fresh word leaves it where it was.
        session.answer("w00", there, false);
        assert_eq!(bar(&session), steps_of(0, 12));
        // A correct answer is one step more.
        session.answer("w00", there, true);
        assert_eq!(bar(&session), steps_of(1, 12));
        session.answer("w01", there, true);
        assert_eq!(bar(&session), steps_of(2, 12));
        // A miss after one correct takes that step back, and no more.
        session.answer("w00", there, false);
        assert_eq!(bar(&session), steps_of(1, 12));

        // That miss turned right, as an upheld "I was right" turns it, is
        // the step back and the one the answer was worth.
        let mut upheld = session.words.clone();
        upheld[0].answers[2] = RIGHT;
        assert_eq!(progress(&upheld), steps_of(3, 12));

        // A word the learner says they know leaves the session's words: its
        // four steps leave the total, and its run leaves the value.
        assert_eq!(progress(&session.words[1..]), steps_of(1, 8));
        assert_eq!(progress(&upheld[1..]), steps_of(1, 8));
        assert_eq!(progress(&session.words[..1]), steps_of(0, 4));
        assert_eq!(progress(&[]), steps_of(0, 0));

        // More right answers than a direction takes are not more steps.
        upheld[0].answers.extend([RIGHT; 3]);
        assert_eq!(progress(&upheld[..1]), steps_of(2, 4));
    }

    #[test]
    fn the_bar_moves_a_step_at_a_time_and_is_full_only_when_the_session_is_over() {
        let mut session = Session::of(10);
        let (mut turn, mut lowered, mut unchanged) = (0_usize, 0, 0);
        while let Some((word, direction)) = session.ask() {
            assert!(turn < 2_000, "the session never ends");
            let before = bar(&session);
            assert!(before.value < before.total, "full at turn {turn}");
            let held = session.words.iter().find(|held| held.word_id == word);
            let standing = run(direction, &held.expect("a word of the session").answers);
            let correct = turn >= 100 || (turn % 7 != 3 && turn % 11 != 5);
            session.answer(&word, direction, correct);
            let after = bar(&session);
            assert_eq!(after.total, 40);
            if correct {
                assert_eq!(after.value, before.value + 1, "turn {turn}");
            } else {
                assert!(standing < IN_A_ROW, "a finished direction is not asked");
                assert_eq!(after.value, before.value - standing, "turn {turn}");
                lowered += standing;
                unchanged += 1 - standing;
            }
            turn += 1;
        }
        assert!(lowered > 2, "misses that broke a run of one");
        assert!(unchanged > 2, "misses on no run");
        assert_eq!(bar(&session), steps_of(40, 40));
        assert_eq!(progress_over(&session.words), steps_of(40, 40));
    }

    #[test]
    fn a_run_standing_before_the_session_counts_and_the_bar_is_still_full_only_at_its_end() {
        let back = Direction::Production;
        // Kept under the rule that opened native → English after one right
        // answer: "w00" has that way finished and the first one not begun.
        let mut session = Session::of(2);
        session.words[0].answers.extend([SAID, SAID]);
        assert!(!is_open(back, &session.words[0].answers));
        assert_eq!(bar(&session), steps_of(2, 8));

        let mut asked = Vec::new();
        while let Some((word, direction)) = session.ask() {
            let before = bar(&session);
            assert!(before.value < before.total, "full with {word} to ask");
            session.answer(&word, direction, true);
            assert_eq!(bar(&session).value, before.value + 1);
            asked.push((word, direction));
        }
        // The two answers it had are not asked for again.
        assert_eq!(asked.len(), 6);
        assert!(!asked.contains(&("w00".to_owned(), back)));
        assert_eq!(bar(&session), steps_of(8, 8));

        // A word a miss in the refresh sent back comes with what it keeps:
        // only that miss is to be made up for.
        let mut reopened = Session::of(1);
        reopened.words[0]
            .answers
            .extend([RIGHT, RIGHT, SAID, SAID, MISS]);
        assert_eq!(bar(&reopened), steps_of(2, 4));
        assert_eq!(reopened.play(|_| true).len(), 2);
        assert_eq!(bar(&reopened), steps_of(4, 4));
    }

    #[test]
    fn a_session_that_is_over_is_full_whatever_became_of_its_words() {
        let mut session = Session::of(2);
        session.play(|_| true);
        // A miss in the refresh, afterwards: the word owes again.
        session.words[0].answers.push(MISS);
        assert_eq!(bar(&session), steps_of(6, 8));
        assert_eq!(progress_over(&session.words), steps_of(8, 8));
        assert_eq!(progress_over(&[]), steps_of(0, 0));
    }

    #[test]
    fn a_pass_of_the_refresh_is_as_far_as_the_words_it_has_asked() {
        assert_eq!(pass_progress(0, 3), steps_of(0, 3));
        assert_eq!(pass_progress(2, 1), steps_of(2, 3));
        assert_eq!(pass_progress(3, 0), steps_of(3, 3));
        assert_eq!(pass_progress(0, 0), steps_of(0, 0));
        assert_eq!(pass_progress(u32::MAX, 2).total, u32::MAX);
    }

    #[test]
    fn the_estimate_uses_eight_seconds_until_thirty_answers_and_the_median_after() {
        let quick = [3_000_i64; 40];
        assert_eq!(pace(0, &[]), DEFAULT_PACE_MS);
        assert_eq!(pace(OWN_PACE_AFTER - 1, &quick), 8_000);
        assert_eq!(pace(OWN_PACE_AFTER, &quick), 3_000);
        // The middle one, or the mean of the two in the middle.
        assert_eq!(pace(30, &[9_000, 1_000, 2_000]), 2_000);
        assert_eq!(pace(30, &[1_000, 3_000]), 2_000);
        // A break is not answering, and a clock set back is nothing at all.
        assert_eq!(pace(30, &[2_000, 3_600_000, 4_000, 60_001, -5]), 3_000);
        assert_eq!(pace(30, &[2_000, 60_000]), 31_000);
        assert_eq!(pace(30, &[90_000, 120_000]), DEFAULT_PACE_MS);
        assert_eq!(pace(30, &[]), DEFAULT_PACE_MS);

        // Five answers a word, to the nearest minute.
        assert_eq!(minutes(10, DEFAULT_PACE_MS), 7);
        assert_eq!(minutes(20, DEFAULT_PACE_MS), 13);
        assert_eq!(minutes(40, DEFAULT_PACE_MS), 27);
        assert_eq!(minutes(72, DEFAULT_PACE_MS), 48);
        assert_eq!(minutes(10, 3_000), 3);
        assert_eq!(minutes(1, 1_000), 1, "never no time at all");
        assert_eq!(minutes(10, 0), 1);
        assert_eq!(minutes(0, DEFAULT_PACE_MS), 0);
        assert_eq!(minutes(u32::MAX, u64::MAX), u32::MAX);
    }

    #[test]
    fn a_size_is_offered_only_when_the_chapter_has_more_open_words_than_it() {
        let offered = |open: u32| -> Vec<(Option<u32>, u32, u32)> {
            sizes(open, DEFAULT_PACE_MS)
                .into_iter()
                .map(|option| (option.size, option.words, option.minutes))
                .collect()
        };
        assert_eq!(
            offered(30),
            [(Some(10), 10, 7), (Some(20), 20, 13), (None, 30, 20)]
        );
        assert_eq!(offered(10), [(None, 10, 7)], "ten is all of them");
        assert_eq!(offered(11), [(Some(10), 10, 7), (None, 11, 7)]);
        assert_eq!(offered(40).len(), 3);
        assert_eq!(
            offered(41),
            [
                (Some(10), 10, 7),
                (Some(20), 20, 13),
                (Some(40), 40, 27),
                (None, 41, 27)
            ]
        );
        assert_eq!(offered(0), [(None, 0, 0)], "all is always there");
        assert_eq!(sizes(30, 3_000)[0].minutes, 3);
    }

    fn marked(sentence: &str, forms: &[&str]) -> Vec<(String, bool)> {
        let forms: Vec<String> = forms.iter().map(|form| (*form).to_owned()).collect();
        let parts = mark(sentence, &forms);
        let whole: String = parts.iter().map(|part| part.text.as_str()).collect();
        assert_eq!(whole, sentence, "the pieces are the sentence");
        parts
            .into_iter()
            .map(|part| (part.text, part.marked))
            .collect()
    }

    fn pieces(parts: &[(&str, bool)]) -> Vec<(String, bool)> {
        parts
            .iter()
            .map(|(text, marked)| ((*text).to_owned(), *marked))
            .collect()
    }

    #[test]
    fn the_word_is_marked_in_its_sentence_in_the_form_the_book_uses() {
        assert_eq!(
            marked("She peeped into the book.", &["peep", "peeped"]),
            pieces(&[
                ("She ", false),
                ("peeped", true),
                (" into the book.", false)
            ])
        );
        assert_eq!(
            marked("“Peep!” — and he PEEPS.", &["peep", "peeps"]),
            pieces(&[
                ("“", false),
                ("Peep", true),
                ("!” — and he ", false),
                ("PEEPS", true),
                (".", false)
            ])
        );
        // An expression is one mark, and a longer form wins over a shorter.
        assert_eq!(
            marked(
                "Down the Rabbit-Hole went the rabbit",
                &["rabbit", "rabbit hole"]
            ),
            pieces(&[
                ("Down the ", false),
                ("Rabbit-Hole", true),
                (" went the ", false),
                ("rabbit", true)
            ])
        );
        // Quotes around a word are not part of it; an apostrophe inside is.
        assert_eq!(
            marked("‘café’ and don’t", &["cafe", "don't"]),
            pieces(&[
                ("‘", false),
                ("café", true),
                ("’ and ", false),
                ("don’t", true)
            ])
        );
    }

    #[test]
    fn a_sentence_without_the_form_is_left_unmarked() {
        assert_eq!(
            marked("She gave it up.", &["give up", "gave up"]),
            pieces(&[("She gave it up.", false)])
        );
        // Part of another word is not the word.
        assert_eq!(
            marked("The peephole.", &["peep"]),
            pieces(&[("The peephole.", false)])
        );
        assert_eq!(marked("", &["peep"]), pieces(&[]));
    }

    fn blanked(sentence: &str, forms: &[&str]) -> Option<Vec<(String, bool)>> {
        let forms: Vec<String> = forms.iter().map(|form| (*form).to_owned()).collect();
        blank(sentence, &forms).map(|parts| {
            parts
                .into_iter()
                .map(|part| (part.text, part.marked))
                .collect()
        })
    }

    #[test]
    fn the_blanked_sentence_hides_every_occurrence_of_the_word_and_nothing_else() {
        assert_eq!(
            blanked("He ran, and Ran again; to run is fun.", &["run", "ran"]),
            Some(pieces(&[
                ("He ", false),
                ("", true),
                (", and ", false),
                ("", true),
                (" again; to ", false),
                ("", true),
                (" is fun.", false)
            ]))
        );
        // Part of another word stays: it is not the word.
        assert_eq!(
            blanked("The runner ran.", &["run", "ran"]),
            Some(pieces(&[("The runner ", false), ("", true), (".", false)]))
        );
        assert_eq!(
            blanked("Down the Rabbit-Hole.", &["rabbit hole"]),
            Some(pieces(&[("Down the ", false), ("", true), (".", false)]))
        );
    }

    #[test]
    fn a_sentence_that_cannot_be_blanked_is_not_shown() {
        assert_eq!(blanked("She gave it up.", &["give up", "gave up"]), None);
        assert_eq!(blanked("", &["peep"]), None);
    }
}
