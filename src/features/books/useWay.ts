import { useTranslation } from "react-i18next";
import type { TranslationDirection } from "@shared/domain";
import { languageName } from "@/lib/text";

/** "English → Spanish", or the other way, in the interface language. */
export function useWay(
  direction: TranslationDirection,
  native: string,
): string {
  const { t, i18n } = useTranslation();
  const english = languageName("en", i18n.language);
  const [from, to] =
    direction === "toNative" ? [english, native] : [native, english];
  return t("books.sitting.direction", { from, to });
}
