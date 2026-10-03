-- Migration 8: a book is its chapters. The cover, the title page, the contents
-- and the rest of its front matter are no longer stored: the ones stored
-- before go, with their words and their sittings, and the chapters that are
-- left are numbered again from the first. A book that is nothing but front
-- matter keeps what it has.

DELETE FROM book_chapters
WHERE front_matter
  AND book_id IN (SELECT book_id FROM book_chapters WHERE NOT front_matter);

CREATE TEMP TABLE chapter_places AS
SELECT id, ROW_NUMBER() OVER (PARTITION BY book_id ORDER BY idx) - 1 AS place
FROM book_chapters;

-- Out of the way first: (book_id, idx) is unique at every row of an update.
UPDATE book_chapters SET idx = -1 - idx;
UPDATE book_chapters
SET idx = (SELECT place FROM chapter_places p WHERE p.id = book_chapters.id);

DROP TABLE chapter_places;

ALTER TABLE book_chapters DROP COLUMN front_matter;
