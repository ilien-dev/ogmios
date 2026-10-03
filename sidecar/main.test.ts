import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  analysisSchema,
  composedSchema,
  drillGradeSchema,
  drillSetSchema,
  helpResultSchema,
  selfCheckSchema,
} from "../shared/protocol.ts";
import type { Outgoing } from "../shared/protocol.ts";

const MAIN = join(import.meta.dir, "main.ts");

/**
 * Runs the real sidecar process, writes `requests` to its stdin as JSON
 * lines, closes stdin and returns every line it printed on stdout.
 */
async function exchange(requests: unknown[], fake = true): Promise<Outgoing[]> {
  const child = Bun.spawn([process.execPath, MAIN], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, OGMIOS_FAKE: fake ? "1" : "0" },
  });
  for (const request of requests) {
    await child.stdin.write(
      typeof request === "string"
        ? `${request}\n`
        : `${JSON.stringify(request)}\n`,
    );
  }
  await child.stdin.end();
  const stdout = await new Response(child.stdout).text();
  await child.exited;
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Outgoing);
}

function responseFor(lines: Outgoing[], id: number): Outgoing | undefined {
  return lines.find((line) => line.id === id && !("event" in line));
}

const context = {
  setup: {
    topic: "my job",
    level: "intermediate",
    mode: "casual",
    personality: "curiousFriend",
    focusMode: "free",
    targetMinutes: 10,
    material: null,
  },
  learner: {
    name: "Ana",
    nativeLang: "es",
    goal: "work",
    variant: "us",
    interests: ["cycling"],
    facts: [],
    cefr: null,
  },
  targets: [],
  challenge: null,
};

const drillItem = {
  format: "transformation",
  patternId: "p1",
  prompt: "I go to Paris last year.",
  instruction: "Corrige la frase.",
  options: [],
  answer: "I went to Paris last year.",
};

const requests = [
  { id: 1, method: "check", params: null },
  {
    id: 2,
    method: "chat",
    params: { context, history: [], providerRef: null },
  },
  {
    id: 3,
    method: "help",
    params: {
      nativeLang: "es",
      text: "tengo ganas",
      recent: "Hi!",
      variant: "us",
    },
  },
  {
    id: 4,
    method: "analyze",
    params: {
      level: "intermediate",
      cefr: null,
      nativeLang: "es",
      goal: "work",
      variant: "us",
      turns: [
        { id: "t1", role: "assistant", said: null, sent: "How was your week?" },
        {
          id: "t2",
          role: "user",
          said: "I go to Paris",
          sent: "I goed to Paris last week",
        },
      ],
      patterns: [
        { id: "p1", key: "past_simple", description: "Pasado simple" },
      ],
      challenge: null,
    },
  },
  {
    id: 5,
    method: "compose",
    params: {
      nativeLang: "es",
      level: "intermediate",
      corrections: [
        {
          itemId: "i1",
          original: "I goed to Paris",
          corrected: "I went to Paris",
          kind: "grammarRule",
          patternDescription: "Pasado simple",
        },
      ],
      focus: { description: "Pasado simple", example: "I went" },
    },
  },
  {
    id: 6,
    method: "selfCheck",
    params: {
      nativeLang: "es",
      original: "I goed",
      corrected: "I went",
      attempt: "I went",
    },
  },
  {
    id: 7,
    method: "drillGenerate",
    params: {
      nativeLang: "es",
      level: "intermediate",
      format: "spotError",
      patterns: [
        { id: "p1", description: "Pasado simple", examples: [] },
        { id: "p2", description: "Artículos", examples: [] },
      ],
      blocked: 3,
      mixed: 2,
    },
  },
  {
    id: 8,
    method: "drillGrade",
    params: {
      nativeLang: "es",
      item: drillItem,
      response: "I went to Paris last year.",
    },
  },
];

describe("sidecar over stdio (fake provider)", () => {
  test("answers every method with output that passes its schema", async () => {
    const lines = await exchange(requests);

    expect(responseFor(lines, 1)).toEqual({
      id: 1,
      result: { ok: true, message: null },
    });

    const deltas = lines.flatMap((line) =>
      line.id === 2 && "event" in line ? [line.text] : [],
    );
    const chat = responseFor(lines, 2);
    expect(deltas.length).toBeGreaterThan(0);
    expect(chat).toMatchObject({ result: { text: deltas.join("") } });

    const schemas = {
      3: helpResultSchema,
      4: analysisSchema,
      5: composedSchema,
      6: selfCheckSchema,
      7: drillSetSchema,
      8: drillGradeSchema,
    };
    for (const [id, schema] of Object.entries(schemas)) {
      const response = responseFor(lines, Number(id));
      expect(response && "result" in response).toBe(true);
      if (response && "result" in response) {
        expect(schema.safeParse(response.result).success).toBe(true);
      }
    }
  });

  test("lists the configured provider's models", async () => {
    const lines = await exchange([{ id: 1, method: "models", params: null }]);
    expect(lines).toEqual([
      {
        id: 1,
        result: expect.arrayContaining([
          expect.objectContaining({ id: "haiku", efforts: [] }),
        ]),
      },
    ]);
  });

  test("writes nothing but protocol lines on stdout", async () => {
    const lines = await exchange([{ id: 1, method: "check", params: null }]);
    expect(lines).toHaveLength(1);
  });

  test("keeps each id's events and response together under concurrency", async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      id: 100 + index,
      method: "chat",
      params: { context, history: [], providerRef: null },
    }));
    const lines = await exchange(many);
    for (const request of many) {
      expect(responseFor(lines, request.id)).toBeDefined();
    }
    expect(lines.filter((line) => !("event" in line))).toHaveLength(10);
  });

  test("the fake analysis echoes ids from the request", async () => {
    const lines = await exchange([requests[3]]);
    const response = responseFor(lines, 4);
    const analysis =
      response && "result" in response
        ? analysisSchema.parse(response.result)
        : null;
    expect(analysis?.errors[0]?.turnId).toBe("t2");
    expect(analysis?.errors[0]?.pattern.existingId).toBe("p1");
  });

  test("the fake drill set honours blocked and mixed", async () => {
    const lines = await exchange([requests[6]]);
    const response = responseFor(lines, 7);
    const drills =
      response && "result" in response
        ? drillSetSchema.parse(response.result)
        : null;
    expect(drills?.items).toHaveLength(5);
    expect(
      drills?.items.slice(0, 3).every((item) => item.patternId === "p1"),
    ).toBe(true);
    expect(drills?.items[0]?.options.length).toBeGreaterThan(1);
  });
});

describe("sidecar errors", () => {
  test("rejects invalid params with a readable message", async () => {
    const lines = await exchange([
      { id: 1, method: "help", params: { nativeLang: "es" } },
      {
        id: 2,
        method: "chat",
        params: {
          context,
          history: [{ role: "assistant", text: "Hi" }],
          providerRef: null,
        },
      },
      { id: 3, method: "nope", params: {} },
    ]);
    expect(responseFor(lines, 1)).toMatchObject({
      error: { kind: "invalid", message: expect.stringContaining("help") },
    });
    expect(responseFor(lines, 2)).toMatchObject({
      error: {
        kind: "invalid",
        message: expect.stringContaining("learner's turn"),
      },
    });
    expect(responseFor(lines, 3)).toMatchObject({
      error: { kind: "invalid", message: "Unknown method: nope" },
    });
  });

  test("skips lines that are not requests and keeps going", async () => {
    const lines = await exchange([
      "not json",
      '{"no":"id"}',
      { id: 9, method: "check", params: null },
    ]);
    expect(lines).toEqual([{ id: 9, result: { ok: true, message: null } }]);
  });

  test("refuses work before configure without the fake", async () => {
    const lines = await exchange(
      [
        { id: 1, method: "check", params: null },
        {
          id: 2,
          method: "configure",
          params: {
            mode: "apiKey",
            model: "claude-sonnet-5",
            effort: null,
            apiKey: null,
            claudePath: null,
          },
        },
        {
          id: 3,
          method: "configure",
          params: {
            mode: "claudeCode",
            model: "claude-sonnet-5",
            effort: null,
            apiKey: null,
            claudePath: "/nonexistent/claude",
          },
        },
        { id: 4, method: "check", params: null },
      ],
      false,
    );
    expect(responseFor(lines, 1)).toMatchObject({ error: { kind: "invalid" } });
    expect(responseFor(lines, 2)).toMatchObject({
      error: { kind: "invalid", message: expect.stringContaining("API key") },
    });
    expect(responseFor(lines, 3)).toEqual({ id: 3, result: null });
    expect(responseFor(lines, 4)).toMatchObject({
      result: { ok: false, message: expect.stringContaining("not found") },
    });
  });
});
