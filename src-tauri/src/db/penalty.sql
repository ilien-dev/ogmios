-- Migration 34: the penalty review (`books::penalty`).

-- Where each word stands with its penalties. Whether one is due is counted
-- from `word_answers`: the misses in a row given after `since_seq`, in
-- sittings of practice. A word with no row has nothing behind it.
CREATE TABLE word_penalties (
  word_id     TEXT PRIMARY KEY REFERENCES chapter_words(id) ON DELETE CASCADE,
  rung        INTEGER NOT NULL DEFAULT 0,  -- 0 free, then 1 to 4
  clean       INTEGER NOT NULL DEFAULT 0,  -- clean sessions in a row since
  clean_on    TEXT,                        -- the learner's day of the last one
  since_seq   INTEGER NOT NULL DEFAULT 0,  -- answers up to it make no streak
  -- The penalty under way, once its first answer is given: the miss that
  -- made it due, how many it has answered right in a row, how often it
  -- started over, and the sitting it was answered in last. A penalty under
  -- way stays due whatever happens to that miss.
  trigger_seq INTEGER,
  position    INTEGER NOT NULL DEFAULT 0,
  restarts    INTEGER NOT NULL DEFAULT 0,
  sitting_id  TEXT
);

-- Answers given before there were penalties make none due: a word missed
-- three times last month is not stopped on the first time it is opened.
INSERT INTO word_penalties (word_id, since_seq)
SELECT word_id, MAX(seq) FROM word_answers GROUP BY word_id;
