-- Migration 9: a word finished in one chapter is a review word in the others.

-- The first time the word was finished in this chapter. Unlike `done_at` it
-- is never cleared: a miss in the refresh makes the word owe again here, and
-- leaves it a review word in every other chapter that has its key.
ALTER TABLE chapter_words ADD COLUMN learned_at TEXT;

UPDATE chapter_words SET learned_at = done_at;
