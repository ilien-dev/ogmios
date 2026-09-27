import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface NoticeProps {
  tone?: "neutral" | "accent" | "danger";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const TONES = {
  neutral: "border-line bg-raised text-ink-soft",
  accent: "border-accent-strong/40 bg-accent-soft text-ink",
  danger: "border-danger/40 bg-danger-soft text-ink",
};

/** A quiet inline message. Errors announce themselves; the rest do not. */
export function Notice({
  tone = "neutral",
  icon,
  children,
  className,
}: NoticeProps): ReactNode {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm leading-relaxed",
        TONES[tone],
        className,
      )}
    >
      {icon !== undefined && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
