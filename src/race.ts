import type { Car } from "./physics";
import { Track } from "./track";
import { LapTrace } from "./lap-trace";
import type { LapPath } from "./lap-trace";
import type { Vec2 } from "./track";

export interface DriverProgress {
  id: string;
  previousDistance: number;
  distance: number;
  nextGate: number;
  laps: number[];
  lapStarted: number;
  sectorStarted: number;
  splits: (number | null)[];
  bestSectors: (number | null)[];
  sectorDelta: number | null;
  finishTime: number | null;
}
export class Race {
  readonly totalLaps: number;
  time = 0;
  readonly drivers = new Map<string, DriverProgress>();
  playerLapPath: LapPath | null = null;
  /** Whether the most recently timed lap has a complete, trustworthy trace. */
  playerLapValid = false;
  private playerTraceValid = true;
  private playerTrace: LapTrace | null = null;
  private previousPlayer: Vec2 | null = null;
  constructor(
    readonly track: Track,
    readonly cars: readonly Car[],
    totalLaps = 3,
  ) {
    this.totalLaps = Math.max(1, Math.min(10, Math.round(totalLaps)));
    const player = cars.find((car) => car.isPlayer);
    if (player) {
      this.playerTrace = new LapTrace(player);
      this.previousPlayer = { x: player.x, y: player.y };
    }
    for (const car of cars)
      this.drivers.set(car.id, {
        id: car.id,
        previousDistance: car.projection.distance,
        distance: car.projection.distance - track.length,
        nextGate: 0,
        laps: [],
        lapStarted: 0,
        sectorStarted: 0,
        splits: [null, null, null],
        bestSectors: [null, null, null],
        sectorDelta: null,
        finishTime: null,
      });
  }
  step(cars: Car[], dt: number): void {
    this.time += dt;
    for (const car of cars) {
      const driver = this.drivers.get(car.id)!;
      const previousPlayer = this.previousPlayer;
      if (car.isPlayer) this.previousPlayer = { x: car.x, y: car.y };
      const current = car.projection.distance;
      let delta = current - driver.previousDistance;
      if (delta < -this.track.length / 2) delta += this.track.length;
      if (delta > this.track.length / 2) delta -= this.track.length;
      driver.previousDistance = current;
      // Reject teleportation and track shortcuts. Reverse travel never awards a checkpoint.
      if (
        Math.abs(delta) > 55 + car.speed * dt * 2 ||
        car.projection.distanceFromCenter >
          this.track.width / 2 + this.track.runoff
      ) {
        if (car.isPlayer) {
          // Retain the completed ghost; discard only this lap’s partial trace.
          this.playerTrace = new LapTrace(car);
          this.playerTraceValid = false;
        }
        continue;
      }
      driver.distance += delta;
      // Finish at the interpolated gate crossing, not the next fixed-step sample.
      const lapEnd = (driver.laps.length + 1) * this.track.length;
      if (car.isPlayer && driver.finishTime === null && this.playerTrace) {
        if (delta > 0 && driver.nextGate === 2 && driver.distance >= lapEnd && previousPlayer) {
          const fraction = 1 - Math.min(1, (driver.distance - lapEnd) / delta);
          const crossing = {
            x: previousPlayer.x + (car.x - previousPlayer.x) * fraction,
            y: previousPlayer.y + (car.y - previousPlayer.y) * fraction,
          };
          const completed = this.playerTrace.finish(crossing);
          this.playerLapValid = this.playerTraceValid;
          if (this.playerLapValid) this.playerLapPath = completed;
          // finish() seeds the next lap at the exact crossing, even after rejection.
          this.playerTraceValid = true;
        }
        this.playerTrace.sample(car);
      }
      if (driver.finishTime !== null || delta <= 0) continue;
      const threshold =
        driver.laps.length * this.track.length +
        this.track.sectorDistances[driver.nextGate];
      if (driver.distance < threshold) continue;
      const crossingTime =
        this.time - Math.min(dt, ((driver.distance - threshold) / delta) * dt);
      const sectorTime = crossingTime - driver.sectorStarted;
      const oldBest = driver.bestSectors[driver.nextGate];
      driver.sectorDelta = oldBest === null ? null : sectorTime - oldBest;
      driver.splits[driver.nextGate] = sectorTime;
      driver.bestSectors[driver.nextGate] =
        oldBest === null ? sectorTime : Math.min(oldBest, sectorTime);
      driver.sectorStarted = crossingTime;
      driver.nextGate++;
      if (driver.nextGate === 3) {
        driver.laps.push(crossingTime - driver.lapStarted);
        driver.lapStarted = crossingTime;
        driver.nextGate = 0;
        if (driver.laps.length === this.totalLaps)
          driver.finishTime = crossingTime;
        else driver.splits = [null, null, null];
      }
    }
  }
  standings(): DriverProgress[] {
    return [...this.drivers.values()].sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null)
        return a.finishTime - b.finishTime;
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.distance - a.distance;
    });
  }
}
