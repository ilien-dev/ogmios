-- Migration 20: a form that denies its word is not a form of it.

-- "was not fond of" was kept as a form of "be fond of": the word was asked
-- by it, and its translations, which say the opposite, were taken for right.
-- No such form is kept any more (`books::vocab::negates`); the ones kept
-- before go here, by the same rule: the form has one of these words and
-- its word has none. Each text is compared with a space around it and
-- between its words.
CREATE TEMP TABLE denial (pattern TEXT NOT NULL);
INSERT INTO denial VALUES
  ('% not %'), ('% no %'), ('% never %'), ('% cannot %'), ('%n''t %');

-- A sentence that has the word in such a form is not asked with again. It
-- counts as looked at, so that no second look brings it back.
UPDATE word_sentences SET reviewed = 1, discarded = 1
WHERE EXISTS (
    SELECT 1 FROM denial
    WHERE ' ' || replace(replace(lower(word_sentences.form), '’', ''''), '-', ' ') || ' '
          LIKE pattern
  )
  AND NOT EXISTS (
    SELECT 1 FROM denial
    WHERE ' ' || replace(replace(lower(COALESCE(
            (SELECT w.lemma FROM chapter_words w WHERE w.key = word_sentences.key
             ORDER BY w.created_at, w.id LIMIT 1),
            word_sentences.key)), '’', ''''), '-', ' ') || ' '
          LIKE pattern
  );

-- The forms a chapter has the word in lose it too.
UPDATE chapter_words
SET forms = (
  SELECT json_group_array(form.value) FROM json_each(chapter_words.forms) form
  WHERE NOT EXISTS (
    SELECT 1 FROM denial
    WHERE ' ' || replace(replace(lower(form.value), '’', ''''), '-', ' ') || ' ' LIKE pattern
  )
)
WHERE NOT EXISTS (
    SELECT 1 FROM denial
    WHERE ' ' || replace(replace(lower(chapter_words.lemma), '’', ''''), '-', ' ') || ' '
          LIKE pattern
  )
  AND EXISTS (
    SELECT 1 FROM json_each(chapter_words.forms) form, denial
    WHERE ' ' || replace(replace(lower(form.value), '’', ''''), '-', ' ') || ' ' LIKE pattern
  );

DROP TABLE denial;
