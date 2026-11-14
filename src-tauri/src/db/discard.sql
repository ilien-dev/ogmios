-- Migration 30: a deleted book keeps only the words answered in it.

-- What nobody ever answered in an exercise or finished goes, as deleting a
-- book does now (`db::books::archive_book`); what was answered at least once
-- stays and comes back in the daily recall, and a known word keeps its
-- translations. A chapter that loses any word is to be prepared again,
-- should the book come back.
CREATE TEMP TABLE losing AS
SELECT DISTINCT w.chapter_id AS id FROM chapter_words w
JOIN book_chapters c ON c.id = w.chapter_id
WHERE c.book_id IN (SELECT book_id FROM archived_books)
  AND w.learned_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM word_answers a WHERE a.word_id = w.id)
  AND w.key NOT IN (SELECT key FROM known_words);

UPDATE book_chapters SET prepared = NULL WHERE id IN (SELECT id FROM losing);
DELETE FROM chapter_chunks WHERE chapter_id IN (SELECT id FROM losing);
DELETE FROM chapter_words AS w
WHERE w.chapter_id IN (SELECT id FROM losing)
  AND w.learned_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM word_answers a WHERE a.word_id = w.id)
  AND w.key NOT IN (SELECT key FROM known_words);

DROP TABLE losing;
