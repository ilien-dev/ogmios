import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "learn" | "known";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent shadow-card hover:bg-accent-strong disabled:bg-raised disabled:text-ink-faint disabled:shadow-none",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-raised disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-raised hover:text-ink disabled:text-ink-faint",
  danger:
    "border border-danger/40 text-danger hover:bg-danger-soft disabled:text-ink-faint",
  learn:
    "border border-accent-strong bg-accent-soft text-ink hover:bg-accent/40 disabled:text-ink-faint",
  known:
    "border border-known bg-known-soft text-ink hover:bg-known/30 disabled:text-ink-faint",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-sm px-3 text-sm",
  md: "h-10 gap-2 rounded-md px-4 text-sm",
  lg: "h-14 gap-3 rounded-lg px-7 text-base",
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
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed",
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
