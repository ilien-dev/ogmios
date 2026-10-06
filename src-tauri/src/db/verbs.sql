-- Migration 27: each form of a verb is a word of its own.

-- "sworn" and "swore" were one word, "swear", and a word with no sentence
-- to be asked with was asked as "swear", the form its book never showed.
-- From now on a verb the text has in another form than its base form is
-- called by that form and has its key (`books::vocab::own_form`); `base`
-- keeps the base form it was called by. NULL for any other word.
ALTER TABLE chapter_words ADD COLUMN base TEXT;
-- The form a verb has in the sentence of its chapter (`domain::VerbForm`):
-- a word with no sentence of its bank to be asked with shows it too. NULL
-- for any other word, and for a verb nobody labelled yet
-- (`db::words::unlabelled`).
ALTER TABLE chapter_words ADD COLUMN verb_form TEXT;

-- A verb whose sentence was looked at already has its form said there.
UPDATE chapter_words
SET verb_form = (
  SELECT s.verb_form FROM word_sentences s
  WHERE s.key = chapter_words.key AND s.verb_form IS NOT NULL
    AND instr(chapter_words.sentence, s.sentence) > 0
  ORDER BY s.created_at, s.rowid LIMIT 1
)
WHERE part_of_speech IN ('verb', 'phrasalVerb');

-- The sentence of each verb as its words are compared: in small letters,
-- with a space around it and where anything stood between its words.
CREATE TEMP TABLE said AS
SELECT id,
       ' ' || replace(replace(replace(replace(replace(replace(replace(replace(
         replace(replace(replace(replace(replace(replace(replace(replace(replace(
           lower(sentence),
           '’', ''''), '-', ' '), '.', ' '), ',', ' '), ';', ' '), ':', ' '), '!', ' '),
           '?', ' '), '"', ' '), '“', ' '), '”', ' '), '‘', ' '), '(', ' '), ')', ' '),
           '—', ' '), '–', ' '), char(10), ' ') || ' ' AS text
FROM chapter_words
WHERE part_of_speech IN ('verb', 'phrasalVerb');

-- The verbs kept under their base form that their sentence has in another
-- form, with that form: the first one the chapter has that is in the
-- sentence and is the verb word for word, as many words as its base form.
-- `leads` is the one the daily recall asked the word by: the first chapter
-- that finished it.
CREATE TEMP TABLE moved AS
SELECT w.id, w.key AS old_key, f.value AS written, lower(f.value) AS form,
       trim(replace(replace(lower(f.value), '’', ''''), '-', ' ')) AS new_key,
       w.id = (SELECT o.id FROM chapter_words o WHERE o.key = w.key
               ORDER BY o.learned_at IS NULL, o.learned_at, o.id LIMIT 1) AS leads
FROM chapter_words w
JOIN said ON said.id = w.id
JOIN json_each(w.forms) f
WHERE f.key = (
  SELECT MIN(g.key) FROM json_each(w.forms) g
  WHERE lower(g.value) <> lower(w.lemma)
    AND length(g.value) - length(replace(g.value, ' ', ''))
      = length(w.lemma) - length(replace(w.lemma, ' ', ''))
    AND instr(said.text,
              ' ' || trim(replace(replace(lower(g.value), '’', ''''), '-', ' ')) || ' ') > 0
);

-- One whose chapter already has a word of that key stays as it was.
UPDATE OR IGNORE chapter_words
SET key = m.new_key, lemma = m.form, base = chapter_words.lemma,
    forms = json_array(m.written)
FROM moved m
WHERE m.id = chapter_words.id;
DELETE FROM moved WHERE id IN (SELECT id FROM chapter_words WHERE base IS NULL);

-- Its sentences go with the form they have it in; one that has it in a
-- form no chapter calls it by stays where it was, and is asked with no
-- more.
UPDATE OR IGNORE word_sentences
SET key = trim(replace(replace(lower(form), '’', ''''), '-', ' '))
WHERE EXISTS (
  SELECT 1 FROM moved m
  WHERE m.old_key = word_sentences.key
    AND m.new_key = trim(replace(replace(lower(word_sentences.form), '’', ''''), '-', ' '))
);

-- What the recall knows of the word goes with the one it asked it by.
UPDATE OR IGNORE word_events
SET key = (SELECT m.new_key FROM moved m WHERE m.old_key = word_events.key AND m.leads)
WHERE EXISTS (SELECT 1 FROM moved m WHERE m.old_key = word_events.key AND m.leads);
UPDATE OR IGNORE word_notes
SET key = (SELECT m.new_key FROM moved m WHERE m.old_key = word_notes.key AND m.leads)
WHERE EXISTS (SELECT 1 FROM moved m WHERE m.old_key = word_notes.key AND m.leads);
UPDATE OR IGNORE session_words
SET key = (SELECT m.new_key FROM moved m WHERE m.old_key = session_words.key AND m.leads)
WHERE EXISTS (SELECT 1 FROM moved m WHERE m.old_key = session_words.key AND m.leads);

-- A verb the learner said they know is known in the forms they met it in.
INSERT OR IGNORE INTO known_words (key, lemma, created_at)
SELECT m.new_key, m.form, k.created_at
FROM moved m JOIN known_words k ON k.key = m.old_key;

DROP TABLE moved;
DROP TABLE said;
