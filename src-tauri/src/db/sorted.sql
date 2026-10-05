-- Migration 24: sorting a chapter's list is taken up where it was left.

-- When the learner, sorting the list, left the word to learn. A word marked
-- as known needs none: it is out of the list. Nothing said which words a
-- sorting before this had gone past, so every word there is starts unsorted.
ALTER TABLE chapter_words ADD COLUMN sorted_at TEXT;
