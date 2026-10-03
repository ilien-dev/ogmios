-- Migration 3: the words of a prepared chapter.

-- The deepest depth a chapter's words were taken at; NULL until prepared.
ALTER TABLE book_chapters
  ADD COLUMN prepared TEXT CHECK (prepared IN ('hardest', 'relevant', 'most'));

-- What the model answered for each piece of a chapter, kept until the whole
-- chapter is in so that a retry asks only for the pieces still missing.
CREATE TABLE chapter_chunks (
  chapter_id TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  depth      TEXT NOT NULL,
  idx        INTEGER NOT NULL,
  total      INTEGER NOT NULL, -- pieces in the chapter when this one was cut
  items      TEXT NOT NULL,    -- JSON: the items as the sidecar returned them
  PRIMARY KEY (chapter_id, depth, idx)
);

-- One row per word and chapter. `key` is the normalised base form
-- (`books::vocab::key`): the same key is the same word in any chapter.
CREATE TABLE chapter_words (
  id            TEXT PRIMARY KEY,
  chapter_id    TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  lemma         TEXT NOT NULL,
  forms         TEXT NOT NULL,    -- JSON array: every form the chapter uses
  sentence      TEXT NOT NULL,    -- the first sentence that uses it
  needs_context INTEGER NOT NULL DEFAULT 0,
  occurrences   INTEGER NOT NULL, -- of its forms in the chapter
  depth         TEXT NOT NULL,    -- the depth that brought it in
  done_at       TEXT,             -- set when the learner has finished it
  created_at    TEXT NOT NULL,
  UNIQUE (chapter_id, key)
);

CREATE INDEX chapter_words_key ON chapter_words(key);

-- Accepted answers for a word, in the learner's native language.
CREATE TABLE word_translations (
  word_id TEXT NOT NULL REFERENCES chapter_words(id) ON DELETE CASCADE,
  text    TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT 'extraction'
          CHECK (source IN ('extraction', 'dispute')),
  PRIMARY KEY (word_id, text)
);

-- Words the learner already knows, by key. No tie to a book: deleting one
-- keeps them, and they are never extracted again.
CREATE TABLE known_words (
  key        TEXT PRIMARY KEY,
  lemma      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
