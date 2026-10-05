-- Migration 23: the other words for a hint are English ones.

-- The second look listed, for some hints, other words of the learner's
-- language ("hebra", "jirón" for the hint of "wisp") where English ones were
-- asked for, so that an English answer that was right for the hint counted
-- as a miss. A sentence asked with whose list holds its hint, one of its
-- word's translations or a letter English does not write is left to be
-- labelled again (`db::sentences::unlabelled`), as one kept before the list
-- was. A word English shares ("intangible") is asked about again for nothing.
UPDATE word_sentences SET also = NULL
WHERE reviewed AND NOT discarded AND also IS NOT NULL AND EXISTS (
  SELECT 1 FROM json_each(word_sentences.also) a
  WHERE lower(a.value) = lower(word_sentences.hint)
     OR a.value GLOB '*[^ -~]*'
     OR EXISTS (
       SELECT 1 FROM word_translations t
       JOIN chapter_words w ON w.id = t.word_id
       WHERE w.key = word_sentences.key AND lower(t.text) = lower(a.value)
     )
);
