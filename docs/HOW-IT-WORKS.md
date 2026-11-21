# How Ogmios decides what you practise

**Español:** [HOW-IT-WORKS.es.md](HOW-IT-WORKS.es.md)

This page explains, in more detail than the README, how Ogmios turns your
conversations into practice. The full product spec, in Spanish, is
[SPEC.md](SPEC.md).

## Claude labels, Ogmios decides

After each conversation Claude reads what you said and labels the mistakes:
which structure, how sure it is, and the sentence where it happened. Labels it
is less than 60% sure of are dropped. Everything after that (which mistake
becomes your focus, when it counts as learned, when you review it) is decided
by Ogmios's own code, not by the AI, so it behaves the same every time.

## The report

The report after a conversation shows:

- what went well;
- **one focus**, the mistake worth your attention now;
- **at most two smaller points**.

Everything else stays in memory for later. For grammar, you see your own
sentence and try to fix it before the answer shows. Explanations are written
in your native language.

## The error memory

A mistake you repeat becomes a _pattern_, and each pattern has a state:

| State     | When                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detected  | It has appeared at least once and has not been your focus yet.                                                                                       |
| In focus  | It was chosen as the focus or a smaller point of a report.                                                                                           |
| Improving | You get it right 40–79% of the times it comes up on your own, or only in drills.                                                                     |
| Mastered  | Right 80% of the time or more, across 3 different conversations and 5 or more chances to use it, the last one at least 7 days after your last drill. |
| Relapse   | You got a mastered pattern wrong in a conversation; it goes back into focus, first in line.                                                          |

At most one pattern is in focus until it starts improving, and at most three
are active at the same time. The rest wait as detected, so you are never asked
to work on everything at once.

"Mastered" is earned only in real conversation. Drills help, but they never
master a pattern on their own.

## How memory shapes the next conversation

Your partner is told which patterns are active, and steers the next
conversations towards situations where you will need them, without telling you
and without correcting you while you talk.

## Drills

A practice session takes about two minutes. It mixes the structure in focus
with others you have worked on, so you have to tell them apart. Patterns come
back for review after 1, 3, 7 and 21 days.

## Words from your books

Each word of a book chapter is studied with a sentence from the book, into
your language and back into English. A learned word comes back after 1, 3, 7,
21 and 60 days, and your conversation partner also uses words you are about to
forget. You can also translate a chapter sentence by sentence, practise its
sentence structures, or take dictations from it.
