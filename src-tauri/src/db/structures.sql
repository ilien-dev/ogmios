-- Migration 18: structures practised by writing sentences with them.

-- When the learner last opened a chapter: the one they are on is the one
-- opened last. A chapter stored before this is taken as opened when it was
-- last practised.
ALTER TABLE book_chapters ADD COLUMN opened_at TEXT;

UPDATE book_chapters SET opened_at =
  (SELECT MAX(s.started_at) FROM practice_sittings s WHERE s.chapter_id = book_chapters.id);

-- One session: `size` sentences over a few structures, more when a missed
-- one comes back. Unfinished, it is paused and can be gone on with.
CREATE TABLE structure_sittings (
  id          TEXT PRIMARY KEY,
  size        INTEGER NOT NULL,
  -- The chapter its verbs are from, when it is a session on one.
  chapter_id  TEXT REFERENCES book_chapters(id) ON DELETE SET NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

-- The sentences of a session, in the order they are asked, each decided
-- when the session started (`structures::plan`), and what the learner wrote.
CREATE TABLE structure_items (
  sitting_id  TEXT NOT NULL REFERENCES structure_sittings(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  structure   TEXT NOT NULL,    -- its key in the catalogue
  topic       TEXT NOT NULL,    -- JSON: a `Topic`
  verb        TEXT,
  verb_source TEXT CHECK (verb_source IN ('chapter', 'recall')),
  warm        INTEGER NOT NULL DEFAULT 0,
  retry_of    INTEGER,          -- the idx of the missed sentence it repeats
  answer      TEXT,             -- as the learner typed it
  peeked      INTEGER NOT NULL DEFAULT 0,
  verdict     TEXT CHECK (verdict IN ('correct', 'partial', 'wrong')),
  explanation TEXT,
  better      TEXT,
  answered_at TEXT,
  PRIMARY KEY (sitting_id, idx)
);

CREATE INDEX structure_items_structure ON structure_items(structure);

-- The structures a chapter uses, as the model found them the one time the
-- chapter was read for them.
CREATE TABLE chapter_structures (
  chapter_id TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  structure  TEXT NOT NULL,
  count      INTEGER NOT NULL,
  example    TEXT NOT NULL,
  PRIMARY KEY (chapter_id, structure)
);

-- A chapter that was read for its structures, even if it has none.
CREATE TABLE chapter_structure_scans (
  chapter_id TEXT PRIMARY KEY REFERENCES book_chapters(id) ON DELETE CASCADE,
  scanned_at TEXT NOT NULL
);
