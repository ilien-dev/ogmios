import { useIsPresent } from "motion/react";
import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { ScreenLeaving } from "@/lib/motion";
import type { Route } from "./routes";
import { screenKey } from "./routes";

interface ScreenStageProps {
  route: Route;
  children: ReactNode;
}

/**
 * Asked here and handed down, because a `Presence` deeper in the screen would
 * answer for itself, not for the screen.
 */
function Scene({ children }: { children: ReactNode }): ReactNode {
  const present = useIsPresent();
  return (
    <ScreenLeaving.Provider value={!present}>{children}</ScreenLeaving.Provider>
  );
}

/**
 * Where the screens take turns. The new one comes in at once over the old one,
 * which goes on leaving without taking a click or the focus: nothing waits.
 */
export function ScreenStage({ route, children }: ScreenStageProps): ReactNode {
  return (
    <div className="relative min-h-0 flex-1 overflow-clip">
      <Presence>
        <Reveal
          key={screenKey(route)}
          kind="slide"
          className="absolute inset-0"
        >
          <Scene>{children}</Scene>
        </Reveal>
      </Presence>
    </div>
  );
}
