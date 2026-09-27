import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CONTROL } from "./controlStyles";

export function TextInput({
  className,
  ...rest
}: ComponentProps<"input">): ReactNode {
  return <input className={cn(CONTROL, "h-11", className)} {...rest} />;
}
