import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Profile, Settings } from "@shared/domain";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { BooksScreen } from "@/features/books/BooksScreen";
import { Conversation } from "@/features/conversation/Conversation";
import { Practice } from "@/features/drills/Practice";
import { Home } from "@/features/home/Home";
import { ListeningScreen } from "@/features/listening/ListeningScreen";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { ProgressScreen } from "@/features/progress/ProgressScreen";
import { RecallScreen } from "@/features/recall/RecallScreen";
import { ReportScreen } from "@/features/report/ReportScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { SpeechProvider } from "@/features/speech/speech";
import { Setup } from "@/features/setup/Setup";
import { StructuresScreen } from "@/features/structures/StructuresScreen";
import { errorMessage } from "@/lib/errors";
import { setUiLang } from "@/lib/i18n/i18n";
import { getProfile, getSettings } from "@/lib/ipc";
import { useTheme } from "@/lib/theme";
import type { Route } from "./routes";
import { showsNav } from "./routes";
import { Sidebar } from "./Sidebar";

type Boot =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; profile: Profile | null; settings: Settings };

export function App(): ReactNode {
  const { t } = useTranslation();
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    let live = true;
    Promise.all([getProfile(), getSettings()])
      .then(([profile, settings]) => {
        if (profile !== null) {
          setUiLang(profile.uiLang);
        }
        if (live) {
          setBoot({ state: "ready", profile, settings });
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setBoot({ state: "failed", message: errorMessage(error) });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  if (boot.state === "loading") {
    return (
      <div className="grid h-full place-items-center" aria-busy>
        <p className="flex items-center gap-3 text-sm text-ink-faint">
          <Spinner />
          {t("app.loading")}
        </p>
      </div>
    );
  }
  if (boot.state === "failed") {
    return (
      <div className="grid h-full place-items-center p-8">
        <Notice tone="danger">
          {t("app.loadFailed", { message: boot.message })}
        </Notice>
      </div>
    );
  }

  const { profile, settings } = boot;
  const setProfile = (next: Profile): void => {
    setUiLang(next.uiLang);
    setBoot({ ...boot, profile: next });
  };
  const setSettings = (next: Settings): void => {
    setBoot({ ...boot, settings: next });
  };

  if (profile?.onboarded !== true) {
    return (
      <Onboarding
        settings={settings}
        onDone={(done, nextSettings) => {
          setBoot({ state: "ready", profile: done, settings: nextSettings });
          setRoute({ name: "home" });
        }}
      />
    );
  }

  const screen = (() => {
    switch (route.name) {
      case "home":
        return <Home navigate={setRoute} />;
      case "setup":
        return (
          <Setup profile={profile} preset={route.preset} navigate={setRoute} />
        );
      case "conversation":
        return (
          <Conversation
            setup={route.setup}
            sttModel={settings.sttModel}
            navigate={setRoute}
          />
        );
      case "report":
        return (
          <ReportScreen
            key={route.sessionId}
            sessionId={route.sessionId}
            initial={route.report}
            origin={route.origin}
            navigate={setRoute}
          />
        );
      case "practice":
        return (
          <Practice
            key={`${route.patternId ?? ""}-${route.format ?? ""}-${String(route.autostart)}`}
            patternId={route.patternId}
            format={route.format}
            autostart={route.autostart}
            navigate={setRoute}
          />
        );
      case "books":
        return (
          <BooksScreen
            nativeLang={profile.nativeLang}
            bookId={route.bookId}
            chapterId={route.chapterId ?? null}
            known={route.known === true}
            practising={route.practising === true}
            refresh={route.refresh === true}
            triage={route.triage === true}
            translating={route.translating === true}
            navigate={setRoute}
          />
        );
      case "recall":
        return (
          <RecallScreen
            nativeLang={profile.nativeLang}
            running={route.running ?? null}
            navigate={setRoute}
          />
        );
      case "structures":
        return (
          <StructuresScreen
            running={route.running ?? null}
            chapterId={route.chapterId ?? null}
            bookId={route.bookId ?? null}
            navigate={setRoute}
          />
        );
      case "listening":
        return (
          <ListeningScreen
            running={route.running ?? null}
            reading={route.reading ?? null}
            chapterId={route.chapterId ?? null}
            navigate={setRoute}
          />
        );
      case "progress":
        return <ProgressScreen navigate={setRoute} />;
      case "settings":
        return (
          <SettingsScreen
            profile={profile}
            settings={settings}
            theme={theme}
            onThemeChange={setTheme}
            onProfileChange={setProfile}
            onSettingsChange={setSettings}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <SpeechProvider>
      <div className="flex h-full">
        {showsNav(route) && <Sidebar route={route} navigate={setRoute} />}
        <div className="min-w-0 flex-1">{screen}</div>
      </div>
    </SpeechProvider>
  );
}
