import { clamp } from "./track";
import type { Race } from "./race";

export const MIN_AI_PACE = 0.35;

// Measured flying-lap response of this circuit/controller, fastest to slowest.
// A speed multiplier is not a lap-time ratio: at high pace, steering and edge
// safety dominate, whereas at low pace the requested speed becomes the limit.
const PACE_RESPONSE = [
  [12.8, 1], [13.55, 0.84], [14.76, 0.75], [17.09, 0.65],
  [20.47, 0.55], [25.4, 0.45], [33.08, MIN_AI_PACE],
] as const;
function paceForLapTime(time: number): number {
  for (let i = 1; i < PACE_RESPONSE.length; i++) {
    const [fastTime, fastPace] = PACE_RESPONSE[i - 1];
    const [slowTime, slowPace] = PACE_RESPONSE[i];
    if (time <= slowTime) {
      const fraction = clamp((time - fastTime) / (slowTime - fastTime), 0, 1);
      return fastPace + fraction * (slowPace - fastPace);
    }
  }
  return MIN_AI_PACE;
}

/** Session-local pace learning. Sector estimates use the circuit's speed profile,
 * so the hairpin sector is not mistaken for a suddenly slower player. */
export class DynamicPace {
  playerLapTime: number | null = null;
  private lastSector = 0;
  private lastLap = 0;
  private observedTime = 0;
  private sectorDelay = 0;
  private lapDelay = 0;
  private readonly sectorWeights: number[];
  readonly referenceLapTime = 12.8;

  constructor(race: Race) {
    const weights = [0, 0, 0];
    for (const point of race.track.racingLine.points) {
      const sector = Math.min(2, Math.floor(point.distance / race.track.length * 3));
      weights[sector] += 1 / point.speed;
    }
    const total = weights.reduce((a, b) => a + b, 0);
    this.sectorWeights = weights.map((weight) => weight / total);
  }

  /** Keep learned pace for rematches; sector clocks restart with each race. */
  resetRace(): void {
    this.lastSector = 0;
    this.lastLap = 0;
    this.observedTime = 0;
    this.sectorDelay = 0;
    this.lapDelay = 0;
  }

  observe(race: Race): void {
    const player = race.drivers.get("player");
    if (!player) return;
    const dt = Math.max(0, race.time - this.observedTime);
    this.observedTime = race.time;
    const car = race.cars.find((candidate) => candidate.isPlayer);
    if (car) {
      // Only a car ahead that we are closing on or following can hold us up.
      // Faster cars lapping us must not starve novices of clean pace samples.
      const forwardSpeed = (candidate: typeof car) => Math.max(0,
        candidate.vx * Math.cos(candidate.projection.heading) +
        candidate.vy * Math.sin(candidate.projection.heading));
      const playerSpeed = forwardSpeed(car);
      const inTraffic = race.cars.some((other) => {
        if (other === car) return false;
        let gap = other.projection.distance - car.projection.distance;
        if (gap > race.track.length / 2) gap -= race.track.length;
        if (gap < -race.track.length / 2) gap += race.track.length;
        return gap > 0 && gap < 340 && !other.isOffTrack &&
          Math.abs(other.projection.offset - car.projection.offset) < 65 &&
          forwardSpeed(other) <= playerSpeed + 20;
      });
      if (inTraffic || car.impact > 0 || car.isOffTrack || car.driveDirection === -1) {
        this.sectorDelay += dt;
        this.lapDelay += dt;
      }
    }
    if (player.sectorStarted === this.lastSector) return;
    const sector = (player.nextGate + 2) % 3;
    const elapsed = player.sectorStarted - this.lastSector;
    // Opening-lap congestion and traffic delays may reveal faster pace, but
    // must never slow the pack in front and create a self-reinforcing queue.
    if (this.lastSector > 0)
      this.learn(elapsed / this.sectorWeights[sector], 0.18, this.lastLap > 0 && this.sectorDelay < 0.35);
    this.lastSector = player.sectorStarted;
    this.sectorDelay = 0;
    if (player.laps.length > this.lastLap) {
      if (this.lastLap > 0) this.learn(player.laps.at(-1)!, 0.28, this.lapDelay < 0.35);
      this.lastLap = player.laps.length;
      this.lapDelay = 0;
    }
  }

  private learn(lapTime: number, weight: number, allowSlower: boolean): void {
    if (!Number.isFinite(lapTime) || lapTime < 8) return;
    const bounded = clamp(lapTime, 10, 40);
    const previous = this.playerLapTime ?? this.referenceLapTime;
    if (!allowSlower && bounded >= previous) return;
    // The first clean sample uses the same EWMA weight as later samples.
    this.playerLapTime = previous + weight * (bounded - previous);
  }

  /** Unwrapped race progress makes pressure correct at the seam and when lapped.
   * This requests a throttle/speed target only; the controller applies it slowly
   * on straights, below its own braking and asphalt safety limits. */
  targets(race: Race): Map<string, number> {
    const player = race.drivers.get("player");
    const rivals = race.standings().filter((driver) => driver.id !== "player");
    const result = new Map<string, number>();
    for (let rank = 0; rank < rivals.length; rank++) {
      const driver = rivals[rank];
      let hash = 0;
      for (const character of driver.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      const spread = (hash % 17) / 1000;
      const base = (rank < 3 ? 0.99 : 0.966) + spread;
      const learned = this.playerLapTime === null ? 1 :
        paceForLapTime(this.playerLapTime);
      const gapSeconds = player ? (player.distance - driver.distance) /
        (race.track.length / (this.playerLapTime ?? this.referenceLapTime)) : 0;
      // Four to five seconds behind produces a meaningful but bounded push.
      const pressure = clamp(gapSeconds / 5, -1, 1) * (gapSeconds > 0 ? 0.08 : 0.025);
      result.set(driver.id, clamp(base * learned + pressure, MIN_AI_PACE, 1));
    }
    return result;
  }
}
