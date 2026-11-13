import { raceKey } from "./setup";
import type { RaceSetup } from "./setup";

export const RECORDS_KEY = "apex-evergreen-records-v2";
export const LEGACY_LAP_KEY = "apex-evergreen-best-v1";
export interface RecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface RecordSummary {
  bestLap: number | null;
  bestRace: number | null;
  wins: number;
  races: number;
}
interface SavedRecords {
  version: 2;
  bestLap: number | null;
  raceTimes: Record<string, number>;
  wins: number;
  races: number;
}
const validTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;

/** Storage failure never interrupts a race; records remain available in memory. */
export class PersonalRecords {
  private data: SavedRecords = {
    version: 2,
    bestLap: null,
    raceTimes: {},
    wins: 0,
    races: 0,
  };
  constructor(private readonly storage: RecordStorage | null) {
    try {
      const raw: unknown = JSON.parse(storage?.getItem(RECORDS_KEY) ?? "null");
      if (
        raw &&
        typeof raw === "object" &&
        "version" in raw &&
        raw.version === 2
      ) {
        const saved = raw as Partial<SavedRecords>;
        this.data.bestLap = validTime(saved.bestLap) ? saved.bestLap : null;
        this.data.wins = count(saved.wins);
        this.data.races = Math.max(count(saved.races), this.data.wins);
        if (saved.raceTimes && typeof saved.raceTimes === "object") {
          for (const [key, time] of Object.entries(saved.raceTimes))
            if (
              /^(easy|medium|hard):([2-9]|10):([1-9]|10)$/.test(key) &&
              validTime(time)
            )
              this.data.raceTimes[key] = time;
        }
      }
    } catch {
      /* Ignore malformed or unavailable storage. */
    }
    try {
      const legacy = Number(storage?.getItem(LEGACY_LAP_KEY));
      if (
        validTime(legacy) &&
        (this.data.bestLap === null || legacy < this.data.bestLap)
      ) {
        this.data.bestLap = legacy;
        this.save();
      }
    } catch {
      /* Optional legacy migration. */
    }
  }
  summary(setup: RaceSetup): RecordSummary {
    return {
      bestLap: this.data.bestLap,
      bestRace: this.data.raceTimes[raceKey(setup)] ?? null,
      wins: this.data.wins,
      races: this.data.races,
    };
  }
  recordLap(time: number): boolean {
    if (
      !validTime(time) ||
      (this.data.bestLap !== null && time >= this.data.bestLap)
    )
      return false;
    this.data.bestLap = time;
    this.save();
    return true;
  }
  finishRace(time: number, position: number, setup: RaceSetup): boolean {
    if (
      !validTime(time) ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > setup.cars
    )
      return false;
    const key = raceKey(setup),
      previous = this.data.raceTimes[key];
    const improved = previous === undefined || time < previous;
    if (improved) this.data.raceTimes[key] = time;
    this.data.races++;
    if (position === 1) this.data.wins++;
    this.save();
    return improved;
  }
  private save(): void {
    try {
      this.storage?.setItem(RECORDS_KEY, JSON.stringify(this.data));
    } catch {
      /* Quota/private mode: keep the in-memory record. */
    }
  }
}

export function browserRecordStorage(): RecordStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
