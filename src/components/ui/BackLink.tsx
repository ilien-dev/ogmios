import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "./Button";

interface BackLinkProps {
  /** Where it leads, by name. */
  label: string;
  onClick: () => void;
}

/** The way back from a screen to the one it was opened from. */
export function BackLink({ label, onClick }: BackLinkProps): ReactNode {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="group -ml-3 self-start"
      icon={
        <ArrowLeft
          aria-hidden
          className="size-4 transition-transform duration-150 group-hover:-translate-x-0.5"
        />
      }
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
