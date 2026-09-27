import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CONTROL } from "./controlStyles";

export function TextArea({
  className,
  ...rest
}: ComponentProps<"textarea">): ReactNode {
  return (
    <textarea
      className={cn(CONTROL, "resize-none py-3 leading-relaxed", className)}
      {...rest}
    />
  );
}
