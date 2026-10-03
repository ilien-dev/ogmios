//! PDF: pages of positioned text, and maybe an outline (the bookmarks) that
//! says on which page each chapter starts. Without one the text is cut into
//! sections of a fixed size. A PDF of page images has no text and is refused.

use std::collections::{BTreeMap, BTreeSet};

use lopdf::{decode_text_string, Dictionary, Document, Object, ObjectId};

use super::pdftext::{page_text, tidy};
use super::xml::collapse;
use super::{is_front_title, refused, ParsedBook, ParsedChapter, DRM, SCANNED, UNREADABLE};
use crate::error::Result;
use crate::metrics::count_words;

/// The size of a section of a PDF without bookmarks, in words. A section ends
/// at the first page boundary past it.
pub const SECTION_WORDS: u32 = 3000;
/// Fewer words than this per page, on average, is a scan with a stray caption.
const MIN_WORDS_PER_PAGE: u64 = 5;
/// No outline level or name tree is followed past this many nodes or this
/// deep, whatever the file links to.
const MAX_NODES: usize = 20_000;
const MAX_DEPTH: u8 = 16;

type Names<'a> = BTreeMap<Vec<u8>, &'a Object>;

fn dict_at<'a>(doc: &'a Document, dict: &'a Dictionary, key: &[u8]) -> Option<&'a Dictionary> {
    dict.get_deref(key, doc).ok()?.as_dict().ok()
}

fn text_at(doc: &Document, dict: &Dictionary, key: &[u8]) -> Option<String> {
    let text = decode_text_string(dict.get_deref(key, doc).ok()?).ok()?;
    Some(collapse(&tidy(&text))).filter(|text| !text.is_empty())
}

/// The entries of a name tree, kids included.
fn name_tree<'a>(
    doc: &'a Document,
    node: &'a Dictionary,
    names: &mut Names<'a>,
    budget: &mut usize,
    depth: u8,
) {
    if *budget == 0 || depth > MAX_DEPTH {
        return;
    }
    *budget -= 1;
    if let Ok(pairs) = node.get_deref(b"Names", doc).and_then(Object::as_array) {
        for [key, dest] in pairs.as_chunks::<2>().0 {
            if let Ok((_, Object::String(name, _))) = doc.dereference(key) {
                names.insert(name.clone(), dest);
            }
        }
    }
    if let Ok(kids) = node.get_deref(b"Kids", doc).and_then(Object::as_array) {
        for kid in kids {
            if let Ok((_, Object::Dictionary(kid))) = doc.dereference(kid) {
                name_tree(doc, kid, names, budget, depth + 1);
            }
        }
    }
}

/// Every destination the file names: the old dictionary of the catalog and
/// the name tree that replaced it.
fn named_destinations<'a>(doc: &'a Document, catalog: &'a Dictionary) -> Names<'a> {
    let mut names = Names::new();
    if let Some(dests) = dict_at(doc, catalog, b"Dests") {
        names.extend(dests.iter().map(|(name, dest)| (name.clone(), dest)));
    }
    let tree = dict_at(doc, catalog, b"Names").and_then(|names| dict_at(doc, names, b"Dests"));
    if let Some(tree) = tree {
        let mut budget = MAX_NODES;
        name_tree(doc, tree, &mut names, &mut budget, 0);
    }
    names
}

/// What the file knows about where a bookmark can point.
struct Places<'a> {
    doc: &'a Document,
    names: Names<'a>,
    /// Each page's place in reading order.
    pages: BTreeMap<ObjectId, usize>,
}

impl Places<'_> {
    /// The page a destination opens: an explicit one, or a named one.
    fn page(&self, dest: &Object, depth: u8) -> Option<usize> {
        if depth > MAX_DEPTH {
            return None;
        }
        match self.doc.dereference(dest).ok()?.1 {
            Object::Array(parts) => match parts.first()? {
                Object::Reference(id) => self.pages.get(id).copied(),
                Object::Integer(at) => usize::try_from(*at)
                    .ok()
                    .filter(|at| *at < self.pages.len()),
                _ => None,
            },
            Object::Dictionary(dict) => self.page(dict.get(b"D").ok()?, depth + 1),
            Object::String(name, _) | Object::Name(name) => {
                self.page(self.names.get(name)?, depth + 1)
            }
            _ => None,
        }
    }

    /// Where a bookmark starts and what it is called.
    fn bookmark(&self, item: &Dictionary) -> Option<(usize, String)> {
        let dest = item.get(b"Dest").ok().or_else(|| {
            let action = dict_at(self.doc, item, b"A")?;
            let kind = action.get_deref(b"S", self.doc).ok()?.as_name().ok()?;
            (kind == b"GoTo").then(|| action.get(b"D").ok())?
        })?;
        let title = text_at(self.doc, item, b"Title").unwrap_or_default();
        Some((self.page(dest, 0)?, title))
    }
}

/// The bookmarks under `parent`, in the order the file lists them.
fn level<'a>(doc: &'a Document, parent: &'a Dictionary) -> Vec<&'a Dictionary> {
    let mut items = Vec::new();
    let mut seen = BTreeSet::new();
    let mut next = parent.get(b"First").ok();
    while let Some(Object::Reference(id)) = next {
        if items.len() >= MAX_NODES || !seen.insert(*id) {
            break;
        }
        let Ok(item) = doc.get_dictionary(*id) else {
            break;
        };
        items.push(item);
        next = item.get(b"Next").ok();
    }
    items
}

/// Where each chapter starts: the top-level bookmarks, in reading order. A
/// lone top-level bookmark that holds the rest is the book itself, so its
/// children are the chapters. Two bookmarks on one page are one chapter,
/// named by the first.
fn bookmarks(doc: &Document, pages: &[ObjectId]) -> Vec<(usize, String)> {
    let Ok(catalog) = doc.catalog() else {
        return Vec::new();
    };
    let Some(root) = dict_at(doc, catalog, b"Outlines") else {
        return Vec::new();
    };
    let mut items = level(doc, root);
    if let [only] = items.as_slice() {
        let inside = level(doc, only);
        if inside.len() > 1 {
            items = inside;
        }
    }
    let places = Places {
        doc,
        names: named_destinations(doc, catalog),
        pages: pages.iter().enumerate().map(|(at, id)| (*id, at)).collect(),
    };
    let mut starts: Vec<_> = items
        .iter()
        .filter_map(|item| places.bookmark(item))
        .collect();
    starts.sort_by_key(|(page, _)| *page);
    starts.dedup_by_key(|(page, _)| *page);
    starts
}

/// The text of the pages `from..to`, empty pages left out.
fn span(pages: &[String], from: usize, to: usize) -> String {
    let texts: Vec<&str> = pages
        .get(from..to)
        .unwrap_or_default()
        .iter()
        .map(String::as_str)
        .filter(|page| !page.is_empty())
        .collect();
    texts.join("\n")
}

fn chapters(pages: &[String], starts: &[(usize, String)]) -> Vec<ParsedChapter> {
    let mut found = Vec::new();
    if let Some((first, _)) = starts.first() {
        found.push(ParsedChapter {
            title: String::new(),
            front_matter: true,
            text: span(pages, 0, *first),
        });
    }
    for (i, (page, title)) in starts.iter().enumerate() {
        let end = starts.get(i + 1).map_or(pages.len(), |(next, _)| *next);
        found.push(ParsedChapter {
            title: title.clone(),
            front_matter: is_front_title(title),
            text: span(pages, *page, end),
        });
    }
    found.retain(|chapter| !chapter.text.is_empty());
    found
}

/// Cuts the pages into sections of about `size` words, each ending with a
/// page. A page longer than a section is cut between its lines instead, and
/// a tail under a quarter of the size joins the section before it. Every
/// line of every page lands in exactly one section, in order.
pub fn sections(pages: &[String], size: u32) -> Vec<String> {
    let mut done: Vec<String> = Vec::new();
    let mut open = String::new();
    let mut words = 0;
    for page in pages {
        let units: Vec<&str> = if count_words(page) > size {
            page.lines().collect()
        } else {
            vec![page.as_str()]
        };
        for unit in units.into_iter().filter(|unit| !unit.trim().is_empty()) {
            if !open.is_empty() {
                open.push('\n');
            }
            open.push_str(unit);
            words += count_words(unit);
            if words >= size {
                done.push(std::mem::take(&mut open));
                words = 0;
            }
        }
    }
    match done.last_mut() {
        Some(last) if !open.is_empty() && words < size / 4 => {
            last.push('\n');
            last.push_str(&open);
        }
        _ if !open.is_empty() => done.push(open),
        _ => {}
    }
    done
}

/// Reads a PDF into its chapters. A protected file, one that cannot be read
/// and one without text are refused as `invalid`, each saying which.
pub fn parse(bytes: &[u8]) -> Result<ParsedBook> {
    let doc = Document::load_mem(bytes).map_err(|error| {
        refused(match error {
            lopdf::Error::InvalidPassword | lopdf::Error::Decryption(_) => DRM,
            _ => UNREADABLE,
        })
    })?;
    if doc.is_encrypted() {
        return Err(refused(DRM));
    }
    let ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    if ids.is_empty() {
        return Err(refused(UNREADABLE));
    }
    let pages: Vec<String> = ids.iter().map(|id| page_text(&doc, *id)).collect();
    let words: u64 = pages.iter().map(|page| u64::from(count_words(page))).sum();
    let enough = u64::try_from(pages.len())
        .unwrap_or(u64::MAX)
        .saturating_mul(MIN_WORDS_PER_PAGE);
    if words < enough {
        return Err(refused(SCANNED));
    }

    let starts = bookmarks(&doc, &ids);
    let chapters = if starts.len() > 1 {
        chapters(&pages, &starts)
    } else {
        sections(&pages, SECTION_WORDS)
            .into_iter()
            .map(|text| ParsedChapter {
                title: String::new(),
                front_matter: false,
                text,
            })
            .collect()
    };
    let info = doc
        .trailer
        .get_deref(b"Info", &doc)
        .and_then(Object::as_dict)
        .ok();
    Ok(ParsedBook {
        title: info.and_then(|info| text_at(&doc, info, b"Title")),
        author: info.and_then(|info| text_at(&doc, info, b"Author")),
        chapters,
    })
}

/// PDF files built in memory from the opening of *Alice's Adventures in
/// Wonderland* (Lewis Carroll, 1865, public domain).
#[cfg(test)]
pub mod fixtures {
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

    pub const TITLE_PAGE: [&str; 2] = ["Alice's Adventures in Wonderland", "by Lewis Carroll"];
    pub const CONTENTS: [&str; 3] = [
        "Contents",
        "I. Down the Rabbit-Hole",
        "II. The Pool of Tears",
    ];
    pub const RABBIT_HOLE: [&str; 5] = [
        "CHAPTER I. Down the Rabbit-Hole",
        "Alice was beginning to get very tired of sitting by her sister on the",
        "bank, and of having nothing to do: once or twice she had peeped into",
        "the book her sister was reading, but it had no pictures or",
        "conversations in it.",
    ];
    pub const RABBIT_HOLE_GOES_ON: [&str; 3] = [
        "So she was considering in her own mind (as well as she could, for the",
        "hot day made her feel very sleepy and stupid), whether the pleasure of",
        "making a daisy-chain would be worth the trouble of getting up.",
    ];
    pub const POOL_OF_TEARS: [&str; 3] = [
        "CHAPTER II. The Pool of Tears",
        "Curiouser and curiouser! cried Alice (she was so much surprised, that",
        "for the moment she quite forgot how to speak good English).",
    ];
    /// Sixty words, the stuff of the pages of the book without bookmarks.
    pub const PARAGRAPH: [&str; 5] = [
        "There was nothing so very remarkable in that; nor did Alice think it",
        "so very much out of the way to hear the Rabbit say to itself, Oh",
        "dear! Oh dear! I shall be late! But when the Rabbit actually took a",
        "watch out of its waistcoat-pocket, and looked at it, and then hurried",
        "on, Alice started to her feet, for it flashed across her mind.",
    ];
    /// Pages of the book without bookmarks, and paragraphs on each.
    pub const PLAIN_PAGES: usize = 20;
    pub const PARAGRAPHS_PER_PAGE: usize = 7;

    /// A bookmark being written: its own entries, and the ones under it.
    pub struct Mark {
        entry: Dictionary,
        inside: Vec<Mark>,
    }

    impl Mark {
        /// One that names its page in `/Dest`.
        pub fn to(title: &str, page: ObjectId) -> Self {
            Self::with(title, "Dest", vec![page.into(), "Fit".into()].into())
        }

        /// One that points at a named destination.
        pub fn named(title: &str, name: &str) -> Self {
            Self::with(title, "Dest", Object::string_literal(name))
        }

        /// One that opens its page through a `GoTo` action.
        pub fn action(title: &str, page: ObjectId) -> Self {
            let action = dictionary! {
                "S" => "GoTo",
                "D" => vec![page.into(), "XYZ".into(), 0.into(), 720.into(), 0.into()],
            };
            Self::with(title, "A", action.into())
        }

        fn with(title: &str, key: &str, value: Object) -> Self {
            let mut entry = dictionary! { "Title" => lopdf::text_string(title) };
            entry.set(key, value);
            Self {
                entry,
                inside: Vec::new(),
            }
        }

        pub fn holding(mut self, inside: Vec<Mark>) -> Self {
            self.inside = inside;
            self
        }
    }

    /// A document being written, page by page.
    pub struct Draft {
        doc: Document,
        pages_id: ObjectId,
        pages: Vec<ObjectId>,
        catalog: Dictionary,
    }

    impl Draft {
        pub fn new() -> Self {
            let mut doc = Document::with_version("1.5");
            let pages_id = doc.new_object_id();
            Self {
                doc,
                pages_id,
                pages: Vec::new(),
                catalog: dictionary! { "Type" => "Catalog", "Pages" => pages_id },
            }
        }

        fn page(&mut self, operations: Vec<Operation>, resources: Dictionary) -> ObjectId {
            let content = Content { operations }.encode().expect("content");
            let content_id = self.doc.add_object(Stream::new(dictionary! {}, content));
            let page = self.doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => self.pages_id,
                "Contents" => content_id,
                "Resources" => resources,
            });
            self.pages.push(page);
            page
        }

        /// A page that shows these operations in Courier: every glyph is 0.6
        /// of the font size wide.
        pub fn drawn(&mut self, operations: Vec<Operation>) -> ObjectId {
            let font = self.doc.add_object(dictionary! {
                "Type" => "Font",
                "Subtype" => "Type1",
                "BaseFont" => "Courier",
                "Encoding" => "WinAnsiEncoding",
                "FirstChar" => 32,
                "LastChar" => 126,
                "Widths" => vec![Object::from(600); 95],
            });
            self.page(
                operations,
                dictionary! { "Font" => dictionary! { "F1" => font } },
            )
        }

        /// A page of text, one line under the other.
        pub fn text(&mut self, lines: &[&str]) -> ObjectId {
            let mut operations = vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("TL", vec![14.into()]),
                Operation::new("Td", vec![72.into(), 720.into()]),
            ];
            for line in lines {
                operations.push(Operation::new("Tj", vec![Object::string_literal(*line)]));
                operations.push(Operation::new("T*", vec![]));
            }
            operations.push(Operation::new("ET", vec![]));
            self.drawn(operations)
        }

        /// A page that is one picture, as a scanner leaves it.
        pub fn scan(&mut self) -> ObjectId {
            let image = Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => 1,
                    "Height" => 1,
                    "ColorSpace" => "DeviceGray",
                    "BitsPerComponent" => 8,
                },
                vec![0x80],
            );
            let image = self.doc.add_object(image);
            let stretch = [612, 0, 0, 792, 0, 0].map(Object::from).to_vec();
            self.page(
                vec![
                    Operation::new("q", vec![]),
                    Operation::new("cm", stretch),
                    Operation::new("Do", vec!["Im1".into()]),
                    Operation::new("Q", vec![]),
                ],
                dictionary! { "XObject" => dictionary! { "Im1" => image } },
            )
        }

        fn link(&mut self, parent: ObjectId, marks: Vec<Mark>) -> Option<(ObjectId, ObjectId)> {
            let ids: Vec<ObjectId> = marks.iter().map(|_| self.doc.new_object_id()).collect();
            for (at, mark) in marks.into_iter().enumerate() {
                let id = *ids.get(at)?;
                let mut entry = mark.entry;
                entry.set("Parent", parent);
                if let Some(next) = ids.get(at + 1) {
                    entry.set("Next", *next);
                }
                if let Some((first, last)) = self.link(id, mark.inside) {
                    entry.set("First", first);
                    entry.set("Last", last);
                }
                self.doc.objects.insert(id, entry.into());
            }
            Some((*ids.first()?, *ids.last()?))
        }

        /// The bookmarks, in the order given.
        pub fn outline(&mut self, marks: Vec<Mark>) {
            let root = self.doc.new_object_id();
            let mut outlines = dictionary! { "Type" => "Outlines" };
            if let Some((first, last)) = self.link(root, marks) {
                outlines.set("First", first);
                outlines.set("Last", last);
            }
            self.doc.objects.insert(root, outlines.into());
            self.catalog.set("Outlines", root);
        }

        /// A destination a bookmark can point at by name.
        pub fn name(&mut self, name: &str, page: ObjectId) {
            let dest: Object = vec![page.into(), "Fit".into()].into();
            let leaf = self.doc.add_object(dictionary! {
                "Names" => vec![Object::string_literal(name), dictionary! { "D" => dest }.into()],
            });
            let tree = dictionary! { "Kids" => vec![leaf.into()] };
            self.catalog.set("Names", dictionary! { "Dests" => tree });
        }

        pub fn info(&mut self, title: &str, author: &str) {
            let info = self.doc.add_object(dictionary! {
                "Title" => lopdf::text_string(title),
                "Author" => lopdf::text_string(author),
            });
            self.doc.trailer.set("Info", info);
        }

        pub fn bytes(mut self) -> Vec<u8> {
            let kids: Vec<Object> = self.pages.iter().map(|page| (*page).into()).collect();
            let pages = dictionary! {
                "Type" => "Pages",
                "Count" => i64::try_from(kids.len()).expect("page count"),
                "Kids" => kids,
                "MediaBox" => [0, 0, 612, 792].map(Object::from).to_vec(),
            };
            self.doc.objects.insert(self.pages_id, pages.into());
            let catalog = self.doc.add_object(self.catalog);
            self.doc.trailer.set("Root", catalog);
            self.doc.compress();
            let mut bytes = Vec::new();
            self.doc.save_to(&mut bytes).expect("save pdf");
            bytes
        }
    }

    /// A title page, the contents, a chapter of two pages and one of one. The
    /// bookmarks are listed out of reading order and point in three ways; one
    /// has a bookmark of its own inside.
    pub fn alice() -> Vec<u8> {
        let mut draft = Draft::new();
        draft.text(&TITLE_PAGE);
        let contents = draft.text(&CONTENTS);
        let one = draft.text(&RABBIT_HOLE);
        let goes_on = draft.text(&RABBIT_HOLE_GOES_ON);
        let two = draft.text(&POOL_OF_TEARS);
        draft.name("chapter.2", two);
        draft.outline(vec![
            Mark::named("II. The Pool of Tears", "chapter.2"),
            Mark::to("Contents", contents),
            Mark::action("I. Down the Rabbit-Hole", one)
                .holding(vec![Mark::to("A daisy-chain", goes_on)]),
        ]);
        draft.info("Alice's Adventures in Wonderland", "Lewis Carroll");
        draft.bytes()
    }

    /// The same book with its chapters under one bookmark, the book's name.
    pub fn alice_under_one_bookmark() -> Vec<u8> {
        let mut draft = Draft::new();
        let title = draft.text(&TITLE_PAGE);
        let one = draft.text(&RABBIT_HOLE);
        let two = draft.text(&POOL_OF_TEARS);
        draft.outline(vec![Mark::to("Alice", title).holding(vec![
            Mark::to("I. Down the Rabbit-Hole", one),
            Mark::to("II. The Pool of Tears", two),
        ])]);
        draft.bytes()
    }

    /// What page `number` (from 1) of the book without bookmarks says.
    pub fn plain_page(number: usize) -> Vec<String> {
        let mut lines = vec![format!("Leaf {number} of the book.")];
        for _ in 0..PARAGRAPHS_PER_PAGE {
            lines.extend(PARAGRAPH.iter().map(|line| (*line).to_owned()));
        }
        lines
    }

    /// Twenty pages of text, no bookmarks and no title.
    pub fn alice_without_bookmarks() -> Vec<u8> {
        let mut draft = Draft::new();
        for number in 1..=PLAIN_PAGES {
            let lines = plain_page(number);
            draft.text(&lines.iter().map(String::as_str).collect::<Vec<_>>());
        }
        draft.bytes()
    }

    /// Three pages that are pictures of pages, bookmarks and all.
    pub fn alice_scanned() -> Vec<u8> {
        let mut draft = Draft::new();
        let cover = draft.scan();
        let one = draft.scan();
        draft.scan();
        draft.outline(vec![Mark::to("Cover", cover), Mark::to("Chapter I", one)]);
        draft.info("Alice's Adventures in Wonderland", "Lewis Carroll");
        draft.bytes()
    }

    /// One page that shows `operations`.
    pub fn drawn(operations: Vec<Operation>) -> Vec<u8> {
        let mut draft = Draft::new();
        draft.drawn(operations);
        draft.bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;

    #[test]
    fn bookmarks_become_chapters_in_reading_order() {
        let book = parse(&fixtures::alice()).expect("parses");
        assert_eq!(
            book.title.as_deref(),
            Some("Alice's Adventures in Wonderland")
        );
        assert_eq!(book.author.as_deref(), Some("Lewis Carroll"));
        let outline: Vec<(&str, bool)> = book
            .chapters
            .iter()
            .map(|c| (c.title.as_str(), c.front_matter))
            .collect();
        assert_eq!(
            outline,
            [
                ("", true),
                ("Contents", true),
                ("I. Down the Rabbit-Hole", false),
                ("II. The Pool of Tears", false),
            ]
        );
        let text = |at: usize| book.chapters.get(at).map(|c| c.text.clone());
        assert_eq!(text(0), Some(fixtures::TITLE_PAGE.join("\n")));
        assert_eq!(text(1), Some(fixtures::CONTENTS.join("\n")));
        // The chapter runs over both its pages; the bookmark inside it does
        // not start a chapter.
        let rabbit_hole = [&fixtures::RABBIT_HOLE[..], &fixtures::RABBIT_HOLE_GOES_ON].concat();
        assert_eq!(text(2), Some(rabbit_hole.join("\n")));
        assert_eq!(text(3), Some(fixtures::POOL_OF_TEARS.join("\n")));
    }

    #[test]
    fn a_lone_bookmark_that_holds_the_rest_is_the_book() {
        let book = parse(&fixtures::alice_under_one_bookmark()).expect("parses");
        let outline: Vec<(&str, bool)> = book
            .chapters
            .iter()
            .map(|c| (c.title.as_str(), c.front_matter))
            .collect();
        assert_eq!(
            outline,
            [
                ("", true),
                ("I. Down the Rabbit-Hole", false),
                ("II. The Pool of Tears", false),
            ]
        );
        assert_eq!(book.title, None);
    }

    #[test]
    fn without_bookmarks_the_text_is_cut_into_sections_that_cover_it() {
        let book = parse(&fixtures::alice_without_bookmarks()).expect("parses");
        assert_eq!(book.title, None);
        // Each section stops at the first page that takes it past the size.
        let page = count_words(&fixtures::plain_page(1).join("\n"));
        let sizes: Vec<u32> = book.chapters.iter().map(|c| count_words(&c.text)).collect();
        assert_eq!(sizes.len(), 3);
        assert!(sizes
            .iter()
            .take(2)
            .all(|size| (SECTION_WORDS..SECTION_WORDS + page).contains(size)));
        assert_eq!(sizes.iter().sum::<u32>(), page * 20);
        assert!(book
            .chapters
            .iter()
            .all(|c| c.title.is_empty() && !c.front_matter));

        let written: Vec<String> = (1..=fixtures::PLAIN_PAGES)
            .flat_map(fixtures::plain_page)
            .collect();
        let read: Vec<&str> = book.chapters.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(read.join("\n"), written.join("\n"));
    }

    #[test]
    fn a_scanned_file_is_refused_as_scanned() {
        let Err(error) = parse(&fixtures::alice_scanned()) else {
            panic!("a scan was read");
        };
        assert_eq!(error.kind(), "invalid");
        assert_eq!(error.to_string(), SCANNED);
    }

    #[test]
    fn a_file_that_is_not_a_pdf_is_unreadable() {
        for bytes in [&b"%PDF-1.7\nnot really"[..], b""] {
            assert!(matches!(parse(bytes), Err(Error::Invalid(why)) if why == UNREADABLE));
        }
    }

    #[test]
    fn sections_end_with_a_page_and_keep_every_line() {
        let page = |words: usize| vec!["word"; words].join(" ");
        let pages = [page(4), page(4), page(4), String::new(), page(4), page(1)];
        // Two pages reach the size of 8; the last word joins the section
        // before it.
        assert_eq!(
            sections(&pages, 8),
            [
                [page(4), page(4)].join("\n"),
                [page(4), page(4), page(1)].join("\n"),
            ]
        );
        // Three words are a section of their own.
        let pages = [page(8), page(3)];
        assert_eq!(sections(&pages, 8), [page(8), page(3)]);
    }

    #[test]
    fn a_page_longer_than_a_section_is_cut_between_its_lines() {
        let pages = ["one two\nthree four\nfive six\nseven eight".to_owned()];
        assert_eq!(
            sections(&pages, 4),
            ["one two\nthree four", "five six\nseven eight"]
        );
        assert_eq!(sections(&[], 4), Vec::<String>::new());
        // A short tail is a section when it is all there is.
        assert_eq!(sections(&["alone".to_owned()], 4), ["alone"]);
    }
}
