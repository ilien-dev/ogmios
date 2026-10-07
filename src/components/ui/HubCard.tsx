import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface HubCardProps {
  title: string;
  /** What is behind it, in a sentence. */
  text: string;
  /** How it stands today; a card with nothing to say has none. */
  status?: ReactNode;
  /** The status is something waiting for the learner. */
  due?: boolean;
  onClick: () => void;
}

/**
 * One way out of a section's own screen: a card that is a button, with what
 * it leads to and how that stands today.
 */
export function HubCard({
  title,
  text,
  status,
  due = false,
  onClick,
}: HubCardProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-5 pt-5 pb-4 text-left shadow-card transition-colors duration-150 hover:border-line-strong"
    >
      <span className="flex items-center gap-2">
        <span className="text-base font-semibold text-ink">{title}</span>
        <ArrowRight
          aria-hidden
          className="ml-auto size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent-text"
        />
      </span>
      <span className="text-sm text-ink-soft">{text}</span>
      {status !== undefined && (
        <span
          className={cn(
            "mt-2 border-t border-line pt-3 text-sm",
            due ? "font-medium text-accent-text" : "text-ink-faint",
          )}
        >
          {status}
        </span>
      )}
    </button>
  );
}

/** The cards of a section, side by side where there is room. */
export function HubGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
