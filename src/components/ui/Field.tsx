import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";

interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

/** A label, the control it names, and an optional hint or error below. */
export function Field({
  id,
  label,
  hint,
  error = null,
  className,
  children,
}: FieldProps): ReactNode {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {/* The id stays on this wrapper: the hint and the error trade places in it, and
          both exist for a moment while one leaves. */}
      <div id={`${id}-hint`} className="relative">
        <Presence swap>
          {error === null ? (
            hint !== undefined && (
              <Reveal
                key="hint"
                as="p"
                kind="fade"
                index={0}
                className="text-sm text-ink-faint"
              >
                {hint}
              </Reveal>
            )
          ) : (
            <Reveal
              key="error"
              as="p"
              kind="fade"
              index={0}
              role="alert"
              className="text-sm text-danger"
            >
              {error}
            </Reveal>
          )}
        </Presence>
      </div>
    </div>
  );
}
