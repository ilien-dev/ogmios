import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

const PAIRS = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink", "you-soft"],
  ["ink", "partner-soft"],
  ["ink", "book-soft"],
  ["ink-soft", "canvas"],
  ["ink-soft", "surface"],
  ["ink-soft", "raised"],
  ["ink-faint", "surface"],
  ["you", "surface"],
  ["book", "canvas"],
  ["book", "surface"],
  ["book", "book-soft"],
  ["book-ink", "book-soft"],
  ["tally", "tally-soft"],
  ["tally", "surface"],
  ["partner", "partner-soft"],
  ["danger", "surface"],
  ["correct", "surface"],
  ["partial", "surface"],
  ["wrong", "surface"],
  ["known", "surface"],
  ["noun", "surface"],
  ["verb", "surface"],
  ["adjective", "surface"],
  ["adverb", "surface"],
  ["expression", "surface"],
  ["on-kind", "verb"],
  ["ink", "correct-wash"],
  ["ink", "partial-wash"],
  ["ink", "wrong-wash"],
  ["ink-soft", "correct-wash"],
  ["ink-soft", "partial-wash"],
  ["ink-soft", "wrong-wash"],
  ["on-grade", "correct"],
  ["on-grade", "partial"],
  ["on-grade", "wrong"],
] as const;

/** The text between the brace that follows `start` and its closing brace. */
function block(start: string): string {
  const at = css.indexOf(start);
  if (at === -1) throw new Error(`global.css has no ${start}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`${start} is not closed`);
}

function tokens(body: string): Map<string, string> {
  const found: Map<string, string> = new Map();
  for (const m of body.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
    found.set(m[1] ?? "", (m[2] ?? "").trim());
  }
  return found;
}

type Rgb = [number, number, number];

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

/** Linear-light sRGB of a hex or an `oklch()` value. */
function linear(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] ?? "", 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
      toLinear(c / 255),
    ) as Rgb;
  }
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!ok) throw new Error(`cannot read the colour ${value}`);
  const [l, c, h] = [
    Number(ok[1]),
    Number(ok[2]),
    (Number(ok[3]) * Math.PI) / 180,
  ];
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb: Rgb = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  // Out-of-gamut values are shown clipped, so they are measured clipped.
  return rgb.map((x) => toLinear(fromLinear(x))) as Rgb;
}

function luminance(value: string): number {
  const [r, g, b] = linear(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const light = tokens(block("@theme"));
const dark = new Map([...light, ...tokens(block(':root[data-theme="dark"]'))]);

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`every text pair reaches 4.5:1 in the ${name} theme`, () => {
    const failing: string[] = [];
    for (const [fg, bg] of PAIRS) {
      const front = theme.get(fg);
      const back = theme.get(bg);
      if (front === undefined || back === undefined) {
        failing.push(`${fg} on ${bg}: token missing`);
        continue;
      }
      const r = ratio(front, back);
      if (r < 4.5) failing.push(`${fg} on ${bg}: ${r.toFixed(2)}`);
    }
    expect(failing).toEqual([]);
  });
}

/** The hue of an `oklch()` value, in degrees. */
function hue(value: string): number {
  const ok = /^oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(value);
  if (!ok) throw new Error(`cannot read the hue of ${value}`);
  return Number(ok[1]);
}

function apart(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`an adjective is told from a noun by its colour alone in the ${name} theme`, () => {
    const noun = hue(theme.get("noun") ?? "");
    const adjective = hue(theme.get("adjective") ?? "");
    expect(apart(noun, adjective)).toBeGreaterThanOrEqual(90);
  });
}

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`a right answer is green in the ${name} theme`, () => {
    const correct = hue(theme.get("correct") ?? "");
    expect(correct).toBeGreaterThanOrEqual(125);
    expect(correct).toBeLessThanOrEqual(155);
  });
}

const KINDS = ["noun", "verb", "adjective", "adverb", "expression"] as const;

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`every kind of word is told from the others by its colour in the ${name} theme`, () => {
    const close: string[] = [];
    for (const [i, a] of KINDS.entries()) {
      for (const b of KINDS.slice(i + 1)) {
        const d = apart(hue(theme.get(a) ?? ""), hue(theme.get(b) ?? ""));
        if (d < 35) close.push(`${a} and ${b}: ${d.toFixed(0)}°`);
      }
    }
    expect(close).toEqual([]);
  });
}
