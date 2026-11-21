/** How a metric moved against the mean of the last sessions. */
export interface Trend {
  delta: number;
  /** No earlier sessions, or a change too small to show at these digits. */
  flat: boolean;
  /** Whether the move is good news; null when flat. */
  better: boolean | null;
}

export function trend(
  now: number,
  before: number | null,
  digits: number,
  higherIsBetter: boolean,
): Trend {
  const delta = before === null ? 0 : now - before;
  const flat = before === null || Math.abs(delta) < 10 ** -digits / 2;
  return {
    delta,
    flat,
    better: flat ? null : delta > 0 === higherIsBetter,
  };
}
