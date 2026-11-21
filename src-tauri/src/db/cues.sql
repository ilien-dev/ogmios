-- Migration 41: the words of a sentence that fix which sense its word has.

-- The one to three words of the sentence, besides the word itself, that
-- tell which sense it has there ("hair" for "fair" in "her fair hair"), as
-- the second look listed them, a JSON array. A word whose tag cannot tell
-- it from a word written alike is asked with them from the start
-- (`commands::ladder::tied`). NULL until it was looked at for them: the
-- sentences of such words kept before this are put to the look once more
-- (`db::sentences::unlabelled`), and asked with their whole sentence
-- until then.
ALTER TABLE word_sentences ADD COLUMN cue TEXT;
