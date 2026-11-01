import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { History, Mic, Shuffle, SlidersHorizontal } from "lucide-react";
import type { HomeState, SessionSetup } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Magnetic } from "@/components/motion/Magnetic";
import { Button } from "@/components/ui/Button";
import { Orb } from "@/components/ui/Orb";
import type { Navigate } from "@/app/routes";
import { useWideHome } from "./homeLayout";
import { TodayLine } from "./TodayLine";

function quickSetup(home: HomeState, topic: string): SessionSetup {
  const last = home.lastSetup;
  if (last === null || (last.mode === "material" && last.material === null)) {
    return {
      topic,
      level: home.profile.level,
      mode: "casual",
      personality: "curiousFriend",
      focusMode: "free",
      targetMinutes: 10,
      material: null,
      continuePrevious: false,
    };
  }
  return { ...last, topic };
}

interface HomeCenterProps {
  home: HomeState;
  navigate: Navigate;
  className?: string;
}

/** The partner, today's topic and the ways into a conversation. */
export function HomeCenter({
  home,
  navigate,
  className,
}: HomeCenterProps): ReactNode {
  const { t } = useTranslation();
  const wide = useWideHome();
  const [topicIndex, setTopicIndex] = useState(0);
  const topics = home.suggestedTopics;
  const topic =
    topics.length > 0
      ? (topics[topicIndex % topics.length] ?? "")
      : (home.lastSetup?.topic ?? "");
  const { continueTopic, focus } = home;
  const name = home.profile.name;

  return (
    <Reveal
      as="section"
      aria-label={t("home.topicLabel")}
      className={className}
    >
      <div className="flex flex-col items-center gap-2 text-center nav:gap-4">
        <Orb size={wide ? "lg" : "md"} shared follow />
        <h1 className="text-lg font-medium text-ink nav:text-2xl">
          {name === null
            ? t("home.greetingAnon")
            : t("home.greeting", { name })}
        </h1>
        <div
          aria-live="polite"
          data-testid="topic"
          className="relative flex min-h-14 w-full items-center nav:min-h-20"
        >
          <Presence swap>
            <Reveal
              key={topic}
              as="p"
              kind="fade"
              index={0}
              className="w-full text-xl font-semibold text-balance text-ink nav:text-title"
            >
              {topic}
            </Reveal>
          </Presence>
        </div>
        <Presence>
          {focus !== null && (
            <Reveal
              key="focus"
              as="p"
              className="max-w-prose text-sm text-balance text-ink-soft"
            >
              {t("home.focusLead")}{" "}
              <span className="font-medium text-ink">{focus.description}</span>
            </Reveal>
          )}
        </Presence>
        <div className="flex flex-wrap items-center justify-center gap-2 nav:flex-col">
          <Magnetic>
            <Button
              variant="primary"
              size={wide ? "lg" : "md"}
              disabled={topic === ""}
              icon={<Mic aria-hidden className="size-4" />}
              onClick={() => {
                navigate({
                  name: "conversation",
                  setup: quickSetup(home, topic),
                });
              }}
            >
              {t("home.start")}
            </Button>
          </Magnetic>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Presence>
              {topics.length > 1 && (
                <Reveal key="topics" as="span" kind="fade">
                  <Button
                    icon={<Shuffle aria-hidden className="size-4" />}
                    onClick={() => {
                      setTopicIndex((held) => held + 1);
                    }}
                  >
                    {t("home.anotherTopic")}
                  </Button>
                </Reveal>
              )}
            </Presence>
            <Button
              icon={<SlidersHorizontal aria-hidden className="size-4" />}
              onClick={() => {
                navigate({ name: "setup", preset: { topic } });
              }}
            >
              {t("home.customize")}
            </Button>
            <Presence>
              {continueTopic !== null && (
                <Reveal key="continueTopic" as="span" kind="fade">
                  <Button
                    icon={<History aria-hidden className="size-4" />}
                    onClick={() => {
                      navigate({
                        name: "conversation",
                        setup: {
                          ...quickSetup(home, continueTopic),
                          continuePrevious: true,
                        },
                      });
                    }}
                  >
                    {t("home.continueLast")}
                  </Button>
                </Reveal>
              )}
            </Presence>
          </div>
        </div>
        <TodayLine home={home} topic={topic} navigate={navigate} />
      </div>
    </Reveal>
  );
}
