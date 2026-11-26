import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

/** The declarations of the first rule whose selector ends in `end`. */
function rule(end: string): string {
  const at = css.indexOf(end);
  if (at === -1) {
    throw new Error(`global.css has no ${end}`);
  }
  const open = css.indexOf("{", at + end.length);
  return css.slice(open + 1, css.indexOf("}", open));
}

/** How far a control rises under the pointer, in px. */
function rise(): number {
  const found = /translate: 0 -(\d+)px;/u.exec(rule("):hover"));
  if (found === null) {
    throw new Error("a control under the pointer does not rise");
  }
  return Number(found[1]);
}

// A control that rises leaves the pointer resting on its lower edge outside
// it: the hover ends, it drops back under the pointer, and it flickers for as
// long as the pointer stays there. What it takes the pointer on must reach
// down as far as it rose.
test("a button that rises under the pointer keeps the pointer", () => {
  const reach = rule("):hover::after");
  expect(reach).toContain('content: "";');
  expect(reach).toContain("position: absolute;");
  expect(reach).toContain(`inset: 0 0 -${rise()}px 0;`);
  expect(css).toMatch(
    /\n {2}button,\r?\n {2}\[role="button"\] \{\r?\n {4}position: relative;/u,
  );
});
