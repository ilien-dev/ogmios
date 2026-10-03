//! The text of a PDF page. A page is a list of drawing operations that place
//! runs of glyphs; the words and lines are recovered from where the runs sit,
//! which takes the width of every glyph shown.

use std::collections::BTreeMap;

use lopdf::content::Operation;
use lopdf::{Dictionary, Document, Encoding, Object, ObjectId};

use super::xml::collapse;

/// A gap between two runs on a line wider than this share of the font size
/// is a space between words; a narrower one is kerning.
const WORD_GAP: f32 = 0.12;
/// Two baselines closer than this are one line.
const SAME_LINE: f32 = 0.5;
/// The width of a glyph the font says nothing about, in thousandths of the
/// font size.
const USUAL_WIDTH: f32 = 500.0;
/// Glyph widths are given in thousandths of the font size.
const PER_MILLE: f32 = 1000.0;

/// How wide each glyph of a font is, in thousandths of the font size.
enum Widths {
    /// One byte per glyph: the widths from `first` on.
    Bytes { first: usize, widths: Vec<f32> },
    /// Two bytes per glyph: single codes, ranges of codes, and the rest.
    Codes {
        single: BTreeMap<u32, f32>,
        ranges: Vec<(u32, u32, f32)>,
        default: f32,
    },
}

/// The object itself, when `object` is a reference to it.
fn plain<'a>(doc: &'a Document, object: &'a Object) -> Option<&'a Object> {
    Some(doc.dereference(object).ok()?.1)
}

fn float(doc: &Document, object: &Object) -> Option<f32> {
    plain(doc, object)?.as_float().ok()
}

fn code(doc: &Document, object: &Object) -> Option<u32> {
    u32::try_from(plain(doc, object)?.as_i64().ok()?).ok()
}

impl Widths {
    fn of(doc: &Document, font: &Dictionary) -> Self {
        let descendant = font
            .get_deref(b"DescendantFonts", doc)
            .and_then(Object::as_array)
            .ok()
            .and_then(|fonts| plain(doc, fonts.first()?)?.as_dict().ok());
        if let Some(descendant) = descendant {
            return Self::codes(doc, descendant);
        }
        let first = font.get(b"FirstChar").ok();
        let widths = font.get_deref(b"Widths", doc).and_then(Object::as_array);
        Self::Bytes {
            first: first
                .and_then(|first| usize::try_from(code(doc, first)?).ok())
                .unwrap_or(0),
            widths: widths
                .map(|widths| {
                    let width = |width| float(doc, width).unwrap_or(USUAL_WIDTH);
                    widths.iter().map(width).collect()
                })
                .unwrap_or_default(),
        }
    }

    /// The `/W` array of a composite font: `first [w w …]` gives one width per
    /// code from `first`, `first last w` one width for the whole range.
    fn codes(doc: &Document, font: &Dictionary) -> Self {
        let mut single = BTreeMap::new();
        let mut ranges = Vec::new();
        let items = font.get_deref(b"W", doc).and_then(Object::as_array);
        let mut items = items.map(|items| items.iter()).into_iter().flatten();
        while let Some(first) = items.next().and_then(|first| code(doc, first)) {
            let Some(next) = items.next().and_then(|next| plain(doc, next)) else {
                break;
            };
            if let Object::Array(widths) = next {
                for (code, width) in (first..).zip(widths) {
                    if let Some(width) = float(doc, width) {
                        single.insert(code, width);
                    }
                }
            } else {
                let width = items.next().and_then(|width| float(doc, width));
                if let (Some(last), Some(width)) = (code(doc, next), width) {
                    ranges.push((first, last, width));
                }
            }
        }
        let default = font.get(b"DW").ok().and_then(|width| float(doc, width));
        Self::Codes {
            single,
            ranges,
            default: default.unwrap_or(PER_MILLE),
        }
    }

    /// The width of a shown string, and how many glyphs it has.
    fn measure(&self, bytes: &[u8]) -> (f32, usize) {
        match self {
            Self::Bytes { first, widths } => {
                let width = |byte: &u8| {
                    let at = usize::from(*byte).checked_sub(*first);
                    at.and_then(|at| widths.get(at))
                        .copied()
                        .unwrap_or(USUAL_WIDTH)
                };
                (bytes.iter().map(width).sum(), bytes.len())
            }
            Self::Codes {
                single,
                ranges,
                default,
            } => {
                let width = |pair: &[u8]| {
                    let code = pair
                        .iter()
                        .fold(0, |code, byte| code * 256 + u32::from(*byte));
                    let ranged = ranges
                        .iter()
                        .find(|(from, to, _)| (*from..=*to).contains(&code));
                    let listed = single.get(&code).or(ranged.map(|(_, _, width)| width));
                    listed.copied().unwrap_or(*default)
                };
                let glyphs = bytes.chunks(2);
                (glyphs.clone().map(width).sum(), glyphs.len())
            }
        }
    }
}

/// What it takes to read a string shown in a font.
struct Font<'a> {
    encoding: Option<Encoding<'a>>,
    widths: Widths,
}

/// The text of a page while it is read: the finished lines, the open one,
/// and where the next glyph goes.
struct Lines<'a> {
    done: Vec<String>,
    line: String,
    font: Option<&'a Font<'a>>,
    size: f32,
    /// Extra room after every glyph, in text units.
    spacing: f32,
    /// Where the next glyph goes, where its line started, and the scale of
    /// the text matrix along each axis.
    at: (f32, f32),
    line_x: f32,
    scale: (f32, f32),
    /// Where the text shown last ended; none when a new line was asked for.
    end: Option<(f32, f32)>,
    /// Whether the open text object has been positioned or shown anything.
    placed: bool,
}

impl Lines<'_> {
    fn new() -> Self {
        Self {
            done: Vec::new(),
            line: String::new(),
            font: None,
            size: 0.0,
            spacing: 0.0,
            at: (0.0, 0.0),
            line_x: 0.0,
            scale: (1.0, 1.0),
            end: None,
            placed: false,
        }
    }

    fn end_line(&mut self) {
        let line = collapse(&tidy(&self.line));
        if !line.is_empty() {
            self.done.push(line);
        }
        self.line.clear();
    }

    fn begin_text(&mut self) {
        self.at = (0.0, 0.0);
        self.line_x = 0.0;
        self.scale = (1.0, 1.0);
        self.placed = false;
    }

    /// `Tm`: the text matrix, of which the scale and the position matter.
    fn place(&mut self, matrix: &[f32]) {
        if let [a, _, _, d, x, y] = *matrix {
            let scale = |by: f32| if by.abs() > f32::EPSILON { by } else { 1.0 };
            self.scale = (scale(a), scale(d));
            self.at = (x, y);
            self.line_x = x;
            self.placed = true;
        }
    }

    /// `Td`: a move from where the line started.
    fn shift(&mut self, right: f32, up: f32) {
        self.line_x += right * self.scale.0;
        self.at = (self.line_x, self.at.1 + up * self.scale.1);
        self.placed = true;
    }

    fn next_line(&mut self) {
        self.at.0 = self.line_x;
        self.end = None;
        self.placed = true;
    }

    /// A `TJ` adjustment, in thousandths of the font size: positive closes up.
    fn kern(&mut self, by: f32) {
        self.at.0 -= by / PER_MILLE * self.size * self.scale.0;
    }

    /// Shows a string where the pen is: on a new line when the baseline
    /// moved, after a space when the pen jumped along the line.
    fn show(&mut self, bytes: &[u8]) {
        let em = (self.size * self.scale.0).abs();
        match self.end.filter(|_| self.placed) {
            Some((x, y)) if (y - self.at.1).abs() < SAME_LINE => {
                let gap = self.at.0 - x;
                if gap > WORD_GAP * em || gap < -em {
                    self.line.push(' ');
                }
            }
            _ => self.end_line(),
        }
        if let Some(font) = self.font {
            if let Some(encoding) = &font.encoding {
                // Bytes the font cannot name are dropped; the rest is kept.
                let _ = encoding.write_to_string(bytes, &mut self.line);
            }
            let (width, glyphs) = font.widths.measure(bytes);
            let glyphs = f32::from(u16::try_from(glyphs).unwrap_or(u16::MAX));
            self.at.0 += (width / PER_MILLE * self.size + glyphs * self.spacing) * self.scale.0;
        }
        self.end = Some(self.at);
        self.placed = true;
    }

    fn show_all(&mut self, operand: Option<&Object>) {
        match operand {
            Some(Object::String(bytes, _)) => self.show(bytes),
            Some(Object::Array(parts)) => {
                for part in parts {
                    match part {
                        Object::String(bytes, _) => self.show(bytes),
                        other => self.kern(other.as_float().unwrap_or(0.0)),
                    }
                }
            }
            _ => {}
        }
    }

    /// The lines as text, a word hyphenated across two lines made whole.
    fn finish(mut self) -> String {
        self.end_line();
        let mut text = String::new();
        for line in &self.done {
            let whole = text
                .strip_suffix('-')
                .filter(|rest| rest.chars().next_back().is_some_and(char::is_alphabetic))
                .filter(|_| line.chars().next().is_some_and(char::is_lowercase))
                .map(str::len);
            match whole {
                Some(len) => text.truncate(len),
                None if !text.is_empty() => text.push('\n'),
                None => {}
            }
            text.push_str(line);
        }
        text
    }
}

/// Ligatures as their letters, and nothing a reader would not see.
pub(super) fn tidy(line: &str) -> String {
    let mut clean = String::with_capacity(line.len());
    for c in line.chars() {
        match c {
            '\u{fb00}' => clean.push_str("ff"),
            '\u{fb01}' => clean.push_str("fi"),
            '\u{fb02}' => clean.push_str("fl"),
            '\u{fb03}' => clean.push_str("ffi"),
            '\u{fb04}' => clean.push_str("ffl"),
            '\u{ad}' | '\u{fffd}' => {}
            c if c.is_control() => clean.push(' '),
            c => clean.push(c),
        }
    }
    clean
}

/// The text of the operations of a page, one line of the page per line.
fn text_of(operations: &[Operation], fonts: &BTreeMap<Vec<u8>, Font<'_>>) -> String {
    let mut lines = Lines::new();
    for operation in operations {
        let numbers: Vec<f32> = operation
            .operands
            .iter()
            .filter_map(|operand| operand.as_float().ok())
            .collect();
        let first = operation.operands.first();
        match (operation.operator.as_str(), numbers.as_slice()) {
            ("BT", _) => lines.begin_text(),
            ("Tf", [size]) => {
                let name = first.and_then(|name| name.as_name().ok());
                lines.font = name.and_then(|name| fonts.get(name));
                lines.size = *size;
            }
            ("Tc", [spacing]) => lines.spacing = *spacing,
            ("Tm", matrix) => lines.place(matrix),
            ("Td" | "TD", [right, up]) => lines.shift(*right, *up),
            ("T*", _) => lines.next_line(),
            ("Tj" | "TJ", _) => lines.show_all(first),
            ("'" | "\"", _) => {
                lines.next_line();
                lines.show_all(operation.operands.last());
            }
            _ => {}
        }
    }
    lines.finish()
}

/// The text of a page; empty when it has none or cannot be read.
pub(super) fn page_text(doc: &Document, page: ObjectId) -> String {
    let fonts: BTreeMap<Vec<u8>, Font<'_>> = doc
        .get_page_fonts(page)
        .unwrap_or_default()
        .into_iter()
        .map(|(name, font)| {
            let font = Font {
                encoding: font.get_font_encoding(doc).ok(),
                widths: Widths::of(doc, font),
            };
            (name, font)
        })
        .collect();
    doc.get_and_decode_page_content(page)
        .map(|content| text_of(&content.operations, &fonts))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::books::pdf::fixtures;
    use lopdf::dictionary;

    fn op(operator: &str, operands: Vec<Object>) -> Operation {
        Operation::new(operator, operands)
    }

    fn text(value: &str) -> Object {
        Object::string_literal(value)
    }

    /// A text object in the fixture's font at 10 units: 6 units a glyph.
    fn read(mut operations: Vec<Operation>) -> String {
        operations.insert(0, op("BT", vec![]));
        operations.insert(1, op("Tf", vec!["F1".into(), 10.into()]));
        operations.push(op("ET", vec![]));
        let doc = Document::load_mem(&fixtures::drawn(operations)).expect("loads");
        let page = doc.page_iter().next().expect("a page");
        page_text(&doc, page)
    }

    fn at(x: i64, y: i64) -> Operation {
        op("Tm", [1, 0, 0, 1, x, y].map(Object::from).to_vec())
    }

    #[test]
    fn words_set_apart_by_kerning_stay_apart_and_kerned_letters_together() {
        let line = vec![
            text("A"),
            60.into(),
            text("lice"),
            (-333).into(),
            text("w"),
            Object::Real(-20.5),
            text("as"),
            Object::Real(-178.0),
            text("late"),
        ];
        let page = read(vec![
            op("Td", vec![72.into(), 720.into()]),
            op("TJ", vec![line.into()]),
        ]);
        assert_eq!(page, "Alice was late");
    }

    #[test]
    fn words_placed_one_by_one_are_words_and_split_ones_stay_whole() {
        // "Alice" ends at 102; a glyph further on is a word, right there is not.
        let page = read(vec![
            at(72, 720),
            op("Tj", vec![text("Alice")]),
            at(108, 720),
            op("Tj", vec![text("was")]),
            op("ET", vec![]),
            op("BT", vec![]),
            at(132, 720),
            op("Tj", vec![text("la")]),
            at(144, 720),
            op("Tj", vec![text("te")]),
            // Back to the left of the line: another column.
            at(20, 720),
            op("Tj", vec![text("7")]),
        ]);
        assert_eq!(page, "Alice was late 7");
    }

    #[test]
    fn a_new_baseline_is_a_new_line() {
        let page = read(vec![
            at(72, 720),
            op("Tj", vec![text("Down the")]),
            op("Td", vec![0.into(), (-14).into()]),
            op("Tj", vec![text("Rabbit-Hole")]),
            op("TL", vec![14.into()]),
            op("T*", vec![]),
            op("Tj", vec![text("Alice was")]),
            op("ET", vec![]),
            op("BT", vec![]),
            op("Tj", vec![text("a text object placed by the page")]),
            op("ET", vec![]),
            op("BT", vec![]),
            op("Tj", vec![text("and another")]),
            op("'", vec![text("with a line under it")]),
        ]);
        assert_eq!(
            page,
            "Down the\nRabbit-Hole\nAlice was\na text object placed by the page\n\
             and another\nwith a line under it"
        );
    }

    #[test]
    fn a_word_hyphenated_across_lines_is_made_whole() {
        let page = read(vec![
            op("Td", vec![72.into(), 720.into()]),
            op("Tj", vec![text("she had never before seen a rab-")]),
            op("T*", vec![]),
            op("Tj", vec![text("bit with either a waistcoat-")]),
            op("T*", vec![]),
            op("Tj", vec![text("Pocket, or a watch 3 -")]),
            op("T*", vec![]),
            op("Tj", vec![text("burning with curiosity")]),
        ]);
        assert_eq!(
            page,
            "she had never before seen a rabbit with either a waistcoat-\n\
             Pocket, or a watch 3 -\nburning with curiosity"
        );
    }

    #[test]
    fn a_composite_font_is_measured_by_its_code_widths() {
        let listed: Object = vec![Object::from(700), 300.into()].into();
        let font = dictionary! {
            "DW" => 400,
            "W" => vec![1.into(), listed, 5.into(), 9.into(), 250.into()],
        };
        let widths = Widths::codes(&Document::new(), &font);
        // Codes 1 and 2 by the list, 7 by the range, 3 by the default.
        let (width, glyphs) = widths.measure(&[0, 1, 0, 2, 0, 7, 0, 3]);
        assert_eq!(glyphs, 4);
        assert!((width - 1650.0).abs() < f32::EPSILON);
    }

    #[test]
    fn ligatures_read_as_their_letters() {
        assert_eq!(
            tidy("\u{fb01}sh, wa\u{fb04}e, so\u{ad}ft"),
            "fish, waffle, soft"
        );
    }
}
