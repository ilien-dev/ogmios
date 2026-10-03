export function countWords(text: string): number {
  return text.split(/\s+/u).filter((word) => word !== "").length;
}

/** Speech runs at roughly two words a second, so seconds stand in for words. */
export const WORDS_PER_SPEECH_SECOND = 2;

export function formatBytes(bytes: number, locale: string): string {
  const megabytes = bytes / 1_000_000;
  return megabytes >= 1000
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes / 1000)} GB`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(megabytes)} MB`;
}

export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

/** An ISO week label (`2026-W39`) shown as the date of its Monday. */
export function formatWeek(label: string, locale: string): string {
  const match = /^(\d{4})-W(\d{2})$/u.exec(label);
  if (match === null) {
    return label;
  }
  // ISO week 1 is the week holding 4 January.
  const jan4 = Date.UTC(Number(match[1]), 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  const day = 86_400_000;
  const monday = jan4 - jan4Weekday * day + (Number(match[2]) - 1) * 7 * day;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(monday);
}

export function formatNumber(
  value: number,
  locale: string,
  digits = 1,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(value);
}

/** The learner's first language written in the interface language. */
export function languageName(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}
