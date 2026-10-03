//! Reading a book file into chapters of plain text. Nothing here touches the
//! database or the disk: bytes in, chapters out.

pub mod epub;
pub mod pdf;
mod pdftext;
pub mod practice;
pub mod vocab;
mod xml;

use crate::error::Error;

/// Why a file is refused. These travel as the message of an `invalid` error
/// and the interface words them in its own language (`BookRefusal` in
/// `shared/domain.ts`).
pub const DRM: &str = "drm";
pub const UNREADABLE: &str = "unreadable";
/// A PDF of page images: there is no text to take the words from.
pub const SCANNED: &str = "scanned";
/// Why a chapter is not prepared: its text is not English (`ChapterRefusal`).
pub const NOT_ENGLISH: &str = "notEnglish";

/// Titles that are front matter in any book, lowercase.
const FRONT_TITLES: [&str; 12] = [
    "cover",
    "title",
    "title page",
    "copyright",
    "copyright page",
    "contents",
    "table of contents",
    "dedication",
    "epigraph",
    "acknowledgments",
    "acknowledgements",
    "also by the author",
];

/// Whether a chapter with this title is front matter whatever the book.
fn is_front_title(title: &str) -> bool {
    FRONT_TITLES.contains(&title.trim().to_lowercase().as_str())
}

pub fn refused(why: &str) -> Error {
    Error::Invalid(why.to_owned())
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedBook {
    pub title: Option<String>,
    pub author: Option<String>,
    /// In reading order, none of them empty.
    pub chapters: Vec<ParsedChapter>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedChapter {
    /// Empty for text the table of contents does not name.
    pub title: String,
    /// Cover, title page, contents and the like: read, never stored.
    pub front_matter: bool,
    pub text: String,
}

impl ParsedBook {
    /// The book without its front matter: only its chapters are stored. A
    /// book that is nothing else is kept whole.
    pub fn chapters_only(mut self) -> Self {
        if self.chapters.iter().any(|chapter| !chapter.front_matter) {
            self.chapters.retain(|chapter| !chapter.front_matter);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book(parts: &[(&str, bool)]) -> ParsedBook {
        ParsedBook {
            title: None,
            author: None,
            chapters: parts
                .iter()
                .map(|(title, front_matter)| ParsedChapter {
                    title: (*title).to_owned(),
                    front_matter: *front_matter,
                    text: "text".into(),
                })
                .collect(),
        }
    }

    fn titles(book: &ParsedBook) -> Vec<&str> {
        book.chapters.iter().map(|c| c.title.as_str()).collect()
    }

    #[test]
    fn only_the_chapters_of_a_book_are_kept() {
        let parts = [("", true), ("Contents", true), ("I", false), ("II", false)];
        assert_eq!(titles(&book(&parts).chapters_only()), ["I", "II"]);
        // Nothing but front matter: the book is what there is.
        let front = [("Cover", true), ("Contents", true)];
        assert_eq!(titles(&book(&front).chapters_only()), ["Cover", "Contents"]);
    }
}
