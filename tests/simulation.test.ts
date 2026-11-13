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
import { LapTrace, MAX_TRACE_POINTS } from "../src/lap-trace.ts";
import {
  PersonalRecords,
  RECORDS_KEY,
  LEGACY_LAP_KEY,
} from "../src/records.ts";

const dt = 1 / 120;

test("actual player lap paths begin empty, finish at the gate, and persist only with a faster PB", () => {
  const track = new Track();
  const player = createCar(track, "player", "You", "#fff", 0);
  const race = new Race(track, [player], 3);
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
  };
  const records = new PersonalRecords(storage);
  assert.equal(records.bestLapPath, null);
  assert.equal(race.playerLapPath, null);
  const actual: { x: number; y: number }[] = [];
  for (let d = -22; d < track.length + 10; d += 10) {
    Object.assign(player, track.pointAt(d, 24 * Math.sin(d / 130)));
    player.speed = 400;
    player.projection = track.project(player);
    actual.push({ x: player.x, y: player.y });
    race.step([player], 0.025);
    if (race.drivers.get("player")!.laps.length === 0) assert.equal(race.playerLapPath, null);
  }
  assert.equal(race.drivers.get("player")!.laps.length, 1);
  const path = race.playerLapPath!;
  assert.ok(path.length > 400 && path.length < MAX_TRACE_POINTS);
  // All interior samples are real positions, rather than a regenerated ideal line.
  for (const p of path.slice(1, -1)) assert.ok(actual.some((a) => a.x === p.x && a.y === p.y));
  const endpoint = track.project(path.at(-1)!);
  assert.ok(Math.min(endpoint.distance, track.length - endpoint.distance) < 1);
  const time = race.drivers.get("player")!.laps[0];
  assert.equal(records.recordLap(time, path), true);
  const reloaded = new PersonalRecords(storage);
  assert.deepEqual(reloaded.bestLapPath, path);
  assert.equal(reloaded.summary(DEFAULT_SETUP).bestLap, time);
  assert.equal(reloaded.recordLap(time + 1, [{ x: 1, y: 2 }, { x: 3, y: 4 }]), false);
  assert.deepEqual(new PersonalRecords(storage).bestLapPath, path);
  const faster = path.map((p) => ({ x: p.x + 2, y: p.y + 1 }));
  assert.equal(reloaded.recordLap(time - 1, faster), true);
  faster[0].x = -100; // Persistence owns a copy, independent of later recording.
  assert.notEqual(reloaded.bestLapPath![0].x, -100);
  assert.equal(new PersonalRecords(storage).summary(DEFAULT_SETUP).bestLap, time - 1);
  assert.deepEqual(new PersonalRecords(storage).bestLapPath, reloaded.bestLapPath);
  assert.equal(new Race(track, [player]).playerLapPath, null);
});

test("time-only v2 records and corrupt ghosts never fabricate a visible path", () => {
  for (const bestLapPath of [undefined, [{ x: 1, y: 2 }], [{ x: null, y: 2 }, { x: 3, y: 4 }]]) {
    const saved = JSON.stringify({ version: 2, bestLap: 15, bestLapPath, raceTimes: {}, wins: 2, races: 4 });
    const records = new PersonalRecords({ getItem: (key) => key === RECORDS_KEY ? saved : null, setItem: () => {} });
    assert.equal(records.summary(DEFAULT_SETUP).bestLap, 15);
    assert.equal(records.bestLapPath, null);
    assert.equal(records.recordLap(16, [{ x: 1, y: 2 }, { x: 3, y: 4 }]), false);
    assert.equal(records.bestLapPath, null);
    assert.equal(records.recordLap(14, [{ x: 1, y: 2 }, { x: 3, y: 4 }]), true);
    assert.equal(records.bestLapPath!.length, 2);
  }
});

test("lap traces remain bounded and consecutive laps share the exact crossing", () => {
  const trace = new LapTrace({ x: 0, y: 0 });
  for (let i = 1; i < 100_000; i++) trace.sample({ x: i * 10, y: i % 100 });
  const finish = { x: 1_000_000, y: 0 };
  const first = trace.finish(finish);
  assert.ok(first.length <= MAX_TRACE_POINTS);
  trace.sample({ x: finish.x + 20, y: 2 });
  const second = trace.finish({ x: finish.x + 40, y: 4 });
  assert.deepEqual(first.at(-1), second[0]);
  assert.equal(second.length, 3);
});
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

/** Check the whole body, not merely the centre or the delayed off-track flag. */
function asphaltExtent(car: ReturnType<typeof createCar>, track: Track): number {
  let extent = 0;
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  for (const x of [-23, 23]) for (const y of [-13, 13]) {
    extent = Math.max(extent, track.project({
      x: car.x + x * c - y * s,
      y: car.y + x * s + y * c,
    }).distanceFromCenter);
  }
  return extent;
}

test("Hard uses human-competitive lap pace; difficulties separate and entire ten-car fields stay on asphalt", () => {
  const track = new Track();
  const flying: number[] = [], launches: number[] = [];
  for (const difficulty of ["easy", "medium", "hard"] as Difficulty[]) {
    const solo = createCar(track, "nova", "Nova", "#fff", 0);
    const launchCar = createCar(track, "launch", "Launch", "#fff", 0);
    launches.push(getAIInput(launchCar, track, [launchCar], difficulty).throttle);
    const race = new Race(track, [solo], 4);
    let soloExtent = 0;
    for (let step = 0; step < 120 * 130 && race.drivers.get(solo.id)!.finishTime === null; step++) {
      stepCar(solo, getAIInput(solo, track, [solo], difficulty), track, dt);
      soloExtent = Math.max(soloExtent, asphaltExtent(solo, track));
      race.step([solo], dt);
    }
    const laps = race.drivers.get(solo.id)!.laps;
    assert.equal(laps.length, 4);
    const mean = laps.slice(1).reduce((sum, lap) => sum + lap, 0) / 3;
    flying.push(mean);
    assert.ok(soloExtent < track.width / 2, `${difficulty} solo body leaves asphalt: ${soloExtent}`);
    if (difficulty === "hard") {
      assert.ok(laps[0] < 17, `Hard standing-start lap: ${laps[0]}`);
      assert.ok(laps.slice(1).every((lap) => lap > 13.5 && lap < 17), `Hard flying laps: ${laps}`);
    }
    const cars = createGrid(track, { difficulty, cars: 10, laps: 4 });
    const packRace = new Race(track, cars, 4);
    let packExtent = 0;
    for (let step = 0; step < 120 * 150 && packRace.standings().some((d) => d.finishTime === null); step++) {
      const inputs = cars.map((car) => getAIInput(car, track, cars, difficulty));
      cars.forEach((car, i) => stepCar(car, inputs[i], track, dt));
      resolveCarCollisions(cars);
      for (const car of cars) {
        constrainToTrack(car, track);
        const extent = asphaltExtent(car, track);
        packExtent = Math.max(packExtent, extent);
        assert.ok(extent < track.width / 2,
          `${difficulty} ${car.id} body leaves asphalt at step ${step}: ${extent}`);
      }
      packRace.step(cars, dt);
    }
    assert.ok(packRace.standings().every((d) => d.finishTime !== null), `${difficulty} ten-car field must finish`);
    console.log(`${difficulty}: standing ${laps[0].toFixed(3)}s; flying mean ${mean.toFixed(3)}s; 10-car maximum body extent ${packExtent.toFixed(2)} / ${track.width / 2}, zero off-asphalt steps`);
  }
  assert.ok(launches[0] < launches[1] && launches[1] < launches[2]);
  assert.ok(flying[1] < flying[0] * 0.9 && flying[2] < flying[1] * 0.93, `Easy/Medium/Hard flying laps: ${flying}`);
});

test("Hard passes slower cars on either side, including a stopped car, without contact or cutting", () => {
  const track = new Track();
  for (const side of [-25, 0, 25]) for (const obstacleSpeed of [0, 160]) {
    const ai = createCar(track, "nova", "Nova", "#fff", 0);
    const slow = createCar(track, "slow", "Slow", "#fff", 0);
    Object.assign(ai, track.pointAt(100, side));
    let slowDistance = 300;
    Object.assign(slow, track.pointAt(slowDistance, side));
    for (const car of [ai, slow]) {
      const speed = car === ai ? 350 : obstacleSpeed;
      car.vx = Math.cos(car.heading) * speed;
      car.vy = Math.sin(car.heading) * speed;
      car.speed = speed;
      car.projection = track.project(car);
    }
    let passed = false;
    for (let i = 0; i < 120 * 12; i++) {
      slowDistance += obstacleSpeed * dt;
      Object.assign(slow, track.pointAt(slowDistance, side));
      slow.projection = track.project(slow);
      slow.vx = Math.cos(slow.heading) * obstacleSpeed;
      slow.vy = Math.sin(slow.heading) * obstacleSpeed;
      stepCar(ai, getAIInput(ai, track, [ai, slow], "hard"), track, dt);
      assert.ok(Math.hypot(ai.x - slow.x, ai.y - slow.y) >= 37, `contact while passing offset ${side} at ${obstacleSpeed}`);
      assert.ok(asphaltExtent(ai, track) < track.width / 2);
      if (ai.projection.distance > slow.projection.distance + 70) { passed = true; break; }
    }
    assert.ok(passed, `stuck behind offset ${side} at speed ${obstacleSpeed}`);
  }
});

test("Hard abandons a blocked passing lane and completes the pass on the other side", () => {
  const track = new Track();
  const ai = createCar(track, "nova", "Nova", "#fff", 0);
  const slow = createCar(track, "slow", "Slow", "#fff", 0);
  const blocker = createCar(track, "blocker", "Blocker", "#fff", 0);
  Object.assign(ai, track.pointAt(50));
  ai.vx = Math.cos(ai.heading) * 300;
  ai.vy = Math.sin(ai.heading) * 300;
  ai.speed = 300;
  ai.projection = track.project(ai);
  let minimumOffset = 0, maximumOffset = 0, passed = false;
  for (let i = 0; i < 120 * 10; i++) {
    const distance = 300 + 140 * i * dt;
    for (const [car, d, offset] of [[slow, distance, 0], [blocker, distance + 90, -40]] as const) {
      Object.assign(car, track.pointAt(d, offset));
      car.projection = track.project(car);
      car.vx = Math.cos(car.heading) * 140;
      car.vy = Math.sin(car.heading) * 140;
      car.speed = 140;
    }
    // A previously unseen car blocks the initially selected left lane.
    const traffic = i > 60 ? [ai, slow, blocker] : [ai, slow];
    stepCar(ai, getAIInput(ai, track, traffic, "hard"), track, dt);
    minimumOffset = Math.min(minimumOffset, ai.projection.offset);
    maximumOffset = Math.max(maximumOffset, ai.projection.offset);
    for (const car of traffic) if (car !== ai)
      assert.ok(Math.hypot(ai.x - car.x, ai.y - car.y) >= 37);
    assert.ok(asphaltExtent(ai, track) < track.width / 2);
    if (ai.projection.distance > blocker.projection.distance + 70) { passed = true; break; }
  }
  assert.ok(minimumOffset < -15 && maximumOffset > 30, "must switch sides rather than queue behind the blocker");
  assert.ok(passed);
});

test("Hard covers the inside of a braking zone when a faster car threatens from behind", () => {
  const track = new Track();
  const front = createCar(track, "front", "Front", "#fff", 0);
  const solo = createCar(track, "solo", "Solo", "#fff", 0);
  const rear = createCar(track, "rear", "Rear", "#fff", 0);
  for (const car of [front, solo]) {
    Object.assign(car, track.pointAt(800));
    car.vx = Math.cos(car.heading) * 400;
    car.vy = Math.sin(car.heading) * 400;
    car.speed = 400;
    car.projection = track.project(car);
  }
  for (let i = 0; i < 72; i++) {
    Object.assign(rear, track.pointAt(front.projection.distance - 130));
    rear.vx = Math.cos(rear.heading) * 440;
    rear.vy = Math.sin(rear.heading) * 440;
    rear.speed = 440;
    rear.projection = track.project(rear);
    stepCar(front, getAIInput(front, track, [front, rear], "hard"), track, dt);
    stepCar(solo, getAIInput(solo, track, [solo], "hard"), track, dt);
    assert.ok(asphaltExtent(front, track) < track.width / 2);
    assert.ok(Math.hypot(front.x - rear.x, front.y - rear.y) > 37);
  }
  assert.ok(front.projection.offset < solo.projection.offset - 8, "defend the inside of the left-hand corner");
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
  assert.ok(JSON.parse(memory.get(RECORDS_KEY)!).version === 3);
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
