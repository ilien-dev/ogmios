-- Migration 16: a word is asked with many sentences, not one.

-- The sentences a word can be asked with, by its key
-- (`books::vocab::key`): the ones the book has it in, found by code, and
-- the ones the model wrote for it. Either way the model gave the form the
-- word has there its translation (`hint`) and translated the sentence. One
-- is used once a second request has looked at it (`reviewed`) and found it
-- good; a refused one stays, `discarded`, so that it is not written again,
-- and so does one the learner called bad.
CREATE TABLE word_sentences (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('book', 'model')),
  sentence    TEXT NOT NULL,
  form        TEXT NOT NULL,  -- the word as the sentence writes it
  hint        TEXT NOT NULL,  -- that form in the learner's language
  translation TEXT NOT NULL,  -- the sentence in the learner's language
  reviewed    INTEGER NOT NULL DEFAULT 0,
  discarded   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (key, sentence)
);

CREATE INDEX word_sentences_key ON word_sentences(key);

-- The sentence an answer was given to. How often a sentence was shown is
-- the answers that name it, in practice and in the recall together
-- (`books::sentences::SHOWS`); nothing is counted when it is served.
ALTER TABLE word_answers
  ADD COLUMN sentence_id TEXT REFERENCES word_sentences(id) ON DELETE SET NULL;
ALTER TABLE word_events
  ADD COLUMN sentence_id TEXT REFERENCES word_sentences(id) ON DELETE SET NULL;

CREATE INDEX word_answers_sentence ON word_answers(sentence_id);
CREATE INDEX word_events_sentence ON word_events(sentence_id);
