-- Migration 21: asked for in English, a word has rivals.

-- The other English words a learner shown the sentence's hint could type
-- and be right about what they saw ("ideas" for the hint of "notions"), as
-- a JSON array: the second look lists them. Such an answer is no miss
-- (`books::sentences::Verdict::OtherWord`). NULL is a sentence looked at
-- before this was asked for: it is labelled by the next run that gives
-- words their sentences (`commands::sentences`).
ALTER TABLE word_sentences ADD COLUMN also TEXT;
