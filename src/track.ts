import { RacingLine } from "./racing-line";

export interface Vec2 {
  x: number;
  y: number;
}
export interface TrackPoint extends Vec2 {
  heading: number;
  distance: number;
}
export interface TrackProjection extends TrackPoint {
  offset: number;
  distanceFromCenter: number;
  index: number;
}
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const wrapAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

/** Closed Catmull–Rom circuit, sampled once for rendering and spatial queries. */
export class Track {
  private optimizedLine?: RacingLine;
  get racingLine(): RacingLine {
    return (this.optimizedLine ??= new RacingLine(this));
  }
  readonly width = 150;
  readonly runoff = 52;
  readonly points: TrackPoint[] = [];
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  readonly length: number;
  readonly sectorDistances: number[];

  constructor() {
    const controls: Vec2[] = [
      { x: 900, y: 1370 },
      { x: 1330, y: 1370 },
      { x: 1740, y: 1210 },
      { x: 1810, y: 880 },
      { x: 1580, y: 650 },
      { x: 1320, y: 730 },
      { x: 1130, y: 470 },
      { x: 920, y: 240 },
      { x: 490, y: 250 },
      { x: 240, y: 490 },
      { x: 270, y: 780 },
      { x: 540, y: 860 },
      { x: 680, y: 1040 },
      { x: 480, y: 1220 },
      { x: 550, y: 1370 },
    ];
    const at = (i: number) => controls[(i + controls.length) % controls.length];
    for (let i = 0; i < controls.length; i++) {
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      for (let j = 0; j < 44; j++) {
        const t = j / 44;
        const spline = (v0: number, v1: number, v2: number, v3: number) =>
          0.5 *
          (2 * v1 +
            (-v0 + v2) * t +
            (2 * v0 - 5 * v1 + 4 * v2 - v3) * t * t +
            (-v0 + 3 * v1 - 3 * v2 + v3) * t * t * t);
        this.points.push({
          x: spline(a.x, b.x, c.x, d.x),
          y: spline(a.y, b.y, c.y, d.y),
          heading: 0,
          distance: 0,
        });
      }
    }
    let distance = 0;
    this.points.forEach((p, i) => {
      const next = this.points[(i + 1) % this.points.length];
      p.heading = Math.atan2(next.y - p.y, next.x - p.x);
      p.distance = distance;
      distance += Math.hypot(next.x - p.x, next.y - p.y);
    });
    this.length = distance;
    this.sectorDistances = [distance / 3, (2 * distance) / 3, distance];
    this.bounds = {
      minX: Math.min(...this.points.map((p) => p.x)) - 180,
      minY: Math.min(...this.points.map((p) => p.y)) - 180,
      maxX: Math.max(...this.points.map((p) => p.x)) + 180,
      maxY: Math.max(...this.points.map((p) => p.y)) + 180,
    };
  }

  pointAt(distance: number, offset = 0): TrackPoint {
    const d = ((distance % this.length) + this.length) % this.length;
    let low = 0,
      high = this.points.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.points[mid].distance <= d) low = mid;
      else high = mid - 1;
    }
    const a = this.points[low],
      b = this.points[(low + 1) % this.points.length];
    const end = low === this.points.length - 1 ? this.length : b.distance;
    const t = (d - a.distance) / (end - a.distance);
    return {
      x: a.x + (b.x - a.x) * t - Math.sin(a.heading) * offset,
      y: a.y + (b.y - a.y) * t + Math.cos(a.heading) * offset,
      heading: a.heading,
      distance: d,
    };
  }

  gridPosition(index: number): TrackPoint {
    return this.pointAt(
      -32 - Math.floor(index / 2) * 64 - (index % 2) * 16,
      index % 2 === 0 ? -27 : 27,
    );
  }

  project(position: Vec2): TrackProjection {
    let best = Infinity;
    let result!: TrackProjection;
    for (let i = 0; i < this.points.length; i++) {
      const a = this.points[i],
        b = this.points[(i + 1) % this.points.length];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = clamp(
        ((position.x - a.x) * dx + (position.y - a.y) * dy) /
          (dx * dx + dy * dy),
        0,
        1,
      );
      const x = a.x + dx * t,
        y = a.y + dy * t;
      const squared = (position.x - x) ** 2 + (position.y - y) ** 2;
      if (squared < best) {
        best = squared;
        result = {
          x,
          y,
          heading: a.heading,
          distance: a.distance + Math.hypot(dx, dy) * t,
          offset:
            -(position.x - x) * Math.sin(a.heading) +
            (position.y - y) * Math.cos(a.heading),
          distanceFromCenter: Math.sqrt(squared),
          index: i,
        };
      }
    }
    return result;
  }
}
