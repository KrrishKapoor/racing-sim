import type { Car } from "./physics";
import { Track } from "./track";

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
  constructor(
    readonly track: Track,
    cars: Car[],
    totalLaps = 3,
  ) {
    this.totalLaps = Math.max(1, Math.min(10, Math.round(totalLaps)));
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
      )
        continue;
      driver.distance += delta;
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
