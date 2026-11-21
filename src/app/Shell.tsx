import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Ambient } from "@/components/ui/Ambient";
import { UpdateCard } from "@/features/update/UpdateCard";
import { EASE_OUT } from "@/lib/motion";
import { Rail } from "./Rail";
import type { Navigate, Route } from "./routes";
import { showsNav } from "./routes";
import { ScreenStage } from "./ScreenStage";

interface ShellProps {
  route: Route;
  navigate: Navigate;
  /** Out of Settings: back to where it was opened from. */
  onClose: () => void;
  /** Everything that comes back today. */
  due: number;
  /** The screen of the route. */
  children: ReactNode;
}

/**
 * The frame every screen sits in, filling the window: the bar along its top,
 * and the screens taking turns under it, over the ambient light. When it
 * opens, after the intro, the bar drops in and the screen rises out of the
 * depth the mark flew away into.
 */
export function Shell({
  route,
  navigate,
  onClose,
  due,
  children,
}: ShellProps): ReactNode {
  return (
    <div className="relative isolate flex h-full flex-col gap-2 overflow-hidden bg-frame p-4 pb-0 perspective-distant">
      <Ambient />
      <motion.div
        className="relative z-20 shrink-0"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
      >
        <Rail route={route} navigate={navigate} onClose={onClose} due={due} />
      </motion.div>
      <motion.div
        className="relative flex min-h-0 min-w-0 flex-1 origin-bottom flex-col"
        initial={{ opacity: 0, z: -260, rotateX: 14 }}
        animate={{ opacity: 1, z: 0, rotateX: 0 }}
        transition={{ duration: 0.7, delay: 0.08, ease: EASE_OUT }}
      >
        <ScreenStage route={route}>{children}</ScreenStage>
        <UpdateCard shown={showsNav(route)} />
      </motion.div>
    </div>
  );
}
