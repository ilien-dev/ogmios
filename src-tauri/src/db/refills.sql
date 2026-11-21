-- Migration 42: the sentences of a word written alike to another one are
-- written again when they run low, and an answer understood only with its
-- sentence spends that sentence too.

-- Each time the model was asked to write more sentences for a word in a
-- chapter's sense after the first (`sentence_writes`): at most once in a
-- while, so that a word missed many times in a row is not written for
-- again and again (`commands::sentences::refill_due`).
CREATE TABLE sentence_refills (
  key        TEXT NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX sentence_refills_word ON sentence_refills(key, chapter_id);

-- The sentence an answer understood only with it was given: it was shown,
-- and counts as shown. NULL for the answers kept before this, which spent
-- nothing.
ALTER TABLE understood_answers
  ADD COLUMN sentence_id TEXT REFERENCES word_sentences(id) ON DELETE SET NULL;
ALTER TABLE understood_recalls
  ADD COLUMN sentence_id TEXT REFERENCES word_sentences(id) ON DELETE SET NULL;
