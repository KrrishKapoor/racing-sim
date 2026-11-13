import { clamp } from "./track";

export interface RaceSetup {
  cars: number;
  laps: number;
}
export const DEFAULT_SETUP: Readonly<RaceSetup> = {
  cars: 7,
  laps: 3,
};

export function normalizeSetup(value: Partial<RaceSetup>): RaceSetup {
  const integer = (
    n: number | undefined,
    fallback: number,
    min: number,
    max: number,
  ) => (Number.isFinite(n) ? clamp(Math.round(n!), min, max) : fallback);
  return {
    cars: integer(value.cars, 7, 2, 10),
    laps: integer(value.laps, 3, 1, 10),
  };
}

/** Race records compare identical race formats, never one lap against ten. */
export const raceKey = (setup: RaceSetup) =>
  `dynamic:${setup.cars}:${setup.laps}`;
