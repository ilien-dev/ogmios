import { beforeEach } from "bun:test";
import { i18n } from "@/lib/i18n/i18n";
import { resetMock, setMockLatency } from "@/lib/ipcMock";
import { resetMockBooks } from "@/lib/ipcMockBooks";
import { resetMockChapters } from "@/lib/ipcMockChapters";
import { resetMockListening } from "@/lib/ipcMockListening";
import { resetMockPractice } from "@/lib/ipcMockPractice";
import { resetMockRecall } from "@/lib/ipcMockRecall";
import { resetMockRefresh } from "@/lib/ipcMockRefresh";
import { resetMockSpeech } from "@/lib/ipcMockSpeech";
import { resetMockStructures } from "@/lib/ipcMockStructures";
import { resetMockTranslate } from "@/lib/ipcMockTranslate";
import { setMockUpdate } from "@/lib/ipcMockUpdate";

/**
 * Every component test starts from the same place: the in-memory backend with
 * no delays, a learner at `onboarded` (with one book, if so), no voice to
 * read aloud yet, and the interface in English.
 */
export function useMockBackend(onboarded = true): void {
  beforeEach(async () => {
    setMockLatency(0);
    resetMock(onboarded);
    resetMockBooks(onboarded);
    resetMockChapters();
    resetMockPractice();
    resetMockRefresh();
    resetMockRecall();
    resetMockStructures();
    resetMockListening();
    resetMockTranslate();
    resetMockSpeech();
    setMockUpdate(null);
    await i18n.changeLanguage("en");
  });
}
