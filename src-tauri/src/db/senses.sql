-- Migration 35: every word is looked at once more against its sentence.

-- A word its sentence uses as another word written the same way was taken
-- in the wrong sense: "moped", the past of "mope" in "he moped around",
-- taken for the noun and translated "ciclomotor". 0 is a word not looked at
-- yet, every word stored before this included: the next run that labels
-- words looks at it (`commands::label::check_all`), puts right the one that
-- was taken wrong, and sets it to 1.
ALTER TABLE chapter_words ADD COLUMN checked INTEGER NOT NULL DEFAULT 0;
