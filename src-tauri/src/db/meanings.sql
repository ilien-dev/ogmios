-- Migration 44: a word means one thing wherever it is, unless it really
-- means another.

-- The sense a chapter's word has: the words of any chapter, of any book,
-- that are the same word in the same meaning share it, and with it what is
-- taken for right (`db::senses`). It is the id of the first word that had
-- it. NULL for a word kept before this, until code gives it one, with no
-- request to the model: the words of one key, kind and form that share a
-- translation are one sense.
ALTER TABLE chapter_words ADD COLUMN sense_id TEXT;
CREATE INDEX chapter_words_sense ON chapter_words(sense_id);

-- What a sense means beside what its chapters were prepared with: what a
-- sentence of it says that is a meaning of the word anywhere. Taken for
-- right, never shown.
CREATE TABLE sense_glosses (
  sense_id TEXT NOT NULL,
  text     TEXT NOT NULL,
  PRIMARY KEY (sense_id, text)
);

-- Whether the look at a word said which of the senses its key already had
-- it is. 0 for every word kept before this: one whose key has another
-- sense of its kind is looked at once more, for that alone.
ALTER TABLE chapter_words ADD COLUMN sensed INTEGER NOT NULL DEFAULT 0;

-- The meanings of its word a sentence's hint says, in their base form, as
-- the second look listed them, a JSON array. NULL until it was asked: the
-- sentences kept before this are put to the look once more for it.
ALTER TABLE word_sentences ADD COLUMN general TEXT;
