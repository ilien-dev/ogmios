-- Migration 38: the learner no longer writes their own note on a word that
-- keeps slipping. A trick they leave themselves answers for them: the word
-- has to come back from memory alone.
DROP TABLE word_notes;
