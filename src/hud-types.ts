import type { RaceSetup } from "./setup";
import type { RecordSummary } from "./records";
/** Public contract between the simulation and the DOM telemetry HUD. */
export interface HudPoint {
  x: number;
  y: number;
}
export interface HudDriver {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;
  position: number;
  lap: number;
  gap: string;
  x: number;
  y: number;
  heading: number;
}
export interface HudTelemetry {
  phase: "ready" | "countdown" | "racing" | "paused" | "finished";
  countdown: number;
  speed: number;
  gear: number;
  rpm: number;
  lap: number;
  totalLaps: number;
  lapTime: number;
  bestLap: number | null;
  raceTime: number;
  sector: number;
  sectorSplits: (number | null)[];
  sectorDelta: number | null;
  position: number;
  drivers: HudDriver[];
  isDrifting: boolean;
  isOffTrack: boolean;
  bestLapIsPersonalBest: boolean;
  completedLaps: number[];
  setup: RaceSetup;
  records: RecordSummary;
  raceBestIsPersonalBest: boolean;
}
export interface HudTrack {
  points: HudPoint[];
  width: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  sectorPoints: HudPoint[];
}
export interface HudActions {
  onStart: () => void;
  onRestart: () => void;
  onResume: () => void;
  onSetupChange: (setup: RaceSetup) => void;
  onSetup: () => void;
}
export interface HudController {
  update: (state: HudTelemetry) => void;
  destroy: () => void;
}
