export interface Segment {
  text: string;
  marked: boolean;
}

/**
 * Splits `text` around the first occurrence of each span. A span that is not
 * there, or that overlaps one already placed, is left unmarked.
 */
export function segments(text: string, spans: string[]): Segment[] {
  const found = spans
    .filter((span) => span !== "")
    .map((span) => ({ at: text.indexOf(span), length: span.length }))
    .filter((hit) => hit.at !== -1)
    .sort((a, b) => a.at - b.at);
  const parts: Segment[] = [];
  let cursor = 0;
  for (const hit of found) {
    if (hit.at < cursor) {
      continue;
    }
    if (hit.at > cursor) {
      parts.push({ text: text.slice(cursor, hit.at), marked: false });
    }
    cursor = hit.at + hit.length;
    parts.push({ text: text.slice(hit.at, cursor), marked: true });
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), marked: false });
  }
  return parts;
}
