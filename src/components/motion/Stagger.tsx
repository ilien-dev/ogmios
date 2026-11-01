import { Children } from "react";
import type { ReactNode } from "react";
import { StaggerIndex } from "../../lib/motion";

interface StaggerProps {
  as?: "div" | "ul" | "ol" | "dl" | "section" | "tbody" | "main";
  className?: string;
  children: ReactNode;
}

/** Hands each `Reveal` among its children a position in the cascade. */
export function Stagger({
  as: Tag = "div",
  className,
  children,
}: StaggerProps): ReactNode {
  return (
    <Tag className={className}>
      {Children.map(Children.toArray(children), (child, position) => (
        <StaggerIndex.Provider value={position}>{child}</StaggerIndex.Provider>
      ))}
    </Tag>
  );
}
