import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { Depth } from "@shared/domain";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";

interface DepthChoiceProps {
  depths: readonly Depth[];
  onChoose: (depth: Depth) => void;
}

/** The depths on offer, each with what it means in one line. */
export function DepthChoice({ depths, onChoose }: DepthChoiceProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Stagger as="ul" className="flex flex-col gap-2">
      {depths.map((depth) => (
        <Reveal as="li" key={depth}>
          <button
            type="button"
            onClick={() => {
              onChoose(depth);
            }}
            className="group flex w-full items-center gap-4 rounded-lg bg-sunken/60 px-4 py-3 text-left text-ink transition-control hover:bg-book-soft"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium text-ink">
                {t(`books.chapter.depth.${depth}.name`)}
              </span>
              <span className="text-sm text-ink-soft">
                {t(`books.chapter.depth.${depth}.hint`)}
              </span>
            </span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-ink-faint transition-transform duration-300 ease-out-expo group-hover:translate-x-1 group-hover:text-ink"
            />
          </button>
        </Reveal>
      ))}
    </Stagger>
  );
}
