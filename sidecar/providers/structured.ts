import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import type { z } from "zod";

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: string };

/**
 * Validates a model's JSON answer. The API's schema enforcement drops
 * numeric and length bounds, so zod is the check that holds all of them.
 */
export function parseStructured<T>(
  schema: z.ZodType<T>,
  raw: string | null,
): Parsed<T> {
  if (raw === null) {
    return { ok: false, issues: "- no JSON document was returned" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, issues: `- not valid JSON: ${String(error)}` };
  }
  return parseValue(schema, json);
}

export function parseValue<T>(schema: z.ZodType<T>, json: unknown): Parsed<T> {
  const result = schema.safeParse(json);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const issues = result.error.issues
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  return { ok: false, issues };
}

/** The first few issues, for an error message that stays one line long. */
export function firstIssues(issues: string): string {
  return issues.split("\n").slice(0, 3).join("; ");
}

/**
 * The JSON schema both providers hand to Claude: `z.toJSONSchema`, reshaped by
 * the SDK into the subset structured outputs accepts.
 */
export function outputSchema<T>(schema: z.ZodType<T>): Record<string, unknown> {
  return zodOutputFormat(schema).schema;
}
