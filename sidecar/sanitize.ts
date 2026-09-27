import type {
  Analysis,
  AnalyzeParams,
  ComposeParams,
  Composed,
  DrillGenerateParams,
  DrillSet,
} from "../shared/protocol.ts";
import { log } from "./log.ts";

/**
 * Checks the schema cannot express: a quoted span must really be in the text
 * it quotes, and an id must name something Rust sent. Rust stores what comes
 * back and highlights spans by searching for them, so a near-miss is repaired
 * where it can be and dropped where it cannot.
 */

const QUOTES = /["'‘’“”]/gu;

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * Finds `needle` in `haystack` and returns it as `haystack` spells it. A model
 * copying a span tends to change case, spacing or quote style; those are
 * forgiven, anything else is not.
 */
export function findSpan(haystack: string, needle: string): string | null {
  const trimmed = needle.trim();
  if (trimmed === "") {
    return null;
  }
  if (haystack.includes(trimmed)) {
    return trimmed;
  }
  const pattern = trimmed
    .split(/\s+/u)
    .map((word) => escapeRegExp(word).replaceAll(QUOTES, `["'‘’“”]`))
    .join(String.raw`\s+`);
  const match = new RegExp(pattern, "iu").exec(haystack);
  return match === null ? null : match[0];
}

export function sanitizeAnalysis(
  analysis: Analysis,
  params: AnalyzeParams,
): Analysis {
  const sent = new Map(
    params.turns
      .filter((turn) => turn.role === "user")
      .map((turn) => [turn.id, turn.sent]),
  );
  const patternIds = new Set(params.patterns.map((pattern) => pattern.id));
  const known = (id: string | null): string | null =>
    id !== null && patternIds.has(id) ? id : null;

  const errors = analysis.errors.flatMap((error) => {
    const text = sent.get(error.turnId);
    const original = text === undefined ? null : findSpan(text, error.original);
    if (original === null) {
      return [];
    }
    const existingId = known(error.pattern.existingId);
    // An unknown id is a pattern Rust has never seen: keep it as a new one.
    const newKey =
      existingId === null
        ? (error.pattern.newKey ??
          error.pattern.existingId ??
          "unnamed_pattern")
        : null;
    return [
      { ...error, original, pattern: { ...error.pattern, existingId, newKey } },
    ];
  });

  const couldHaveSaid = analysis.couldHaveSaid.flatMap((item) => {
    const text = sent.get(item.turnId);
    const original = text === undefined ? null : findSpan(text, item.original);
    return original === null ? [] : [{ ...item, original }];
  });

  const bestText =
    analysis.bestSentenceTurnId === null
      ? undefined
      : sent.get(analysis.bestSentenceTurnId);
  const bestSentence =
    bestText === undefined || analysis.bestSentence === null
      ? null
      : findSpan(bestText, analysis.bestSentence);

  const dropped =
    analysis.errors.length -
    errors.length +
    (analysis.couldHaveSaid.length - couldHaveSaid.length);
  if (dropped > 0) {
    log("dropped analysis items quoting text that is not there", { dropped });
  }

  return {
    ...analysis,
    errors,
    couldHaveSaid,
    correctUses: analysis.correctUses.filter(
      (use) => sent.has(use.turnId) && patternIds.has(use.patternId),
    ),
    edits: analysis.edits
      .filter((edit) => sent.has(edit.turnId))
      .map((edit) => ({ ...edit, patternId: known(edit.patternId) })),
    bestSentence,
    bestSentenceTurnId:
      bestSentence === null ? null : analysis.bestSentenceTurnId,
    challengeAchieved:
      params.challenge === null ? null : (analysis.challengeAchieved ?? false),
  };
}

export function sanitizeComposed(
  composed: Composed,
  params: ComposeParams,
): Composed {
  const originals = new Map(
    params.corrections.map((correction) => [
      correction.itemId,
      correction.original,
    ]),
  );
  const corrections = composed.corrections.flatMap((card) => {
    const original = originals.get(card.itemId);
    if (original === undefined) {
      return [];
    }
    // Marking the whole sentence is a weaker card, but still a true one.
    return [
      { ...card, highlight: findSpan(original, card.highlight) ?? original },
    ];
  });
  return {
    corrections,
    challenge: params.focus === null ? null : composed.challenge,
  };
}

export function sanitizeDrills(
  drills: DrillSet,
  params: DrillGenerateParams,
): DrillSet {
  const ids = new Set(params.patterns.map((pattern) => pattern.id));
  const target = params.patterns[0]?.id ?? "";
  const items = drills.items
    .slice(0, params.blocked + params.mixed)
    .map((item, index) => ({
      ...item,
      format: params.format,
      patternId:
        index < params.blocked || !ids.has(item.patternId)
          ? target
          : item.patternId,
    }));
  return { items };
}
