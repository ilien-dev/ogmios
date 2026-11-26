import { describe, expect, test } from "bun:test";
import { i18n } from "@/lib/i18n/i18n";

describe("between tests", () => {
  test("one test switches to Spanish", async () => {
    await i18n.changeLanguage("es");
    expect(i18n.language).toBe("es");
  });

  test("the next one starts in English again", () => {
    expect(i18n.language).toBe("en");
  });
});
