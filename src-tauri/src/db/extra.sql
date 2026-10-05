-- Migration 17: practising a direction that has nothing left to ask.

-- An extra review: a session started in ways none of the chapter's words
-- owed anything in. It asks the chapter's words anyway, done ones included,
-- and counts what they owe from the answers given in it alone. Its answers
-- are rows of `word_answers` like any other, so a miss reopens its word by
-- the same counting.
ALTER TABLE practice_sittings ADD COLUMN extra INTEGER NOT NULL DEFAULT 0;
