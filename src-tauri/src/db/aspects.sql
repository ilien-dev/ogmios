-- Migration 32: a verb in another form is asked for in the forms that say it.

-- An English past is two pasts in Spanish: "swore" is "juró" and "juraba".
-- Each translation put in the form its word is called by (`in_form`) has
-- the other forms that say the same beside it, as a JSON list: '[]' when
-- there is none, NULL until a model was asked (`db::words::unlabelled`).
-- English → native, an answer is right only in one of them
-- (`commands::practice::off_form`).
ALTER TABLE word_translations ADD COLUMN in_form_also TEXT;

-- Only a past has another form to be asked for: any other form already
-- said has none. A past said before this is asked again, and is asked for
-- the form it was said in meanwhile.
UPDATE word_translations SET in_form_also = '[]'
WHERE in_form IS NOT NULL AND word_id IN (
  SELECT id FROM chapter_words WHERE verb_form IS NULL OR verb_form != 'past'
);
