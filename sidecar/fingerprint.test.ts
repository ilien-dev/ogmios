import { describe, expect, test } from "bun:test";

import { fingerprintOf, protocolFingerprint } from "./fingerprint.ts";

describe("the protocol fingerprint", () => {
  // `agent/mod.rs` asserts the same numbers: the two must hash alike.
  test("is the FNV-1a of the text", () => {
    expect(fingerprintOf("")).toBe(2_166_136_261);
    expect(fingerprintOf("a")).toBe(3_826_002_220);
    expect(fingerprintOf("foobar")).toBe(3_214_735_720);
  });

  test("does not depend on how the lines end", () => {
    expect(fingerprintOf("a\r\nb")).toBe(fingerprintOf("a\nb"));
  });

  test("counts a character outside ASCII by its bytes", () => {
    expect(fingerprintOf("é")).toBe(513_665_217);
  });

  test("is that of `shared/protocol.ts`", async () => {
    const text = await Bun.file(
      new URL("../shared/protocol.ts", import.meta.url),
    ).text();
    expect(protocolFingerprint()).toBe(fingerprintOf(text));
  });
});
