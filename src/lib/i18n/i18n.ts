import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import type { UiLang } from "@shared/domain";
import { en } from "./en";
import { es } from "./es";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}

/**
 * One i18next instance for the app. Starts in English; `setUiLang` switches
 * it once the profile says otherwise.
 */
export const i18n = createInstance();

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function setUiLang(lang: UiLang): void {
  if (i18n.language !== lang) {
    void i18n.changeLanguage(lang);
  }
  document.documentElement.lang = lang;
}
