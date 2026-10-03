/**
 * Canned drill items for the in-memory backend: a warm-up on the learner's
 * focus pattern, then two items mixed in from other active patterns (§9.2).
 */
import type { DrillFormat, DrillItem } from "@shared/domain";
import type { Lang } from "./ipcMockData";
import { PATTERNS, pick } from "./ipcMockData";

interface DrillSeed {
  format: DrillFormat;
  patternId: string;
  prompt: string;
  instruction: [spanish: string, english: string];
  options?: string[];
  expected: string;
  /** The answer is right when it holds any of these. */
  accept: string[];
  slip: string | null;
  explanation: [spanish: string, english: string];
}

const PRESENT_PERFECT_SEEDS: DrillSeed[] = [
  {
    format: "transformation",
    patternId: "p-present-perfect",
    prompt: "I visited Rome three times. (in my life, so far)",
    instruction: [
      "Pásala a present perfect: es una experiencia sin fecha.",
      "Rewrite it in the present perfect: it's an experience with no date.",
    ],
    expected: "I've visited Rome three times.",
    accept: ["ve visited rome", "have visited rome"],
    slip: null,
    explanation: [
      "Experiencia de vida sin momento concreto → have + participio.",
      "A life experience with no specific time → have + past participle.",
    ],
  },
  {
    format: "sameStructure",
    patternId: "p-present-perfect",
    prompt:
      "A friend asks about sushi. You tried it for the first time last Friday.",
    instruction: [
      "Responde con una frase. Ojo: hay un momento concreto.",
      "Answer in one sentence. Careful: there's a specific time.",
    ],
    expected: "I tried sushi for the first time last Friday.",
    accept: ["tried"],
    slip: "have tried",
    explanation: [
      "«Last Friday» es un momento terminado → past simple.",
      "“Last Friday” is a finished time → past simple.",
    ],
  },
  {
    format: "spotError",
    patternId: "p-present-perfect",
    prompt: "One of these sentences has a slip.",
    instruction: [
      "Elige la frase con el error y escríbela bien.",
      "Pick the sentence with the slip and write it correctly.",
    ],
    options: [
      "I've lived here since 2019.",
      "I have seen that film last night.",
      "She has never been to Canada.",
    ],
    expected: "I saw that film last night.",
    accept: ["saw that film"],
    slip: "have seen",
    explanation: [
      "«Last night» pide past simple: I saw.",
      "“Last night” needs the past simple: I saw.",
    ],
  },
];

const MIXED_SEEDS: DrillSeed[] = [
  {
    format: "transformation",
    patternId: "p-articles",
    prompt: "She is engineer at big company.",
    instruction: [
      "Añade lo que falta para que suene natural.",
      "Add what's missing so it sounds natural.",
    ],
    expected: "She is an engineer at a big company.",
    accept: ["an engineer at a big company"],
    slip: null,
    explanation: [
      "Sustantivos contables en singular: a / an.",
      "Singular countable nouns: a / an.",
    ],
  },
  {
    format: "spotError",
    patternId: "p-make-do",
    prompt: "One of these sentences has a slip.",
    instruction: [
      "Elige la frase con el error y escríbela bien.",
      "Pick the sentence with the slip and write it correctly.",
    ],
    options: [
      "Could you do me a favour?",
      "I need to do a decision today.",
      "We made a lot of progress.",
    ],
    expected: "I need to make a decision today.",
    accept: ["make a decision"],
    slip: "do a decision",
    explanation: ["«Decision» va con make.", "“Decision” goes with make."],
  },
];

const GUIDED_SEEDS: DrillSeed[] = [
  {
    format: "guidedChat",
    patternId: "p-present-perfect",
    prompt:
      "I'm thinking of going somewhere new this winter. Have you ever been anywhere really cold?",
    instruction: [
      "Contesta con naturalidad. Habla de tus experiencias.",
      "Answer naturally. Talk about your experiences.",
    ],
    expected: "I've been to Norway once — it was freezing!",
    accept: ["ve been"],
    slip: null,
    explanation: [
      "«Have you ever…?» se contesta con present perfect.",
      "“Have you ever…?” is answered with the present perfect.",
    ],
  },
  {
    format: "guidedChat",
    patternId: "p-present-perfect",
    prompt: "Nice! And when did you go? What was the best part?",
    instruction: [
      "Ahora te pregunta cuándo: hay un momento concreto.",
      "Now they ask when: there's a specific time.",
    ],
    expected:
      "I went there two years ago. The best part was the northern lights.",
    accept: ["went"],
    slip: "have gone",
    explanation: [
      "«When…?» y «ago» piden past simple.",
      "“When…?” and “ago” need the past simple.",
    ],
  },
  {
    format: "guidedChat",
    patternId: "p-present-perfect",
    prompt:
      "Sounds amazing. Is there anything you've always wanted to try but haven't yet?",
    instruction: [
      "Cuéntale algo que aún no has hecho.",
      "Tell them something you haven't done yet.",
    ],
    expected: "I've never tried skiing, but I'd love to.",
    accept: ["never"],
    slip: null,
    explanation: [
      "«Never» / «yet» con experiencias → present perfect.",
      "“Never” / “yet” with experiences → present perfect.",
    ],
  },
];

export interface SeededItem {
  item: DrillItem;
  seed: DrillSeed;
}

function seeded(seeds: DrillSeed[], lang: Lang, offset: number): SeededItem[] {
  return seeds.map((seed, i) => ({
    seed,
    item: {
      index: offset + i,
      format: seed.format,
      patternId: seed.patternId,
      focus:
        PATTERNS.find((pattern) => pattern.id === seed.patternId)
          ?.description ?? "",
      prompt: seed.prompt,
      instruction: pick(lang, ...seed.instruction),
      options: seed.options ?? [],
    },
  }));
}

export function drillItems(
  format: DrillFormat | null,
  lang: Lang,
): SeededItem[] {
  if (format === "guidedChat") {
    return seeded(GUIDED_SEEDS, lang, 0);
  }
  const warmup = PRESENT_PERFECT_SEEDS.filter(
    (seed) => format === null || seed.format === format,
  );
  const mixed = MIXED_SEEDS.filter(
    (seed) => format === null || seed.format === format,
  );
  return seeded([...warmup, ...mixed], lang, 0);
}

export function retryItem(
  original: SeededItem,
  index: number,
  lang: Lang,
): SeededItem {
  const seed: DrillSeed = {
    ...original.seed,
    prompt:
      original.seed.patternId === "p-present-perfect"
        ? "Your colleague asks about the report. You sent it two hours ago."
        : original.seed.prompt,
    expected:
      original.seed.patternId === "p-present-perfect"
        ? "I sent it two hours ago."
        : original.seed.expected,
    accept:
      original.seed.patternId === "p-present-perfect"
        ? ["sent it"]
        : original.seed.accept,
    format:
      original.seed.format === "spotError"
        ? "transformation"
        : original.seed.format,
    options: [],
  };
  const [item] = seeded([seed], lang, index);
  return item ?? original;
}
