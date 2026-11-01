import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";

/**
 * The owner's rule, held by the compiler's own reading of the code: everything
 * that enters or leaves the interface does so animated. CSS cannot animate
 * what React unmounts, so a choice between elements has to be made inside
 * something that keeps the old one on screen until its exit ends.
 *
 * What counts is a choice in JSX: `&&`, `||`, `??` or `?:` with an element on
 * one side, and `if (...) return` of an element in a component. It is in order
 * when:
 * - it is the direct child of a `Presence` and every element it can give
 *   animates by itself;
 * - it is the direct child of one of `CARRIERS`, or of a `Reveal` whose key
 *   reads the same condition: the whole of it is swapped by name;
 * - it is handed on (a prop, a variable, a return) and every element it can
 *   give animates by itself, so whatever shows it can carry it out;
 * - all it does is pick how an item of a list is drawn (`.map`);
 * - it gives an element with a `layoutId`: that one travels, it never appears;
 * - it is an early return in a component that is only ever drawn inside one of
 *   those swaps, or that gives the same root element as the component's last
 *   return, which React keeps;
 * - it is in one of `ROUTERS`, which pick a screen by its route.
 * Sitting under a `Presence` further up is not enough: that one only sees its
 * own children.
 *
 * Two more things are held to the same rule: an `if (...) return` inside the
 * callback of a `.map`, and a list drawn from state its own file changes on a
 * learner's action (a setter used outside an effect), whose rows have to be
 * animated direct children of a `Presence`.
 *
 * What the guard cannot read: whether a carrier's name really changes with the
 * choice, and what a component returning `null` was showing. Those are for
 * review.
 */

const ROOT = join(import.meta.dirname, "..");

/** A report's cards never change: what they hold is settled when they show. */
const SETTLED = /^src\/features\/report\/cards\/.*/u;
const SETTLED_ROOTS = new Set(["card", "item"]);

/** Hold a choice as `Presence` does: they key their child themselves. */
const CARRIERS = new Set(["Presence", "Swap", "SittingStage", "Glyph"]);

/** `screenKey` names everything these choose by, so `ScreenStage` swaps them. */
const ROUTERS = new Set([
  "src/app/App.tsx",
  "src/features/books/BooksScreen.tsx",
  "src/features/books/SittingScreen.tsx",
  "src/features/listening/ListeningScreen.tsx",
  "src/features/recall/RecallScreen.tsx",
  "src/features/structures/StructuresScreen.tsx",
]);

/** Not an appearance: the browser draws these only when the control opens. */
const NOT_DRAWN = new Set(["option"]);

interface Allowance {
  file: string;
  /** The text of each condition, as the source has it. */
  when: string | readonly string[];
  why: string;
}

/**
 * What is fixed for as long as the thing around it shows: it can only come in
 * and go out with the `Reveal` that holds it. A condition that can change
 * while its screen shows never goes here.
 */
const ALLOWED: readonly Allowance[] = [
  {
    file: "src/features/progress/SessionList.tsx",
    when: "session.hasReport",
    why: "A session keeps or lacks its report for as long as its row shows.",
  },
  {
    file: "src/features/books/BookCover.tsx",
    when: "book.author !== null",
    why: "A book's author: fixed for the cover, which is drawn whole.",
  },
  {
    file: "src/features/progress/WeeklyBars.tsx",
    when: "i % 2 === lastIndex % 2",
    why: "Which bars carry a label: arithmetic on their place, never a change.",
  },
  {
    file: "src/components/ui/Notice.tsx",
    when: "icon !== undefined",
    why: "Fixed by whoever writes the notice, whose own Reveal carries it.",
  },
  {
    file: "src/components/ui/Orb.tsx",
    when: "follow",
    why: "The glow is part of an orb that follows: decided at mount by its props.",
  },
  {
    file: "src/app/TopBar.tsx",
    when: "text !== undefined",
    why: "A pill has its label or has not, for as long as the bar shows.",
  },
  {
    file: "src/features/books/WordRow.tsx",
    when: ["word.done", "word.strength !== null", "word.half === null"],
    why: "A word's standing changes on another route; known, its row leaves whole. Rows are thousands: each Presence here costs a mount.",
  },
  {
    file: "src/features/books/SittingItem.tsx",
    when: "blanked",
    why: "Set by the question, and the question is swapped by SittingStage.",
  },
  {
    file: "src/features/books/TranslateRows.tsx",
    when: "parts === undefined",
    why: "Plain or learned, a sentence is fixed for the row whose Reveal holds it.",
  },
];

/** How many allowances there can be before detection has to get finer. */
const ALLOWED_CAP = 9;

interface Source {
  file: string;
  tree: ts.SourceFile;
}

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => `${dir}/${name.split(sep).join("/")}`);
}

function parse(file: string): Source {
  const text = readFileSync(join(ROOT, file), "utf8");
  return {
    file,
    tree: ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  };
}

const screens = ["src/features", "src/app", "src/components"]
  .flatMap((dir) => sourcesUnder(dir))
  .map((file) => parse(file));

const everything = sourcesUnder("src").map((file) => parse(file));

type Element = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

function isElement(node: ts.Node): node is Element {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

function tagOf(node: Element): string {
  if (ts.isJsxFragment(node)) {
    return "<>";
  }
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  return opening.tagName.getText();
}

const CHOOSING = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function isChoice(
  node: ts.Node,
): node is ts.ConditionalExpression | ts.BinaryExpression {
  return (
    ts.isConditionalExpression(node) ||
    (ts.isBinaryExpression(node) && CHOOSING.has(node.operatorToken.kind))
  );
}

function unwrapped(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrapped(node.expression) : node;
}

/** The elements a choice can give; none, if it only chooses between values. */
function given(node: ts.Expression): Element[] {
  const bare = unwrapped(node);
  if (isElement(bare)) {
    return [bare];
  }
  if (ts.isConditionalExpression(bare)) {
    return [...given(bare.whenTrue), ...given(bare.whenFalse)];
  }
  if (ts.isBinaryExpression(bare) && isChoice(bare)) {
    return [...given(bare.left), ...given(bare.right)];
  }
  return [];
}

function conditionOf(node: ts.Node): string {
  const text = ts.isConditionalExpression(node)
    ? node.condition.getText()
    : ts.isBinaryExpression(node)
      ? node.left.getText()
      : ts.isIfStatement(node)
        ? node.expression.getText()
        : node.getText();
  return text.replaceAll(/\s+/gu, " ");
}

function resultsOf(body: ts.Node): ts.Expression[] {
  const results: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      results.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return results;
}

/** What each component in the app gives back at its root. */
function componentRoots(): Map<string, string[]> {
  const roots: Map<string, string[]> = new Map();
  for (const { tree } of everything) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name !== undefined &&
        /^[A-Z]/u.test(node.name.text) &&
        node.body !== undefined
      ) {
        roots.set(
          node.name.text,
          resultsOf(node.body)
            .flatMap((result) => given(result))
            .map((element) => tagOf(element)),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return roots;
}

const ROOTS = componentRoots();

function isAnimated(tag: string, seen: Set<string> = new Set()): boolean {
  if (tag === "Reveal" || tag === "Swap" || tag.startsWith("motion.")) {
    return true;
  }
  const roots = ROOTS.get(tag);
  if (roots === undefined || roots.length === 0 || seen.has(tag)) {
    return false;
  }
  seen.add(tag);
  return roots.every((root) => isAnimated(root, seen));
}

interface Finding {
  file: string;
  line: number;
  when: string;
  tag: string;
  kind: string;
}

function isOuterChoice(node: ts.Node): boolean {
  let parent = node.parent;
  while (ts.isParenthesizedExpression(parent)) {
    parent = parent.parent;
  }
  return !isChoice(parent);
}

function spot(node: ts.Node): ts.Node {
  let parent = node.parent;
  while (ts.isParenthesizedExpression(parent)) {
    parent = parent.parent;
  }
  return parent;
}

function holderOf(node: ts.JsxExpression): string | null {
  const holder = node.parent;
  if (ts.isJsxElement(holder) || ts.isJsxFragment(holder)) {
    return tagOf(holder);
  }
  return null;
}

function attributeOf(element: Element, name: string): ts.JsxAttribute | null {
  if (ts.isJsxFragment(element)) {
    return null;
  }
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return (
    opening.attributes.properties
      .filter((attribute) => ts.isJsxAttribute(attribute))
      .find((attribute) => attribute.name.getText() === name) ?? null
  );
}

/** A `Reveal` named after what it holds: a new name swaps it. */
function namedKey(element: ts.Node): string | null {
  if (!ts.isJsxElement(element) || tagOf(element) !== "Reveal") {
    return null;
  }
  const key = attributeOf(element, "key")?.initializer;
  return key !== undefined && ts.isJsxExpression(key) ? key.getText() : null;
}

/** Everything drawn right inside a swap: the swap carries all it returns. */
function carriedComponents(): Set<string> {
  const carried: Set<string> = new Set();
  for (const { tree } of everything) {
    const visit = (node: ts.Node): void => {
      if (isElement(node) && /^[A-Z]/u.test(tagOf(node))) {
        const holder = ts.findAncestor(node.parent, (each) => isElement(each));
        if (
          holder !== undefined &&
          (CARRIERS.has(tagOf(holder as Element)) || namedKey(holder) !== null)
        ) {
          carried.add(tagOf(node));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return carried;
}

const CARRIED = carriedComponents();

/** Whether a choice only says how an item of a mapped list is drawn. */
function drawsAnItem(node: ts.Node): boolean {
  const holder = spot(node);
  const callback = ts.isArrowFunction(holder)
    ? holder
    : ts.isReturnStatement(holder)
      ? ts.findAncestor(holder, ts.isArrowFunction)
      : undefined;
  const call = callback?.parent;
  return (
    call !== undefined &&
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "map"
  );
}

function unanimated(elements: readonly Element[]): Element | undefined {
  return elements.find(
    (element) =>
      !isAnimated(tagOf(element)) &&
      !NOT_DRAWN.has(tagOf(element)) &&
      attributeOf(element, "layoutId") === null,
  );
}

function travels(elements: readonly Element[]): boolean {
  return elements.every((element) => attributeOf(element, "layoutId") !== null);
}

/** The leftmost name of each thing a condition reads. */
function rootsRead(node: ts.Node): string[] {
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    return rootsRead(node.expression);
  }
  if (ts.isIdentifier(node)) {
    return node.text === "undefined" ? [] : [node.text];
  }
  const roots: string[] = [];
  ts.forEachChild(node, (child) => {
    roots.push(...rootsRead(child));
  });
  return roots;
}

function isSettled(file: string, node: ts.Node): boolean {
  const condition = ts.isConditionalExpression(node)
    ? node.condition
    : ts.isBinaryExpression(node)
      ? node.left
      : node;
  return (
    SETTLED.test(file) &&
    rootsRead(condition).every((root) => SETTLED_ROOTS.has(root))
  );
}

function findingAt(
  { file, tree }: Source,
  node: ts.Node,
  tag: string,
  kind: string,
): Finding {
  return {
    file,
    line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    when: conditionOf(node),
    tag,
    kind,
  };
}

function auditChoice(
  source: Source,
  node: ts.ConditionalExpression | ts.BinaryExpression,
): Finding[] {
  const elements = given(node);
  if (elements.length === 0) {
    return [];
  }
  const loose = unanimated(elements);
  const holder = spot(node);
  if (!ts.isJsxExpression(holder) || ts.isJsxAttribute(holder.parent)) {
    const free = drawsAnItem(node) || ROUTERS.has(source.file);
    return loose === undefined || free
      ? []
      : [findingAt(source, node, tagOf(loose), "handed on, not animated")];
  }
  const held = holderOf(holder);
  const carried =
    (held !== null && CARRIERS.has(held)) ||
    namedKey(holder.parent)?.includes(conditionOf(node)) === true;
  if (!carried && !travels(elements) && !isSettled(source.file, node)) {
    const first = elements[0] as Element;
    return [findingAt(source, node, tagOf(first), `bare in <${held}>`)];
  }
  if (held === "Presence" && loose !== undefined) {
    return [
      findingAt(source, node, tagOf(loose), "not animated in <Presence>"),
    ];
  }
  return [];
}

function callbackOf(node: ts.CallExpression): ts.ArrowFunction | null {
  const callback = node.arguments[0];
  const mapped =
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "map";
  return mapped && callback !== undefined && ts.isArrowFunction(callback)
    ? callback
    : null;
}

function auditMappedReturns(
  source: Source,
  callback: ts.ArrowFunction,
): Finding[] {
  if (!ts.isBlock(callback.body)) {
    return [];
  }
  return callback.body.statements.filter(ts.isIfStatement).flatMap((each) => {
    const tags = resultsOf(each.thenStatement).flatMap((result) =>
      given(result),
    );
    return tags.length === 0
      ? []
      : [findingAt(source, each, tagOf(tags[0] as Element), "return in .map")];
  });
}

/** State this file changes on a learner's action, and what is derived from it. */
function changingState(source: Source): Set<string> {
  const state: Set<string> = new Set();
  const derived: Array<[string, ts.Expression]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (
        ts.isArrayBindingPattern(node.name) &&
        node.initializer.getText().startsWith("useState")
      ) {
        const [value, setter] = node.name.elements;
        if (
          value !== undefined &&
          setter !== undefined &&
          ts.isBindingElement(setter) &&
          ts.isBindingElement(value) &&
          firedByLearner(source.tree, setter.name.getText())
        ) {
          state.add(value.name.getText());
        }
      } else if (ts.isIdentifier(node.name)) {
        derived.push([node.name.text, node.initializer]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  for (const [name, value] of derived) {
    if (rootsRead(value).some((root) => state.has(root))) {
      state.add(name);
    }
  }
  return state;
}

function firedByLearner(tree: ts.SourceFile, setter: string): boolean {
  let fired = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText() === "useEffect"
    ) {
      return;
    }
    if (ts.isCallExpression(node) && node.expression.getText() === setter) {
      fired = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return fired;
}

function auditMappedList(
  source: Source,
  node: ts.CallExpression,
  callback: ts.ArrowFunction,
  state: Set<string>,
): Finding[] {
  const list = (node.expression as ts.PropertyAccessExpression).expression;
  const holder = spot(node);
  if (
    !ts.isJsxExpression(holder) ||
    ts.isJsxAttribute(holder.parent) ||
    !rootsRead(list).some((root) => state.has(root)) ||
    ts.isBlock(callback.body)
  ) {
    return [];
  }
  const rows = given(callback.body);
  const loose = rows.length === 0 ? undefined : unanimated(rows);
  if (loose !== undefined) {
    return [findingAt(source, node, tagOf(loose), "mapped row not animated")];
  }
  return rows.length > 0 && holderOf(holder) !== "Presence"
    ? [findingAt(source, node, tagOf(rows[0] as Element), "mapped row bare")]
    : [];
}

function audit(source: Source): Finding[] {
  const findings: Finding[] = [];
  const state = changingState(source);
  const visit = (node: ts.Node): void => {
    if (isChoice(node) && isOuterChoice(node)) {
      findings.push(...auditChoice(source, node));
    }
    if (ts.isCallExpression(node)) {
      const callback = callbackOf(node);
      if (callback !== null) {
        findings.push(
          ...auditMappedReturns(source, callback),
          ...auditMappedList(source, node, callback, state),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return findings;
}

/** `if (...) return <X />` in a component: X replaces all that comes after. */
function auditEarlyReturns(source: Source): Finding[] {
  const findings: Finding[] = [];
  if (ROUTERS.has(source.file)) {
    return findings;
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      /^[A-Z]/u.test(node.name.text) &&
      node.body !== undefined &&
      !CARRIED.has(node.name.text)
    ) {
      const last = resultsOf(node.body)
        .flatMap((result) => given(result))
        .at(-1);
      for (const statement of node.body.statements) {
        if (ts.isIfStatement(statement)) {
          const loose = unanimated(
            resultsOf(statement.thenStatement)
              .flatMap((result) => given(result))
              .filter(
                (element) =>
                  last === undefined || tagOf(element) !== tagOf(last),
              ),
          );
          if (loose !== undefined) {
            findings.push(
              findingAt(source, statement, tagOf(loose), "early return"),
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return findings;
}

function covers(allowance: Allowance, finding: Finding): boolean {
  return (
    allowance.file === finding.file &&
    [allowance.when].flat().includes(finding.when)
  );
}

function isAllowed(finding: Finding): boolean {
  return ALLOWED.some((allowance) => covers(allowance, finding));
}

function described(finding: Finding): string {
  return `${finding.file}:${finding.line} ${finding.kind}: <${finding.tag}> when ${finding.when}`;
}

const findings = screens.flatMap((source) => [
  ...audit(source),
  ...auditEarlyReturns(source),
]);

function matching(pattern: RegExp): string[] {
  return everything
    .filter(({ tree }) => pattern.test(tree.text))
    .map(({ file }) => file);
}

describe("the motion rule", () => {
  test("no screen keeps a CSS entrance", () => {
    expect(matching(/motion-safe:animate-(?:rise|enter|lift|fade)/u)).toEqual(
      [],
    );
  });

  test("no retired look survives", () => {
    expect(
      matching(/bg-hero|bg-partner-panel|bg-glow|bg-voices|Waveform/u),
    ).toEqual([]);
  });

  test("conditional JSX in a screen goes through Presence", () => {
    expect(
      findings
        .filter((finding) => !isAllowed(finding))
        .map((finding) => described(finding)),
    ).toEqual([]);
  });

  test("every allowance still answers a real finding", () => {
    expect(
      ALLOWED.filter(
        (allowance) =>
          ![allowance.when]
            .flat()
            .every((when) =>
              findings.some((finding) =>
                covers({ ...allowance, when }, finding),
              ),
            ),
      ),
    ).toEqual([]);
  });

  test("the list of allowances stays short", () => {
    expect(ALLOWED.length).toBeLessThanOrEqual(ALLOWED_CAP);
  });
});
