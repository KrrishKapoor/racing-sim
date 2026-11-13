import { createCar } from "./physics";
import type { Track } from "./track";
import type { RaceSetup } from "./setup";

const RIVALS = [
  ["nova", "Nova", "#f09b72"],
  ["vale", "Vale", "#b9b0e4"],
  ["reed", "Reed", "#83c5c1"],
  ["ash", "Ash", "#e2bc7f"],
  ["lux", "Lux", "#d687ad"],
  ["kai", "Kai", "#8baedc"],
  ["wren", "Wren", "#d8d9cf"],
  ["sol", "Sol", "#d2a28e"],
  ["rio", "Rio", "#92b38b"],
] as const;

/** The player remains element zero for input/rendering, independent of grid slot. */
export function createGrid(track: Track, setup: RaceSetup) {
  const playerSlot = Math.min(setup.cars - 1, Math.floor(setup.cars * 0.75));
  const rivals = Array.from({ length: setup.cars - 1 }, (_, i) => {
    const [id, name, color] = RIVALS[i];
    return createCar(track, id, name, color, i < playerSlot ? i : i + 1);
  });
  return [createCar(track, "player", "You", "#d5f55b", playerSlot), ...rivals];
}
