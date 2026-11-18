-- Migration 37: every word is looked at again for what its translations
-- say beyond it.

-- "stand a chance", taken from "wouldn't stand a chance", was kept as
-- "tendría alguna oportunidad": the "would" and the "not" of the sentence
-- in a word that says neither. The look now says so of any translation,
-- and code gives the word its own (`db::words::judge_look`).
UPDATE chapter_words SET checked = 0;
