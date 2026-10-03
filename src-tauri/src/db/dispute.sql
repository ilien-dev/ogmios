-- Migration 5: "I was right" on a missed answer.

-- A miss the learner stood by, and what the model said. One row per answer:
-- an answer is judged once. An upheld one has had its `correct` set, which
-- is all it takes to undo the miss (`books::practice::owed`).
CREATE TABLE answer_disputes (
  seq        INTEGER PRIMARY KEY REFERENCES word_answers(seq) ON DELETE CASCADE,
  upheld     INTEGER NOT NULL,
  reason     TEXT NOT NULL, -- one line, in the learner's language
  created_at TEXT NOT NULL
);

-- English answers upheld for a word asked native → English, beside its base
-- form and the forms the book uses. Kept apart from `chapter_words.forms`,
-- which is what gets marked and blanked in the sentence, and from
-- `word_translations`, which is in the learner's language.
CREATE TABLE word_english (
  word_id TEXT NOT NULL REFERENCES chapter_words(id) ON DELETE CASCADE,
  text    TEXT NOT NULL,
  PRIMARY KEY (word_id, text)
);
