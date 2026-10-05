//! The two ways a book's XML is read: the package files as a small tree, and
//! the content documents as plain text with the place of every anchor.

use std::collections::{HashMap, HashSet};

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
    "td",
    "th",
    "caption",
];

/// The values of `display` that put an element on a line of its own.
const BREAKING: &[&str] = &[
    "block",
    "list-item",
    "table",
    "table-row",
    "table-cell",
    "table-caption",
    "flex",
    "grid",
    "flow-root",
];

/// Whether these declarations set a `display` that starts and ends a line.
fn breaks_line(declarations: &str) -> bool {
    declarations.split(';').any(|declaration| {
        declaration
            .split_once(':')
            .is_some_and(|(property, value)| {
                let value = value.to_ascii_lowercase();
                let value = value.trim().trim_end_matches("!important").trim();
                property.trim().eq_ignore_ascii_case("display") && BREAKING.contains(&value)
            })
    })
}

/// What a book's stylesheets put on a line of its own though its element
/// does not: `<span class="num">Chapter 1</span>Nightmare Begins` is two
/// lines on the page when `.num` is displayed as a block, and has to be two
/// lines of text too, or the words run together.
#[derive(Debug, Default, PartialEq)]
pub struct Styles {
    classes: HashSet<String>,
    tags: HashSet<String>,
}

impl Styles {
    /// Takes from a stylesheet every rule that displays what it selects as
    /// a block. The last part of the selector says what that is: its class,
    /// or its element when it names no class.
    pub fn add(&mut self, css: &str) {
        let mut rest = css;
        let mut plain = String::with_capacity(css.len());
        while let Some((before, after)) = rest.split_once("/*") {
            plain.push_str(before);
            rest = after.split_once("*/").map_or("", |(_, tail)| tail);
        }
        plain.push_str(rest);
        for rule in plain.split('}') {
            let Some((head, declarations)) = rule.rsplit_once('{') else {
                continue;
            };
            if !breaks_line(declarations) {
                continue;
            }
            // Inside `@media … {` the selector is what follows that brace.
            let selectors = head.rsplit('{').next().unwrap_or(head);
            for selector in selectors.split(',') {
                self.select(selector);
            }
        }
    }

    fn select(&mut self, selector: &str) {
        let Some(last) = selector
            .split(|c: char| c.is_whitespace() || matches!(c, '>' | '+' | '~'))
            .rfind(|part| !part.is_empty())
        else {
            return;
        };
        let last = last.split(':').next().unwrap_or(last);
        let name = |text: &str| -> String {
            text.chars()
                .take_while(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
                .collect()
        };
        match last.rsplit_once('.') {
            Some((_, class)) => self.classes.insert(name(class)),
            None => self.tags.insert(name(last).to_ascii_lowercase()),
        };
    }

    /// Whether an element with this name and these attributes is displayed
    /// as a block: by a stylesheet, or by its own `style`.
    fn breaks(&self, name: &str, attrs: &[(String, String)]) -> bool {
        self.tags.contains(name)
            || attrs.iter().any(|(key, value)| match key.as_str() {
                "class" => value
                    .split_whitespace()
                    .any(|class| self.classes.contains(class)),
                "style" => breaks_line(value),
                _ => false,
            })
    }
}

#[derive(Clone, Copy, PartialEq, PartialOrd)]
enum Gap {
    None,
    Space,
    Line,
}

struct Writer<'a> {
    out: Text,
    styles: &'a Styles,
    /// For each open element, whether it starts and ends a line.
    open: Vec<bool>,
    /// What separates the text so far from the next word.
    gap: Gap,
    /// How many skipped elements are open.
    skipping: usize,
}

impl Writer<'_> {
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
                self.open.push(false);
            }
            return;
        }
        let attrs = attrs(start);
        let block = BLOCKS.contains(&name.as_str()) || self.styles.breaks(&name, &attrs);
        if block {
            self.gap(Gap::Line);
        }
        if !empty {
            self.open.push(block);
        }
        for (key, value) in attrs {
            if key == "id" || (key == "name" && name == "a") {
                self.out.anchors.entry(value).or_insert(self.out.text.len());
            }
        }
    }

    fn end(&mut self, name: &str) {
        let name = name.to_ascii_lowercase();
        // A document that closes what it never opened still ends its blocks.
        let block = self.open.pop().unwrap_or(false);
        if SKIPPED.contains(&name.as_str()) {
            self.skipping = self.skipping.saturating_sub(1);
        } else if block || BLOCKS.contains(&name.as_str()) {
            self.gap(Gap::Line);
        }
    }
}

/// The readable text of an XHTML document, laid out in lines as the book's
/// `styles` say. A document that breaks halfway gives what came before the
/// break.
pub fn text(xhtml: &str, styles: &Styles) -> Text {
    let mut reader = reader(xhtml);
    let mut writer = Writer {
        out: Text::default(),
        styles,
        open: Vec::new(),
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

    /// The text of a document of a book without stylesheets.
    fn plain(xhtml: &str) -> Text {
        text(xhtml, &Styles::default())
    }

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
        let page = plain(
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
        assert_eq!(plain("<p>Kept</p><p attr=>").text, "Kept");
        assert_eq!(plain("<p>Open <b>ends</i></p>").text, "Open ends");
    }

    #[test]
    fn what_a_stylesheet_displays_as_a_block_is_a_line_of_its_own() {
        let mut styles = Styles::default();
        styles.add(
            "/* headings */ h2.chapter .num { display: block; font-size: 0.72em }
             p.i { font-style: italic }
             @media screen { .part > span.kicker:first-child, cite { DISPLAY : Block !important } }
             .aside { display: inline-block }",
        );
        let page = text(
            r#"<h2 class="chapter"><span class="num">Chapter 1</span>Nightmare Begins</h2>
               <p class="i">A <span class="aside">frail</span>-looking man<cite>Anon</cite>said
               <span class="big kicker">so</span>twice.</p>
               <p>One<span style="color: red; display:block">Two</span>Three</p>
               <table><tr><td>a</td><td>b</td></tr></table>"#,
            &styles,
        );
        assert_eq!(
            page.text,
            "Chapter 1\nNightmare Begins\nA frail-looking man\nAnon\nsaid\nso\ntwice.\n\
             One\nTwo\nThree\na\nb"
        );
        // Without the book's styles the same words run together.
        let glued = plain(r#"<h2><span class="num">Chapter 1</span>Nightmare</h2>"#);
        assert_eq!(glued.text, "Chapter 1Nightmare");
    }
}
