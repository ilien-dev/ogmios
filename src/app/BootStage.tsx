import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Ambient } from "@/components/ui/Ambient";

/**
 * Where the boot states take turns: loading, a failure, the first questions,
 * the app. The next fades in over the last, which leaves inert. Until the app
 * comes, which brings its own, the ambient light drifts behind them, outside
 * the swap so it goes on drifting from one to the next.
 */
export function BootStage({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="relative isolate h-full bg-canvas">
      <Presence>
        {name !== "app" && (
          <Reveal
            key="ambient"
            kind="fade"
            className="pointer-events-none absolute inset-0"
          >
            <Ambient />
          </Reveal>
        )}
      </Presence>
      <Presence swap>
        <Reveal key={name} kind="fade" className="absolute inset-0">
          {children}
        </Reveal>
      </Presence>
    </div>
  );
}
