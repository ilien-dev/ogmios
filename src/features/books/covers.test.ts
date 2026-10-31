import { describe, expect, mock, test } from "bun:test";
import type { CoverSources } from "./covers";
import { findCover } from "./covers";

const IMAGE = new Uint8Array([1, 2, 3]).buffer;
const EMPTY = new ArrayBuffer(0);

function sources(overrides: Partial<CoverSources>): CoverSources {
  return {
    kept: () => Promise.resolve(EMPTY),
    pdf: () => Promise.resolve(EMPTY),
    draw: () => Promise.resolve(IMAGE),
    save: () => Promise.resolve(),
    ...overrides,
  };
}

describe("findCover", () => {
  test("a kept cover is used as it is", async () => {
    const draw = mock(() => Promise.resolve(IMAGE));
    const found = await findCover(
      "b",
      sources({ kept: () => Promise.resolve(IMAGE), draw }),
    );
    expect(found).toBe(IMAGE);
    expect(draw).not.toHaveBeenCalled();
  });

  test("a PDF draws its first page once, and keeps it", async () => {
    const save = mock(() => Promise.resolve());
    const found = await findCover(
      "b",
      sources({ pdf: () => Promise.resolve(new ArrayBuffer(8)), save }),
    );
    expect(found).toBe(IMAGE);
    expect(save).toHaveBeenCalledWith("b", IMAGE);
  });

  test("a book with neither has no cover", async () => {
    expect(await findCover("b", sources({}))).toBeNull();
  });

  test("a page that cannot be drawn leaves the book without a cover", async () => {
    const found = await findCover(
      "b",
      sources({
        pdf: () => Promise.resolve(new ArrayBuffer(8)),
        draw: () => Promise.reject(new Error("broken")),
      }),
    );
    expect(found).toBeNull();
  });
});
