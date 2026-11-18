-- Migration 36: what a word needs to be asked with, each way.

-- Whether the word shown alone leads to the answer asked for: English →
-- native (`context_there`) and native → English (`context_back`). "toe"
-- asked for "punta" needs its sentence ("the toe of my shoe"), and so does
-- "punta" asked for "toe"; "race" asked for "carrera" does not. NULL for a
-- word not looked at yet: it goes by `needs_context` until then.
ALTER TABLE chapter_words ADD COLUMN context_there INTEGER;
ALTER TABLE chapter_words ADD COLUMN context_back INTEGER;
-- Words of the learner's language from the root of a translation, in
-- another kind ("patada", a noun, beside "patear"), as a JSON array of
-- {text, partOfSpeech}: an answer that is one of them is reminded of the
-- kind asked for. NULL for a word not looked at yet.
ALTER TABLE chapter_words ADD COLUMN related TEXT;
-- A past said in its form ("pateó") in every other person of the same
-- tense ("pateé", "patearon"), as a JSON array: English says no person,
-- and a past asked without its sentence is right in any. NULL until the
-- next label run says them (`db::words::unlabelled`).
ALTER TABLE word_translations ADD COLUMN in_form_persons TEXT;

-- Every word is looked at again, with what the look now says.
UPDATE chapter_words SET checked = 0;
