/**
 * Isometric projection for the 3D scenes: a point on the floor plan (x, y)
 * at a height z, seen from above at 30 degrees. One unit of the plan is one
 * unit of the drawing.
 */
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

export type Point = readonly [number, number];

export function project(x: number, y: number, z = 0): Point {
  return [(x - y) * COS, (x + y) * SIN - z];
}

function points(list: readonly Point[]): string {
  return list.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
}

export interface Box {
  x: number;
  y: number;
  /** Along x. */
  w: number;
  /** Along y. */
  d: number;
  /** Up. */
  h: number;
  /** Where its foot stands. */
  z?: number;
}

/** The three faces of a box that can be seen, as polygon points. */
export function faces(box: Box): { top: string; left: string; right: string } {
  const { x, y, w, d, h, z = 0 } = box;
  const top = z + h;
  return {
    top: points([
      project(x, y, top),
      project(x + w, y, top),
      project(x + w, y + d, top),
      project(x, y + d, top),
    ]),
    left: points([
      project(x, y + d, z),
      project(x + w, y + d, z),
      project(x + w, y + d, top),
      project(x, y + d, top),
    ]),
    right: points([
      project(x + w, y, z),
      project(x + w, y + d, z),
      project(x + w, y + d, top),
      project(x + w, y, top),
    ]),
  };
}

/** Boxes drawn back to front, so the nearer one covers the farther. */
export function byDepth<T extends Box>(boxes: readonly T[]): T[] {
  return [...boxes].sort((a, b) => a.x + a.y - (b.x + b.y));
}

/** The centre of a box's top, where a pin stands. */
export function topCentre(box: Box): Point {
  return project(box.x + box.w / 2, box.y + box.d / 2, (box.z ?? 0) + box.h);
}
