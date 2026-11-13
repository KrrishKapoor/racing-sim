import { clamp } from "./track";

export type Difficulty = "easy" | "medium" | "hard";
export interface RaceSetup {
  difficulty: Difficulty;
  cars: number;
  laps: number;
}
export const DEFAULT_SETUP: Readonly<RaceSetup> = {
  difficulty: "medium",
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
    difficulty: ["easy", "medium", "hard"].includes(value.difficulty ?? "")
      ? value.difficulty!
      : "medium",
    cars: integer(value.cars, 7, 2, 10),
    laps: integer(value.laps, 3, 1, 10),
  };
}

/** Race records compare identical race formats, never one lap against ten. */
export const raceKey = (setup: RaceSetup) =>
  `${setup.difficulty}:${setup.cars}:${setup.laps}`;
