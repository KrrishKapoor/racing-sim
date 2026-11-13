import { clamp, Track, wrapAngle } from "./track";
import { MAX_SPEED, steeringAngle, WHEELBASE } from "./physics";
import type { Car, DrivingInput } from "./physics";
import type { Difficulty } from "./setup";

export interface AIProfile {
  pace: number;
  cornerGrip: number;
  brakingHorizon: number;
  brakeStrength: number;
  launch: number;
  overtakeDistance: number;
  defend: boolean;
}
export const AI_PROFILES: Record<Difficulty, Readonly<AIProfile>> = {
  easy: { pace: 0.76, cornerGrip: 0.9, brakingHorizon: 120, brakeStrength: 0.75, launch: 0.65, overtakeDistance: 180, defend: false },
  medium: { pace: 0.96, cornerGrip: 1.15, brakingHorizon: 55, brakeStrength: 0.9, launch: 0.9, overtakeDistance: 260, defend: false },
  hard: { pace: 1.02, cornerGrip: 1.3, brakingHorizon: 15, brakeStrength: 1, launch: 1, overtakeDistance: 340, defend: true },
};
interface AIState {
  lane: number;
  targetLane: number;
  blend: number;
  age: number;
  passId: string | null;
  passSide: number;
  defendFor: number;
  defendCooldown: number;
  decisionIn: number;
  stuckFor: number;
  reverseFor: number;
}
const states = new WeakMap<Car, AIState>();
const LANE_LIMIT = 42;
const CLEARANCE = 43;

interface Traffic {
  car: Car;
  gap: number;
  offset: number;
  speed: number;
}
const longitudinalSpeed = (car: Car) =>
  car.vx * Math.cos(car.projection.heading) + car.vy * Math.sin(car.projection.heading);

/** Anticipate steering/yaw lag and tyre slip, then steer with the same bicycle
 * model and engine as the player. No positional correction, speed boosts or
 * rubber banding. The private optimized plan is independent of the PB ghost.
 */
export function getAIInput(
  car: Car,
  track: Track,
  cars: Car[],
  difficulty: Difficulty = "medium",
  dt = 1 / 120,
): DrivingInput {
  const profile = AI_PROFILES[difficulty];
  let state = states.get(car);
  if (!state) {
    state = { lane: car.projection.offset, targetLane: car.projection.offset, blend: 0, age: 0, passId: null, passSide: 0, defendFor: 0, defendCooldown: 0, decisionIn: 0, stuckFor: 0, reverseFor: 0 };
    states.set(car, state);
  }
  state.age += dt;
  state.defendCooldown = Math.max(0, state.defendCooldown - dt);
  state.defendFor = Math.max(0, state.defendFor - dt);
  state.decisionIn = Math.max(0, state.decisionIn - dt);
  const distance = car.projection.distance;
  const speed = Math.max(0, longitudinalSpeed(car));
  const line = track.racingLine;
  const traffic: Traffic[] = [];
  for (const other of cars) {
    if (other === car) continue;
    let gap = other.projection.distance - distance;
    if (gap > track.length / 2) gap -= track.length;
    if (gap < -track.length / 2) gap += track.length;
    if (gap > -200 && gap < profile.overtakeDistance + 100)
      traffic.push({ car: other, gap, offset: other.projection.offset, speed: Math.max(0, longitudinalSpeed(other)) });
  }
  traffic.sort((a, b) => a.gap - b.gap);
  const stoppedBehindObstacle = traffic.some((t) => t.gap > 0 && t.gap < 85 && t.speed < 10);
  const roomBehind = !traffic.some((t) => t.gap < 0 && t.gap > -150 && Math.abs(t.offset - car.projection.offset) < CLEARANCE);
  state.stuckFor = state.age > 3 && car.speed < 8 && car.driveDirection === 1 && stoppedBehindObstacle && roomBehind
    ? state.stuckFor + dt : 0;
  if (state.stuckFor > 0.65) {
    state.reverseFor = 1.7;
    state.stuckFor = 0;
  }
  if (state.reverseFor > 0 || car.driveDirection === -1) {
    state.reverseFor = roomBehind ? Math.max(0, state.reverseFor - dt) : 0;
    const target = track.pointAt(distance - 75, clamp(car.projection.offset, -30, 30));
    const error = wrapAngle(Math.atan2(target.y - car.y, target.x - car.x) - car.heading - Math.PI);
    const backing = roomBehind && state.reverseFor > 0;
    return { throttle: backing ? 0 : 1, brake: backing ? 1 : 0, reverse: true,
      steer: -clamp(Math.atan(2 * Math.sin(error) * WHEELBASE / 75) / steeringAngle(car.speed), -1, 1), handbrake: false };
  }
  const alongside = traffic.filter((t) => Math.abs(t.gap) < 58);
  let leader = traffic.find((t) => t.gap > 0 && t.gap < profile.overtakeDistance &&
    (t.speed < speed + 35 || t.gap < 90));
  const committed = traffic.find((t) => t.car.id === state!.passId);
  // Hold the lane until the rear bumper clears; never cut across a car beside us.
  if (committed && committed.gap > -65 && committed.gap < profile.overtakeDistance + 80)
    leader = committed;
  else if (state.passId) {
    state.passId = null;
    state.passSide = 0;
  }

  let requestedLane = state.targetLane;
  let useLane = false;
  if (leader) {
    const candidates = [-LANE_LIMIT, LANE_LIMIT,
      clamp(leader.offset - CLEARANCE, -LANE_LIMIT, LANE_LIMIT),
      clamp(leader.offset + CLEARANCE, -LANE_LIMIT, LANE_LIMIT)];
    let best = -Infinity;
    let chosen: number | null = null;
    for (const candidate of candidates) {
      if (Math.abs(candidate - leader.offset) < 38) continue;
      // Swept corridor: reject a lane change through an overlapping car, or
      // into a fast car approaching from behind. Score both inside and outside.
      const crossesCar = traffic.some((t) => {
        if (t === leader && t.gap > 58) return false;
        const gapSoon = t.gap + (t.speed - speed) * 0.6;
        if (Math.abs(t.gap) > 58 && Math.abs(gapSoon) > 58) return false;
        const lo = Math.min(car.projection.offset, candidate) - 36;
        const hi = Math.max(car.projection.offset, candidate) + 36;
        return t.offset > lo && t.offset < hi;
      });
      if (crossesCar) continue;
      let runway = profile.overtakeDistance;
      for (const t of traffic) {
        if (t.gap > 0 && Math.abs(t.offset - candidate) < 38)
          runway = Math.min(runway, t.gap + (t.speed - speed) * 0.8);
      }
      const sameSide = Math.sign(candidate - leader.offset) === state.passSide;
      const score = runway - Math.abs(candidate - car.projection.offset) * 0.3 + (sameSide ? 35 : 0);
      if (score > best) { best = score; chosen = candidate; }
    }
    if (chosen !== null && (state.decisionIn === 0 || !state.passId)) {
      requestedLane = chosen;
      state.passSide = Math.sign(chosen - leader.offset);
      state.passId = leader.car.id;
      state.decisionIn = 0.3;
    }
    useLane = state.passId !== null;
  }
  if (alongside.length > 0) {
    useLane = true;
    // Retain the side already occupied even if another car becomes the leader.
    for (const other of alongside) {
      const side = Math.sign(car.projection.offset - other.offset) || state.passSide || 1;
      requestedLane = clamp(other.offset + side * CLEARANCE, -LANE_LIMIT, LANE_LIMIT);
    }
  }

  const corner = line.pointAt(distance + 190);
  const threatened = traffic.some((t) => t.gap < -70 && t.gap > -180 && t.speed > speed + 5);
  if (profile.defend && !leader && alongside.length === 0 && threatened &&
    Math.abs(corner.curvature) > 0.0015 && corner.speed < speed && state.defendCooldown === 0) {
    state.defendFor = 0.85;
    state.defendCooldown = 4;
    requestedLane = Math.sign(corner.curvature) * 28;
  }
  if (state.defendFor > 0 && !leader && alongside.length === 0) useLane = true;
  state.targetLane = requestedLane;
  state.lane += clamp(requestedLane - state.lane, -65 * dt, 65 * dt);
  state.blend += clamp((useLane ? 1 : 0) - state.blend, -2 * dt, 3 * dt);

  const routeAt = (d: number) => {
    const plan = line.pointAt(d);
    return track.pointAt(d, plan.offset * (1 - state.blend) + state.lane * state.blend);
  };
  const lookahead = state.age > 2.5 && leader && leader.speed < 50 && leader.gap > 0 && Math.abs(leader.offset - car.projection.offset) < 38
    ? Math.min(60 + car.speed * 0.2, Math.max(25, leader.gap * 0.35))
    : 60 + car.speed * 0.2;
  const anticipation = 0.2;
  const target = routeAt(distance + lookahead + car.speed * anticipation);
  const px = car.x + car.vx * anticipation, py = car.y + car.vy * anticipation;
  const velocityHeading = car.speed > 30 ? Math.atan2(car.vy, car.vx) : car.heading;
  const heading = car.heading + car.yawRate * anticipation + wrapAngle(velocityHeading - car.heading) * 0.6;
  const error = wrapAngle(Math.atan2(target.y - py, target.x - px) - heading);
  const curvature = 2 * Math.sin(error) / Math.max(35, Math.hypot(target.x - px, target.y - py));
  let steer = clamp(Math.atan(curvature * WHEELBASE) / steeringAngle(car.speed), -1, 1);
  let desired = MAX_SPEED;
  for (let ahead = 0; ahead <= 380; ahead += 30) {
    const d = distance + ahead + profile.brakingHorizon;
    const plan = line.pointAt(d);
    const cornerSpeed = Math.sqrt(410 * profile.cornerGrip / Math.max(0.0001, Math.abs(plan.curvature)));
    let planned = Math.min(plan.speed * profile.pace, cornerSpeed);
    if (state.blend > 0.05) {
      // Passing/defending lanes have different radii. Inspect their actual
      // geometry instead of blindly reusing the fastest-line speed envelope.
      const a = routeAt(d - 30), b = routeAt(d), c = routeAt(d + 30);
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const k = Math.abs(2 * cross / Math.max(1, Math.hypot(b.x-a.x,b.y-a.y)*Math.hypot(c.x-b.x,c.y-b.y)*Math.hypot(c.x-a.x,c.y-a.y)));
      const steeringCap = 205 * (0.57 / Math.atan(WHEELBASE * Math.max(0.0001, k)) - 1);
      planned = Math.min(planned, Math.max(65, steeringCap * 0.85), Math.sqrt(390 / Math.max(0.0001,k)));
    }
    desired = Math.min(desired, Math.sqrt(planned ** 2 + 2 * 350 * ahead));
  }
  for (const other of traffic) {
    if (other.gap <= 0) continue;
    const currentOverlap = Math.abs(other.offset - car.projection.offset) < 38;
    const targetOverlap = Math.abs(other.offset - state.lane) < 38;
    if (!currentOverlap && !(useLane && targetOverlap)) continue;
    // Brake for the closing distance until lateral separation actually exists.
    const separation = Math.min(Math.abs(other.offset - car.projection.offset),
      useLane ? Math.abs(other.offset - state.lane) : Infinity);
    const reserve = (other.speed < 50 ? Math.sqrt(Math.max(0, CLEARANCE ** 2 - separation ** 2)) : 45) +
      speed * (difficulty === "easy" ? 0.12 : 0.055);
    const safeSpeed = Math.sqrt(other.speed ** 2 + 2 * 350 * Math.max(0, other.gap - reserve));
    desired = Math.min(desired, safeSpeed);
  }
  // Predict the car's swept body near the asphalt edge and steer inward before
  // it reaches the kerb. This is a control input, never a position clamp.
  const safetyTime = 0.3;
  const turn = car.yawRate * safetyTime * 0.5;
  const predicted = track.project({
    x: car.x + (car.vx * Math.cos(turn) - car.vy * Math.sin(turn)) * safetyTime,
    y: car.y + (car.vx * Math.sin(turn) + car.vy * Math.cos(turn)) * safetyTime,
  });
  const futureAngle = wrapAngle(car.heading + car.yawRate * safetyTime - predicted.heading);
  const extent = Math.abs(Math.sin(futureAngle)) * 23 + Math.abs(Math.cos(futureAngle)) * 13;
  const excess = Math.abs(predicted.offset) + extent - (track.width / 2 - 15);
  if (excess > 0) {
    steer = clamp(steer - Math.sign(predicted.offset) * clamp(excess / 18, 0, 0.9), -1, 1);
    desired = Math.min(desired, Math.max(90, car.speed - excess * 3));
  }
  if (Math.abs(error) > 0.8 || car.isOffTrack) desired = Math.min(desired, 100);
  const launch = state.age < 2.5 ? profile.launch : 1;
  return {
    throttle: car.speed < desired ? launch : 0,
    brake: clamp((car.speed - desired) / 35, 0, profile.brakeStrength),
    steer,
    handbrake: false,
  };
}
