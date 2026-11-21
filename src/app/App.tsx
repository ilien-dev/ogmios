import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Profile, Settings } from "@shared/domain";
import { Logo } from "@/components/ui/Logo";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { BookHome } from "@/features/books/BookHome";
import { BooksScreen } from "@/features/books/BooksScreen";
import { chapterOn } from "@/features/books/currentChapter";
import { Conversation } from "@/features/conversation/Conversation";
import { Practice } from "@/features/drills/Practice";
import { Home } from "@/features/home/Home";
import { ListeningScreen } from "@/features/listening/ListeningScreen";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { ProgressScreen } from "@/features/progress/ProgressScreen";
import { RecallRun } from "@/features/recall/RecallRun";
import { ReportScreen } from "@/features/report/ReportScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { SpeechProvider } from "@/features/speech/speech";
import { UpdateProvider } from "@/features/update/update";
import { Setup } from "@/features/setup/Setup";
import { StructureRun } from "@/features/structures/StructureRun";
import { Today } from "@/features/today/Today";
import { errorMessage } from "@/lib/errors";
import { setUiLang } from "@/lib/i18n/i18n";
import { getProfile, getSettings } from "@/lib/ipc";
import { useTheme } from "@/lib/theme";
import type { Route } from "./routes";
import { showsNav } from "./routes";
import { BootStage } from "./BootStage";
import { Shell } from "./Shell";
import { useShelf } from "./useShelf";

/** Where the app opens, and where an activity with nowhere to go back ends. */
const START: Route = { name: "today" };

type Boot =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; profile: Profile | null; settings: Settings };

export function App(): ReactNode {
  const { t } = useTranslation();
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const [route, setRoute] = useState<Route>(START);
  /**
   * The last screen beside the navigation: where an activity, or Settings,
   * goes back to.
   */
  const [origin, setOrigin] = useState<Route>(START);
  const [theme, setTheme] = useTheme();
  const onboarded = boot.state === "ready" && boot.profile?.onboarded === true;
  const { due, books, currentId, loaded, pick } = useShelf(route, onboarded);

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
      <BootStage name="loading">
        <div
          className="flex h-full flex-col items-center justify-center gap-6"
          aria-busy
        >
          <div className="animate-float">
            <Logo className="size-12" />
          </div>
          <p className="flex items-center gap-3 text-sm text-ink-faint">
            <Spinner />
            {t("app.loading")}
          </p>
        </div>
      </BootStage>
    );
  }
  if (boot.state === "failed") {
    return (
      <BootStage name="failed">
        <div className="grid h-full place-items-center p-8">
          <Notice tone="danger" className="max-w-lg">
            {t("app.loadFailed", { message: boot.message })}
          </Notice>
        </div>
      </BootStage>
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
      <BootStage name="onboarding">
        <Onboarding
          settings={settings}
          onDone={(done, nextSettings) => {
            setBoot({ state: "ready", profile: done, settings: nextSettings });
            setRoute(START);
            setOrigin(START);
          }}
        />
      </BootStage>
    );
  }

  const current = chapterOn(books, currentId);
  const navigate = (next: Route): void => {
    if (showsNav(next) && next.name !== "settings") {
      setOrigin(next);
    }
    setRoute(next);
  };
  /** Out of an activity or Settings: back to where it was started from. */
  const leave = (): void => {
    setRoute(origin);
  };

  const screen = (() => {
    switch (route.name) {
      case "today":
        return <Today current={current} navigate={navigate} />;
      case "home":
        return (
          <Home
            settings={settings}
            onSettingsChange={setSettings}
            navigate={navigate}
          />
        );
      case "book":
        return (
          <BookHome
            loaded={loaded}
            books={books}
            current={current}
            tab={route.tab ?? "words"}
            nativeLang={profile.nativeLang}
            navigate={navigate}
            onPick={pick}
          />
        );
      case "setup":
        return (
          <Setup profile={profile} preset={route.preset} navigate={navigate} />
        );
      case "conversation":
        return (
          <Conversation
            setup={route.setup}
            sttModel={settings.sttModel}
            navigate={navigate}
          />
        );
      case "report":
        return (
          <ReportScreen
            sessionId={route.sessionId}
            initial={route.report}
            origin={route.origin}
            navigate={navigate}
          />
        );
      case "practice":
        return (
          <Practice
            patternId={route.patternId}
            format={route.format}
            navigate={navigate}
            onLeave={leave}
          />
        );
      case "books":
        return (
          <BooksScreen
            nativeLang={profile.nativeLang}
            shelf={books}
            bookId={route.bookId}
            chapterId={route.chapterId ?? null}
            practising={route.practising === true}
            refresh={route.refresh === true}
            triage={route.triage === true}
            translating={route.translating ?? null}
            navigate={navigate}
            onPick={pick}
          />
        );
      case "recall":
        return (
          <RecallRun
            ways={route.running}
            nativeLang={profile.nativeLang}
            onDone={leave}
          />
        );
      case "structures":
        return (
          <StructureRun
            key={route.running}
            sittingId={route.running}
            onLeave={leave}
            onAgain={(next) => {
              navigate({ name: "structures", running: next });
            }}
          />
        );
      case "listening":
        return (
          <ListeningScreen
            running={route.running ?? null}
            reading={route.reading ?? null}
            navigate={navigate}
            onLeave={leave}
          />
        );
      case "progress":
        return (
          <ProgressScreen
            tab={route.tab ?? "words"}
            nativeLang={profile.nativeLang}
            navigate={navigate}
          />
        );
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
    <BootStage name="app">
      <SpeechProvider>
        <UpdateProvider>
          <Shell route={route} navigate={navigate} onClose={leave} due={due}>
            {screen}
          </Shell>
        </UpdateProvider>
      </SpeechProvider>
    </BootStage>
  );
}
