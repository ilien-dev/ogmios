import type { ReactNode } from "react";
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
      {error === null ? (
        hint !== undefined && (
          <p id={`${id}-hint`} className="text-sm text-ink-faint">
            {hint}
          </p>
        )
      ) : (
        <p id={`${id}-hint`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
