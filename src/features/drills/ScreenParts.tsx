import type { ReactNode } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { cn } from "@/lib/cn";

interface HubScreenProps {
  /** The column of glass: chips, tiles, a metric, the items. */
  aside: ReactNode;
  /** The scene beside it. */
  scene: ReactNode;
}

/**
 * The grammar of Home for a section's own screen: the column of glass on the
 * left and the scene on the right; one under the other when it is narrow.
 */
export function HubScreen({ aside, scene }: HubScreenProps): ReactNode {
  return (
    <main className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
        <Stagger className="flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
          {aside}
        </Stagger>
        <Reveal kind="fade" className="flex min-h-160 min-w-0 flex-1 flex-col">
          {scene}
        </Reveal>
      </div>
    </main>
  );
}

/**
 * The scene a run stands in: the same deep panel as a section's scene, with
 * the run's own frame inside it, so an exercise keeps its focus.
 */
export function RunBackdrop({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="h-full pt-2 pb-4">
      <div className="relative isolate h-full overflow-hidden rounded-2xl border border-line bg-scene">
        {children}
      </div>
    </div>
  );
}

interface RunCardProps {
  children: ReactNode;
  /** Wider, for a run with more beside it. */
  wide?: boolean;
  className?: string;
}

/** The glass card a step of a run is on, centred on the scene. */
export function RunCard({
  children,
  wide = false,
  className,
}: RunCardProps): ReactNode {
  return (
    <div
      className={cn(
        "mx-auto w-full rounded-2xl glass px-6 py-7 nav:px-9",
        wide ? "max-w-3xl" : "max-w-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
