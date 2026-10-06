-- Migration 28: a verb called by another form than its base form is shown
-- in that form in the learner's language too.

-- The translation in the form the word is called by ("jurado" beside
-- "jurar", for "sworn"), as the model said it when the word was labelled
-- (`commands::label`). NULL for a word called by its base form, and for a
-- translation stored before this was asked for: the next run that labels
-- words says it (`db::words::unlabelled`), and the word is shown by its
-- base form until then.
ALTER TABLE word_translations ADD COLUMN in_form TEXT;
