-- Migration 13: a session of practice in one direction alone.

-- The ways a session asks its words in, chosen when it starts: both, or one
-- alone (`domain::Ways`). The sittings there, and every pass of the refresh,
-- are of both.
ALTER TABLE practice_sittings
  ADD COLUMN ways TEXT NOT NULL DEFAULT 'both'
  CHECK (ways IN ('both', 'recognition', 'production'));
