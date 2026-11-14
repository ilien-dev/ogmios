-- Migration 31: a verb asked in a sentence is asked as it is alone.

-- English → native now asks for a verb's translations in the form it is
-- called by (`db::practice::WordRow::alone`), and its sentence's form is
-- only pointed out. A present or a past put in its form before that may
-- carry the mood its sentence gave it ("se congele" for "freezes" in
-- "before she freezes"): it is said again by the next run that labels
-- words (`db::words::unlabelled`), which asks for the indicative, and the
-- word is asked as its sentence has it until then. A participle or a
-- gerund was never put in another mood.
UPDATE word_translations SET in_form = NULL
WHERE source = 'extraction' AND in_form IS NOT NULL AND word_id IN (
  SELECT id FROM chapter_words
  WHERE base IS NOT NULL AND verb_form IN ('present', 'past')
);
