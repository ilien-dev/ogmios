-- Migration 10: translating a chapter, sentence by sentence. Paragraphs and
-- sentences are numbered as `books::segment` cuts the chapter's text.

-- What the learner wrote for one sentence, in one direction.
CREATE TABLE translation_sentences (
  chapter_id TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('toNative', 'toEnglish')),
  paragraph  INTEGER NOT NULL,
  sentence   INTEGER NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chapter_id, direction, paragraph, sentence)
);

-- What the model said of a paragraph once it was whole: every note it made,
-- not only the ones the learner is shown.
CREATE TABLE paragraph_reviews (
  chapter_id TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('toNative', 'toEnglish')),
  paragraph  INTEGER NOT NULL,
  review     TEXT NOT NULL, -- JSON: the review as the sidecar returned it
  created_at TEXT NOT NULL,
  PRIMARY KEY (chapter_id, direction, paragraph)
);

-- A paragraph in the learner's language, as close to the author's as that
-- language allows: what is translated back into English.
CREATE TABLE paragraph_versions (
  chapter_id  TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  native_lang TEXT NOT NULL,
  paragraph   INTEGER NOT NULL,
  sentences   TEXT NOT NULL, -- JSON array: one per sentence of the paragraph
  created_at  TEXT NOT NULL,
  PRIMARY KEY (chapter_id, native_lang, paragraph)
);

-- What a review needs to know of the whole chapter, written once.
CREATE TABLE chapter_briefs (
  chapter_id  TEXT NOT NULL REFERENCES book_chapters(id) ON DELETE CASCADE,
  native_lang TEXT NOT NULL,
  brief       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (chapter_id, native_lang)
);
