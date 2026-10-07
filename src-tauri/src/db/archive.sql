-- Migration 29: a deleted book leaves the shelf and keeps what it taught.

-- The books the learner deleted. Their rows stay, so the words finished in
-- them are still learned: asked in the daily recall, review words in the
-- other books, never extracted again. Nothing lists the book or its
-- chapters, and its copy of the file is gone; the same file added again
-- takes it out of here (`commands::book::import`), as it was left.
CREATE TABLE archived_books (
  book_id     TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  archived_at TEXT NOT NULL
);
