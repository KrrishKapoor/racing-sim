import { Track, clamp, wrapAngle } from "./track";
import type { TrackProjection } from "./track";

export interface DrivingInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  /** AI recovery must request reverse explicitly; ordinary AI braking cannot shift. */
  reverse?: boolean;
}
export const NO_INPUT: DrivingInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
};
export interface Car {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  speed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  yawRate: number;
  steering: number;
  driveDirection: 1 | -1;
  shiftTimer: number;
  isDrifting: boolean;
  isOffTrack: boolean;
  braking: boolean;
  impact: number;
  projection: TrackProjection;
}
export const MAX_SPEED = 560;
export const BRAKE_DECELERATION = 460;
export const ENGINE_ACCELERATION = 255;
export const MAX_REVERSE_SPEED = 110;
export const WHEELBASE = 36;
export const steeringAngle = (speed: number) =>
  0.57 / (1 + Math.abs(speed) / 205);

export function createCar(
  track: Track,
  id: string,
  name: string,
  color: string,
  grid: number,
): Car {
  const position = track.gridPosition(grid);
  return {
    id,
    name,
    color,
    isPlayer: id === "player",
    x: position.x,
    y: position.y,
    heading: position.heading,
    vx: 0,
    vy: 0,
    speed: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    yawRate: 0,
    steering: 0,
    driveDirection: 1,
    shiftTimer: 0,
    isDrifting: false,
    isOffTrack: false,
    braking: false,
    impact: 0,
    projection: track.project(position),
  };
}

/** Aerodynamic tow, available to every car using the same physical rules.
 * Only aligned cars on a straight qualify; neither engine power nor MAX_SPEED changes. */
export function slipstream(car: Car, cars: Car[], track: Track): number {
  if (car.isOffTrack || car.speed < 180 ||
      Math.abs(wrapAngle(track.pointAt(car.projection.distance + 160).heading - car.projection.heading)) > 0.16)
    return 0;
  let tow = 0;
  for (const other of cars) {
    if (other === car || other.isOffTrack || other.speed < 180) continue;
    const gap = (other.projection.distance - car.projection.distance + track.length) % track.length;
    const lateral = Math.abs(other.projection.offset - car.projection.offset);
    if (gap > 40 && gap < 280 && lateral < 36 && Math.abs(wrapAngle(other.heading - car.heading)) < 0.2)
      tow = Math.max(tow, (1 - (gap - 40) / 240) * (1 - lateral / 36));
  }
  return tow;
}

/** Fixed-step bicycle steering with independently damped longitudinal/lateral velocity. */
export function stepCar(
  car: Car,
  input: DrivingInput,
  track: Track,
  dt: number,
  tow = 0,
): void {
  const projection = track.project(car);
  car.isOffTrack = projection.distanceFromCenter > track.width / 2 + 3;
  const cosine = Math.cos(car.heading),
    sine = Math.sin(car.heading);
  let forward = car.vx * cosine + car.vy * sine;
  let lateral = -car.vx * sine + car.vy * cosine;
  car.steering +=
    (clamp(input.steer, -1, 1) - car.steering) * (1 - Math.exp(-12 * dt));
  const drift = input.handbrake && Math.abs(forward) > 55;
  const targetYaw =
    (forward / WHEELBASE) *
    Math.tan(car.steering * steeringAngle(forward)) *
    (drift ? 1.35 : 1);
  car.yawRate += (targetYaw - car.yawRate) * (1 - Math.exp(-8 * dt));
  car.heading = wrapAngle(car.heading + car.yawRate * dt);

  // Rotating the chassis preserves world momentum, producing controllable slip.
  const c = Math.cos(car.heading),
    s = Math.sin(car.heading);
  forward = car.vx * c + car.vy * s;
  lateral = -car.vx * s + car.vy * c;
  const acceleration = car.isOffTrack ? 170 : ENGINE_ACCELERATION;
  const reverseRequested =
    input.brake > 0.1 &&
    input.throttle < 0.1 &&
    (car.isPlayer || input.reverse === true);
  const changeDirection =
    car.driveDirection === 1 ? reverseRequested : input.throttle > 0.1;
  const shiftAtRest =
    changeDirection && Math.abs(forward) < 3 && Math.abs(lateral) < 10;
  car.shiftTimer = shiftAtRest ? car.shiftTimer + dt : 0;
  // A short neutral dwell prevents an instant jump from braking to reverse.
  if (car.shiftTimer >= 0.22) {
    car.driveDirection = car.driveDirection === 1 ? -1 : 1;
    car.shiftTimer = 0;
    forward = 0;
  }
  const braking = car.driveDirection === 1 ? input.brake : input.throttle;
  const drive = car.driveDirection === 1 ? input.throttle : input.brake;
  if (braking < 0.1) {
    if (car.driveDirection === 1)
      forward +=
        drive *
        acceleration *
        (1 - Math.max(0, forward) / (MAX_SPEED * 1.3)) *
        dt;
    else
      forward -=
        drive *
        155 *
        (1 - Math.max(0, -forward) / (MAX_REVERSE_SPEED * 1.5)) *
        dt;
  }
  const deceleration =
    braking * BRAKE_DECELERATION +
    (input.handbrake ? 140 : 0) +
    13 +
    Math.abs(forward) * 0.028 * (1 - 0.75 * clamp(tow, 0, 1));
  forward =
    Math.sign(forward) * Math.max(0, Math.abs(forward) - deceleration * dt);
  // Preserve low-speed traction in runoff so a stopped car can climb back out.
  if (car.isOffTrack)
    forward *= Math.exp(-1.35 * clamp(Math.abs(forward) / 140, 0.25, 1) * dt);
  forward = clamp(forward, -MAX_REVERSE_SPEED, MAX_SPEED);
  lateral *= Math.exp(-(drift ? 1.65 : car.isOffTrack ? 3.8 : 10.5) * dt);
  car.vx = c * forward - s * lateral;
  car.vy = s * forward + c * lateral;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.impact = Math.max(0, car.impact - dt * 2.5);
  constrainToTrack(car, track);
  car.speed = Math.hypot(car.vx, car.vy);
  car.forwardSpeed = car.vx * c + car.vy * s;
  car.lateralSpeed = -car.vx * s + car.vy * c;
  car.isDrifting =
    !car.isOffTrack &&
    car.speed > 65 &&
    (drift || Math.abs(car.lateralSpeed) > 48);
  car.braking = braking > 0.1 || input.handbrake;
  car.projection = track.project(car);
}

/** Resolve penetration without killing tangential motion or locking the chassis.
 * Also run after car contacts: a pack must not push a car through a barrier.
 */
export function constrainToTrack(car: Car, track: Track): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    const projection = track.project(car);
    if (projection.distanceFromCenter < 0.01) break;
    const nx = (car.x - projection.x) / projection.distanceFromCenter;
    const ny = (car.y - projection.y) / projection.distanceFromCenter;
    const c = Math.cos(car.heading),
      s = Math.sin(car.heading);
    const bodyExtent =
      Math.abs(nx * c + ny * s) * 23 + Math.abs(-nx * s + ny * c) * 13;
    const boundary = track.width / 2 + track.runoff - bodyExtent - 1;
    if (projection.distanceFromCenter <= boundary) break;
    car.x = projection.x + nx * boundary;
    car.y = projection.y + ny * boundary;
    const outgoing = car.vx * nx + car.vy * ny;
    if (outgoing > 0) {
      const restitution = outgoing > 70 ? 0.12 : 0;
      car.vx -= nx * outgoing * (1 + restitution);
      car.vy -= ny * outgoing * (1 + restitution);
      car.impact = Math.max(car.impact, Math.min(1, outgoing / 160));
    }
  }
  car.projection = track.project(car);
  car.speed = Math.hypot(car.vx, car.vy);
  car.forwardSpeed =
    car.vx * Math.cos(car.heading) + car.vy * Math.sin(car.heading);
  car.lateralSpeed =
    -car.vx * Math.sin(car.heading) + car.vy * Math.cos(car.heading);
}

export function resolveCarCollisions(cars: Car[]): void {
  for (let i = 0; i < cars.length; i++)
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i],
        b = cars[j],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= 37) continue;
      const nx = distance > 0.01 ? dx / distance : 1,
        ny = distance > 0.01 ? dy / distance : 0;
      const overlap = (37 - distance) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (approach > 0) {
        const impulse = approach * 0.65;
        a.vx -= nx * impulse;
        a.vy -= ny * impulse;
        b.vx += nx * impulse;
        b.vy += ny * impulse;
        a.impact = b.impact = Math.min(1, approach / 180);
      }
    }
}
