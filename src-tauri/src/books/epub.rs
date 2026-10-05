//! EPUB: a zip of XHTML documents, a package file that orders them, and a
//! table of contents (EPUB 3 navigation document or EPUB 2 NCX) that says
//! where each chapter starts.

use std::io::{Cursor, Read};

use percent_encoding::percent_decode_str;
use zip::ZipArchive;

use super::xml::{self, Node, Styles, Text};
use super::{is_front_title, refused, ParsedBook, ParsedChapter, DRM, UNREADABLE};
use crate::error::Result;

type Archive<'a> = ZipArchive<Cursor<&'a [u8]>>;

/// No file inside a book is read past this, whatever the zip claims.
const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
/// Encryption that only scrambles embedded fonts; the text stays readable.
const FONT_OBFUSCATION: [&str; 2] = [
    "http://www.idpf.org/2008/embedding",
    "http://ns.adobe.com/pdf/enc#RC",
];
/// A place in the book: a file in the archive and maybe an anchor in it.
#[derive(Debug, Clone, PartialEq)]
struct Target {
    path: String,
    fragment: Option<String>,
}

struct TocEntry {
    title: String,
    target: Target,
}

/// What the package says about the book, before any chapter text is read.
struct Package {
    title: Option<String>,
    author: Option<String>,
    /// The content documents in reading order.
    spine: Vec<String>,
    toc: Vec<TocEntry>,
    /// Where the body starts, when the book says so.
    body: Option<Target>,
}

/// The start of a chapter: a document of the spine and an offset in its text.
type Position = (usize, usize);

fn read(archive: &mut Archive<'_>, name: &str) -> Option<String> {
    let file = archive.by_name(name).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_ENTRY_BYTES).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(text.trim_start_matches('\u{feff}').to_owned())
}

fn read_xml(archive: &mut Archive<'_>, name: &str) -> Option<Node> {
    xml::parse(&read(archive, name)?)
}

/// The directory of a path inside the archive, without the trailing slash.
fn dir(path: &str) -> &str {
    path.rfind('/').map_or("", |slash| &path[..slash])
}

/// An `href` as written in a file that lives in `base`, as an archive path.
fn resolve(base: &str, href: &str) -> Target {
    let (path, fragment) = match href.split_once('#') {
        Some((path, fragment)) => (path, Some(fragment)),
        None => (href, None),
    };
    let decode = |text: &str| percent_decode_str(text).decode_utf8_lossy().into_owned();
    let mut parts: Vec<&str> = base.split('/').filter(|part| !part.is_empty()).collect();
    let path = decode(path);
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    Target {
        path: parts.join("/"),
        fragment: fragment.filter(|f| !f.is_empty()).map(decode),
    }
}

/// DRM leaves a rights file, or encrypts the content documents.
fn protected(archive: &mut Archive<'_>) -> bool {
    if archive
        .file_names()
        .any(|name| name == "META-INF/rights.xml")
    {
        return true;
    }
    let Some(encryption) = read_xml(archive, "META-INF/encryption.xml") else {
        return false;
    };
    encryption.descendants("EncryptedData").iter().any(|data| {
        let algorithm = data
            .find("EncryptionMethod")
            .and_then(|method| method.attr("Algorithm"))
            .unwrap_or_default();
        !FONT_OBFUSCATION.contains(&algorithm)
    })
}

fn has_type(node: &Node, wanted: &str) -> bool {
    node.attr("type")
        .is_some_and(|types| types.split_whitespace().any(|t| t == wanted))
}

fn non_empty(text: &str) -> Option<String> {
    Some(xml::collapse(text)).filter(|text| !text.is_empty())
}

/// EPUB 3: the links of `<nav epub:type="toc">`, and the body start from the
/// landmarks beside it.
fn nav_toc(nav: &Node, base: &str) -> (Vec<TocEntry>, Option<Target>) {
    let navs = nav.descendants("nav");
    let links = |nav: &Node| -> Vec<(TocEntry, bool)> {
        nav.descendants("a")
            .iter()
            .filter_map(|a| {
                let entry = TocEntry {
                    title: xml::collapse(&a.text),
                    target: resolve(base, a.attr("href")?),
                };
                Some((entry, has_type(a, "bodymatter")))
            })
            .collect()
    };
    let toc = navs
        .iter()
        .find(|nav| has_type(nav, "toc"))
        .or(navs.first())
        .map(|nav| links(nav))
        .unwrap_or_default();
    let body = navs
        .iter()
        .find(|nav| has_type(nav, "landmarks"))
        .and_then(|nav| links(nav).into_iter().find(|(_, body)| *body))
        .map(|(entry, _)| entry.target);
    (toc.into_iter().map(|(entry, _)| entry).collect(), body)
}

/// EPUB 2: every `navPoint` of the NCX, nested ones included, in order.
fn ncx_toc(ncx: &Node, base: &str) -> Vec<TocEntry> {
    ncx.descendants("navPoint")
        .iter()
        .filter_map(|point| {
            let label = point.child("navLabel").map_or("", |l| l.text.as_str());
            Some(TocEntry {
                title: xml::collapse(label),
                target: resolve(base, point.child("content")?.attr("src")?),
            })
        })
        .collect()
}

fn package(archive: &mut Archive<'_>) -> Option<Package> {
    let container = read_xml(archive, "META-INF/container.xml")?;
    let opf_path = container.find("rootfile")?.attr("full-path")?.to_owned();
    let opf = read_xml(archive, &opf_path)?;
    let base = dir(&opf_path);

    let items = opf.find("manifest")?.descendants("item");
    let path_of = |item: &Node| Some(resolve(base, item.attr("href")?).path);
    let by_id = |id: &str| items.iter().find(|item| item.attr("id") == Some(id));
    let spine_node = opf.find("spine")?;
    let spine: Vec<String> = spine_node
        .descendants("itemref")
        .iter()
        .filter_map(|itemref| path_of(by_id(itemref.attr("idref")?)?))
        .collect();

    let mut toc = Vec::new();
    let mut body = None;
    let nav = items.iter().find(|item| {
        item.attr("properties")
            .is_some_and(|p| p.split_whitespace().any(|p| p == "nav"))
    });
    if let Some(path) = nav.and_then(|item| path_of(item)) {
        if let Some(nav) = read_xml(archive, &path) {
            (toc, body) = nav_toc(&nav, dir(&path));
        }
    }
    if toc.is_empty() {
        let ncx = spine_node.attr("toc").and_then(by_id).or_else(|| {
            items
                .iter()
                .find(|item| item.attr("media-type") == Some("application/x-dtbncx+xml"))
        });
        if let Some(path) = ncx.and_then(|item| path_of(item)) {
            if let Some(ncx) = read_xml(archive, &path) {
                toc = ncx_toc(&ncx, dir(&path));
            }
        }
    }
    if body.is_none() {
        body = opf
            .descendants("reference")
            .iter()
            .find(|reference| reference.attr("type") == Some("text"))
            .and_then(|reference| Some(resolve(base, reference.attr("href")?)));
    }

    let metadata = opf.find("metadata");
    let meta = |name: &str| non_empty(&metadata?.find(name)?.text);
    Some(Package {
        title: meta("title"),
        author: meta("creator"),
        spine,
        toc,
        body,
    })
}

/// The text from one position to the next (or to the end of the book).
fn between(texts: &[Text], from: Position, to: Option<Position>) -> String {
    let last = to.map_or(texts.len().saturating_sub(1), |(doc, _)| doc);
    let mut parts = Vec::new();
    for (doc, page) in texts.iter().enumerate().take(last + 1).skip(from.0) {
        let start = if doc == from.0 { from.1 } else { 0 };
        let end = match to {
            Some((to_doc, at)) if to_doc == doc => at,
            _ => page.text.len(),
        };
        let part = page.text.get(start..end).map_or("", str::trim);
        if !part.is_empty() {
            parts.push(part);
        }
    }
    parts.join("\n")
}

fn chapters(package: &Package, texts: &[Text]) -> Vec<ParsedChapter> {
    let position = |target: &Target| -> Option<Position> {
        let doc = package.spine.iter().position(|p| *p == target.path)?;
        let anchors = &texts.get(doc)?.anchors;
        let at = target.fragment.as_ref().and_then(|f| anchors.get(f));
        Some((doc, at.copied().unwrap_or(0)))
    };
    // Reading order; two entries on one spot are one chapter, named by the first.
    let mut starts: Vec<(Position, &str)> = package
        .toc
        .iter()
        .filter_map(|entry| Some((position(&entry.target)?, entry.title.as_str())))
        .collect();
    starts.sort_by_key(|(at, _)| *at);
    starts.dedup_by_key(|(at, _)| *at);
    let body = package.body.as_ref().and_then(position);

    let mut found = Vec::new();
    if let Some((first, _)) = starts.first() {
        found.push(ParsedChapter {
            title: String::new(),
            front_matter: true,
            text: between(texts, (0, 0), Some(*first)),
        });
    }
    for (i, (at, title)) in starts.iter().enumerate() {
        let known = is_front_title(title);
        found.push(ParsedChapter {
            title: (*title).to_owned(),
            front_matter: known || body.is_some_and(|body| *at < body),
            text: between(texts, *at, starts.get(i + 1).map(|(next, _)| *next)),
        });
    }
    found.retain(|chapter| !chapter.text.is_empty());
    found
}

/// What the book's stylesheets display as a block, every one of them read:
/// which document links which sheet does not change what a class means.
fn styles(archive: &mut Archive<'_>) -> Styles {
    let sheets: Vec<String> = archive
        .file_names()
        .filter(|name| name.to_ascii_lowercase().ends_with(".css"))
        .map(str::to_owned)
        .collect();
    let mut styles = Styles::default();
    for sheet in sheets {
        if let Some(css) = read(archive, &sheet) {
            styles.add(&css);
        }
    }
    styles
}

/// Reads an EPUB into its chapters. A protected file and one that cannot be
/// read are both refused as `invalid`, each saying which.
pub fn parse(bytes: &[u8]) -> Result<ParsedBook> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| refused(UNREADABLE))?;
    if protected(&mut archive) {
        return Err(refused(DRM));
    }
    let package = package(&mut archive).ok_or_else(|| refused(UNREADABLE))?;
    let styles = styles(&mut archive);
    let texts: Vec<Text> = package
        .spine
        .iter()
        .map(|path| {
            read(&mut archive, path).map_or_else(Text::default, |page| xml::text(&page, &styles))
        })
        .collect();
    let chapters = chapters(&package, &texts);
    if chapters.is_empty() {
        return Err(refused(UNREADABLE));
    }
    Ok(ParsedBook {
        title: package.title,
        author: package.author,
        chapters,
    })
}

/// EPUB files built in memory from the opening of *Alice's Adventures in
/// Wonderland* (Lewis Carroll, 1865, public domain).
#[cfg(test)]
pub mod fixtures {
    use std::io::{Cursor, Write};

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    pub fn zip(files: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, content) in files {
            writer.start_file(*name, options).expect("start file");
            writer.write_all(content.as_bytes()).expect("write file");
        }
        writer.finish().expect("finish zip").into_inner()
    }

    const CONTAINER: &str = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    const OPF: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:alice-fixture</dc:identifier>
    <dc:title>Alice's Adventures
      in Wonderland</dc:title>
    <dc:creator>Lewis Carroll</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="text/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="titlepage" href="text/title.xhtml" media-type="application/xhtml+xml"/>
    <item id="one" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="rest" href="text/rest.xhtml" media-type="application/xhtml+xml"/>
    <item id="font" href="fonts/serif.otf" media-type="font/otf"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="titlepage"/>
    <itemref idref="one"/>
    <itemref idref="rest"/>
  </spine>
</package>"#;

    const NAV: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc">
    <h1>Contents</h1>
    <ol>
      <li><a href="title.xhtml">Title Page</a></li>
      <li><a href="chapter%201.xhtml">I. Down the Rabbit-Hole</a></li>
      <li><a href="rest.xhtml">II. The Pool of Tears</a>
        <ol><li><a href="rest.xhtml#caucus">III. A Caucus-Race and a Long Tale</a></li></ol>
      </li>
    </ol>
  </nav>
  <nav epub:type="landmarks">
    <ol>
      <li><a epub:type="toc" href="nav.xhtml">Contents</a></li>
      <li><a epub:type="bodymatter" href="chapter%201.xhtml">Start</a></li>
    </ol>
  </nav>
</body>
</html>"#;

    const COVER: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Cover</title></head>
<body><p>The Millennium Fulcrum Edition 3.0</p></body></html>"#;

    const TITLE: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Title</title></head>
<body><h1>Alice's Adventures in Wonderland</h1><p>Lewis Carroll</p></body></html>"#;

    const ONE: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>I</title></head>
<body><h2>Down the Rabbit-Hole</h2>
<p>Alice was beginning to get very tired of sitting by her sister on the bank, and of
having nothing to do: once or twice she had peeped into the book her sister was reading,
but it had no pictures or conversations in it, &ldquo;and what is the use of a book,&rdquo;
thought Alice &ldquo;without pictures or conversations?&rdquo;</p></body></html>"#;

    const REST: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>II and III</title></head>
<body><h2>The Pool of Tears</h2>
<p>&ldquo;Curiouser and curiouser!&rdquo; cried Alice (she was so much surprised, that for
the moment she quite forgot how to speak good English).</p>
<h2 id="caucus">A Caucus-Race and a Long Tale</h2>
<p>They were indeed a queer-looking party that assembled on the bank&mdash;the birds with
draggled feathers, the animals with their fur clinging close to them.</p></body></html>"#;

    /// Real protection: a content document encrypted with AES.
    const ENCRYPTED_TEXT: &str = r#"<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/text/chapter%201.xhtml"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>"#;

    /// Not protection: only an embedded font is scrambled.
    const OBFUSCATED_FONT: &str = r#"<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/serif.otf"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>"#;

    fn book<'a>(extra: &[(&'a str, &'a str)]) -> Vec<u8> {
        let mut files = vec![
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", CONTAINER),
            ("OEBPS/content.opf", OPF),
            ("OEBPS/text/nav.xhtml", NAV),
            ("OEBPS/text/cover.xhtml", COVER),
            ("OEBPS/text/title.xhtml", TITLE),
            ("OEBPS/text/chapter 1.xhtml", ONE),
            ("OEBPS/text/rest.xhtml", REST),
        ];
        files.extend_from_slice(extra);
        zip(&files)
    }

    /// Three chapters after a cover and a title page.
    pub fn alice() -> Vec<u8> {
        book(&[])
    }

    pub fn alice_with_drm() -> Vec<u8> {
        book(&[("META-INF/encryption.xml", ENCRYPTED_TEXT)])
    }

    pub fn alice_with_rights_file() -> Vec<u8> {
        book(&[("META-INF/rights.xml", "<rights/>")])
    }

    pub fn alice_with_obfuscated_font() -> Vec<u8> {
        book(&[("META-INF/encryption.xml", OBFUSCATED_FONT)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;

    fn refusal(bytes: &[u8]) -> String {
        match parse(bytes) {
            Err(Error::Invalid(why)) => why,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn chapters_follow_the_table_of_contents() {
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
                ("Title Page", true),
                ("I. Down the Rabbit-Hole", false),
                ("II. The Pool of Tears", false),
                ("III. A Caucus-Race and a Long Tale", false),
            ]
        );
        assert_eq!(book.chapters[0].text, "The Millennium Fulcrum Edition 3.0");
        assert!(book.chapters[2]
            .text
            .starts_with("Down the Rabbit-Hole\nAlice was beginning"));
        assert!(book.chapters[2].text.ends_with("conversations?”"));
    }

    #[test]
    fn two_chapters_in_one_file_split_at_the_anchor() {
        let book = parse(&fixtures::alice()).expect("parses");
        let pool = &book.chapters[3].text;
        let caucus = &book.chapters[4].text;
        assert!(pool.starts_with("The Pool of Tears\n“Curiouser"));
        assert!(pool.ends_with("good English)."));
        assert!(caucus.starts_with("A Caucus-Race and a Long Tale\nThey were indeed"));
    }

    #[test]
    fn an_epub_2_book_reads_its_ncx_and_guide() {
        let opf = r#"<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Alice</dc:title></metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="a" href="a.html" media-type="application/xhtml+xml"/>
    <item id="b" href="b.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine>
  <guide><reference type="text" title="Start" href="b.html"/></guide>
</package>"#;
        let ncx = r#"<ncx xmlns="http://www.daisy.org/z3950/2005/ncx/"><navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>Preface</text></navLabel>
    <content src="a.html"/></navPoint>
  <navPoint id="n2" playOrder="2"><navLabel><text>Part One</text></navLabel>
    <content src="b.html"/>
    <navPoint id="n3" playOrder="3"><navLabel><text>The Pool of Tears</text></navLabel>
      <content src="b.html#pool"/></navPoint>
  </navPoint>
</navMap></ncx>"#;
        let container = r#"<container><rootfiles>
  <rootfile full-path="content.opf"/></rootfiles></container>"#;
        let bytes = fixtures::zip(&[
            ("META-INF/container.xml", container),
            ("content.opf", opf),
            ("toc.ncx", ncx),
            (
                "a.html",
                "<html><body><p>All in the golden afternoon.</p></body></html>",
            ),
            (
                "b.html",
                r#"<html><body><h1>Part One</h1><a name="pool"/><p>Curiouser!</p></body></html>"#,
            ),
        ]);
        let book = parse(&bytes).expect("parses");
        assert_eq!(book.author, None);
        let outline: Vec<(&str, bool, &str)> = book
            .chapters
            .iter()
            .map(|c| (c.title.as_str(), c.front_matter, c.text.as_str()))
            .collect();
        assert_eq!(
            outline,
            [
                ("Preface", true, "All in the golden afternoon."),
                ("Part One", false, "Part One"),
                ("The Pool of Tears", false, "Curiouser!"),
            ]
        );
    }

    #[test]
    fn a_protected_book_is_refused_as_drm() {
        assert_eq!(refusal(&fixtures::alice_with_drm()), DRM);
        assert_eq!(refusal(&fixtures::alice_with_rights_file()), DRM);
    }

    #[test]
    fn an_obfuscated_font_is_not_drm() {
        let book = parse(&fixtures::alice_with_obfuscated_font()).expect("parses");
        assert_eq!(book.chapters.len(), 5);
    }

    #[test]
    fn what_is_not_an_epub_is_refused_as_unreadable() {
        assert_eq!(refusal(b"%PDF-1.7 not a zip"), UNREADABLE);
        let no_package = fixtures::zip(&[("mimetype", "application/epub+zip")]);
        assert_eq!(refusal(&no_package), UNREADABLE);
    }

    #[test]
    fn hrefs_resolve_against_the_file_that_holds_them() {
        assert_eq!(
            resolve("OEBPS/text", "../extra/a%20b.xhtml#one"),
            Target {
                path: "OEBPS/extra/a b.xhtml".into(),
                fragment: Some("one".into()),
            }
        );
        assert_eq!(resolve("", "./c.xhtml").path, "c.xhtml");
    }
}
