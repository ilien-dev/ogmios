-- Migration 43: a run of the daily recall asks the words of one effort,
-- and as many as the learner chose.

-- The effort of the words a run asks (`memory::recall::effort`); NULL for
-- every effort, as every run before this asked.
ALTER TABLE recall_sittings ADD COLUMN effort TEXT
  CHECK (effort IN ('hard', 'mid', 'easy'));
-- The words a run asks at most; NULL for every one that is due. A run
-- started before this asked `memory::recall::SIZE`, ten.
ALTER TABLE recall_sittings ADD COLUMN size INTEGER DEFAULT 10;
