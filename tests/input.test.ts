import test from "node:test";
import assert from "node:assert/strict";
import { drivingInput, mapStick, STICK_RADIUS } from "../src/input";
import { createCar, NO_INPUT, stepCar } from "../src/physics";
import { Track } from "../src/track";

const keys = (...codes: string[]) => new Set(codes);

test("keyboard retains digital steering, gas and brake; Space has no driving action", () => {
  assert.deepEqual(drivingInput(keys()), NO_INPUT);
  assert.deepEqual(drivingInput(keys("Space")), NO_INPUT);
  assert.deepEqual(Object.keys(NO_INPUT).sort(), ["brake", "steer", "throttle"]);
  for (const [left, right, gas, brake] of [["KeyA", "KeyD", "KeyW", "KeyS"], ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]]) {
    assert.deepEqual(drivingInput(keys(left, gas)), { steer: -1, throttle: 1, brake: 0 });
    assert.deepEqual(drivingInput(keys(right, brake)), { steer: 1, throttle: 0, brake: 1 });
    assert.equal(drivingInput(keys(left, right)).steer, 0);
  }
  assert.deepEqual(drivingInput(keys("KeyW", "Space")), drivingInput(keys("KeyW")));
});

test("floating stick has a horizontal deadzone and proportional, bounded travel in all directions", () => {
  for (const x of [-4, 0, 4]) assert.equal(mapStick(x, 0).steer, 0);
  for (const y of [-200, -56, 0, 56, 200]) assert.equal(mapStick(0, y).steer, 0);
  assert.equal(mapStick(STICK_RADIUS, 0).steer, 1);
  assert.equal(mapStick(-1000, 0).steer, -1);
  assert.ok(Math.abs(mapStick(28, 0).steer - (0.5 - 0.08) / 0.92) < 1e-12);
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
    const mapped = mapStick(Math.cos(angle) * 200, Math.sin(angle) * 200);
    assert.ok(Math.hypot(mapped.x, mapped.y) <= STICK_RADIUS + 1e-10);
    const expected = Math.sign(Math.cos(angle)) * Math.max(0, (Math.abs(Math.cos(angle)) - 0.08) / 0.92);
    assert.ok(Math.abs(mapped.steer - expected) < 1e-10);
  }
  assert.equal(mapStick(28, 28).steer, mapStick(28, -28).steer);
  assert.ok(mapStick(5, 0).steer > 0 && mapStick(5, 0).steer < 0.02);
});

test("analog steering survives input mapping with independent pedals", () => {
  const steer = mapStick(28, -16).steer;
  for (const [throttle, brake] of [[true, false], [false, true], [true, true], [false, false]]) {
    assert.deepEqual(drivingInput(keys(), { steer, throttle, brake }), { steer, throttle: Number(throttle), brake: Number(brake) });
  }
  assert.equal(drivingInput(keys("KeyA"), { steer, throttle: true, brake: false }).steer, -1);
});

test("physics applies fractional steering without changing normal grip or brake/reverse", () => {
  const track = new Track();
  const turn = (steer: number) => {
    const car = createCar(track, "player", "You", "#fff", 0);
    Object.assign(car, track.pointAt(400));
    car.vx = Math.cos(car.heading) * 180;
    car.vy = Math.sin(car.heading) * 180;
    for (let frame = 0; frame < 12; frame++) stepCar(car, { ...NO_INPUT, steer }, track, 1 / 120);
    return car;
  };
  const half = turn(0.5), full = turn(1);
  assert.ok(Math.abs(half.steering / full.steering - 0.5) < 1e-10);
  assert.ok(Math.abs(half.yawRate) < Math.abs(full.yawRate) * 0.55);
  const reverse = createCar(track, "player", "You", "#fff", 0);
  for (let frame = 0; frame < 120; frame++) stepCar(reverse, drivingInput(keys("ArrowDown")), track, 1 / 120);
  assert.equal(reverse.driveDirection, -1);
  assert.ok(reverse.forwardSpeed < 0);
});
