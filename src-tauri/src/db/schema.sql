-- Migration 1. Every timestamp is RFC 3339 UTC text; every id is a UUID v4.
-- Enum columns hold the camelCase spelling from domain.rs.

CREATE TABLE profile (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT,
  native_lang   TEXT NOT NULL,
  ui_lang       TEXT NOT NULL,
  goal          TEXT NOT NULL,
  variant       TEXT NOT NULL,
  interests     TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  level         TEXT NOT NULL,
  reminder_time TEXT,
  onboarded     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE profile_facts (
  id                TEXT PRIMARY KEY,
  text              TEXT NOT NULL,
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  deleted           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  setup           TEXT NOT NULL, -- JSON SessionSetup
  topic           TEXT NOT NULL,
  level           TEXT NOT NULL,
  mode            TEXT NOT NULL,
  provider_ref    TEXT,          -- Claude Code session id, when kept
  speech_minutes  REAL NOT NULL DEFAULT 0,
  target_notified INTEGER NOT NULL DEFAULT 0,
  estimated_cefr  TEXT,
  metrics         TEXT,          -- JSON SessionMetrics
  analysis        TEXT,          -- JSON Analysis, as returned by the agent
  applied         TEXT,          -- JSON of what the memory update decided; set with it
  report          TEXT           -- JSON Report
);

CREATE TABLE turns (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  said_text      TEXT,
  sent_text      TEXT NOT NULL,
  audio_id       TEXT,
  speech_seconds REAL,
  words          INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (session_id, idx)
);

CREATE TABLE patterns (
  id                 TEXT PRIMARY KEY,
  key                TEXT NOT NULL UNIQUE,
  description        TEXT NOT NULL,
  kind               TEXT NOT NULL,
  rule_based         INTEGER NOT NULL,
  state              TEXT NOT NULL,
  first_seen_session TEXT NOT NULL,
  last_seen_session  TEXT NOT NULL,
  state_changed_at   TEXT NOT NULL,
  -- When the pattern last entered focus or relapse; progress is measured on
  -- the events after it.
  focus_at           TEXT,
  -- The single pattern the reports keep coming back to (SPEC §8.3).
  is_primary         INTEGER NOT NULL DEFAULT 0,
  last_drill_at      TEXT,
  next_review_at     TEXT,
  review_step        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pattern_events (
  id         TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id    TEXT REFERENCES turns(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN
               ('error', 'correctUse', 'selfCorrected', 'drillOk', 'drillFail')),
  global     INTEGER NOT NULL DEFAULT 0,
  above_level INTEGER NOT NULL DEFAULT 0,
  original   TEXT,
  corrected  TEXT,
  disputed   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX pattern_events_by_pattern ON pattern_events (pattern_id, created_at);

-- One row per correction shown in a report, so a dispute or a self-check can
-- find the events it is about.
CREATE TABLE report_items (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES pattern_events(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('focus', 'minor')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  solved     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE drills (
  id         TEXT PRIMARY KEY,
  pattern_id TEXT REFERENCES patterns(id) ON DELETE CASCADE,
  format     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  items      TEXT NOT NULL -- JSON array of generated items with answers and results
);

CREATE TABLE vocab (
  id         TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  asked      TEXT,   -- what the learner typed in their language; null if from the partner
  english    TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE best_sentences (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id    TEXT REFERENCES turns(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE challenges (
  id                  TEXT PRIMARY KEY,
  created_session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pattern_id          TEXT REFERENCES patterns(id) ON DELETE SET NULL,
  text                TEXT NOT NULL,
  target_count        INTEGER NOT NULL,
  achieved_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  checked             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE practice_days (
  date        TEXT PRIMARY KEY, -- local YYYY-MM-DD
  sessions    INTEGER NOT NULL DEFAULT 0
);
