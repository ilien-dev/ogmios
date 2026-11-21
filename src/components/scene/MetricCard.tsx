import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";

interface MetricCardProps {
  title: string;
  number: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
}

/** A glass card with a title, a big thin number, a quiet line and a chart. */
export function MetricCard({
  title,
  number,
  note,
  children,
}: MetricCardProps): ReactNode {
  return (
    <div className="group flex flex-col gap-1.5 rounded-xl glass px-5 pt-5 pb-3.5">
      <div className="flex items-center justify-between">
        <span className="text-base text-ink">{title}</span>
        <ArrowUpRight
          aria-hidden
          className="size-4 text-ink-faint transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        />
      </div>
      {number}
      <Presence>
        {note !== undefined && (
          <Reveal
            key="note"
            as="span"
            kind="fade"
            className="text-sm text-ink-faint"
          >
            {note}
          </Reveal>
        )}
      </Presence>
      {children}
    </div>
  );
}
