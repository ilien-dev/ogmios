import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";

/**
 * Where the boot states take turns: loading, a failure, the first questions,
 * the app. The next fades in over the last, which leaves inert.
 */
export function BootStage({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="relative h-full">
      <Presence swap>
        <Reveal key={name} kind="fade" className="absolute inset-0">
          {children}
        </Reveal>
      </Presence>
    </div>
  );
}
