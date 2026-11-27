//! What a word means, wherever it is. The words of any chapter that are the
//! same word (one key), of one kind, and that share a translation, are one
//! *sense*, whatever form a verb is in: they mean the same, and what is
//! taken for right is the same for all of them, whatever each chapter was
//! prepared with. Two lists that only differ by a synonym are one meaning.
//! Words with nothing in common are two senses, until a look says they are
//! one ([`merge`]).
//!
//! Code decides all of it, with no request to the model: a sense is given
//! when a word is stored, and to the words kept before this the first time
//! the database is opened ([`fill`]).

use rusqlite::{params, Connection, OptionalExtension};

use super::profile::get_profile;
use crate::books::practice::{accepts_native, inflects};
use crate::books::spelling::Spelling;
use crate::books::vocab::key;
use crate::domain::PartOfSpeech;
use crate::error::Result;

/// A word as senses are told apart: what it is, and what it means.
struct Meant {
    key: String,
    kind: Option<PartOfSpeech>,
}

fn meant(conn: &Connection, word_id: &str) -> Result<Meant> {
    Ok(conn.query_row(
        "SELECT key, part_of_speech FROM chapter_words WHERE id = ?1",
        [word_id],
        |row| {
            Ok(Meant {
                key: row.get(0)?,
                kind: row.get(1)?,
            })
        },
    )?)
}

/// The sense of a word; none for one not given one yet.
pub fn of(conn: &Connection, word_id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT sense_id FROM chapter_words WHERE id = ?1",
            [word_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten())
}

/// Everything a sense means: what each of its words was prepared with or
/// had upheld, the oldest word first, and then what its sentences added.
pub fn glosses(conn: &Connection, sense_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare_cached(
        "SELECT t.text FROM word_translations t JOIN chapter_words w ON w.id = t.word_id
         WHERE w.sense_id = ?1 ORDER BY w.created_at, w.id, t.rowid",
    )?;
    let mut all: Vec<String> = stmt
        .query_map([sense_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    all.extend(added(conn, sense_id)?);
    let mut seen: Vec<String> = Vec::new();
    all.retain(|each| {
        let same = key(each);
        let new = !seen.contains(&same);
        seen.push(same);
        new
    });
    Ok(all)
}

/// What the sentences of a sense added to what it means.
pub fn added(conn: &Connection, sense_id: &str) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare_cached("SELECT text FROM sense_glosses WHERE sense_id = ?1 ORDER BY rowid")?;
    let rows = stmt.query_map([sense_id], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Adds a meaning to the sense of a word: one a sentence of it says, that
/// the word means anywhere. One the sense has already, in any form, is not
/// added twice; whether it was news.
pub fn add(conn: &Connection, word_id: &str, text: &str) -> Result<bool> {
    let text = text.trim();
    let Some(sense) = of(conn, word_id)? else {
        return Ok(false);
    };
    let has = glosses(conn, &sense)?;
    let native = native(conn, meant(conn, word_id)?.kind)?;
    let native = (native.0.as_str(), native.1);
    if key(text).is_empty() || accepts_native(text, &has, native, Spelling::Lenient) {
        return Ok(false);
    }
    conn.execute(
        "INSERT OR IGNORE INTO sense_glosses (sense_id, text) VALUES (?1, ?2)",
        params![sense, text],
    )?;
    Ok(true)
}

/// The learner's language, and whether a word of this kind inflects.
fn native(conn: &Connection, kind: Option<PartOfSpeech>) -> Result<(String, bool)> {
    let lang = get_profile(conn)?.map_or_default(|profile| profile.native_lang);
    Ok((lang, inflects(kind)))
}

/// Whether two kinds can be of one sense: the same, or one of them not
/// said yet.
fn agree<T: PartialEq>(mine: Option<T>, theirs: Option<T>) -> bool {
    match (mine, theirs) {
        (Some(mine), Some(theirs)) => mine == theirs,
        _ => true,
    }
}

/// The other senses the key of a word has in its kind, each with what it
/// means, the oldest first: the ones a look can say it is one of.
pub fn siblings(conn: &Connection, word_id: &str) -> Result<Vec<(String, Vec<String>)>> {
    let word = meant(conn, word_id)?;
    let own = of(conn, word_id)?;
    let mut stmt = conn.prepare(
        "SELECT sense_id, part_of_speech FROM chapter_words
         WHERE key = ?1 AND id != ?2 AND sense_id IS NOT NULL
         ORDER BY created_at, id",
    )?;
    let rows = stmt
        .query_map(params![word.key, word_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<Vec<(String, Option<PartOfSpeech>)>>>()?;
    let mut found: Vec<(String, Vec<String>)> = Vec::new();
    for (sense, kind) in rows {
        let other = Some(&sense) != own.as_ref() && !found.iter().any(|(held, _)| *held == sense);
        if other && agree(word.kind, kind) {
            let means = glosses(conn, &sense)?;
            found.push((sense, means));
        }
    }
    // A sense the learner knows may have no word left: its book is gone.
    for (sense, kind, means) in super::known::senses_of(conn, &word.key)? {
        let other = Some(&sense) != own.as_ref() && !found.iter().any(|(held, _)| *held == sense);
        if other && agree(word.kind, kind) {
            found.push((sense, means));
        }
    }
    Ok(found)
}

/// Makes two senses one: every word of `from` is of `into` from then on,
/// with what its sentences added.
pub fn merge(conn: &Connection, into: &str, from: &str) -> Result<()> {
    if into == from {
        return Ok(());
    }
    conn.execute(
        "UPDATE chapter_words SET sense_id = ?1 WHERE sense_id = ?2",
        params![into, from],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO sense_glosses (sense_id, text)
         SELECT ?1, text FROM sense_glosses WHERE sense_id = ?2",
        params![into, from],
    )?;
    conn.execute("DELETE FROM sense_glosses WHERE sense_id = ?1", [from])?;
    super::known::moved(conn, into, from)
}

/// Says that a word is of the sense `sense`, as a look at it found: its
/// own sense and that one become one. Only a sense its key has in its kind
/// ([`siblings`]) is taken; whether it was.
pub fn same_as(conn: &Connection, word_id: &str, sense: &str) -> Result<bool> {
    let Some(own) = of(conn, word_id)? else {
        return Ok(false);
    };
    if !siblings(conn, word_id)?.iter().any(|(id, _)| id == sense) {
        return Ok(false);
    }
    merge(conn, sense, &own)?;
    Ok(true)
}

/// Gives a word its sense, anew: the one its key has in its kind that
/// shares a translation with it, in any form of it, or one of its own.
/// A word that shares with several makes them one. Run it once the word has
/// its translations, and again when they change.
pub fn assign(conn: &Connection, word_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE chapter_words SET sense_id = NULL WHERE id = ?1",
        [word_id],
    )?;
    let mut stmt = conn
        .prepare_cached("SELECT text FROM word_translations WHERE word_id = ?1 ORDER BY rowid")?;
    let mine: Vec<String> = stmt
        .query_map([word_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let native = native(conn, meant(conn, word_id)?.kind)?;
    let native = (native.0.as_str(), native.1);
    let shared: Vec<String> = siblings(conn, word_id)?
        .into_iter()
        .filter(|(_, theirs)| {
            mine.iter()
                .any(|each| accepts_native(each, theirs, native, Spelling::Lenient))
        })
        .map(|(sense, _)| sense)
        .collect();
    let sense = shared.first().map_or(word_id, String::as_str);
    for other in shared.iter().skip(1) {
        merge(conn, sense, other)?;
    }
    conn.execute(
        "UPDATE chapter_words SET sense_id = ?2 WHERE id = ?1",
        params![word_id, sense],
    )?;
    Ok(())
}

/// Gives every word that has none its sense, the oldest first; how many
/// those were. The words kept before senses were are given theirs here.
pub fn fill(conn: &Connection) -> Result<usize> {
    let mut stmt = conn
        .prepare("SELECT id FROM chapter_words WHERE sense_id IS NULL ORDER BY created_at, id")?;
    let missing = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in &missing {
        assign(conn, id)?;
    }
    Ok(missing.len())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::books::vocab::Word;
    use crate::db::open_in_memory;
    use crate::db::words::tests::{book, word};
    use crate::db::words::{finish, list};
    use crate::domain::Depth;

    fn kind(lemma: &str, translations: &[&str], kind: PartOfSpeech) -> Word {
        Word {
            part_of_speech: Some(kind),
            ..word(lemma, translations, 1)
        }
    }

    fn sense_in(conn: &Connection, chapter: &str, lemma: &str) -> String {
        let listed = list(conn, chapter).expect("list");
        let id = &listed.iter().find(|w| w.lemma == lemma).expect("word").id;
        of(conn, id).expect("sense").expect("a sense")
    }

    #[test]
    fn words_that_share_a_translation_are_one_sense_and_the_others_are_not() {
        let conn = open_in_memory().expect("db");
        crate::db::profile::save_profile(&conn, &crate::db::profile::tests::profile())
            .expect("profile");
        let chapters = book(&conn, "b", &["one", "two", "three", "four"]);
        let noun = PartOfSpeech::Noun;
        let store = |at: usize, words: &[Word]| {
            finish(&conn, &chapters[at], Depth::Most, words, Utc::now()).expect("finish");
        };
        store(
            0,
            &[
                kind("sign", &["letrero", "cartel"], noun),
                kind("bug", &["bicho", "insecto"], noun),
                kind("loot", &["botín"], noun),
            ],
        );
        store(
            1,
            &[
                kind("sign", &["señal", "carteles"], noun),
                kind("bug", &["error", "falla"], noun),
                kind("loot", &["botín"], PartOfSpeech::Verb),
            ],
        );
        let sense = |at: usize, lemma: &str| sense_in(&conn, &chapters[at], lemma);
        // A synonym more, and the other number: the same meaning.
        assert_eq!(sense(0, "sign"), sense(1, "sign"));
        assert_eq!(
            glosses(&conn, &sense(0, "sign")).expect("glosses"),
            ["letrero", "cartel", "señal", "carteles"]
        );
        // Nothing in common, or another kind of word: another sense.
        assert_ne!(sense(0, "bug"), sense(1, "bug"));
        assert_ne!(sense(0, "loot"), sense(1, "loot"));
        let id = |at: usize, lemma: &str| {
            let listed = list(&conn, &chapters[at]).expect("list");
            listed
                .into_iter()
                .find(|w| w.lemma == lemma)
                .expect("word")
                .id
        };
        let others = siblings(&conn, &id(1, "bug")).expect("siblings");
        assert_eq!(
            others,
            [(sense(0, "bug"), vec!["bicho".into(), "insecto".into()])]
        );
        assert_eq!(siblings(&conn, &id(1, "loot")).expect("siblings"), []);

        // A word that shares with two senses makes them one.
        store(2, &[kind("bug", &["insecto", "falla"], noun)]);
        assert_eq!(sense(0, "bug"), sense(1, "bug"));
        assert_eq!(sense(0, "bug"), sense(2, "bug"));

        // A look says two senses are one; only a sense of its key is taken.
        store(3, &[kind("sign", &["indicio"], noun)]);
        assert_ne!(sense(3, "sign"), sense(0, "sign"));
        assert!(!same_as(&conn, &id(3, "sign"), &sense(0, "bug")).expect("no"));
        assert!(same_as(&conn, &id(3, "sign"), &sense(0, "sign")).expect("yes"));
        assert_eq!(sense(3, "sign"), sense(0, "sign"));

        // What a sentence adds is meant by every word of the sense, once.
        assert!(add(&conn, &id(0, "sign"), "rótulo").expect("add"));
        assert!(!add(&conn, &id(1, "sign"), "Rótulos").expect("again"));
        assert!(!add(&conn, &id(1, "sign"), "letrero").expect("held"));
        assert_eq!(
            glosses(&conn, &sense(3, "sign")).expect("glosses"),
            ["letrero", "cartel", "señal", "carteles", "indicio", "rótulo"]
        );
    }

    #[test]
    fn words_kept_before_senses_are_given_theirs_from_what_they_were_kept_with() {
        let conn = open_in_memory().expect("db");
        let chapters = book(&conn, "b", &["one", "two"]);
        let adjective = PartOfSpeech::Adjective;
        let first = [kind("lichen-like", &["parecido al liquen"], adjective)];
        let second = [kind(
            "lichen-like",
            &["similar al liquen", "parecido al liquen"],
            adjective,
        )];
        finish(&conn, &chapters[0], Depth::Most, &first, Utc::now()).expect("finish");
        finish(&conn, &chapters[1], Depth::Most, &second, Utc::now()).expect("finish");
        // As a database kept before this has them.
        conn.execute("UPDATE chapter_words SET sense_id = NULL", [])
            .expect("old rows");

        assert_eq!(fill(&conn).expect("fill"), 2);
        assert_eq!(fill(&conn).expect("again"), 0);
        let one = sense_in(&conn, &chapters[0], "lichen-like");
        assert_eq!(one, sense_in(&conn, &chapters[1], "lichen-like"));
        assert_eq!(
            glosses(&conn, &one).expect("glosses"),
            ["parecido al liquen", "similar al liquen"]
        );
    }
}
