import type { DeltaSink } from "./providers/provider.ts";

/**
 * At basic level the partner ends its reply with sentence starters for the
 * learner's answer: `<starters>I prefer…|I usually…</starters>`. The tail
 * rides on the chat call and is cut off here, so it is never streamed, stored
 * or analysed as something the partner said.
 */
export const STARTERS_OPEN = "<starters>";
export const STARTERS_CLOSE = "</starters>";

export function splitStarters(raw: string): {
  text: string;
  starters: string[];
} {
  const open = raw.indexOf(STARTERS_OPEN);
  if (open === -1) {
    return { text: raw.trim(), starters: [] };
  }
  const tail = raw.slice(open + STARTERS_OPEN.length);
  const close = tail.indexOf(STARTERS_CLOSE);
  const starters = (close === -1 ? tail : tail.slice(0, close))
    .split(/[|\n]/u)
    .map((starter) => starter.trim())
    .filter((starter) => starter !== "");
  return { text: raw.slice(0, open).trim(), starters };
}

/** Where the text that may still turn out to be the tail begins. */
function heldFrom(text: string): number {
  let from = text.length;
  for (let size = STARTERS_OPEN.length - 1; size > 0; size -= 1) {
    if (text.endsWith(STARTERS_OPEN.slice(0, size))) {
      from = text.length - size;
      break;
    }
  }
  // The space before the tail goes with it: the stored reply is trimmed.
  return text.slice(0, from).trimEnd().length;
}

/**
 * Streams a reply without its starters. Deltas cut the tag anywhere, so what
 * could still be its beginning is held back until the next one settles it.
 */
export function hideStarters(onDelta: DeltaSink): {
  push: DeltaSink;
  /** Call once the reply is complete: releases what was held back. */
  finish: () => void;
} {
  let held = "";
  let hidden = false;
  const release = (text: string) => {
    if (text !== "") {
      onDelta(text);
    }
  };
  return {
    push: (delta) => {
      if (hidden) {
        return;
      }
      held += delta;
      const open = held.indexOf(STARTERS_OPEN);
      if (open !== -1) {
        hidden = true;
        release(held.slice(0, open).trimEnd());
        held = "";
        return;
      }
      const from = heldFrom(held);
      release(held.slice(0, from));
      held = held.slice(from);
    },
    finish: () => {
      release(held.trimEnd());
      held = "";
    },
  };
}
