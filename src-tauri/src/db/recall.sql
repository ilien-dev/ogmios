-- Migration 15: learned words come back over the days.

-- One run of the daily recall: at most `memory::recall::SIZE` of the words
-- that are due, asked once each. It belongs to no chapter.
CREATE TABLE recall_sittings (
  id          TEXT PRIMARY KEY,
  ways        TEXT NOT NULL DEFAULT 'both'
              CHECK (ways IN ('both', 'recognition', 'production')),
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

-- Everything that happened to a learned word since it was learned, in
-- order, by its key (`books::vocab::key`): an answer of the recall, right
-- or missed, or the learner using it in a conversation. How strong the word
-- is and when it comes back are counted from these rows
-- (`memory::recall`); nothing is cached. They are apart from
-- `word_answers`: a miss here never reopens the word in its chapter.
CREATE TABLE word_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('right', 'miss', 'used')),
  direction  TEXT CHECK (direction IN ('recognition', 'production')),
  answer     TEXT,  -- as the learner typed it; NULL for a use
  sitting_id TEXT REFERENCES recall_sittings(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX word_events_key ON word_events(key);
CREATE INDEX word_events_sitting ON word_events(sitting_id);
-- A conversation counts a word as used once.
CREATE UNIQUE INDEX word_events_use ON word_events(key, session_id)
  WHERE session_id IS NOT NULL;

-- The learner's own way of remembering a word that keeps slipping.
CREATE TABLE word_notes (
  key        TEXT PRIMARY KEY,
  note       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The learned words the partner was given to use in a conversation, fixed
-- when it started so that its context is the same on every turn.
CREATE TABLE session_words (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  english    TEXT NOT NULL,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (session_id, key)
);
