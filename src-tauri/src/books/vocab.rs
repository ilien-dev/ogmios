//! A chapter's vocabulary. The model labels the words of each piece of the
//! chapter; everything decided about them is decided here: where the pieces
//! are cut, which words are the same word, which are dropped, how often each
//! occurs and in what order they are learned.

use std::collections::{HashMap, HashSet};

use crate::agent::protocol::VocabItem;
use crate::domain::{PartOfSpeech, VerbForm};

/// The size of one piece sent to the model, in characters: about 700 words,
/// so that even "most words" for a basic learner fits one answer.
pub const CHUNK_CHARS: usize = 4000;

/// Below this many words a text is too short to tell its language.
const LANGUAGE_MIN_WORDS: usize = 30;
/// English prose is a third function words; other languages share almost
/// none of these.
const ENGLISH_MIN_SHARE: f64 = 0.12;
const ENGLISH_WORDS: [&str; 30] = [
    "the", "and", "of", "to", "was", "that", "it", "with", "for", "had", "is", "not", "but",
    "this", "have", "from", "they", "were", "his", "her", "she", "you", "which", "would", "there",
    "what", "been", "their", "at", "on",
];

/// Words that only count: never worth a card.
const NUMBER_WORDS: [&str; 33] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
    "hundred",
    "thousand",
    "million",
    "billion",
    "trillion",
];

/// What a key drops from the front of an expression: "to give up" and "give
/// up" are one word, and so are "the bank" and "bank".
pub const LEADING: [&str; 4] = ["to", "a", "an", "the"];

/// One word of a chapter, ready to be stored.
#[derive(Debug, Clone, PartialEq)]
pub struct Word {
    /// What makes two items the same word: see [`key`].
    pub key: String,
    /// What the word is called: the base form, as the model wrote it, or,
    /// for a verb the text has in another form, that form ([`own_form`]).
    pub lemma: String,
    /// The base form of a verb called by another form; none for any other
    /// word.
    pub base: Option<String>,
    /// The form a verb has in its sentence; none for any other word, and
    /// when no model said.
    pub verb_form: Option<VerbForm>,
    /// Every form the chapter uses, what the word is called first.
    pub forms: Vec<String>,
    /// The first sentence of the chapter that uses it.
    pub sentence: String,
    /// What kind of word it is in that sentence; none when no model said.
    pub part_of_speech: Option<PartOfSpeech>,
    /// A verb that takes an object in that sentence; none when no model
    /// said.
    pub transitive: Option<bool>,
    /// Accepted translations, in the order they were first given.
    pub translations: Vec<String>,
    pub needs_context: bool,
    /// How often its forms occur in the chapter; at least 1.
    pub count: u32,
}

/// A letter without its accent; any other character as it is.
fn fold(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        '’' | '‘' => '\'',
        other => other,
    }
}

/// The words of a text for comparing: lowercase, without accents, split at
/// anything that is not a letter, a digit or an apostrophe inside a word.
/// "Rabbit-Hole" is two tokens and "don’t" is one.
pub fn tokens(text: &str) -> Vec<String> {
    let folded: String = text
        .chars()
        .flat_map(char::to_lowercase)
        .map(fold)
        .collect();
    split(&folded)
}

/// A text split into words at anything that is not a letter, a digit or an
/// apostrophe inside a word.
pub fn split(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|word| word.trim_matches('\''))
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The one normalisation of a word: two items with the same key are the same
/// word, in any chapter of any book. Case, accents, punctuation, spacing and
/// a leading "to" or article do not count.
pub fn key(text: &str) -> String {
    let words = tokens(text);
    let skip = usize::from(words.len() > 1 && LEADING.contains(&words[0].as_str()));
    words[skip..].join(" ")
}

/// Whether an item is a verb or a phrasal verb.
fn is_verb(part: PartOfSpeech) -> bool {
    matches!(part, PartOfSpeech::Verb | PartOfSpeech::PhrasalVerb)
}

/// The form the text has a verb in, when that form is a word of its own:
/// "sworn" and "swore" are two words to learn, not two forms of "swear",
/// and neither is asked as "swear". Only a form that is the verb word for
/// word: "gave it up" and "was not fond of" stay forms of their base form.
/// None for a verb the text has in its base form, and for any other word.
fn own_form(item: &VocabItem) -> Option<String> {
    let (form, lemma) = (key(&item.form), key(&item.lemma));
    let words = |text: &str| text.split(' ').count();
    (is_verb(item.part_of_speech)
        && form != lemma
        && words(&form) == words(&lemma)
        && !negates(&item.form, &item.lemma))
    .then_some(form)
}

/// The words that deny what they stand with; so does one ending in "n't".
const NEGATIONS: [&str; 4] = ["not", "no", "never", "cannot"];

fn negated(text: &str) -> bool {
    tokens(text)
        .iter()
        .any(|word| NEGATIONS.contains(&word.as_str()) || word.ends_with("n't"))
}

/// Whether `form` denies what `lemma` says: "was not fond of" for "be fond
/// of". It is not a form of the word: its translations say the opposite.
/// "couldn't help but" is one of "can't help but", which denies already.
pub fn negates(form: &str, lemma: &str) -> bool {
    negated(form) && !negated(lemma)
}

/// Whether a key names a number: digits, or a word that only counts.
fn is_number(key: &str) -> bool {
    !key.chars().any(char::is_alphabetic)
        || key.chars().any(|c| c.is_ascii_digit())
        || key.split(' ').all(|word| NUMBER_WORDS.contains(&word))
}

/// Whether a text reads as English. Decided on its function words; a text
/// too short to tell is given the benefit of the doubt.
pub fn looks_english(text: &str) -> bool {
    let words = tokens(text);
    if words.len() < LANGUAGE_MIN_WORDS {
        return true;
    }
    let english = words
        .iter()
        .filter(|word| ENGLISH_WORDS.contains(&word.as_str()))
        .count();
    crate::convert::len_f64(english) >= ENGLISH_MIN_SHARE * crate::convert::len_f64(words.len())
}

/// The byte offset of the `max`-th character, if the text is longer.
fn char_limit(text: &str, max: usize) -> Option<usize> {
    text.char_indices().nth(max).map(|(at, _)| at)
}

/// Where to cut a window that is too long: after its last paragraph, else
/// after its last sentence, else at its last space. A break in the first half
/// is not taken: the piece would be too small to be worth a request.
fn cut(window: &str) -> usize {
    let half = window.len() / 2;
    if let Some(at) = window.rfind('\n').filter(|at| *at >= half) {
        return at;
    }
    let sentence = window
        .char_indices()
        .rev()
        .find(|(at, c)| c.is_whitespace() && window[..*at].ends_with(['.', '!', '?', '”', '"']))
        .map(|(at, _)| at)
        .filter(|at| *at >= half);
    if let Some(at) = sentence {
        return at;
    }
    window
        .rfind(char::is_whitespace)
        .filter(|at| *at > 0)
        .unwrap_or(window.len())
}

/// The chapter in pieces of at most `max_chars` characters, in order. The
/// same text always gives the same pieces: a retry resumes by their index.
pub fn chunks(text: &str, max_chars: usize) -> Vec<&str> {
    let mut pieces = Vec::new();
    let mut rest = text.trim();
    while let Some(limit) = char_limit(rest, max_chars.max(1)) {
        let at = cut(&rest[..limit]);
        pieces.push(rest[..at].trim_end());
        rest = rest[at..].trim_start();
    }
    if !rest.is_empty() {
        pieces.push(rest);
    }
    pieces
}

/// How often a run of tokens occurs in the chapter.
fn occurrences(form: &[String], chapter: &[String]) -> usize {
    if form.is_empty() {
        return 0;
    }
    chapter
        .windows(form.len())
        .filter(|run| *run == form)
        .count()
}

/// How often a word or expression occurs in a chapter's text; at least once,
/// for one the chapter is known to have.
pub fn count_in(lemma: &str, text: &str) -> u32 {
    u32::try_from(occurrences(&tokens(lemma), &tokens(text)))
        .unwrap_or(u32::MAX)
        .max(1)
}

/// A translation as it is stored, and what makes two of them the same.
fn clean(translation: &str) -> Option<(String, String)> {
    let text = translation.split_whitespace().collect::<Vec<_>>().join(" ");
    let same = key(&text);
    (!same.is_empty()).then_some((same, text))
}

fn push_new(list: &mut Vec<String>, seen: &mut HashSet<String>, same: String, text: String) {
    if seen.insert(same) {
        list.push(text);
    }
}

/// A word being put together from the pieces that mention it.
struct Draft {
    word: Word,
    forms: HashSet<String>,
    translations: HashSet<String>,
}

impl Draft {
    /// The word an item starts: called by `named`, the form of a verb that
    /// is a word of its own ([`own_form`]), or else by its base form.
    fn new(key: String, item: &VocabItem, named: Option<String>) -> Self {
        let base = item.lemma.split_whitespace().collect::<Vec<_>>().join(" ");
        let (lemma, base) = match named {
            Some(form) => (form, Some(base)),
            None => (base, None),
        };
        let mut draft = Self {
            word: Word {
                key,
                lemma: lemma.clone(),
                base,
                verb_form: item.verb_form.filter(|_| is_verb(item.part_of_speech)),
                forms: Vec::new(),
                sentence: item.sentence.trim().to_owned(),
                part_of_speech: Some(item.part_of_speech),
                transitive: Some(item.transitive),
                translations: Vec::new(),
                needs_context: false,
                count: 0,
            },
            forms: HashSet::new(),
            translations: HashSet::new(),
        };
        draft.form(&lemma);
        draft
    }

    fn form(&mut self, form: &str) {
        let run = tokens(form).join(" ");
        if !run.is_empty() && !negates(form, &self.word.lemma) {
            push_new(
                &mut self.word.forms,
                &mut self.forms,
                run,
                form.trim().to_owned(),
            );
        }
    }

    fn add(&mut self, item: &VocabItem) {
        self.form(&item.form);
        self.word.needs_context |= item.needs_context;
        for (same, text) in item.translations.iter().filter_map(|t| clean(t)) {
            push_new(
                &mut self.word.translations,
                &mut self.translations,
                same,
                text,
            );
        }
    }
}

/// The chapter's words from what the model said about each piece: one word
/// per key with every translation given for it, each form of a verb a word
/// of its own ([`own_form`]), without names, numbers,
/// words that came without a translation and the `excluded` keys (words the
/// learner already knows or has finished elsewhere). Most frequent in the
/// chapter first; equally frequent words in alphabetical order.
pub fn merge(pieces: &[Vec<VocabItem>], text: &str, excluded: &HashSet<String>) -> Vec<Word> {
    let mut order: Vec<String> = Vec::new();
    let mut drafts: HashMap<String, Draft> = HashMap::new();
    for item in pieces.iter().flatten() {
        let named = own_form(item);
        let key = key(named.as_deref().unwrap_or(&item.lemma));
        if item.proper_noun || key.is_empty() || is_number(&key) || excluded.contains(&key) {
            continue;
        }
        drafts
            .entry(key.clone())
            .or_insert_with(|| {
                order.push(key.clone());
                Draft::new(key, item, named)
            })
            .add(item);
    }

    let chapter = tokens(text);
    let mut words: Vec<Word> = order
        .iter()
        .filter_map(|key| drafts.remove(key))
        .filter(|draft| !draft.word.translations.is_empty())
        .map(|draft| {
            let found: usize = draft
                .forms
                .iter()
                .map(|form| occurrences(&tokens(form), &chapter))
                .sum();
            Word {
                // A phrasal verb split by its object ("gave it up") is in the
                // chapter even when no run of tokens matches it.
                count: u32::try_from(found).unwrap_or(u32::MAX).max(1),
                ..draft.word
            }
        })
        .collect();
    words.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.key.cmp(&b.key)));
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(lemma: &str, form: &str, translations: &[&str]) -> VocabItem {
        VocabItem {
            lemma: lemma.into(),
            form: form.into(),
            sentence: format!("A sentence with {form}."),
            part_of_speech: PartOfSpeech::Noun,
            transitive: false,
            translations: translations.iter().map(|t| (*t).to_owned()).collect(),
            proper_noun: false,
            needs_context: false,
            verb_form: None,
        }
    }

    fn keys(words: &[Word]) -> Vec<(&str, u32)> {
        words.iter().map(|w| (w.key.as_str(), w.count)).collect()
    }

    #[test]
    fn a_key_ignores_case_accents_punctuation_and_a_leading_to_or_article() {
        assert_eq!(key("  To Give   Up. "), "give up");
        assert_eq!(key("give up"), "give up");
        assert_eq!(key("The Bank"), "bank");
        assert_eq!(key("Café"), "cafe");
        assert_eq!(key("don’t"), "don't");
        assert_eq!(key("queer-looking"), "queer looking");
        // Alone, "to" and "the" are words like any other.
        assert_eq!(key("to"), "to");
        assert_eq!(key("?!"), "");
    }

    #[test]
    fn a_form_that_denies_its_word_is_not_a_form_of_it() {
        assert!(negates("was not fond of", "be fond of"));
        assert!(negates("has Not budged", "budge"));
        assert!(negates("wasn’t fond of", "be fond of"));
        assert!(negates("never budged", "budge"));
        // The word denies already.
        assert!(!negates("couldn’t help but", "can't help but"));
        assert!(!negates("no longer", "no longer"));
        // More words than the base form, and the same thing said.
        assert!(!negates("was very fond of", "be fond of"));
        assert!(!negates("propped himself up", "prop up"));
        // Part of another word denies nothing.
        assert!(!negates("knotted", "knot"));

        let pieces = vec![vec![
            item("be fond of", "was not fond of", &["ser aficionado a"]),
            item("be fond of", "was very fond of", &["gustarle mucho"]),
        ]];
        let words = merge(&pieces, "He was not fond of it.", &HashSet::new());
        assert_eq!(words[0].forms, ["be fond of", "was very fond of"]);
        assert_eq!(
            words[0].translations,
            ["ser aficionado a", "gustarle mucho"]
        );
    }

    #[test]
    fn chunks_cover_the_text_in_order_within_the_size() {
        let paragraph = "It was a long day. Nobody came! Who would? ".repeat(20);
        let text = format!("{0}\n{0}\n{0}", paragraph.trim());
        let pieces = chunks(&text, 600);

        assert!(pieces.len() > 3);
        assert!(pieces.iter().all(|p| p.chars().count() <= 600));
        assert!(pieces.iter().all(|p| !p.is_empty() && p.trim() == *p));
        let words = |t: &str| t.split_whitespace().map(str::to_owned).collect::<Vec<_>>();
        assert_eq!(words(&pieces.join(" ")), words(&text));
        // A piece ends where a sentence does.
        assert!(pieces.iter().all(|p| p.ends_with(['.', '!', '?'])));
        // The same text gives the same pieces.
        assert_eq!(chunks(&text, 600), pieces);
    }

    #[test]
    fn chunks_prefer_a_paragraph_break_and_survive_text_without_any_break() {
        let text = format!("{}\n{}", "One two three. ".repeat(6).trim(), "x".repeat(50));
        let pieces = chunks(&text, 100);
        assert_eq!(pieces[0], "One two three. ".repeat(6).trim());

        let solid = "é".repeat(250);
        let cut: Vec<usize> = chunks(&solid, 100)
            .iter()
            .map(|p| p.chars().count())
            .collect();
        assert_eq!(cut, [100, 100, 50]);
        assert_eq!(chunks("  short text ", 100), ["short text"]);
        assert_eq!(chunks("   ", 100), Vec::<&str>::new());
    }

    #[test]
    fn english_is_told_from_other_languages_and_short_text_is_let_through() {
        let english = "Alice was beginning to get very tired of sitting by her sister on the \
            bank, and of having nothing to do: once or twice she had peeped into the book her \
            sister was reading, but it had no pictures or conversations in it.";
        let spanish = "Alicia empezaba ya a cansarse de estar sentada con su hermana a la orilla \
            del río, sin tener nada que hacer: había echado un par de ojeadas al libro que su \
            hermana estaba leyendo, pero no tenía dibujos ni diálogos.";
        let german = "Alice fing an sich zu langweilen; sie saß schon lange bei ihrer Schwester \
            am Ufer und hatte nichts zu tun. Das Buch, das ihre Schwester las, gefiel ihr nicht; \
            denn es waren weder Bilder noch Gespräche darin.";
        assert!(looks_english(english));
        assert!(!looks_english(spanish));
        assert!(!looks_english(german));
        assert!(looks_english("Capítulo primero"));
    }

    #[test]
    fn merging_removes_duplicates_names_and_numbers() {
        let text = "She peeped out. He peeps in. Alice gave up in 1865, and gave up again.";
        let mut alice = item("Alice", "Alice", &["Alicia"]);
        alice.proper_noun = true;
        let mut context = item("to give up", "gave up", &["rendirse", "Abandonar"]);
        context.needs_context = true;
        // Its first sentence is the one kept, and so is what the word is there.
        let mut noun = item("Peep", "peeps", &["echar un vistazo", " Asomarse "]);
        noun.part_of_speech = PartOfSpeech::Adjective;
        let pieces = vec![
            vec![
                item("peep", "peeped", &["asomarse"]),
                alice,
                item("1865", "1865", &["1865"]),
                item("give up", "gave up", &["rendirse"]),
            ],
            vec![
                noun,
                item("twenty one", "twenty-one", &["veintiuno"]),
                context,
                item("blank", "blank", &["", "  "]),
            ],
        ];

        let words = merge(&pieces, text, &HashSet::new());
        assert_eq!(keys(&words), [("give up", 2), ("peep", 2)]);
        let [give_up, peep] = words.as_slice() else {
            panic!("two words");
        };
        assert_eq!(peep.lemma, "peep");
        assert_eq!(peep.forms, ["peep", "peeped", "peeps"]);
        assert_eq!(peep.translations, ["asomarse", "echar un vistazo"]);
        assert_eq!(peep.sentence, "A sentence with peeped.");
        assert_eq!(peep.part_of_speech, Some(PartOfSpeech::Noun));
        assert_eq!((peep.base.as_deref(), peep.verb_form), (None, None));
        assert!(!peep.needs_context);
        assert_eq!(give_up.translations, ["rendirse", "Abandonar"]);
        assert!(give_up.needs_context, "flagged in any piece");
    }

    fn verb(lemma: &str, form: &str, said: VerbForm, translations: &[&str]) -> VocabItem {
        VocabItem {
            part_of_speech: PartOfSpeech::Verb,
            verb_form: Some(said),
            ..item(lemma, form, translations)
        }
    }

    #[test]
    fn each_form_of_a_verb_is_a_word_of_its_own_called_by_that_form() {
        let text = "He swore it. They were sworn in, Sworn to him. I swear! She gave it up.";
        let split = VocabItem {
            part_of_speech: PartOfSpeech::PhrasalVerb,
            ..verb("give up", "gave it up", VerbForm::Past, &["rendirse"])
        };
        let pieces = vec![vec![
            verb("swear", "swore", VerbForm::Past, &["jurar"]),
            verb("swear", "sworn", VerbForm::PastParticiple, &["jurar"]),
            verb(
                "swear",
                "Sworn",
                VerbForm::PastParticiple,
                &["prestar juramento"],
            ),
            verb("swear", "swear", VerbForm::Present, &["jurar"]),
            split,
        ]];
        let words = merge(&pieces, text, &HashSet::new());
        assert_eq!(
            keys(&words),
            [("sworn", 2), ("give up", 1), ("swear", 1), ("swore", 1)]
        );
        let [participle, phrasal, plain, past] = words.as_slice() else {
            panic!("four words");
        };
        assert_eq!(participle.lemma, "sworn");
        assert_eq!(participle.base.as_deref(), Some("swear"));
        assert_eq!(participle.forms, ["sworn"]);
        assert_eq!(participle.verb_form, Some(VerbForm::PastParticiple));
        assert_eq!(participle.translations, ["jurar", "prestar juramento"]);
        assert_eq!(participle.sentence, "A sentence with sworn.");
        assert_eq!(
            (past.lemma.as_str(), past.base.as_deref()),
            ("swore", Some("swear"))
        );
        assert_eq!(past.verb_form, Some(VerbForm::Past));
        // In its base form it is called as before.
        assert_eq!(
            (plain.lemma.as_str(), plain.base.as_deref()),
            ("swear", None)
        );
        assert_eq!(plain.verb_form, Some(VerbForm::Present));
        // Split by its object, the form is not the verb word for word.
        assert_eq!(phrasal.lemma, "give up");
        assert_eq!(phrasal.forms, ["give up", "gave it up"]);
        assert_eq!(phrasal.base, None);

        // Knowing one form leaves the others to learn.
        let known: HashSet<String> = ["sworn".to_owned()].into();
        assert_eq!(
            keys(&merge(&pieces, text, &known)),
            [("give up", 1), ("swear", 1), ("swore", 1)]
        );
    }

    #[test]
    fn words_known_or_done_elsewhere_are_removed() {
        let pieces = vec![vec![
            item("peep", "peeped", &["asomarse"]),
            item("to give up", "gave up", &["rendirse"]),
            item("bank", "bank", &["orilla"]),
        ]];
        let excluded: HashSet<String> = ["give up", "peep"].map(str::to_owned).into();
        let words = merge(&pieces, "She peeped at the bank and gave up.", &excluded);
        assert_eq!(keys(&words), [("bank", 1)]);
    }

    #[test]
    fn the_order_is_by_count_in_the_chapter() {
        let text = "The rabbit ran. Rabbits run, and a rabbit runs: “Run!” The queer-looking \
            hole was deep; a queer-looking party. She took the watch out.";
        let pieces = vec![vec![
            item("hole", "hole", &["agujero"]),
            item("queer-looking", "queer-looking", &["de aspecto raro"]),
            item("run", "ran", &["correr"]),
            item("rabbit", "Rabbits", &["conejo"]),
            item("take out", "took out", &["sacar"]),
            item("run", "runs", &["correr"]),
        ]];
        let words = merge(&pieces, text, &HashSet::new());
        assert_eq!(
            keys(&words),
            [
                ("run", 4),
                ("rabbit", 3),
                ("queer looking", 2),
                ("hole", 1),
                // Split by its object: not found as a run, still in the chapter.
                ("take out", 1),
            ]
        );
    }
}
