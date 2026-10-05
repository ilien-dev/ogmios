/**
 * Canned content for the in-memory backend in `ipcMock.ts`: what a real
 * learner's history might look like after a month of use. Everything here is
 * made up. Learner-facing explanations come in Spanish or English, following
 * the profile's language, the way the real backend writes them in the
 * learner's own language.
 */
import type {
  Effort,
  Level,
  ModelOption,
  PatternView,
  Progress,
  ReportCard,
  SessionMetrics,
  SessionSetup,
  SttModel,
} from "@shared/domain";

export type Lang = "es" | "en";

export function pick(lang: Lang, spanish: string, english: string): string {
  return lang === "es" ? spanish : english;
}

export const OPENINGS: Record<Level, string> = {
  basic:
    "Hi! Let's talk about {{topic}}. What did you do last weekend? Tell me one or two things.",
  intermediate:
    "So, {{topic}}. What's one thing that happened this week that you're proud of? Tell me what happened.",
  advanced:
    "Let's get into {{topic}}. What's a decision you made recently that people around you might have disagreed with, and how did you justify it?",
};

export const LENGTH_HINTS: Record<Level, string> = {
  basic: "Try 1–2 short sentences",
  intermediate: "Try 2–3 sentences",
  advanced: "Try 4–5 sentences, with an example",
};

export const WORD_GOALS: Record<Level, number> = {
  basic: 12,
  intermediate: 40,
  advanced: 90,
};

/** One set per partner turn: the opening's, then one for each of `REPLIES`. */
const SCAFFOLDS = [
  ["Last week I…", "The best part was…", "I'm proud because…"],
  ["They were…", "My team said…", "Nobody…"],
  ["I would…", "Next time I…", "I wouldn't…"],
  ["Yes, once I…", "No, never…", "One time…"],
  ["The client…", "My manager…", "I mean…"],
  ["Nobody sees…", "The hard part is…", "I spend a lot of time…"],
];

export function scaffoldsFor(level: Level, partnerTurn: number): string[] {
  return level === "basic" ? (SCAFFOLDS[partnerTurn] ?? []) : [];
}

export const REPLIES = [
  "Oh really? That sounds like a lot of pressure. I once had a week like that, and I ended up sleeping at the office. How did your team react when it all came together?",
  "That's a good point. I'd probably have done the same, honestly. What would you do differently if it happened again tomorrow?",
  "Ha, I love that. Small wins like that make the whole week feel better. Have you ever had a moment when things went completely wrong instead?",
  "Sorry, do you mean the client changed the plan, or your manager did? I want to make sure I follow.",
  "Interesting. I think most people underestimate how much planning goes into that. What's the part of your job that nobody sees?",
];

export const SUGGESTED_TOPICS = [
  "A small win at work this week",
  "The last trip that surprised you",
  "A film you'd recommend to a friend",
  "Something you'd change about your city",
  "A skill you're slowly learning",
];

/** What `?mock=ready` remembers of the learner's last session. */
export const READY_SETUP: SessionSetup = {
  topic: SUGGESTED_TOPICS[0] ?? "",
  level: "intermediate",
  mode: "casual",
  personality: "curiousFriend",
  focusMode: "free",
  targetMinutes: 10,
  material: null,
  continuePrevious: false,
};

/** As in Rust: the topic just talked about is offered last. */
export function suggestedTopics(lastTopic: string | undefined): string[] {
  return [
    ...SUGGESTED_TOPICS.filter((topic) => topic !== lastTopic),
    ...SUGGESTED_TOPICS.filter((topic) => topic === lastTopic),
  ];
}

export const HEARD_PHRASES = [
  "Well, this week I have finished a big report for the logistics team and my boss was really happy with it.",
  "I think the most difficult part was to coordinate with three different suppliers at the same time.",
  "Honestly, I did a big effort, but in the end it worked and we delivered on time.",
];

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** What `claude` lists, as `supportedModels()` describes it. */
export const CLAUDE_CODE_MODELS: ModelOption[] = [
  {
    id: "opus",
    name: "Opus",
    description: "Opus 5.5 · Best for everyday, complex tasks",
    efforts: EFFORTS,
  },
  {
    id: "claude-fable-5-1[1m]",
    name: "Fable",
    description: "Fable 5.1 · Most capable for your hardest tasks",
    efforts: EFFORTS,
  },
  {
    id: "sonnet",
    name: "Sonnet",
    description: "Sonnet 5.5 · Efficient for routine tasks",
    efforts: EFFORTS,
  },
  {
    id: "haiku",
    name: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers",
    efforts: [],
  },
];

/** What `/v1/models` lists for a key: names only. */
export const API_MODELS: ModelOption[] = [
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    description: null,
    efforts: EFFORTS,
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    description: null,
    efforts: EFFORTS,
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    description: null,
    efforts: [],
  },
];

export const STT_MODELS: SttModel[] = [
  {
    id: "parakeet-tdt-0.6b-v2",
    name: "Parakeet TDT 0.6B",
    bytes: 640_000_000,
    languages: ["en"],
    downloaded: false,
  },
  {
    id: "moonshine-base",
    name: "Moonshine Base",
    bytes: 250_000_000,
    languages: ["en"],
    downloaded: false,
  },
];

export const HELP_OPTIONS = [
  { english: "I'm swamped", note: "Informal: too much work." },
  { english: "I'm overwhelmed", note: "More general, also emotional." },
  { english: "I have a lot on my plate", note: null },
];

export const FACTS = [
  "Works in logistics, coordinating suppliers",
  "Has a dog called Lola",
  "Is preparing a trip to Scotland in spring",
];

/** Rules the fake grader applies: the fix must appear and the slip must not. */
export interface Answer {
  fix: string;
  slip: string | null;
  hint: string;
}

export const CORRECTION_ANSWERS: Record<string, Answer> = {
  "item-focus": {
    fix: "i finished",
    slip: "have finished",
    hint: "“Yesterday” is a finished time.",
  },
  "item-minor-1": { fix: "made", slip: "did", hint: "effort → make" },
  "item-minor-2": {
    fix: "a very organised",
    slip: null,
    hint: "One person, countable.",
  },
};

function metrics(values: Partial<SessionMetrics>): SessionMetrics {
  return {
    modality: "voice",
    speechMinutes: 9.5,
    userWords: 1040,
    userShare: 0.66,
    wordsPerTurn: 43,
    mtld: 58,
    errorsPer100: 3.1,
    globalErrorsPer100: 0.4,
    clausesPerUnit: 1.6,
    subordinationRatio: 0.34,
    ...values,
  };
}

function correctionCards(lang: Lang): ReportCard[] {
  return [
    {
      type: "correction",
      role: "focus",
      itemId: "item-focus",
      patternId: "p-present-perfect",
      original: "I have finished the report yesterday, so my boss was happy.",
      highlight: "have finished",
      corrected: "I finished the report yesterday, so my boss was happy.",
      explanation: pick(
        lang,
        "Con un momento ya terminado, como «yesterday» o «last week», el inglés usa el past simple, no el present perfect.",
        "With a finished time like “yesterday” or “last week”, English uses the past simple, not the present perfect.",
      ),
      hint: pick(lang, "«Yesterday» ya terminó.", "“Yesterday” is over."),
      selfCorrect: true,
      recurrence: pick(
        lang,
        "Esto apareció en 4 de tus últimas 6 charlas.",
        "This appeared in 4 of your last 6 conversations.",
      ),
    },
    {
      type: "correction",
      role: "minor",
      itemId: "item-minor-1",
      patternId: "p-make-do",
      original: "Honestly, I did a big effort to finish on time.",
      highlight: "did",
      corrected: "Honestly, I made a big effort to finish on time.",
      explanation: pick(
        lang,
        "«Effort» va con «make»: make an effort.",
        "“Effort” goes with “make”: make an effort.",
      ),
      hint: "make / do",
      selfCorrect: false,
      recurrence: null,
    },
    {
      type: "correction",
      role: "minor",
      itemId: "item-minor-2",
      patternId: "p-articles",
      original: "My boss is very organised person.",
      highlight: "very organised person",
      corrected: "My boss is a very organised person.",
      explanation: pick(
        lang,
        "Un sustantivo contable en singular necesita «a» o «an» delante.",
        "A singular countable noun needs “a” or “an” in front of it.",
      ),
      hint: pick(
        lang,
        "Una persona: ¿qué falta?",
        "One person: what's missing?",
      ),
      selfCorrect: true,
      recurrence: pick(
        lang,
        "Antes 5 veces, hoy 1.",
        "Before 5 times, today 1.",
      ),
    },
  ];
}

export function reportCards(lang: Lang): ReportCard[] {
  return [
    {
      type: "achievement",
      strengths: [
        pick(
          lang,
          "Contaste una historia completa: el problema, lo que hiciste y cómo acabó.",
          "You told a complete story: the problem, what you did and how it ended.",
        ),
        pick(
          lang,
          "Usaste bien el past simple 8 veces seguidas.",
          "You used the past simple correctly 8 times in a row.",
        ),
      ],
      bestSentence:
        "When the truck finally arrived, we had already reorganised the whole warehouse.",
      selfCorrections: ["“I goed” → “I went”"],
    },
    ...correctionCards(lang),
    {
      type: "couldHaveSaid",
      items: [
        {
          original: "We had many problems with the delivery.",
          better: "We ran into a lot of delivery problems.",
          why: pick(
            lang,
            "«Run into» suena más natural para problemas que aparecen sin avisar.",
            "“Run into” sounds more natural for problems that turn up unexpectedly.",
          ),
        },
        {
          original: "It was very, very difficult for me.",
          better: "It was really tough.",
          why: pick(
            lang,
            "Un adjetivo más fuerte evita repetir «very».",
            "A stronger adjective saves repeating “very”.",
          ),
        },
      ],
      nativeRewrite: {
        original:
          "The most difficult part was to coordinate with three different suppliers at the same time, because everybody wanted different things.",
        rewrite:
          "The hardest part was juggling three suppliers at once — each of them wanted something different.",
        notes: [
          {
            from: "to coordinate with",
            to: "juggling",
            why: pick(
              lang,
              "«Juggle» da la imagen de atender varias cosas a la vez sin que se caiga ninguna.",
              "“Juggle” paints the picture of keeping several things going at once.",
            ),
          },
          {
            from: "at the same time",
            to: "at once",
            why: pick(
              lang,
              "Significa lo mismo, pero es más corto y es lo habitual al hablar.",
              "Same meaning, but shorter and the usual choice in speech.",
            ),
          },
          {
            from: "everybody wanted different things",
            to: "each of them wanted something different",
            why: pick(
              lang,
              "«Each of them» deja claro que hablas de los tres proveedores, uno por uno.",
              "“Each of them” makes it clear you mean the three suppliers, one by one.",
            ),
          },
        ],
      },
    },
    {
      type: "vocabulary",
      items: [
        {
          asked: "plazo de entrega",
          english: "lead time",
          note: pick(
            lang,
            "En logística. «Deadline» es para tareas.",
            "In logistics. “Deadline” is for tasks.",
          ),
        },
        {
          asked: "estar agobiado",
          english: "to be swamped",
          note: pick(lang, "Informal.", "Informal."),
        },
        {
          asked: null,
          english: "a close call",
          note: pick(
            lang,
            "Lo usó tu compañero: algo que casi sale mal.",
            "Your partner used it: something that nearly went wrong.",
          ),
        },
      ],
    },
    {
      type: "metrics",
      current: metrics({}),
      previous: metrics({
        speechMinutes: 7.8,
        userWords: 810,
        userShare: 0.58,
        wordsPerTurn: 34,
        mtld: 52,
        errorsPer100: 4.2,
      }),
      estimatedCefr: "B2",
    },
    {
      type: "challenge",
      text: pick(
        lang,
        "En tu próxima charla, usa dos veces el present perfect para hablar de experiencias («I've never…», «Have you ever…?»).",
        "In your next conversation, use the present perfect twice to talk about experiences (“I've never…”, “Have you ever…?”).",
      ),
      previousAchieved: true,
    },
  ];
}

export const PATTERNS: PatternView[] = [
  {
    id: "p-present-perfect",
    description: "Present perfect vs past simple with finished time",
    kind: "grammarRule",
    state: "focus",
    correctRate: 0.35,
    sessionsSeen: 6,
    nextReviewAt: "2026-09-25",
  },
  {
    id: "p-articles",
    description: "Missing article before singular countable nouns",
    kind: "grammarRule",
    state: "improving",
    correctRate: 0.62,
    sessionsSeen: 9,
    nextReviewAt: "2026-09-27",
  },
  {
    id: "p-make-do",
    description: "make vs do with nouns (make an effort, do a favour)",
    kind: "collocation",
    state: "detected",
    correctRate: null,
    sessionsSeen: 2,
    nextReviewAt: null,
  },
  {
    id: "p-third-person",
    description: "Third-person -s in the present simple",
    kind: "grammarRule",
    state: "mastered",
    correctRate: 0.91,
    sessionsSeen: 11,
    nextReviewAt: "2026-10-15",
  },
  {
    id: "p-depend-of",
    description: "“depend on”, not “depend of”",
    kind: "collocation",
    state: "relapse",
    correctRate: 0.7,
    sessionsSeen: 5,
    nextReviewAt: "2026-09-24",
  },
  {
    id: "p-word-order-questions",
    description: "Word order in indirect questions",
    kind: "wordOrder",
    state: "detected",
    correctRate: null,
    sessionsSeen: 1,
    nextReviewAt: null,
  },
];

export function progress(lang: Lang): Progress {
  return {
    patterns: PATTERNS,
    weeklyMinutes: [
      { week: "2026-W32", minutes: 12 },
      { week: "2026-W33", minutes: 25 },
      { week: "2026-W34", minutes: 18 },
      { week: "2026-W35", minutes: 31 },
      { week: "2026-W36", minutes: 0 },
      { week: "2026-W37", minutes: 22 },
      { week: "2026-W38", minutes: 38 },
      { week: "2026-W39", minutes: 27 },
    ],
    cefrHistory: [
      { date: "2026-08-04", cefr: "B1" },
      { date: "2026-08-19", cefr: "B1" },
      { date: "2026-09-02", cefr: "B2" },
      { date: "2026-09-16", cefr: "B2" },
    ],
    bestSentences: [
      {
        date: "2026-09-23",
        text: "When the truck finally arrived, we had already reorganised the whole warehouse.",
      },
      {
        date: "2026-09-18",
        text: "If I had known how long the flight was, I would have brought a better book.",
      },
      {
        date: "2026-09-11",
        text: "I'm not against remote work; I just think it depends on the team.",
      },
    ],
    vocabulary: [
      {
        asked: "plazo de entrega",
        english: "lead time",
        date: "2026-09-23",
        strength: null,
      },
      {
        asked: "estar agobiado",
        english: "to be swamped",
        date: "2026-09-23",
        strength: null,
      },
      {
        asked: null,
        english: "a close call",
        date: "2026-09-23",
        strength: null,
      },
      {
        asked: "aprovechar",
        english: "to make the most of",
        date: "2026-09-18",
        strength: null,
      },
      {
        asked: "echar de menos",
        english: "to miss",
        date: "2026-09-11",
        strength: null,
      },
      { asked: null, english: "to juggle", date: "2026-09-11", strength: null },
    ],
    trend: [
      { ...metrics({ wordsPerTurn: 28, errorsPer100: 5 }), date: "2026-09-02" },
      {
        ...metrics({ wordsPerTurn: 34, errorsPer100: 4.2 }),
        date: "2026-09-11",
      },
      { ...metrics({}), date: "2026-09-23" },
    ],
    sessions: [
      {
        id: "s-106",
        startedAt: "2026-09-23T19:12:00",
        topic: pick(
          lang,
          "Una pequeña victoria en el trabajo",
          "A small win at work",
        ),
        mode: "casual",
        level: "intermediate",
        speechMinutes: 9.5,
        hasReport: true,
      },
      {
        id: "s-105",
        startedAt: "2026-09-18T20:40:00",
        topic: pick(lang, "Un viaje que salió mal", "A trip that went wrong"),
        mode: "story",
        level: "intermediate",
        speechMinutes: 11.2,
        hasReport: true,
      },
      {
        id: "s-104",
        startedAt: "2026-09-11T08:05:00",
        topic: pick(lang, "¿Teletrabajo para siempre?", "Remote work forever?"),
        mode: "debate",
        level: "advanced",
        speechMinutes: 14,
        hasReport: true,
      },
      {
        id: "s-103",
        startedAt: "2026-09-09T21:30:00",
        topic: pick(
          lang,
          "Pedir en un restaurante",
          "Ordering at a restaurant",
        ),
        mode: "roleplay",
        level: "basic",
        speechMinutes: 3.4,
        hasReport: false,
      },
    ],
  };
}
