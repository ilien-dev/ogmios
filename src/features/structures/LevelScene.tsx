import { Fragment } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Level } from "@shared/domain";
import type { StructureInfo } from "@shared/structures";
import { Reveal } from "@/components/motion/Reveal";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { BarRelief } from "@/features/drills/BarRelief";

export const LEVELS: readonly Level[] = ["basic", "intermediate", "advanced"];

/** How the structures of each level stand. */
interface LevelCount {
  level: Level;
  count: number;
  practised: number;
  firm: number;
  due: number;
  picked: number;
}

function byLevel(
  structures: readonly StructureInfo[],
  picked: ReadonlySet<string>,
): LevelCount[] {
  return LEVELS.map((level) => {
    const mine = structures.filter((each) => each.level === level);
    return {
      level,
      count: mine.length,
      practised: mine.filter((each) => each.strength !== "new").length,
      firm: mine.filter((each) => each.strength === "firm").length,
      due: mine.filter((each) => each.due).length,
      picked: mine.filter((each) => picked.has(each.key)).length,
    };
  });
}

/** The levels in a table, as the panel along the scene of the section. */
export function LevelTable({
  structures,
}: {
  structures: readonly StructureInfo[];
}): ReactNode {
  const { t } = useTranslation();
  const heads = [
    t("structures.board.level"),
    t("structures.board.total"),
    t("structures.board.practised"),
    t("structures.board.firm"),
    t("structures.due"),
  ];
  return (
    <Reveal className="grid grid-cols-6 items-center gap-x-3.5 gap-y-2 rounded-xl glass px-5.5 py-4.5 text-sm">
      {heads.map((head, at) => (
        <span
          key={head}
          className={
            at === 0
              ? "col-span-2 font-mono text-xs tracking-wider text-ink-faint uppercase"
              : "font-mono text-xs tracking-wider text-ink-faint uppercase"
          }
        >
          {head}
        </span>
      ))}
      {byLevel(structures, new Set()).map((each) => (
        <Fragment key={each.level}>
          <span className="col-span-2 flex items-center gap-2 text-ink">
            <span
              aria-hidden
              className={
                each.due > 0
                  ? "size-1.5 shrink-0 animate-breathe rounded-full bg-book"
                  : "size-1.5 shrink-0 rounded-full bg-line-strong"
              }
            />
            {t(`level.${each.level}`)}
          </span>
          <span className="font-mono text-ink-soft">{each.count}</span>
          <span className="font-mono text-ink-soft">{each.practised}</span>
          <span className="font-mono text-ink-soft">{each.firm}</span>
          <span className="font-mono text-ink-soft">{each.due}</span>
        </Fragment>
      ))}
    </Reveal>
  );
}

interface LevelSceneProps {
  title: string;
  text: string;
  structures: readonly StructureInfo[];
  /** The ones picked for the next session: their level is raised in teal. */
  picked?: ReadonlySet<string>;
  /** Under the text: a notice, a chip. */
  extra?: ReactNode;
  footer?: ReactNode;
}

/**
 * The scene of the structures: a thin title over the three levels raised as
 * columns, each as tall as its structures practised, a pin where some are
 * due again.
 */
export function LevelScene({
  title,
  text,
  structures,
  picked = new Set(),
  extra,
  footer,
}: LevelSceneProps): ReactNode {
  const { t } = useTranslation();
  const levels = byLevel(structures, picked);
  return (
    <Scene
      label={t("structures.board.scene")}
      className="flex-1"
      header={
        <>
          <SceneTitle>{title}</SceneTitle>
          <p className="max-w-prose text-ink-soft">{text}</p>
          {extra}
        </>
      }
      footer={footer}
    >
      <BarRelief
        label={t("structures.board.relief", {
          levels: levels
            .map((each) =>
              t("structures.board.reliefLevel", {
                level: t(`level.${each.level}`),
                practised: each.practised,
                count: each.count,
              }),
            )
            .join(", "),
        })}
        bars={levels.map((each) => ({
          key: each.level,
          value: each.practised,
          look: each.picked > 0 ? "book" : "plain",
          tip: {
            title: t(`level.${each.level}`),
            lines: [
              t("scene.tip.practised", {
                practised: each.practised,
                count: each.count,
              }),
              ...(each.due > 0
                ? [t("scene.tip.due", { count: each.due })]
                : []),
            ],
          },
          pin: each.due > 0 ? "book" : undefined,
        }))}
        className="size-full max-w-2xl px-6 pt-48 pb-56"
      />
    </Scene>
  );
}
