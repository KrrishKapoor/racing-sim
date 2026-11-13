import type { Vec2 } from "./track";

export const MAX_TRACE_POINTS = 4096;
export type LapPath = readonly Readonly<Vec2>[];

/** Spatial sampling follows actual motion (including slides and reversals).
 * Adaptive thinning bounds storage even for an unusually long, wandering lap.
 */
export class LapTrace {
  private points: Vec2[];
  private spacing = 6;
  constructor(start: Vec2) {
    this.points = [{ x: start.x, y: start.y }];
  }
  sample(position: Vec2, force = false): void {
    const last = this.points.at(-1)!;
    if (!force && Math.hypot(position.x - last.x, position.y - last.y) < this.spacing)
      return;
    if (this.points.length >= MAX_TRACE_POINTS - 1) {
      this.points = this.points.filter((_, i) => i % 2 === 0);
      this.spacing *= 2;
    }
    this.points.push({ x: position.x, y: position.y });
  }
  finish(crossing: Vec2): LapPath {
    this.sample(crossing, true);
    const completed = this.points;
    this.points = [{ x: crossing.x, y: crossing.y }];
    this.spacing = 6;
    return completed;
  }
}

/** Reject corrupt/unbounded storage; never associate a partial trace with a PB. */
export function readLapPath(value: unknown): LapPath | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_TRACE_POINTS)
    return null;
  if (!value.every((p) => p && typeof p === "object" &&
    typeof p.x === "number" && typeof p.y === "number" &&
    Number.isFinite(p.x) && Number.isFinite(p.y) &&
    Math.abs(p.x) < 100_000 && Math.abs(p.y) < 100_000)) return null;
  return value.map((p) => ({ x: p.x, y: p.y }));
}
