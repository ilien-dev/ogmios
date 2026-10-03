import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS } from "./updater-manifest";

/**
 * macOS ships for Apple Silicon only. An Intel build was dropped after 0.1.1
 * failed to publish over it: the release runs each bundled sidecar, and the
 * x64 one died under Rosetta on the Apple Silicon runner.
 */
interface Build {
  target: string;
}

const workflow = Bun.YAML.parse(
  readFileSync(
    join(import.meta.dirname, "..", ".github", "workflows", "release.yml"),
    "utf8",
  ),
) as { jobs: { build: { strategy: { matrix: { include: Build[] } } } } };

const targets = workflow.jobs.build.strategy.matrix.include.map(
  (build) => build.target,
);

test("the release builds macOS for Apple Silicon only", () => {
  expect(targets.filter((target) => target.endsWith("-apple-darwin"))).toEqual([
    "aarch64-apple-darwin",
  ]);
});

// `publish` refuses a manifest with a platform missing, so a platform the
// updater expects and nothing builds would leave every release a draft.
test("the release builds every platform the updater manifest lists", () => {
  expect(targets).toHaveLength(Object.keys(ASSETS).length);
});
