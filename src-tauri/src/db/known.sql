-- Migration 45: a word is known in one sense, not in every sense its
-- spelling has.

-- What the learner said they know, by sense (`db::known`): "bug", the
-- insect, known, leaves "bug", the error, to learn. The mark keeps what
-- tells its sense apart (its kind and what it means), so
-- that it outlives the book it was made in and is found again by a word of
-- a later one. A mark made before this has none of it yet (`glosses` NULL,
-- its sense named after its key): code gives it the senses its key has, or,
-- when no chapter has the word any more, the first one that comes.
ALTER TABLE known_words RENAME TO known_keys;

CREATE TABLE known_words (
  sense_id       TEXT PRIMARY KEY,
  key            TEXT NOT NULL,
  lemma          TEXT NOT NULL,
  part_of_speech TEXT,
  glosses        TEXT,
  created_at     TEXT NOT NULL
);

INSERT INTO known_words (sense_id, key, lemma, created_at)
SELECT 'key:' || key, key, lemma, created_at FROM known_keys;

DROP TABLE known_keys;
CREATE INDEX known_words_key ON known_words(key);
