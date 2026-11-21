//! How each word of a chapter is written, kept so that the words written
//! alike are found with one look-up, in any chapter of any book: "spinning"
//! in one chapter and "spinning in circles" in another are the same word to
//! the learner: one heads the other. A word's *rivals* are those written alike that do not mean
//! exactly the same: another kind of word, or other translations. A word
//! with rivals is asked so that the learner can tell which one is meant,
//! and it is the only kind of word the model writes sentences for.

use rusqlite::{params, Connection};

use crate::books::vocab;
use crate::domain::{PartOfSpeech, VerbForm};
use crate::error::Result;

/// The words of a form from its first one on, the whole of it first:
/// "spinning in circles", "spinning in", "spinning". A word that heads
/// another's form is written alike ("spinning", "spinning in circles"); one
/// that only comes later in it is not ("circles").
pub fn heads(words: &[String]) -> Vec<String> {
    (1..=words.len())
        .rev()
        .map(|len| words[..len].join(" "))
        .collect()
}

/// Writes down how the word `word_id` is written, anew.
pub fn write(conn: &Connection, word_id: &str) -> Result<()> {
    let (lemma, forms): (String, String) = conn.query_row(
        "SELECT lemma, forms FROM chapter_words WHERE id = ?1",
        [word_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let mut written: Vec<String> = serde_json::from_str(&forms)?;
    written.push(lemma);
    conn.execute("DELETE FROM word_spellings WHERE word_id = ?1", [word_id])?;
    let mut insert = conn.prepare(
        "INSERT INTO word_spellings (word_id, text, whole) VALUES (?1, ?2, ?3)
         ON CONFLICT (word_id, text) DO UPDATE SET whole = MAX(whole, excluded.whole)",
    )?;
    for form in written {
        let words = vocab::tokens(&form);
        for (at, run) in heads(&words).into_iter().enumerate() {
            insert.execute(params![word_id, run, at == 0])?;
        }
    }
    Ok(())
}

/// Writes down every word not written down yet; how many those were.
pub fn fill(conn: &Connection) -> Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT w.id FROM chapter_words w
         WHERE NOT EXISTS (SELECT 1 FROM word_spellings s WHERE s.word_id = w.id)",
    )?;
    let missing = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in &missing {
        write(conn, id)?;
    }
    Ok(missing.len())
}

/// The other words written alike: one heads the other's form. Any word
/// not written down yet is written down first.
pub fn alike(conn: &Connection, word_id: &str) -> Result<Vec<String>> {
    fill(conn)?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT b.word_id FROM word_spellings a
         JOIN word_spellings b ON b.text = a.text AND b.word_id != a.word_id
         WHERE a.word_id = ?1 AND (a.whole OR b.whole)
         ORDER BY b.word_id",
    )?;
    let rows = stmt.query_map([word_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A word written alike that means something else, as the learner is told
/// of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rival {
    pub word_id: String,
    pub chapter_id: String,
    /// The title of its book, and whether it is the book of the word asked.
    pub book: String,
    pub same_book: bool,
    /// Its chapter's place in the book, from 0, and its title.
    pub chapter_index: u32,
    pub chapter_title: String,
    pub part_of_speech: Option<PartOfSpeech>,
    /// The form a verb has in its chapter, when one said.
    pub verb_form: Option<VerbForm>,
    /// What it means, as its chapter has it.
    pub translations: Vec<String>,
}

/// A word as rivals are weighed: its kind and its translations, in small
/// letters and in order.
fn meant(conn: &Connection, word_id: &str) -> Result<(Option<PartOfSpeech>, Vec<String>)> {
    let kind: Option<PartOfSpeech> = conn.query_row(
        "SELECT part_of_speech FROM chapter_words WHERE id = ?1",
        [word_id],
        |row| row.get(0),
    )?;
    let mut stmt = conn.prepare("SELECT text FROM word_translations WHERE word_id = ?1")?;
    let said = stmt
        .query_map([word_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut said: Vec<String> = said.iter().map(|each| each.trim().to_lowercase()).collect();
    said.sort();
    said.dedup();
    Ok((kind, said))
}

/// The words written alike to `word_id` that do not mean exactly the same:
/// another kind of word, or other translations. In the order they were
/// found in.
pub fn rivals(conn: &Connection, word_id: &str) -> Result<Vec<Rival>> {
    let (kind, said) = meant(conn, word_id)?;
    let book: String = conn.query_row(
        "SELECT c.book_id FROM chapter_words w JOIN book_chapters c ON c.id = w.chapter_id
         WHERE w.id = ?1",
        [word_id],
        |row| row.get(0),
    )?;
    let mut found = Vec::new();
    for id in alike(conn, word_id)? {
        let (theirs, meaning) = meant(conn, &id)?;
        let kinds = matches!((kind, theirs), (Some(mine), Some(other)) if mine != other);
        if !kinds && meaning == said {
            continue;
        }
        let mut stmt = conn.prepare(
            "SELECT w.chapter_id, b.title, c.book_id, c.idx, c.title, w.created_at, w.verb_form
             FROM chapter_words w JOIN book_chapters c ON c.id = w.chapter_id
             JOIN books b ON b.id = c.book_id WHERE w.id = ?1",
        )?;
        let (chapter_id, title, book_id, index, chapter_title, created, verb_form): (
            String,
            String,
            String,
            u32,
            String,
            String,
            Option<VerbForm>,
        ) = stmt.query_row([&id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })?;
        let mut stmt =
            conn.prepare("SELECT text FROM word_translations WHERE word_id = ?1 ORDER BY rowid")?;
        let translations = stmt
            .query_map([&id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        found.push((
            created,
            Rival {
                word_id: id,
                chapter_id,
                book: title,
                same_book: book_id == book,
                chapter_index: index,
                chapter_title,
                part_of_speech: theirs,
                verb_form,
                translations,
            },
        ));
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(found.into_iter().map(|(_, rival)| rival).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(text: &str) -> Vec<String> {
        text.split(' ').map(str::to_owned).collect()
    }

    #[test]
    fn the_heads_of_a_form_are_its_words_from_the_first_the_whole_first() {
        assert_eq!(
            heads(&words("spinning in circles")),
            ["spinning in circles", "spinning in", "spinning"]
        );
    }
}
