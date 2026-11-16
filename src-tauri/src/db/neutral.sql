-- Migration 33: the learner's Spanish is neutral Latin American Spanish.

-- A translation put in the form of its word that speaks to "vosotros"
-- ("jurasteis", "jurabais" for "you swore") is asked for again: a learner
-- who types "juraron" would be told they are wrong. Only where the learner's
-- language is Spanish; the endings are those `books::variety` reads.
UPDATE word_translations SET in_form = NULL, in_form_also = NULL
WHERE EXISTS (SELECT 1 FROM profile WHERE lower(native_lang) LIKE 'es%')
  AND (
    in_form LIKE '%ais' OR in_form LIKE '%áis' OR in_form LIKE '%éis'
    OR in_form LIKE '%steis' OR in_form LIKE 'os %' OR in_form LIKE '% os %'
    OR in_form = 'sois'
    OR in_form_also LIKE '%ais"%' OR in_form_also LIKE '%áis"%'
    OR in_form_also LIKE '%éis"%' OR in_form_also LIKE '%steis"%'
    OR in_form_also LIKE '%"os %'
  );
