import { beforeEach } from "bun:test";
import { i18n } from "@/lib/i18n/i18n";
import { resetMock, setMockLatency } from "@/lib/ipcMock";
import { setMockUpdate } from "@/lib/ipcMockUpdate";

/**
 * Every component test starts from the same place: the in-memory backend with
 * no delays, a learner at `onboarded`, and the interface in English.
 */
export function useMockBackend(onboarded = true): void {
  beforeEach(async () => {
    setMockLatency(0);
    resetMock(onboarded);
    setMockUpdate(null);
    await i18n.changeLanguage("en");
  });
}
