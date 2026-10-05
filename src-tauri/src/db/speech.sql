-- Migration 14: what kind of word each word of a chapter is.

-- NULL for a word prepared before words were labelled, and for one added
-- outside a preparation.
ALTER TABLE chapter_words
  ADD COLUMN part_of_speech TEXT CHECK (part_of_speech IN
    ('noun', 'verb', 'phrasalVerb', 'adjective', 'adverb', 'expression', 'other'));

-- The pieces of a preparation under way were answered without it: they are
-- asked again.
DELETE FROM chapter_chunks;
