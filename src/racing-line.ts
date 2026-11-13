import { MAX_SPEED, BRAKE_DECELERATION, ENGINE_ACCELERATION, WHEELBASE } from "./physics";
import type { Track, TrackPoint, Vec2 } from "./track";

export interface RacingPoint extends TrackPoint {
  offset: number;
  curvature: number;
  speed: number;
  cue: "brake" | "accelerate" | "carry";
}
interface Evaluation {
  points: Vec2[];
  speeds: number[];
  curvatures: number[];
  time: number;
}
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** A constrained minimum-lap-time trajectory, not a decorative centerline offset.
 * Optimize lateral offsets at multiple spatial scales against a periodic speed
 * envelope (curvature, engine acceleration, braking and steering limits).
 * The lane margin leaves room for the car body and a small tracking error.
 * This is a numerical local optimum for this driving model, not a proof of a
 * global optimum. Only AI uses this private plan; the visible ghost follows the player’s PB.
 */
export class RacingLine {
  readonly points: RacingPoint[];
  readonly predictedLapTime: number;
  readonly centerlineLapTime: number;
  readonly margin = 32;
  private readonly step: number;
  private readonly count = 180;

  constructor(private readonly track: Track) {
    this.step = track.length / this.count;
    const bases = Array.from({ length: this.count }, (_, i) =>
      track.pointAt(i * this.step),
    );
    const offsets = Array<number>(this.count).fill(0);
    const limit = track.width / 2 - this.margin;
    const evaluate = (candidate: number[]): Evaluation => {
      const points = bases.map((p, i) => ({
        x: p.x - Math.sin(p.heading) * candidate[i],
        y: p.y + Math.cos(p.heading) * candidate[i],
      }));
      const lengths = points.map((p, i) =>
        Math.hypot(
          p.x - points[(i + 1) % this.count].x,
          p.y - points[(i + 1) % this.count].y,
        ),
      );
      const curvatures = points.map((p, i) => {
        const a = points[(i - 1 + this.count) % this.count],
          b = points[(i + 1) % this.count];
        const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
        return (
          (2 * cross) /
          Math.max(
            1,
            Math.hypot(p.x - a.x, p.y - a.y) *
              Math.hypot(b.x - p.x, b.y - p.y) *
              Math.hypot(b.x - a.x, b.y - a.y),
          )
        );
      });
      const speeds = curvatures.map((k) => {
        const curve = Math.max(0.00001, Math.abs(k));
        const steerCap = 205 * (0.57 / Math.atan(WHEELBASE * curve) - 1);
        return Math.max(
          55,
          Math.min(MAX_SPEED, Math.sqrt(850 / curve), steerCap),
        );
      });
      // Repeated circular sweeps propagate braking across the start/finish seam.
      for (let pass = 0; pass < 3; pass++) {
        for (let i = this.count - 1; i >= 0; i--) {
          const next = (i + 1) % this.count;
          speeds[i] = Math.min(
            speeds[i],
            Math.sqrt(speeds[next] ** 2 + 2 * BRAKE_DECELERATION * lengths[i]),
          );
        }
        for (let i = 0; i < this.count; i++) {
          const next = (i + 1) % this.count;
          const acceleration = Math.max(
            28,
            ENGINE_ACCELERATION * (1 - speeds[i] / (MAX_SPEED * 1.3)) - 13 - speeds[i] * 0.028,
          );
          speeds[next] = Math.min(
            speeds[next],
            Math.sqrt(speeds[i] ** 2 + 2 * acceleration * lengths[i]),
          );
        }
      }
      return {
        points,
        speeds,
        curvatures,
        // Avoid collapsed/reversed segments at the tight hairpin. Those can
        // falsely improve the numerical score while creating an undriveable cusp.
        time: lengths.some((length) => length < this.step * 0.8) ? Infinity : lengths.reduce(
          (sum, length, i) =>
            sum + (2 * length) / (speeds[i] + speeds[(i + 1) % this.count]),
          0,
        ),
      };
    };
    let best = evaluate(offsets);
    this.centerlineLapTime = best.time;
    // Wide smooth moves create outside–apex–outside arcs; finer moves tune exits.
    for (const [radius, amplitude, passes] of [
      [14, 16, 3],
      [9, 10, 3],
      [6, 6, 3],
      [3, 3, 2],
      [2, 1, 2],
    ]) {
      for (let pass = 0; pass < passes; pass++) {
        for (
          let center = 0;
          center < this.count;
          center += Math.max(1, Math.floor(radius / 2))
        ) {
          let winning: number[] | null = null,
            candidateBest = best;
          for (const sign of [-1, 1]) {
            const trial = offsets.slice();
            for (let j = -radius; j <= radius; j++) {
              const i = (center + j + this.count) % this.count;
              trial[i] = clamp(
                trial[i] +
                  (sign * amplitude * (1 + Math.cos((Math.PI * j) / radius))) /
                    2,
                -limit,
                limit,
              );
            }
            const candidate = evaluate(trial);
            if (candidate.time < candidateBest.time - 0.00001) {
              candidateBest = candidate;
              winning = trial;
            }
          }
          if (winning) {
            offsets.splice(0, this.count, ...winning);
            best = candidateBest;
          }
        }
      }
    }
    this.predictedLapTime = best.time;
    this.points = best.points.map((p, i) => {
      const next = best.points[(i + 1) % this.count];
      const speedChange = best.speeds[(i + 1) % this.count] - best.speeds[i];
      return {
        ...p,
        distance: i * this.step,
        heading: Math.atan2(next.y - p.y, next.x - p.x),
        offset: offsets[i],
        curvature: best.curvatures[i],
        speed: best.speeds[i],
        cue:
          speedChange < -2 ? "brake" : speedChange > 1 ? "accelerate" : "carry",
      };
    });
  }
  pointAt(distance: number): RacingPoint {
    const wrapped =
      ((distance % this.track.length) + this.track.length) % this.track.length;
    const index = Math.floor(wrapped / this.step),
      t = wrapped / this.step - index;
    const a = this.points[index],
      b = this.points[(index + 1) % this.count];
    return {
      ...a,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      distance: wrapped,
      offset: a.offset + (b.offset - a.offset) * t,
      speed: a.speed + (b.speed - a.speed) * t,
    };
  }
}
