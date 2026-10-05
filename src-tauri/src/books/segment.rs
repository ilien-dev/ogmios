//! Cuts a chapter into the paragraphs and sentences the learner translates.
//! The cut is code's: the same text always gives the same pieces, so what
//! the learner wrote is kept by paragraph and sentence number.

/// A full stop after one of these does not end a sentence. Lowercase.
const ABBREVIATIONS: [&str; 16] = [
    "mr", "mrs", "ms", "dr", "st", "prof", "sr", "jr", "vs", "etc", "mt", "capt", "col", "gen",
    "lt", "sgt",
];

/// A piece shorter than this is not translated alone: it joins a neighbour.
const MIN_WORDS: usize = 3;

/// What may close a sentence after its last mark: quotes and brackets.
const CLOSERS: [char; 7] = ['"', '”', '’', '\'', ')', ']', '»'];

fn is_end_mark(c: char) -> bool {
    matches!(c, '.' | '?' | '!' | '…')
}

/// Whether the line ends where a sentence does.
fn ends_sentence(line: &str) -> bool {
    line.trim_end()
        .trim_end_matches(CLOSERS)
        .ends_with(is_end_mark)
}

/// The paragraphs of a chapter, in order; a line without a letter (a row of
/// asterisks, a page number) is none. An EPUB keeps one block per line. A
/// PDF keeps one line of the page per line, so its lines are joined until
/// one ends a sentence: the pieces are shorter than the author's paragraphs
/// at times, and never stop halfway through a sentence.
pub fn paragraphs(text: &str, lines_are_blocks: bool) -> Vec<String> {
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| line.chars().any(char::is_alphabetic));
    if lines_are_blocks {
        return lines.map(str::to_owned).collect();
    }
    let mut done = Vec::new();
    let mut open = String::new();
    for line in lines {
        if !open.is_empty() {
            open.push(' ');
        }
        open.push_str(line);
        if ends_sentence(line) {
            done.push(std::mem::take(&mut open));
        }
    }
    if !open.is_empty() {
        done.push(open);
    }
    done
}

/// The letters and digits of a text, lowercase: what is left of a heading
/// whatever its lines and its punctuation.
fn letters(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// How many paragraphs a chapter's heading may be spread over.
const HEADING_LINES: usize = 3;

/// The paragraphs with the chapter's heading written as the chapter is
/// named. A book writes "Chapter 1" and "Nightmare Begins" on two lines, or
/// runs them together, and names the chapter "Chapter 1: Nightmare Begins":
/// the first paragraphs that spell that name become it, in one paragraph.
/// A chapter that opens with anything else is left as it is.
pub fn headed(paragraphs: Vec<String>, title: &str) -> Vec<String> {
    let named = letters(title);
    if named.is_empty() {
        return paragraphs;
    }
    let mut spelled = String::new();
    for (at, paragraph) in paragraphs.iter().enumerate().take(HEADING_LINES) {
        spelled.push_str(&letters(paragraph));
        if spelled == named {
            let mut whole = vec![title.trim().to_owned()];
            whole.extend(paragraphs.into_iter().skip(at + 1));
            return whole;
        }
        if !named.starts_with(&spelled) {
            break;
        }
    }
    paragraphs
}

/// The word a full stop at `at` closes, without what opens it.
fn word_before(chars: &[char], at: usize) -> String {
    let start = chars[..at]
        .iter()
        .rposition(|c| !c.is_alphanumeric())
        .map_or(0, |space| space + 1);
    chars[start..at].iter().collect()
}

/// Whether a lone full stop at `at` belongs to its word: an abbreviation or
/// an initial.
fn is_abbreviation(chars: &[char], at: usize) -> bool {
    let word = word_before(chars, at);
    let initial = word.chars().count() == 1 && word.chars().all(char::is_uppercase);
    initial || ABBREVIATIONS.contains(&word.to_lowercase().as_str())
}

/// Where the sentence ending with the mark at `at` stops, if it does: past
/// the marks and closers that follow it. A mark inside a word or a number
/// ends nothing, and neither does one followed by a lowercase word: that is
/// a line of dialogue going on with who said it.
fn sentence_end(chars: &[char], at: usize) -> Option<usize> {
    let mark = *chars.get(at)?;
    let mut end = at + 1;
    if mark != ';' {
        while chars.get(end).copied().is_some_and(is_end_mark) {
            end += 1;
        }
        while chars.get(end).is_some_and(|c| CLOSERS.contains(c)) {
            end += 1;
        }
    }
    let next = chars[end..].iter().position(|c| !c.is_whitespace());
    if next == Some(0) {
        return None;
    }
    if mark == ';' {
        return Some(end);
    }
    let goes_on = next.is_some_and(|skip| chars[end + skip].is_lowercase());
    let abbreviated = mark == '.' && end == at + 1 && is_abbreviation(chars, at);
    (!goes_on && !abbreviated).then_some(end)
}

fn is_short(piece: &str) -> bool {
    piece.split_whitespace().count() < MIN_WORDS
}

/// The sentences of a paragraph, in order: it is cut after a full stop, a
/// semicolon, a question or exclamation mark and an ellipsis. A piece too
/// short to translate alone joins the one before it, or the one after when
/// it comes first. Joined with a space they are the paragraph again.
pub fn sentences(paragraph: &str) -> Vec<String> {
    let chars: Vec<char> = paragraph.trim().chars().collect();
    let mut pieces: Vec<String> = Vec::new();
    let mut start = 0;
    let mut at = 0;
    while at < chars.len() {
        let end = (is_end_mark(chars[at]) || chars[at] == ';')
            .then(|| sentence_end(&chars, at))
            .flatten();
        match end {
            Some(end) => {
                pieces.push(chars[start..end].iter().collect::<String>());
                start = end;
                at = end;
            }
            None => at += 1,
        }
    }
    if start < chars.len() {
        pieces.push(chars[start..].iter().collect());
    }

    let mut done: Vec<String> = Vec::new();
    let mut held = String::new();
    for piece in pieces.iter().map(|piece| piece.trim()) {
        if piece.is_empty() {
            continue;
        }
        match done.last_mut() {
            Some(last) if is_short(piece) => {
                last.push(' ');
                last.push_str(piece);
            }
            _ => {
                if !held.is_empty() {
                    held.push(' ');
                }
                held.push_str(piece);
                if !is_short(&held) {
                    done.push(std::mem::take(&mut held));
                }
            }
        }
    }
    if !held.is_empty() {
        done.push(held);
    }
    done
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_paragraph_is_cut_after_stops_semicolons_questions_and_ellipses() {
        assert_eq!(
            sentences(
                "He lay still and counted the cracks; there were eleven, the same as \
                 yesterday. Who would come now? Nobody at all! He waited… Then he slept."
            ),
            [
                "He lay still and counted the cracks;",
                "there were eleven, the same as yesterday.",
                "Who would come now?",
                "Nobody at all! He waited…",
                "Then he slept.",
            ],
            "two words are not translated alone"
        );
        assert_eq!(
            sentences("What was that?! He did not know... Nobody ever knew."),
            ["What was that?!", "He did not know...", "Nobody ever knew."]
        );
    }

    #[test]
    fn dialogue_keeps_its_closing_quote_and_who_said_it() {
        assert_eq!(
            sentences(
                "“You know what happens here?” the man asked. “I know it well.” He \
                 smiled at that. \"Do you really?\" she said, \"or not?\""
            ),
            [
                "“You know what happens here?” the man asked.",
                "“I know it well.”",
                "He smiled at that.",
                "\"Do you really?\" she said, \"or not?\"",
            ]
        );
    }

    #[test]
    fn abbreviations_initials_and_numbers_do_not_end_a_sentence() {
        assert_eq!(
            sentences(
                "Mr. Smith met Dr. J. K. Brown at 3.5 miles from St. Ives. They paid \
                 $4.50 each, etc. and left."
            ),
            [
                "Mr. Smith met Dr. J. K. Brown at 3.5 miles from St. Ives.",
                "They paid $4.50 each, etc. and left.",
            ]
        );
    }

    #[test]
    fn a_piece_too_short_joins_its_neighbour() {
        assert_eq!(
            sentences("No. He would not go there. Never."),
            ["No. He would not go there. Never."]
        );
        assert_eq!(
            sentences("He closed his eyes. Yes! The room was gone."),
            ["He closed his eyes. Yes!", "The room was gone."]
        );
        assert_eq!(sentences("Chapter One"), ["Chapter One"]);
        assert_eq!(sentences("  "), Vec::<String>::new());
    }

    #[test]
    fn the_sentences_of_a_paragraph_joined_are_the_paragraph() {
        let paragraph = "The boy knew. Everyone knew what the trial did; still, he smiled. \
                         “Why?” they asked him. He had nothing else to offer!";
        assert_eq!(sentences(paragraph).join(" "), paragraph);
    }

    #[test]
    fn a_heading_is_written_as_the_chapter_is_named() {
        let owned = |lines: &[&str]| -> Vec<String> {
            lines.iter().map(|line| (*line).to_owned()).collect()
        };
        let title = " Chapter 1: Nightmare Begins ";
        let named = ["Chapter 1: Nightmare Begins", "A frail man sat."];
        // Run together, as a book stored before its styles were read.
        let glued = owned(&["Chapter 1Nightmare Begins", "A frail man sat."]);
        assert_eq!(headed(glued, title), named);
        let split = owned(&["CHAPTER 1", "Nightmare Begins", "A frail man sat."]);
        assert_eq!(headed(split, title), named);

        // Anything else opens the chapter as it is written.
        let other = owned(&["Chapter 1", "A frail man sat.", "Nightmare Begins"]);
        assert_eq!(headed(other.clone(), title), other);
        let more = owned(&["Chapter 1: Nightmare Begins Again", "A frail man sat."]);
        assert_eq!(headed(more.clone(), title), more);
        assert_eq!(headed(other.clone(), ""), other);
        assert_eq!(headed(Vec::new(), title), Vec::<String>::new());
    }

    #[test]
    fn an_epub_keeps_a_paragraph_a_line() {
        let text = "Chapter One\n\n  The boy woke. He lay still.  \n***\n12\nNobody came";
        assert_eq!(
            paragraphs(text, true),
            ["Chapter One", "The boy woke. He lay still.", "Nobody came"]
        );
    }

    #[test]
    fn the_lines_of_a_pdf_are_joined_until_one_ends_a_sentence() {
        let text = "The boy woke before\nthe sirens did. He lay\nstill and waited.\n\
                    “Who is there?”\n7\nNobody answered, and the\nnight went on";
        assert_eq!(
            paragraphs(text, false),
            [
                "The boy woke before the sirens did. He lay still and waited.",
                "“Who is there?”",
                "Nobody answered, and the night went on",
            ]
        );
    }
}
