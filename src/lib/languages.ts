/**
 * First languages offered at onboarding, as BCP-47 primary tags. Their names
 * come from `Intl.DisplayNames`, so no list of names needs translating.
 */
export const NATIVE_LANGUAGES = [
  "es",
  "pt",
  "fr",
  "de",
  "it",
  "nl",
  "pl",
  "uk",
  "ru",
  "tr",
  "ar",
  "hi",
  "bn",
  "zh",
  "ja",
  "ko",
  "vi",
  "id",
  "th",
  "fa",
] as const;

export const INTEREST_KEYS = [
  "technology",
  "travel",
  "cooking",
  "films",
  "music",
  "sports",
  "books",
  "science",
  "business",
  "games",
  "nature",
  "history",
  "art",
  "health",
] as const;
