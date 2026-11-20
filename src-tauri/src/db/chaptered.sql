-- Migration 39: a sentence is of the chapter whose sense of the word it
-- shows. A word can mean one thing in one book and another in the next:
-- practice of a chapter asks it only in that chapter's sentences, and the
-- daily recall judges an answer by the sense of the sentence it shows.

ALTER TABLE word_sentences
  ADD COLUMN chapter_id TEXT REFERENCES book_chapters(id) ON DELETE CASCADE;

CREATE INDEX word_sentences_chapter ON word_sentences(chapter_id, key);

-- The words of a chapter the model was asked to write sentences for, in
-- that chapter's sense: once, whatever came of it.
CREATE TABLE sentence_writes (
  key        TEXT NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, chapter_id)
);

-- A sentence of the book whose gloss was refused was kept as the model's:
-- it is the book's, so that its chapter is not asked about it again.
UPDATE word_sentences SET source = 'book'
WHERE source = 'model' AND discarded AND hint = '' AND form = '';

-- A sentence of a book is of the chapter of the word that has it in its
-- text, the first in reading order.
UPDATE word_sentences SET chapter_id = (
  SELECT w.chapter_id FROM chapter_words w
  JOIN book_chapters c ON c.id = w.chapter_id
  WHERE w.key = word_sentences.key AND instr(c.text, word_sentences.sentence) > 0
  ORDER BY c.book_id, c.idx LIMIT 1
)
WHERE source = 'book' AND sentence != '';

-- Or of the chapter whose own sentence of the word it is.
UPDATE word_sentences SET chapter_id = (
  SELECT w.chapter_id FROM chapter_words w
  WHERE w.key = word_sentences.key AND w.sentence != ''
    AND (instr(w.sentence, word_sentences.sentence) > 0
      OR instr(word_sentences.sentence, w.sentence) > 0)
  ORDER BY w.created_at, w.id LIMIT 1
)
WHERE chapter_id IS NULL AND sentence != '';

-- One the model wrote is of the chapter whose translations its hint is.
UPDATE word_sentences SET chapter_id = (
  SELECT w.chapter_id FROM chapter_words w
  JOIN word_translations t ON t.word_id = w.id
  WHERE w.key = word_sentences.key AND word_sentences.hint != ''
    AND substr(lower(t.text), 1, 4) = substr(lower(word_sentences.hint), 1, 4)
  ORDER BY w.created_at, w.id LIMIT 1
)
WHERE chapter_id IS NULL;

-- A word of one chapter only has every sentence of that chapter.
UPDATE word_sentences SET chapter_id = (
  SELECT MIN(w.chapter_id) FROM chapter_words w WHERE w.key = word_sentences.key
)
WHERE chapter_id IS NULL
  AND (SELECT COUNT(*) FROM chapter_words w WHERE w.key = word_sentences.key) = 1;

-- What is still of no chapter, of a word some chapter has, cannot be told
-- apart: it goes, and the answers given to it keep no sentence.
DELETE FROM word_sentences
WHERE chapter_id IS NULL
  AND EXISTS (SELECT 1 FROM chapter_words w WHERE w.key = word_sentences.key);

-- A deleted book keeps of its sentences only the one each word it kept was
-- learned with (`db::books::archive_book`).
DELETE FROM word_sentences
WHERE source = 'book'
  AND chapter_id IN (
    SELECT c.id FROM book_chapters c JOIN archived_books a ON a.book_id = c.book_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM chapter_words w
    WHERE w.chapter_id = word_sentences.chapter_id AND w.key = word_sentences.key
      AND w.sentence != '' AND word_sentences.sentence != ''
      AND (instr(w.sentence, word_sentences.sentence) > 0
        OR instr(word_sentences.sentence, w.sentence) > 0)
  );
