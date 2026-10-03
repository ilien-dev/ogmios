-- Migration 6: the quick refresh before reading a ready chapter.

-- A sitting is a run of "Practice" or one pass of the refresh: English →
-- native over the chapter's done words, each asked once. Its answers are
-- rows of `word_answers` like any other, so a miss reopens its word by the
-- same counting. The kind keeps the two apart: a practice sitting is never
-- answered as a refresh, nor a refresh as practice.
ALTER TABLE practice_sittings
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice'
  CHECK (kind IN ('practice', 'refresh'));

-- Set when a refresh pass ran out of words to ask. A pass left before that
-- is gone on with by the next refresh; a finished one is not, and the next
-- refresh starts over. Always NULL for a practice sitting.
ALTER TABLE practice_sittings ADD COLUMN finished_at TEXT;
