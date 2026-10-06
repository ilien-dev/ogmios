-- Migration 26: a word asked in a sentence is answered in the form it has
-- there.

-- The word's other translations in the form the sentence's hint has ("se
-- retiró", "se alejó" beside the hint "retrocedió"), as a JSON array: the
-- second look lists them, and a miss shows them with the hint, never the
-- base forms. NULL is a sentence looked at before this was asked for: it is
-- labelled by the next run that gives words their sentences
-- (`db::sentences::unlabelled`), and shows its hint alone until then.
ALTER TABLE word_sentences ADD COLUMN hints TEXT;
-- The form a verb has in the sentence (`domain::VerbForm`), as the second
-- look labels it; NULL for any other word, and for a sentence not labelled
-- yet.
ALTER TABLE word_sentences ADD COLUMN verb_form TEXT;
