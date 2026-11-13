import test from "node:test";
import assert from "node:assert/strict";
import { Track, wrapAngle } from "../src/track.ts";
import {
  createCar,
  NO_INPUT,
  resolveCarCollisions,
  stepCar,
  constrainToTrack,
  MAX_REVERSE_SPEED,
} from "../src/physics.ts";
import { getAIInput } from "../src/ai.ts";
import { Race } from "../src/race.ts";
import { DEFAULT_SETUP, normalizeSetup } from "../src/setup.ts";
import type { Difficulty } from "../src/setup.ts";
import { createGrid } from "../src/grid.ts";
import {
  PersonalRecords,
  RECORDS_KEY,
  LEGACY_LAP_KEY,
} from "../src/records.ts";

const dt = 1 / 120;
test("closed circuit projection and starting grid face the first straight", () => {
  const track = new Track();
  assert.ok(track.length > 4000);
  assert.ok(
    Math.hypot(
      track.pointAt(0).x - track.pointAt(track.length).x,
      track.pointAt(0).y - track.pointAt(track.length).y,
    ) < 0.001,
  );
  for (let grid = 0; grid < 4; grid++) {
    const car = createCar(
      track,
      grid === 3 ? "player" : `${grid}`,
      "Driver",
      "#fff",
      grid,
    );
    assert.ok(
      Math.abs(wrapAngle(car.heading)) < 0.14,
      `grid ${grid} must face east`,
    );
    assert.ok(car.projection.distanceFromCenter < track.width / 2 - 20);
    assert.equal(car.speed, 0);
  }
});

test("throttle accelerates and brakes bring the car to rest", () => {
  const track = new Track(),
    car = createCar(track, "player", "You", "#fff", 0);
  for (let i = 0; i < 180; i++)
    stepCar(car, { ...NO_INPUT, throttle: 1 }, track, dt);
  assert.ok(car.speed > 200);
  for (let i = 0; i < 180 && car.speed > 0.1; i++)
    stepCar(car, { ...NO_INPUT, brake: 1 }, track, dt);
  assert.ok(car.speed < 1);
  assert.equal(
    car.driveDirection,
    1,
    "forward braking reaches rest before reverse engages",
  );
});

test("holding brake shifts through rest into capped reverse; throttle brakes and returns to drive", () => {
  const track = new Track(),
    car = createCar(track, "player", "You", "#fff", 0);
  car.vx = 180;
  let stopped = false,
    shifted = false;
  for (let i = 0; i < 420; i++) {
    stepCar(car, { ...NO_INPUT, brake: 1 }, track, dt);
    if (Math.abs(car.forwardSpeed) < 0.1) stopped = true;
    if (car.driveDirection === -1) {
      assert.ok(stopped);
      shifted = true;
    }
    assert.ok(car.forwardSpeed >= -MAX_REVERSE_SPEED - 0.01);
  }
  assert.ok(shifted && car.forwardSpeed < -45);
  for (let i = 0; i < 180; i++)
    stepCar(car, { ...NO_INPUT, throttle: 1 }, track, dt);
  assert.equal(car.driveDirection, 1);
  assert.ok(car.forwardSpeed > 20);
});

test("reverse steering turns the chassis in the opposite direction", () => {
  const track = new Track();
  const forward = createCar(track, "player", "You", "#fff", 0);
  const reverse = createCar(track, "player", "You", "#fff", 0);
  const origin = forward.heading;
  forward.vx = Math.cos(origin) * 75;
  forward.vy = Math.sin(origin) * 75;
  reverse.vx = -forward.vx;
  reverse.vy = -forward.vy;
  reverse.driveDirection = -1;
  for (let i = 0; i < 40; i++) {
    stepCar(forward, { ...NO_INPUT, steer: 1 }, track, dt);
    stepCar(reverse, { ...NO_INPUT, steer: 1 }, track, dt);
  }
  assert.ok(wrapAngle(forward.heading - origin) > 0.08);
  assert.ok(wrapAngle(reverse.heading - origin) < -0.08);
});

test("a player can reverse out of barriers and runoff around the entire circuit", () => {
  const track = new Track();
  for (let index = 0; index < 24; index++)
    for (const side of [-1, 1]) {
      const car = createCar(track, "player", "You", "#fff", 0);
      const location = track.pointAt((index / 24) * track.length, side * 120);
      Object.assign(car, location);
      car.heading = location.heading + (side * Math.PI) / 2;
      car.vx = Math.cos(car.heading) * 110;
      car.vy = Math.sin(car.heading) * 110;
      stepCar(car, NO_INPUT, track, dt);
      for (let i = 0; i < 300; i++)
        stepCar(car, { ...NO_INPUT, brake: 1 }, track, dt);
      assert.equal(car.driveDirection, -1);
      assert.ok(
        car.projection.distanceFromCenter < 80,
        `wedged at sample ${index}, side ${side}: ${car.projection.distanceFromCenter}`,
      );
    }
});

test("default and custom grids contain 2–10 cars with a mid/back player slot", () => {
  assert.deepEqual(DEFAULT_SETUP, { difficulty: "medium", cars: 7, laps: 3 });
  assert.deepEqual(normalizeSetup({ cars: 80, laps: -2 }), {
    difficulty: "medium",
    cars: 10,
    laps: 1,
  });
  const track = new Track();
  for (let count = 2; count <= 10; count++) {
    const grid = createGrid(track, { ...DEFAULT_SETUP, cars: count });
    assert.equal(grid.length, count);
    assert.equal(grid[0].id, "player");
    const race = new Race(track, grid, 5);
    assert.equal(race.totalLaps, 5);
    assert.ok(
      race.standings().findIndex((d) => d.id === "player") >=
        Math.floor(count / 2),
    );
    for (const car of grid) assert.ok(car.projection.distanceFromCenter < 40);
    for (let i = 0; i < grid.length; i++)
      for (let j = i + 1; j < grid.length; j++)
        assert.ok(
          Math.hypot(grid[i].x - grid[j].x, grid[i].y - grid[j].y) > 40,
        );
  }
});

test("optimized line stays on asphalt, closes smoothly, and beats the centerline speed plan", () => {
  const track = new Track(),
    line = track.racingLine;
  assert.ok(line.predictedLapTime < line.centerlineLapTime * 0.9);
  assert.ok(
    line.points.some((p) => p.offset < -30) &&
      line.points.some((p) => p.offset > 30),
  );
  assert.ok(
    line.points.some((p) => p.cue === "brake") &&
      line.points.some((p) => p.cue === "accelerate"),
  );
  for (let d = 0; d < track.length; d += 5) {
    const p = line.pointAt(d);
    assert.ok(track.project(p).distanceFromCenter < track.width / 2 - 20);
    assert.ok(p.speed > 50 && p.speed <= 535);
  }
  const a = line.pointAt(0),
    b = line.pointAt(track.length);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.001);
});

test("difficulty affects launch, braking and actual lap pace; ten-car fields finish", () => {
  const track = new Track();
  const times: number[] = [],
    launches: number[] = [];
  for (const difficulty of ["easy", "medium", "hard"] as Difficulty[]) {
    const solo = createCar(track, "nova", "Nova", "#fff", 0);
    launches.push(getAIInput(solo, track, [solo], difficulty).throttle);
    const race = new Race(track, [solo], 1);
    for (
      let step = 0;
      step < 120 * 80 && race.drivers.get(solo.id)!.finishTime === null;
      step++
    ) {
      stepCar(solo, getAIInput(solo, track, [solo], difficulty), track, dt);
      race.step([solo], dt);
    }
    const time = race.drivers.get(solo.id)!.finishTime;
    assert.ok(time !== null);
    times.push(time);
    const cars = createGrid(track, { difficulty, cars: 10, laps: 1 });
    const packRace = new Race(track, cars, 1);
    for (
      let step = 0;
      step < 120 * 150 &&
      packRace.standings().some((d) => d.finishTime === null);
      step++
    ) {
      for (const car of cars)
        stepCar(car, getAIInput(car, track, cars, difficulty), track, dt);
      resolveCarCollisions(cars);
      for (const car of cars) constrainToTrack(car, track);
      packRace.step(cars, dt);
    }
    assert.ok(
      packRace.standings().every((d) => d.finishTime !== null),
      `${difficulty} field must finish`,
    );
  }
  assert.ok(launches[0] < launches[1] && launches[1] < launches[2]);
  assert.ok(
    times[1] < times[0] * 0.9 && times[2] < times[1] * 0.95,
    `lap times easy/medium/hard: ${times}`,
  );
  console.log(
    `Difficulty lap times easy/medium/hard: ${times.map((t) => t.toFixed(2)).join(" / ")} s`,
  );
});

test("personal bests, race formats and wins persist across store reloads", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  const first = new PersonalRecords(storage);
  assert.equal(first.recordLap(24.2), true);
  assert.equal(first.recordLap(25), false);
  assert.equal(first.finishRace(75, 1, DEFAULT_SETUP), true);
  const second = new PersonalRecords(storage);
  assert.deepEqual(second.summary(DEFAULT_SETUP), {
    bestLap: 24.2,
    bestRace: 75,
    wins: 1,
    races: 1,
  });
  assert.equal(second.finishRace(80, 2, DEFAULT_SETUP), false);
  second.finishRace(20, 1, { ...DEFAULT_SETUP, laps: 1 });
  assert.equal(second.summary(DEFAULT_SETUP).bestRace, 75);
  assert.equal(
    second.summary({ ...DEFAULT_SETUP, difficulty: "hard" }).bestRace,
    null,
  );
  const reloaded = new PersonalRecords(storage);
  assert.deepEqual(reloaded.summary({ ...DEFAULT_SETUP, laps: 1 }), {
    bestLap: 24.2,
    bestRace: 20,
    wins: 2,
    races: 3,
  });
});

test("record migration, malformed storage and unavailable storage are safe", () => {
  const memory = new Map([
    [LEGACY_LAP_KEY, "21.5"],
    [RECORDS_KEY, "{broken"],
  ]);
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  const records = new PersonalRecords(storage);
  assert.equal(records.summary(DEFAULT_SETUP).bestLap, 21.5);
  assert.ok(JSON.parse(memory.get(RECORDS_KEY)!).version === 2);
  assert.equal(records.recordLap(NaN), false);
  assert.equal(records.recordLap(-1), false);
  const blocked = new PersonalRecords({
    getItem: () => {
      throw new Error("Blocked");
    },
    setItem: () => {
      throw new Error("Blocked");
    },
  });
  assert.equal(blocked.recordLap(30), true);
  assert.equal(blocked.finishRace(90, 1, DEFAULT_SETUP), true);
  assert.equal(blocked.summary(DEFAULT_SETUP).wins, 1);
});

test("handbrake produces lateral slip; grass reduces acceleration", () => {
  const track = new Track();
  const normal = createCar(track, "player", "You", "#fff", 0);
  const drift = createCar(track, "player", "You", "#fff", 0);
  normal.vx = drift.vx = 280;
  for (let i = 0; i < 30; i++) {
    stepCar(normal, { ...NO_INPUT, steer: 0.7 }, track, dt);
    stepCar(drift, { ...NO_INPUT, steer: 0.7, handbrake: true }, track, dt);
  }
  assert.ok(Math.abs(drift.lateralSpeed) > Math.abs(normal.lateralSpeed) * 1.5);
  assert.equal(drift.isDrifting, true);
  const road = createCar(track, "player", "You", "#fff", 0);
  const grass = createCar(track, "player", "You", "#fff", 0);
  Object.assign(road, track.pointAt(50));
  Object.assign(grass, track.pointAt(50, 96));
  for (let i = 0; i < 120; i++) {
    stepCar(road, { ...NO_INPUT, throttle: 1 }, track, dt);
    stepCar(grass, { ...NO_INPUT, throttle: 1 }, track, dt);
  }
  assert.ok(grass.speed < road.speed * 0.6);
});

test("barriers contain the car and absorb outward velocity", () => {
  const track = new Track(),
    car = createCar(track, "player", "You", "#fff", 0);
  const point = track.pointAt(100, 125);
  Object.assign(car, point);
  car.vy = 300;
  stepCar(car, NO_INPUT, track, dt);
  assert.ok(
    car.projection.distanceFromCenter <= track.width / 2 + track.runoff - 12,
  );
  assert.ok(car.vy < 0);
  assert.ok(car.impact > 0);
});

test("teleporting over sector gates never awards a lap", () => {
  const track = new Track(),
    car = createCar(track, "player", "You", "#fff", 0);
  const race = new Race(track, [car]);
  for (let round = 0; round < 4; round++)
    for (const distance of [track.length / 3, (2 * track.length) / 3, 10]) {
      Object.assign(car, track.pointAt(distance));
      car.projection = track.project(car);
      race.step([car], dt);
    }
  assert.equal(race.drivers.get("player")!.laps.length, 0);
});

test("reversing across the finish line cannot award a checkpoint or lap", () => {
  const track = new Track(), car = createCar(track, "player", "You", "#fff", 0);
  const race = new Race(track, [car]);
  for (let distance = -32; distance >= -400; distance -= 2) {
    Object.assign(car, track.pointAt(distance));
    car.speed = 100; car.forwardSpeed = -100; car.driveDirection = -1;
    car.projection = track.project(car); race.step([car], 0.02);
  }
  const progress = race.drivers.get("player")!;
  assert.equal(progress.nextGate, 0);
  assert.equal(progress.laps.length, 0);
  assert.ok(progress.distance < -350);
});

test("four waypoint-driven cars complete three clean laps with ordered sector timing", () => {
  const track = new Track();
  const cars = ["nova", "vale", "reed", "player"].map((id, i) =>
    createCar(track, id, id, "#fff", i),
  );
  const race = new Race(track, cars);
  let offRoadSteps = 0,
    steps = 0;
  while (
    steps < 120 * 180 &&
    race.standings().some((driver) => driver.finishTime === null)
  ) {
    for (const car of cars) {
      stepCar(car, getAIInput(car, track, cars), track, dt);
      if (car.isOffTrack) offRoadSteps++;
      assert.ok(Number.isFinite(car.x + car.y + car.speed));
    }
    resolveCarCollisions(cars);
    race.step(cars, dt);
    steps++;
  }
  assert.ok(
    offRoadSteps / (steps * cars.length) < 0.05,
    `off-road ratio ${offRoadSteps / (steps * cars.length)}`,
  );
  for (const driver of race.standings()) {
    assert.equal(
      driver.laps.length,
      3,
      `${driver.id}: ${driver.laps.length} laps, distance ${driver.distance}`,
    );
    assert.ok(driver.finishTime! < 180);
    assert.ok(driver.laps.every((lap) => lap > 10));
    assert.ok(driver.splits.every((split) => split !== null && split > 0));
  }
  console.log(
    `Full-race validation: ${race
      .standings()
      .map((d) => `${d.id} ${d.finishTime!.toFixed(2)}s`)
      .join(
        ", ",
      )}; off-road ${((offRoadSteps / (steps * cars.length)) * 100).toFixed(2)}%`,
  );
});
