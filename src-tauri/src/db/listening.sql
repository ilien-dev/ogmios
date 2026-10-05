-- Migration 25: listening. A chapter read aloud, and dictations of its
-- sentences.

-- Where the reading aloud of a chapter was left.
CREATE TABLE listening_places (
  chapter_id TEXT PRIMARY KEY REFERENCES book_chapters(id) ON DELETE CASCADE,
  sentence   INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- One dictation: a few sentences of a chapter, more when a missed one comes
-- back. Unfinished, it is paused and can be gone on with. What was heard in
-- it outlives its book.
CREATE TABLE dictation_sittings (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT REFERENCES book_chapters(id) ON DELETE SET NULL,
  pace        TEXT NOT NULL CHECK (pace IN ('slow', 'normal', 'fast')),
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

-- The sentences of a dictation, in the order they are played, each chosen
-- when it started (`listening::plan`), and what the learner typed.
CREATE TABLE dictation_items (
  sitting_id  TEXT NOT NULL REFERENCES dictation_sittings(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  sentence    TEXT NOT NULL,
  reinforces  TEXT,             -- the word it is there for
  retry_of    INTEGER,          -- the idx of the missed sentence it repeats
  listens     INTEGER NOT NULL DEFAULT 0,
  first_pace  TEXT CHECK (first_pace IN ('slow', 'normal', 'fast')),
  -- The slowest pace it was heard at; answered unheard, the one chosen.
  pace        TEXT CHECK (pace IN ('slow', 'normal', 'fast')),
  answer      TEXT,             -- as the learner typed it
  verdict     TEXT CHECK (verdict IN ('correct', 'partial', 'wrong')),
  right       INTEGER,          -- words heard, out of `total`
  total       INTEGER,
  answered_at TEXT,
  PRIMARY KEY (sitting_id, idx)
);

CREATE INDEX dictation_items_answered ON dictation_items(answered_at);

-- Every word of an answered sentence, and whether it was typed.
CREATE TABLE dictation_words (
  sitting_id TEXT NOT NULL,
  idx        INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  word       TEXT NOT NULL,
  heard      INTEGER NOT NULL,
  PRIMARY KEY (sitting_id, idx, at),
  FOREIGN KEY (sitting_id, idx) REFERENCES dictation_items(sitting_id, idx) ON DELETE CASCADE
);
