-- Migration 40: words written alike are found at once, and a word a learner
-- understood only with its sentence is neither right nor a miss.

-- How each word of a chapter is written, as words in small letters: every
-- form it has, and each of them from its first word on ("spinning in
-- circles", "spinning in", "spinning"). A whole form (`whole`) found among
-- another word's is the same word to the learner ("spinning", "spinning in
-- circles"), whatever book it is from (`db::spellings`). Filled by code:
-- the words kept before this are written down the first time sentences
-- are prepared.
CREATE TABLE word_spellings (
  word_id TEXT NOT NULL REFERENCES chapter_words(id) ON DELETE CASCADE,
  text    TEXT NOT NULL,
  whole   INTEGER NOT NULL,
  PRIMARY KEY (word_id, text)
);

CREATE INDEX word_spellings_text ON word_spellings(text);

-- An answer of practice that was right only once the sentence was shown:
-- it is not counted, right or missed, but it is asked in its turn, so
-- that the word comes back later in the session.
CREATE TABLE understood_answers (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  sitting_id TEXT NOT NULL REFERENCES practice_sittings(id) ON DELETE CASCADE,
  word_id    TEXT NOT NULL REFERENCES chapter_words(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('recognition', 'production')),
  created_at TEXT NOT NULL
);

CREATE INDEX understood_answers_sitting ON understood_answers(sitting_id);

-- The same in the daily recall, by the word's key: the word stays due as it
-- was, and is not asked again in that run.
CREATE TABLE understood_recalls (
  sitting_id TEXT NOT NULL REFERENCES recall_sittings(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (sitting_id, key)
);
