import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "primary"
  | "primaryBook"
  | "inverse"
  | "secondary"
  | "ghost"
  | "danger"
  | "learn"
  | "known";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-cta text-on-cta enabled:hover:brightness-95 disabled:bg-raised disabled:bg-none disabled:text-ink-faint",
  primaryBook:
    "bg-cta-book text-on-cta-book enabled:hover:brightness-95 disabled:bg-raised disabled:bg-none disabled:text-ink-faint",
  inverse:
    "bg-ink text-canvas shadow-float hover:bg-ink-soft disabled:bg-raised disabled:text-ink-faint",
  secondary:
    "bg-surface text-ink shadow-card hover:bg-raised disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-raised hover:text-ink disabled:text-ink-faint",
  danger:
    "border border-danger/40 text-danger hover:bg-danger-soft disabled:text-ink-faint",
  learn:
    "border border-accent-strong bg-accent-soft text-ink hover:bg-accent/40 disabled:text-ink-faint",
  known:
    "border border-known bg-known-soft text-ink hover:bg-known/30 disabled:text-ink-faint",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-sm",
  md: "h-11 gap-2 rounded-full px-5 text-sm",
  lg: "h-14 gap-3 rounded-full px-7 text-base",
};

interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={type === "submit" ? "submit" : "button"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition duration-150 select-none disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
