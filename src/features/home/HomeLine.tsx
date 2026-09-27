import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface HomeLineProps {
  icon: LucideIcon;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}

/** One quiet line under the start button: an icon, a sentence, maybe a link. */
export function HomeLine({
  icon: Icon,
  action,
  children,
}: HomeLineProps): ReactNode {
  return (
    <li className="flex min-h-11 items-center gap-3 text-sm text-ink-soft">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1">{children}</span>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-sm px-2 py-1 font-medium text-accent-text underline-offset-4 hover:underline"
        >
          {action.label}
        </button>
      )}
    </li>
  );
}
