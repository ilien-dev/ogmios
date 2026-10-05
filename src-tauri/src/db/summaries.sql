-- Migration 12: a finished attempt has a summary, and a review marks what
-- is wrong in the learner's own words.

-- What matters most of an attempt, written once it is finished.
CREATE TABLE attempt_summaries (
  attempt_id TEXT PRIMARY KEY REFERENCES translation_attempts(id) ON DELETE CASCADE,
  summary    TEXT NOT NULL, -- JSON: the summary as the learner is shown it
  created_at TEXT NOT NULL
);

-- The reviews kept so far name a sentence, not the words that are wrong:
-- they cannot be placed in the text. Each is written again when its
-- attempt is next opened.
DELETE FROM attempt_reviews;
