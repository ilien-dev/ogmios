/** The questions of §5, in the order they are asked. */
export const STEPS = [
  "nativeLang",
  "name",
  "goal",
  "interests",
  "connection",
  "voice",
  "variant",
  "reminder",
  "level",
] as const;

export type Step = (typeof STEPS)[number];
