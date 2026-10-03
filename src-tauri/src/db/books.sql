-- Migration 2: books and their chapters. A chapter keeps its plain text so it
-- can be prepared later without opening the file again.

CREATE TABLE books (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  author     TEXT,
  format     TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
  hash       TEXT NOT NULL UNIQUE, -- SHA-256 of the file, to spot a duplicate
  file_name  TEXT NOT NULL,        -- the copy under <data_dir>/books/
  created_at TEXT NOT NULL
);

CREATE TABLE book_chapters (
  id           TEXT PRIMARY KEY,
  book_id      TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL, -- reading order
  title        TEXT NOT NULL,    -- empty when the file names no title
  front_matter INTEGER NOT NULL DEFAULT 0,
  words        INTEGER NOT NULL,
  text         TEXT NOT NULL,
  UNIQUE (book_id, idx)
);
