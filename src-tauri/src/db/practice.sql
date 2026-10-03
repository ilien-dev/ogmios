-- Migration 4: practising a chapter's words.

-- One run of "Practice" on a chapter. Its start is what the time cap is
-- measured from; it has no end, a sitting left halfway is simply not resumed.
CREATE TABLE practice_sittings (
  id         TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL
);

-- Every answer given, in order. This is the whole of a word's progress: what
-- it still owes in a direction is counted from these rows, oldest first
-- (`books::practice::owed`), and so is what is new, open or asked last.
-- Nothing is cached, so changing one row's `correct` undoes a miss exactly.
CREATE TABLE word_answers (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT, -- the order of the answers
  word_id    TEXT NOT NULL REFERENCES chapter_words(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('recognition', 'production')),
  sitting_id TEXT NOT NULL REFERENCES practice_sittings(id) ON DELETE CASCADE,
  answer     TEXT NOT NULL,                     -- as the learner typed it
  correct    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX word_answers_word ON word_answers(word_id);
CREATE INDEX word_answers_sitting ON word_answers(sitting_id);
