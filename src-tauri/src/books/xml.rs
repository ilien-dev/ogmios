//! The two ways a book's XML is read: the package files as a small tree, and
//! the content documents as plain text with the place of every anchor.

use std::collections::HashMap;

use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

/// One element: names without their namespace prefix, text of the element
/// itself and of everything under it.
#[derive(Debug, Default)]
pub struct Node {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
    pub text: String,
}

impl Node {
    /// An attribute by its name without prefix (`epub:type` is `type`).
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|node| node.name == name)
    }

    /// Every element under this one with that name, in document order.
    pub fn descendants(&self, name: &str) -> Vec<&Node> {
        let mut found = Vec::new();
        self.collect(name, &mut found);
        found
    }

    fn collect<'a>(&'a self, name: &str, found: &mut Vec<&'a Node>) {
        for node in &self.children {
            if node.name == name {
                found.push(node);
            }
            node.collect(name, found);
        }
    }

    pub fn find(&self, name: &str) -> Option<&Node> {
        self.descendants(name).first().copied()
    }
}

/// Books are written by many tools and few of them are strict; neither is
/// this reader.
fn reader(xml: &str) -> Reader<&[u8]> {
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.check_end_names = false;
    config.allow_unmatched_ends = true;
    config.allow_dangling_amp = true;
    reader
}

fn attrs(start: &BytesStart<'_>) -> Vec<(String, String)> {
    start
        .html_attributes()
        .with_checks(false)
        .flatten()
        .map(|attr| {
            let value = attr
                .normalized_value(XmlVersion::Implicit1_0)
                .map_or_else(|_| attr.value.to_string(), std::borrow::Cow::into_owned);
            (attr.key.local_name().as_ref().to_owned(), value)
        })
        .collect()
}

/// The HTML entities books actually use; XML itself only knows the first five.
const ENTITIES: &[(&str, &str)] = &[
    ("amp", "&"),
    ("lt", "<"),
    ("gt", ">"),
    ("quot", "\""),
    ("apos", "'"),
    ("nbsp", " "),
    ("ensp", " "),
    ("emsp", " "),
    ("thinsp", " "),
    ("shy", ""),
    ("mdash", "—"),
    ("ndash", "–"),
    ("hellip", "…"),
    ("lsquo", "‘"),
    ("rsquo", "’"),
    ("ldquo", "“"),
    ("rdquo", "”"),
    ("laquo", "«"),
    ("raquo", "»"),
    ("copy", "©"),
    ("pound", "£"),
    ("eacute", "é"),
    ("egrave", "è"),
    ("agrave", "à"),
    ("ccedil", "ç"),
    ("ntilde", "ñ"),
    ("ouml", "ö"),
    ("uuml", "ü"),
    ("aelig", "æ"),
    ("oelig", "œ"),
];

/// What `&name;` or `&#number;` stands for; an unknown one stands for nothing
/// rather than failing the whole book.
fn entity(reference: &BytesRef<'_>) -> String {
    if let Ok(Some(ch)) = reference.resolve_char_ref() {
        return ch.to_string();
    }
    let name: &str = reference;
    ENTITIES
        .iter()
        .find(|(known, _)| *known == name)
        .map(|(_, text)| (*text).to_owned())
        .unwrap_or_default()
}

fn node(start: &BytesStart<'_>) -> Node {
    Node {
        name: start.local_name().as_ref().to_owned(),
        attrs: attrs(start),
        ..Node::default()
    }
}

/// Closes the innermost open element into its parent.
fn close(open: &mut Vec<Node>) {
    if open.len() < 2 {
        return;
    }
    if let (Some(done), Some(parent)) = (open.pop(), open.last_mut()) {
        parent.text.push_str(&done.text);
        parent.children.push(done);
    }
}

/// Parses a package file (container, OPF, NCX, navigation document). `None`
/// when it is not XML at all.
pub fn parse(xml: &str) -> Option<Node> {
    let mut reader = reader(xml);
    // The open elements; the first is a root that holds the document.
    let mut open = vec![Node::default()];
    loop {
        match reader.read_event().ok()? {
            Event::Start(start) => open.push(node(&start)),
            Event::Empty(start) => {
                open.push(node(&start));
                close(&mut open);
            }
            Event::End(_) => close(&mut open),
            Event::Text(text) => open.last_mut()?.text.push_str(&text),
            Event::CData(text) => open.last_mut()?.text.push_str(&text),
            Event::GeneralRef(reference) => open.last_mut()?.text.push_str(&entity(&reference)),
            Event::Eof => break,
            _ => {}
        }
    }
    while open.len() > 1 {
        close(&mut open);
    }
    let root = open.pop()?;
    (!root.children.is_empty()).then_some(root)
}

/// Runs of whitespace as one space.
pub fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A content document as text: one line per block, whitespace collapsed.
#[derive(Debug, Default, PartialEq)]
pub struct Text {
    pub text: String,
    /// Where each `id` starts, as a byte offset into `text`.
    pub anchors: HashMap<String, usize>,
}

/// Elements whose content is not the book's text.
const SKIPPED: &[&str] = &["head", "script", "style"];
/// Elements that start and end a line.
const BLOCKS: &[&str] = &[
    "p",
    "div",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "ul",
    "ol",
    "tr",
    "table",
    "blockquote",
    "section",
    "article",
    "aside",
    "header",
    "footer",
    "pre",
    "dd",
    "dt",
    "dl",
    "figure",
    "figcaption",
    "body",
];

#[derive(Clone, Copy, PartialEq, PartialOrd)]
enum Gap {
    None,
    Space,
    Line,
}

struct Writer {
    out: Text,
    /// What separates the text so far from the next word.
    gap: Gap,
    /// How many skipped elements are open.
    skipping: usize,
}

impl Writer {
    fn gap(&mut self, gap: Gap) {
        if gap > self.gap {
            self.gap = gap;
        }
    }

    fn push(&mut self, text: &str) {
        if self.skipping > 0 {
            return;
        }
        for ch in text.chars() {
            if ch.is_whitespace() {
                self.gap(Gap::Space);
                continue;
            }
            if !self.out.text.is_empty() {
                match self.gap {
                    Gap::None => {}
                    Gap::Space => self.out.text.push(' '),
                    Gap::Line => self.out.text.push('\n'),
                }
            }
            self.gap = Gap::None;
            self.out.text.push(ch);
        }
    }

    fn start(&mut self, start: &BytesStart<'_>, empty: bool) {
        let name = start.local_name().as_ref().to_ascii_lowercase();
        if SKIPPED.contains(&name.as_str()) {
            if !empty {
                self.skipping += 1;
            }
            return;
        }
        if BLOCKS.contains(&name.as_str()) {
            self.gap(Gap::Line);
        }
        for (key, value) in attrs(start) {
            if key == "id" || (key == "name" && name == "a") {
                self.out.anchors.entry(value).or_insert(self.out.text.len());
            }
        }
    }

    fn end(&mut self, name: &str) {
        let name = name.to_ascii_lowercase();
        if SKIPPED.contains(&name.as_str()) {
            self.skipping = self.skipping.saturating_sub(1);
        } else if BLOCKS.contains(&name.as_str()) {
            self.gap(Gap::Line);
        }
    }
}

/// The readable text of an XHTML document. A document that breaks halfway
/// gives what came before the break.
pub fn text(xhtml: &str) -> Text {
    let mut reader = reader(xhtml);
    let mut writer = Writer {
        out: Text::default(),
        gap: Gap::None,
        skipping: 0,
    };
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => writer.start(&start, false),
            Ok(Event::Empty(start)) => writer.start(&start, true),
            Ok(Event::End(end)) => writer.end(end.local_name().as_ref()),
            Ok(Event::Text(text)) => writer.push(&text),
            Ok(Event::CData(text)) => writer.push(&text),
            Ok(Event::GeneralRef(reference)) => writer.push(&entity(&reference)),
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }
    writer.out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_package_file_becomes_a_tree_without_prefixes() {
        let root = parse(
            r#"<?xml version="1.0"?>
            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
              <metadata><dc:title>Three Men &amp; a Boat</dc:title></metadata>
              <manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest>
            </package>"#,
        )
        .expect("parses");
        assert_eq!(
            root.find("title").map(|n| n.text.as_str()),
            Some("Three Men & a Boat")
        );
        let ids: Vec<_> = root
            .descendants("item")
            .iter()
            .filter_map(|n| n.attr("id"))
            .collect();
        assert_eq!(ids, ["a", "b"]);
        assert!(parse("not xml").is_none());
    }

    #[test]
    fn text_keeps_blocks_apart_and_drops_what_is_not_prose() {
        let page = text(
            r#"<html><head><title>Skipped</title><style>p { color: red }</style></head>
            <body><h1 id="one">Chapter  One</h1>
            <p>It was&nbsp;a <em>bright</em>,
               cold day&mdash;in April&#8230;</p><script>x()</script>
            <p id="two">The clocks &unknown;struck.<br/>Thirteen.</p></body></html>"#,
        );
        assert_eq!(
            page.text,
            "Chapter One\nIt was a bright, cold day—in April…\nThe clocks struck.\nThirteen."
        );
        assert_eq!(page.anchors.get("one"), Some(&0));
        let two = *page.anchors.get("two").expect("anchor");
        assert_eq!(
            page.text[two..].trim_start(),
            "The clocks struck.\nThirteen."
        );
    }

    #[test]
    fn a_broken_document_gives_what_it_could_read() {
        assert_eq!(text("<p>Kept</p><p attr=>").text, "Kept");
        assert_eq!(text("<p>Open <b>ends</i></p>").text, "Open ends");
    }
}
