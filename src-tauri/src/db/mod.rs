//! SQLite: one file in the app data directory, migrated on open.

pub mod books;
pub mod drills;
pub mod listening;
pub mod patterns;
pub mod practice;
pub mod profile;
pub mod recall;
pub mod refresh;
pub mod sentences;
pub mod sessions;
pub mod structures;
pub mod translate;
pub mod words;

use std::path::Path;

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::Connection;

use crate::error::{Error, Result};

/// Ordered migrations. Append only; never edit one that has shipped.
const MIGRATIONS: &[&str] = &[
    include_str!("schema.sql"),
    include_str!("books.sql"),
    include_str!("vocab.sql"),
    include_str!("practice.sql"),
    include_str!("dispute.sql"),
    include_str!("refresh.sql"),
    include_str!("session.sql"),
    include_str!("chapters.sql"),
    include_str!("review.sql"),
    include_str!("translate.sql"),
    include_str!("attempts.sql"),
    include_str!("summaries.sql"),
    include_str!("ways.sql"),
    include_str!("speech.sql"),
    include_str!("recall.sql"),
    include_str!("sentences.sql"),
    include_str!("extra.sql"),
    include_str!("structures.sql"),
    include_str!("transitive.sql"),
    include_str!("negation.sql"),
    include_str!("also.sql"),
    include_str!("hints.sql"),
    include_str!("rivals.sql"),
    include_str!("sorted.sql"),
    include_str!("listening.sql"),
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    prepare(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    prepare(&conn)?;
    Ok(conn)
}

fn prepare(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrate(conn)
}

fn migrate(conn: &Connection) -> Result<()> {
    let applied: usize = conn
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map(|v| usize::try_from(v).unwrap_or(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(applied) {
        conn.execute_batch(&format!("BEGIN; {sql} COMMIT;"))?;
        conn.pragma_update(
            None,
            "user_version",
            i64::try_from(index + 1).unwrap_or(i64::MAX),
        )?;
    }
    Ok(())
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Fixed-width RFC 3339, so timestamps sort as text in SQL.
pub fn ts(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn parse_ts(text: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|e| Error::Internal(format!("bad timestamp {text}: {e}")))
}

pub fn parse_ts_opt(text: Option<&str>) -> Result<Option<DateTime<Utc>>> {
    text.map(parse_ts).transpose()
}

/// Turns "no rows" into a `NotFound` naming what was missing.
pub fn found<T>(result: rusqlite::Result<T>, what: &str) -> Result<T> {
    match result {
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(Error::NotFound(format!("{what} not found")))
        }
        other => Ok(other?),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_a_fresh_database_and_is_idempotent() {
        let conn = open_in_memory().expect("open");
        migrate(&conn).expect("migrate again");
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("version");
        assert_eq!(version, i64::try_from(MIGRATIONS.len()).expect("small"));
    }

    #[test]
    fn migration_seven_closes_the_sittings_that_had_no_words_of_their_own() {
        let conn = Connection::open_in_memory().expect("open");
        // As the database stood when a sitting was ended by the clock.
        for sql in &MIGRATIONS[..6] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 6)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, '', 1, 'text');
             INSERT INTO practice_sittings (id, chapter_id, started_at)
               VALUES ('old', 'c', '2026-03-01T10:00:00.000Z');
             INSERT INTO practice_sittings (id, chapter_id, started_at, kind)
               VALUES ('pass', 'c', '2026-03-02T10:00:00.000Z', 'refresh');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let finished = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT finished_at FROM practice_sittings WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("sitting")
        };
        assert_eq!(finished("old").as_deref(), Some("2026-03-01T10:00:00.000Z"));
        assert_eq!(finished("pass"), None, "a refresh is not touched");
        assert_eq!(practice::unfinished(&conn, "c").expect("unfinished"), None);
    }

    #[test]
    fn migration_eleven_keeps_what_was_translated_as_a_paused_attempt() {
        let conn = Connection::open_in_memory().expect("open");
        conn.pragma_update(None, "foreign_keys", "ON")
            .expect("foreign keys");
        for sql in &MIGRATIONS[..10] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 10)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, '', 1, 'text');
             INSERT INTO translation_sentences VALUES
               ('c', 'toNative', 0, 0, 'Uno.', '2026-03-01T10:00:00.000Z'),
               ('c', 'toNative', 0, 1, 'Dos.', '2026-03-01T10:05:00.000Z'),
               ('c', 'toEnglish', 0, 0, 'One.', '2026-03-02T10:00:00.000Z');
             INSERT INTO paragraph_reviews VALUES
               ('c', 'toNative', 0, '{}', '2026-03-01T10:06:00.000Z');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let found = translate::attempts(&conn, "c").expect("attempts");
        let seen: Vec<_> = found
            .iter()
            .map(|a| (a.direction.as_str(), a.started_at.as_str(), a.finished))
            .collect();
        assert_eq!(
            seen,
            [
                ("toEnglish", "2026-03-02T10:00:00.000Z", false),
                ("toNative", "2026-03-01T10:00:00.000Z", false),
            ]
        );
        let there = &found[1].id;
        let written = translate::written(&conn, there).expect("written");
        assert_eq!(
            written.get(&0).map(Vec::as_slice),
            Some(&["Uno.".to_owned(), "Dos.".to_owned()][..])
        );
        // A review written before paragraphs were scored is asked for again.
        assert_eq!(translate::reviews(&conn, there).expect("reviews").len(), 0);
        assert_eq!(
            translate::reviews(&conn, &found[0].id)
                .expect("reviews")
                .len(),
            0
        );
    }

    #[test]
    fn migration_eighteen_takes_a_chapter_as_opened_when_it_was_last_practised() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..17] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 17)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text) VALUES
               ('old', 'b', 0, 'I', 1, 'text'),
               ('new', 'b', 1, 'II', 1, 'text'),
               ('never', 'b', 2, 'III', 1, 'text');
             INSERT INTO practice_sittings (id, chapter_id, started_at) VALUES
               ('s1', 'old', '2026-03-01T10:00:00.000Z'),
               ('s2', 'new', '2026-03-02T10:00:00.000Z'),
               ('s3', 'new', '2026-03-05T10:00:00.000Z');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let opened = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT opened_at FROM book_chapters WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("chapter")
        };
        assert_eq!(opened("old").as_deref(), Some("2026-03-01T10:00:00.000Z"));
        assert_eq!(opened("new").as_deref(), Some("2026-03-05T10:00:00.000Z"));
        assert_eq!(opened("never"), None);
        assert_eq!(
            structures::current_chapter(&conn)
                .expect("current")
                .as_deref(),
            Some("new")
        );
    }

    #[test]
    fn migration_nineteen_leaves_a_verb_to_be_asked_whether_it_takes_an_object() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..18] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 18)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, 'I', 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, created_at,
                part_of_speech)
             VALUES ('w1', 'c', 'adorn', 'adorn', '[]', 'They adorned it.', 3, 'most',
                     '2026-01-01', 'verb'),
                    ('w2', 'c', 'bank', 'bank', '[]', 'On the bank.', 2, 'most',
                     '2026-01-01', 'noun'),
                    ('w3', 'c', 'glen', 'glen', '[]', 'In the glen.', 1, 'most',
                     '2026-01-01', NULL);
             INSERT INTO chapter_chunks (chapter_id, depth, idx, total, items)
               VALUES ('c', 'most', 0, 2, '[]');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let chunks: u32 = conn
            .query_row("SELECT COUNT(*) FROM chapter_chunks", [], |row| row.get(0))
            .expect("count");
        assert_eq!(chunks, 0, "answered without it: asked again");
        // The verb is asked about again, with the word of no kind; a noun
        // takes no object and is left alone.
        let waiting: Vec<String> = words::unlabelled(&conn)
            .expect("unlabelled")
            .into_iter()
            .map(|word| word.lemma)
            .collect();
        assert_eq!(waiting, ["adorn", "glen"]);
        assert!(words::label(&conn, "w1", crate::domain::PartOfSpeech::Noun, true).expect("label"));
        let stored: (String, bool) = conn
            .query_row(
                "SELECT part_of_speech, transitive FROM chapter_words WHERE id = 'w1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("word");
        assert_eq!(stored, ("verb".to_owned(), true), "its kind stays");
        assert_eq!(words::unlabelled(&conn).expect("unlabelled").len(), 1);
    }

    #[test]
    fn migration_twenty_drops_the_forms_that_deny_their_word() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..19] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 19)
            .expect("version");
        conn.execute_batch(
            r#"INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, 'I', 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, created_at)
             VALUES ('w1', 'c', 'be fond of', 'be fond of',
                     '["be fond of","was not fond of","was very fond of","wasn’t fond of"]',
                     'He was very fond of it.', 1, 'most', '2026-01-01'),
                    ('w2', 'c', 'can''t help but', 'can''t help but',
                     '["can''t help but","couldn’t help but"]',
                     'She couldn’t help but laugh.', 1, 'most', '2026-01-01'),
                    ('w3', 'c', 'budge', 'budge', '["budge","budged"]',
                     'It budged.', 1, 'most', '2026-01-01');
             INSERT INTO word_sentences
               (id, key, source, sentence, form, hint, translation, reviewed, created_at)
             VALUES ('not', 'be fond of', 'model', 'He was not fond of it.',
                     'was not fond of', 'no le gustaba', 'No le gustaba.', 1, '2026-01-01'),
                    ('very', 'be fond of', 'book', 'He was very fond of it.',
                     'was very fond of', 'era muy aficionado a', 'Le gustaba.', 1, '2026-01-02'),
                    ('waiting', 'budge', 'model', 'It has Not budged.',
                     'has Not budged', 'no se ha movido', 'No se ha movido.', 0, '2026-01-03'),
                    ('moved', 'budge', 'book', 'It budged.',
                     'budged', 'se movió', 'Se movió.', 1, '2026-01-04'),
                    ('help', 'can''t help but', 'book', 'She couldn’t help but laugh.',
                     'couldn’t help but', 'no pudo evitar', 'No pudo evitar reír.', 1,
                     '2026-01-05');"#,
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let asked = |key: &str| -> Vec<String> {
            sentences::bank(&conn, key)
                .expect("bank")
                .into_iter()
                .map(|sentence| sentence.id)
                .collect()
        };
        assert_eq!(asked("be fond of"), ["very"]);
        assert_eq!(asked("budge"), ["moved"]);
        // Its word denies already: the form says the same.
        assert_eq!(asked("can't help but"), ["help"]);
        assert_eq!(
            sentences::unreviewed(&conn).expect("unreviewed").len(),
            0,
            "no second look brings one back"
        );
        let forms = |id: &str| -> String {
            conn.query_row(
                "SELECT forms FROM chapter_words WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("word")
        };
        assert_eq!(forms("w1"), r#"["be fond of","was very fond of"]"#);
        assert_eq!(forms("w2"), r#"["can't help but","couldn’t help but"]"#);
        assert_eq!(forms("w3"), r#"["budge","budged"]"#);
    }

    #[test]
    fn migration_twenty_one_leaves_the_sentences_kept_before_to_be_labelled() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..20] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 20)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO word_sentences
               (id, key, source, sentence, form, hint, translation, reviewed, discarded,
                created_at)
             VALUES ('used', 'notion', 'book', 'Random notions bubbled up.', 'notions',
                     'ideas', 'Brotaban ideas.', 1, 0, '2026-01-01'),
                    ('bad', 'notion', 'book', 'A notion.', 'notion', 'idea', 'Una idea.',
                     1, 1, '2026-01-02'),
                    ('waiting', 'peep', 'book', 'Do not peep.', 'peep', 'mires',
                     'No mires.', 0, 0, '2026-01-03');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        // It is asked with as before, with no rival known yet.
        let bank = sentences::bank(&conn, "notion").expect("bank");
        assert_eq!(bank.len(), 1);
        assert_eq!(bank[0].also, Vec::<String>::new());
        // Only one that is asked with is left to be labelled: the one
        // waiting is labelled when it is looked at.
        let ids = |list: Vec<sentences::Sentence>| -> Vec<String> {
            list.into_iter().map(|each| each.id).collect()
        };
        assert_eq!(ids(sentences::unlabelled(&conn).expect("list")), ["used"]);
        assert_eq!(
            ids(sentences::unreviewed(&conn).expect("list")),
            ["waiting"]
        );

        sentences::label(&conn, "used", &["ideas".to_owned()]).expect("label");
        assert_eq!(
            sentences::bank(&conn, "notion").expect("bank")[0].also,
            ["ideas"]
        );
        assert_eq!(sentences::unlabelled(&conn).expect("list").len(), 0);
    }

    #[test]
    fn migration_twenty_two_has_a_hint_unlike_its_translations_looked_at_again() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..21] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 21)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, 'I', 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, created_at)
             VALUES ('w', 'c', 'wisp', 'wisp', '[\"wisp\"]', 'A wisp of fog.', 1, 'most',
                     '2026-01-01');
             INSERT INTO word_translations (word_id, text)
             VALUES ('w', 'voluta'), ('w', 'jirón');
             INSERT INTO word_sentences
               (id, key, source, sentence, form, hint, translation, reviewed, discarded,
                also, created_at)
             VALUES ('fog', 'wisp', 'book', 'A wisp of fog.', 'wisp', 'Volutas',
                     'Una voluta de niebla.', 1, 0, '[]', '2026-01-01'),
                    ('fire', 'wisp', 'book', 'A wisp of fire rose.', 'wisp', 'llama',
                     'Una llama de fuego se alzó.', 1, 0, '[]', '2026-01-02'),
                    ('bad', 'wisp', 'book', 'Wisp!', 'Wisp', 'mechón', '¡Mechón!', 1, 1,
                     '[]', '2026-01-03'),
                    ('lone', 'peep', 'book', 'Do not peep.', 'peep', 'mires', 'No mires.',
                     1, 0, '[]', '2026-01-04');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let ids = |list: Vec<sentences::Sentence>| -> Vec<String> {
            list.into_iter().map(|each| each.id).collect()
        };
        // The one whose hint is a form of a translation is asked with still.
        assert_eq!(ids(sentences::bank(&conn, "wisp").expect("bank")), ["fog"]);
        // The other waits for the second look; one called bad stays so.
        assert_eq!(ids(sentences::unreviewed(&conn).expect("list")), ["fire"]);
        // A word with no translation kept has nothing to go by.
        assert_eq!(ids(sentences::bank(&conn, "peep").expect("bank")), ["lone"]);

        sentences::review(&conn, "fire", false, &[]).expect("review");
        assert_eq!(ids(sentences::bank(&conn, "wisp").expect("bank")), ["fog"]);
        assert_eq!(sentences::unreviewed(&conn).expect("list").len(), 0);
    }

    #[test]
    fn migration_twenty_three_has_a_list_of_native_words_labelled_again() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..22] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 22)
            .expect("version");
        conn.execute_batch(
            r#"INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, 'I', 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, created_at)
             VALUES ('w', 'c', 'wisp', 'wisp', '["wisp"]', 'A wisp of fog.', 1, 'most',
                     '2026-01-01');
             INSERT INTO word_translations (word_id, text)
             VALUES ('w', 'voluta'), ('w', 'hebra');
             INSERT INTO word_sentences
               (id, key, source, sentence, form, hint, translation, reviewed, discarded,
                also, created_at)
             VALUES ('english', 'wisp', 'book', 'One.', 'wisp', 'voluta', 'Una.', 1, 0,
                     '["curl","puff"]', '2026-01-01'),
                    ('none', 'wisp', 'book', 'Two.', 'wisp', 'voluta', 'Dos.', 1, 0,
                     '[]', '2026-01-02'),
                    ('meaning', 'wisp', 'book', 'Three.', 'wisp', 'voluta', 'Tres.', 1, 0,
                     '["Hebra","hilo"]', '2026-01-03'),
                    ('letter', 'wisp', 'book', 'Four.', 'wisp', 'voluta', 'Cuatro.', 1, 0,
                     '["curl","jirón"]', '2026-01-04'),
                    ('hint', 'wisp', 'book', 'Five.', 'wisp', 'mechón', 'Cinco.', 1, 0,
                     '["mechon","Mechón"]', '2026-01-05'),
                    ('bad', 'wisp', 'book', 'Six.', 'wisp', 'voluta', 'Seis.', 1, 1,
                     '["hebra"]', '2026-01-06'),
                    ('waiting', 'wisp', 'book', 'Seven.', 'wisp', 'voluta', 'Siete.', 0, 0,
                     '["hebra"]', '2026-01-07');"#,
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let ids = |list: Vec<sentences::Sentence>| -> Vec<String> {
            list.into_iter().map(|each| each.id).collect()
        };
        // Only the ones asked with whose list is not English.
        assert_eq!(
            ids(sentences::unlabelled(&conn).expect("list")),
            ["meaning", "letter", "hint"]
        );
        // They are asked with meanwhile, with no rival known.
        let bank = sentences::bank(&conn, "wisp").expect("bank");
        assert_eq!(bank.len(), 5);
        assert_eq!(bank[0].also, ["curl", "puff"]);
        assert_eq!(bank[2].also, Vec::<String>::new());

        sentences::label(&conn, "meaning", &["strand".to_owned()]).expect("label");
        assert_eq!(
            ids(sentences::unlabelled(&conn).expect("list")),
            ["letter", "hint"]
        );
    }

    #[test]
    fn migration_twenty_four_leaves_the_words_stored_before_it_to_be_sorted() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..23] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 23)
            .expect("version");
        conn.execute_batch(
            r#"INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, 'I', 2, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, created_at)
             VALUES ('w', 'c', 'wisp', 'wisp', '["wisp"]', 'A wisp of fog.', 2, 'most',
                     '2026-01-01'),
                    ('p', 'c', 'peep', 'peep', '["peep"]', 'She peeped.', 1, 'most',
                     '2026-01-01');"#,
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let sorted = |conn: &Connection| -> Vec<(String, bool)> {
            words::list(conn, "c")
                .expect("list")
                .into_iter()
                .map(|word| (word.lemma, word.sorted))
                .collect()
        };
        assert_eq!(
            sorted(&conn),
            [("wisp".to_owned(), false), ("peep".to_owned(), false)]
        );

        // And an old row takes the mark as a new one does.
        words::set_sorted(&conn, "w", true, Utc::now()).expect("sort");
        assert_eq!(
            sorted(&conn),
            [("wisp".to_owned(), true), ("peep".to_owned(), false)]
        );
    }

    #[test]
    fn migration_nine_takes_the_words_done_before_as_learned() {
        let conn = Connection::open_in_memory().expect("open");
        for sql in &MIGRATIONS[..8] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 8)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, words, text)
               VALUES ('c', 'b', 0, '', 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, done_at,
                created_at)
             VALUES ('done', 'c', 'peep', 'peep', '[]', 'She peeped.', 1, 'most',
                     '2026-03-01T10:00:00.000Z', '2026-01-01'),
                    ('open', 'c', 'bank', 'bank', '[]', 'The bank.', 1, 'most', NULL,
                     '2026-01-01');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let learned = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT learned_at FROM chapter_words WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("word")
        };
        assert_eq!(learned("done").as_deref(), Some("2026-03-01T10:00:00.000Z"));
        assert_eq!(learned("open"), None);
    }

    #[test]
    fn migration_eight_drops_the_front_matter_stored_before_with_what_hung_on_it() {
        let conn = Connection::open_in_memory().expect("open");
        conn.pragma_update(None, "foreign_keys", "ON")
            .expect("foreign keys");
        // As the database stood when a book kept its cover and its contents.
        for sql in &MIGRATIONS[..7] {
            conn.execute_batch(sql).expect("migration");
        }
        conn.pragma_update(None, "user_version", 7)
            .expect("version");
        conn.execute_batch(
            "INSERT INTO books VALUES ('b', 'Alice', NULL, 'epub', 'h', 'f', '2026-01-01');
             INSERT INTO books VALUES ('f', 'Leaflet', NULL, 'epub', 'i', 'g', '2026-01-01');
             INSERT INTO book_chapters (id, book_id, idx, title, front_matter, words, text) VALUES
               ('cover', 'b', 0, '', 1, 1, 'text'),
               ('one', 'b', 1, 'I', 0, 1, 'text'),
               ('contents', 'b', 2, 'Contents', 1, 1, 'text'),
               ('two', 'b', 3, 'II', 0, 1, 'text'),
               ('only', 'f', 0, 'Cover', 1, 1, 'text');
             INSERT INTO chapter_words
               (id, chapter_id, key, lemma, forms, sentence, occurrences, depth, created_at)
             VALUES ('w', 'contents', 'string', 'string', '[]', 'Strings', 1, 'most', '2026-01-01'),
                    ('kept', 'two', 'peep', 'peep', '[]', 'She peeped.', 1, 'most', '2026-01-01');
             INSERT INTO practice_sittings (id, chapter_id, started_at)
               VALUES ('s', 'contents', '2026-03-01T10:00:00.000Z');
             INSERT INTO word_answers (word_id, direction, sitting_id, answer, correct, created_at)
               VALUES ('w', 'recognition', 's', 'cadena', 0, '2026-03-01T10:00:00.000Z');",
        )
        .expect("rows");

        migrate(&conn).expect("migrate");
        let mut stmt = conn
            .prepare("SELECT book_id, idx, id FROM book_chapters ORDER BY book_id, idx")
            .expect("chapters");
        let left = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("rows")
            .collect::<rusqlite::Result<Vec<(String, i64, String)>>>()
            .expect("chapters");
        let left: Vec<_> = left
            .iter()
            .map(|(book, idx, id)| (book.as_str(), *idx, id.as_str()))
            .collect();
        // A book of nothing but front matter keeps what it has.
        assert_eq!(left, [("b", 0, "one"), ("b", 1, "two"), ("f", 0, "only")]);
        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count")
        };
        assert_eq!(count("chapter_words"), 1);
        assert_eq!(count("practice_sittings"), 0);
        assert_eq!(count("word_answers"), 0);
        assert_eq!(books::get_book(&conn, "b").expect("book").chapters.len(), 2);
    }
}
