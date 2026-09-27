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
