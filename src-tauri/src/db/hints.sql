-- Migration 22: a hint has to mean its word on its own.

-- The second look now refuses a hint that names the phrase the word heads
-- and not the word ("llama" for "wisp" in "a wisp of fire"). A sentence it
-- called good before is put to it once more when its hint starts like none
-- of the word's translations: the next run that gives words their sentences
-- looks at it (`commands::sentences`), and it is not asked with until then.
-- A word with no translation kept has nothing to tell its hints by.
UPDATE word_sentences SET reviewed = 0
WHERE reviewed AND NOT discarded AND key IN (
  SELECT w.key FROM chapter_words w JOIN word_translations t ON t.word_id = w.id
) AND NOT EXISTS (
  SELECT 1 FROM word_translations t
  JOIN chapter_words w ON w.id = t.word_id
  WHERE w.key = word_sentences.key
    AND substr(lower(t.text), 1, 4) = substr(lower(word_sentences.hint), 1, 4)
);
