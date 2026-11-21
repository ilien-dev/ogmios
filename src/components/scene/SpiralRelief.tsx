import type { ReactNode } from "react";
import type { Box } from "./iso";
import { byDepth, project, topCentre } from "./iso";
import type { Tone } from "./Relief";
import { ReliefFrame, useHover } from "./HoverTip";
import type { Tip } from "./HoverTip";
import { Block, Floor, Pin } from "./Relief";

/**
 * The mark (assets/brand) raised into a relief: its walls climb from the
 * outer ring to the centre, where the learner's focus stands lit in mint.
 * In plan units of the mark's 256 grid.
 */
const WALLS: readonly Box[] = [
  { x: 80, y: 28, w: 148, d: 26, h: 10 },
  { x: 202, y: 54, w: 26, d: 174, h: 14 },
  { x: 28, y: 202, w: 174, d: 26, h: 18 },
  { x: 28, y: 72, w: 26, d: 130, h: 22 },
  { x: 54, y: 72, w: 130, d: 26, h: 28 },
  { x: 158, y: 98, w: 26, d: 86, h: 34 },
  { x: 72, y: 158, w: 86, d: 26, h: 40 },
  { x: 72, y: 116, w: 26, d: 42, h: 46 },
];

const FOCUS: Box = { x: 114, y: 113, w: 32, d: 32, h: 64 };

/** Where the pins stand, one per wall from the outside in. */
const SPOTS = [WALLS[1], WALLS[3], WALLS[5], WALLS[7]] as const;

/** A pin that tells what it stands for under the pointer. */
export interface SpiralPin {
  tone: Tone;
  tip: Omit<Tip, "key">;
}

interface SpiralReliefProps {
  /** One pin per pattern, from the outer ring in; at most four. */
  pins?: ReadonlyArray<Tone | SpiralPin>;
  /** Dimmed behind other content, as in a conversation. */
  dim?: boolean;
  className?: string;
  /** Read out instead of the drawing. */
  label?: string;
}

export function SpiralRelief({
  pins = [],
  dim = false,
  className,
  label,
}: SpiralReliefProps): ReactNode {
  const [ox] = project(0, 256);
  const [ex] = project(256, 0);
  const [, top] = project(0, 0, 80);
  const [, bottom] = project(256, 256);
  const width = ex - ox;
  const hover = useHover();
  return (
    <ReliefFrame hover={hover} className={className}>
      <svg
        viewBox={`${ox - 40} ${top - 40} ${width + 80} ${bottom - top + 80}`}
        role={label === undefined ? undefined : "img"}
        aria-label={label}
        aria-hidden={label === undefined}
        className="block size-full"
        opacity={dim ? 0.35 : 1}
      >
        <Floor size={256} step={16} />
        <ellipse
          cx={project(130, 129)[0]}
          cy={project(130, 129)[1]}
          rx={70}
          ry={34}
          className="pointer-events-none animate-breathe fill-mint transform-fill"
          fillOpacity={0.18}
        />
        {byDepth([...WALLS, FOCUS]).map((box) => (
          <Block
            key={`${box.x},${box.y}`}
            look={box === FOCUS ? "lit" : "plain"}
            {...box}
          />
        ))}
        {pins.slice(0, SPOTS.length).map((pin, at) => {
          const spot = SPOTS[at];
          if (spot === undefined) {
            return null;
          }
          const key = `${String(spot.x)},${String(spot.y)}`;
          return typeof pin === "string" ? (
            <Pin key={key} at={topCentre(spot)} tone={pin} />
          ) : (
            <Pin
              key={key}
              at={topCentre(spot)}
              tone={pin.tone}
              raised={hover.hovered === key}
              hover={hover.on({ key, ...pin.tip })}
            />
          );
        })}
      </svg>
    </ReliefFrame>
  );
}
