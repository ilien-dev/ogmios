import type { ReactNode } from "react";
import { Ambient } from "@/components/ui/Ambient";
import { UpdateCard } from "@/features/update/UpdateCard";
import { Rail } from "./Rail";
import type { Navigate, Route } from "./routes";
import { showsNav } from "./routes";
import { ScreenStage } from "./ScreenStage";

interface ShellProps {
  route: Route;
  navigate: Navigate;
  /** Everything that comes back today. */
  due: number;
  /** The screen of the route. */
  children: ReactNode;
}

/**
 * The frame every screen sits in, over the canvas: the bar along its top, and
 * the screens taking turns under it, over the ambient light.
 */
export function Shell({
  route,
  navigate,
  due,
  children,
}: ShellProps): ReactNode {
  return (
    <div className="h-full bg-canvas p-3">
      <div className="relative isolate flex h-full flex-col gap-2 overflow-hidden rounded-3xl border border-line bg-frame p-4 pb-0">
        <Ambient />
        <Rail route={route} navigate={navigate} due={due} />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <ScreenStage route={route}>{children}</ScreenStage>
          <UpdateCard shown={showsNav(route)} />
        </div>
      </div>
    </div>
  );
}
