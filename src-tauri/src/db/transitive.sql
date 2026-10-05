-- Migration 19: whether a verb of a chapter takes an object.

-- A structure built on such a verb (the passive, the causative) is asked
-- with one alone. NULL for a word stored before this was asked for: it is
-- put to the model again with the words nobody labelled
-- (`commands::label`), and until then no such structure asks for it.
ALTER TABLE chapter_words ADD COLUMN transitive INTEGER;

-- The pieces of a preparation under way were answered without it: they are
-- asked again.
DELETE FROM chapter_chunks;
