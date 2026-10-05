-- Migration 11: a chapter is translated in attempts. Each one is a session
-- in one direction, with its own sentences and reviews: it can be paused and
-- gone on with, or finished, and a new one starts from the first paragraph.

CREATE TABLE translation_attempts (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL CHECK (direction IN ('toNative', 'toEnglish')),
  started_at  TEXT NOT NULL,
  finished_at TEXT -- NULL while it is paused: it can be gone on with
);

CREATE INDEX translation_attempts_chapter ON translation_attempts(chapter_id);

-- What the learner wrote for one sentence in one attempt.
CREATE TABLE attempt_sentences (
  attempt_id TEXT NOT NULL REFERENCES translation_attempts(id) ON DELETE CASCADE,
  paragraph  INTEGER NOT NULL,
  sentence   INTEGER NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, paragraph, sentence)
);

-- What the model said of a paragraph of an attempt once it was whole: every
-- note it made, not only the ones the learner is shown.
CREATE TABLE attempt_reviews (
  attempt_id TEXT NOT NULL REFERENCES translation_attempts(id) ON DELETE CASCADE,
  paragraph  INTEGER NOT NULL,
  review     TEXT NOT NULL, -- JSON: the review as the sidecar returned it
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, paragraph)
);

-- What was written before attempts existed is one paused attempt for each
-- chapter and direction.
INSERT INTO translation_attempts (id, chapter_id, direction, started_at)
  SELECT chapter_id || ':' || direction, chapter_id, direction, MIN(created_at)
  FROM translation_sentences GROUP BY chapter_id, direction;

INSERT INTO attempt_sentences (attempt_id, paragraph, sentence, text, created_at)
  SELECT chapter_id || ':' || direction, paragraph, sentence, text, created_at
  FROM translation_sentences;

INSERT INTO attempt_reviews (attempt_id, paragraph, review, created_at)
  SELECT r.chapter_id || ':' || r.direction, r.paragraph, r.review, r.created_at
  FROM paragraph_reviews r
  WHERE r.chapter_id || ':' || r.direction IN (SELECT id FROM translation_attempts);

DROP TABLE translation_sentences;
DROP TABLE paragraph_reviews;
