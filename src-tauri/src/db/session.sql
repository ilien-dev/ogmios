-- Migration 7: a session of practice has its own words.

-- The words a run of "Practice" was started with: that many of the chapter's
-- open words, most frequent first, fixed for as long as the session lasts.
-- It asks only these and ends when each is done or known. `rank` is their
-- order when it started: the order words not asked yet come in.
CREATE TABLE practice_session_words (
  sitting_id TEXT NOT NULL REFERENCES practice_sittings(id) ON DELETE CASCADE,
  word_id    TEXT NOT NULL REFERENCES chapter_words(id) ON DELETE CASCADE,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (sitting_id, word_id)
);

-- `practice_sittings.finished_at` (migration 6) is from now on set for a
-- practice sitting too, when it runs out of words to ask. One left before
-- that is unfinished, and "Practice" goes on with it. The sittings there
-- were until now ended by the clock and have no words of their own: none of
-- them is to be gone on with.
UPDATE practice_sittings SET finished_at = started_at
WHERE kind = 'practice' AND finished_at IS NULL;
