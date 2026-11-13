import { clamp, Track, wrapAngle } from "./track";
import { BRAKE_DECELERATION, MAX_SPEED, steeringAngle, WHEELBASE } from "./physics";
import { MIN_AI_PACE } from "./ai-pace";
import type { Car, DrivingInput } from "./physics";

interface AIState {
  pace: number;
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
const CLEARANCE = 48;

interface Traffic {
  car: Car;
  gap: number;
  offset: number;
  speed: number;
}
const longitudinalSpeed = (car: Car) =>
  car.vx * Math.cos(car.projection.heading) + car.vy * Math.sin(car.projection.heading);

/** Anticipate steering/yaw lag and tyre slip, then steer with the same bicycle
 * model and engine as the player. Dynamic pace changes control targets only;
 * it never moves cars or bypasses the shared physics. The private optimized plan is independent of the PB ghost.
 */
export function getAIInput(
  car: Car,
  track: Track,
  cars: Car[],
  pace = 1,
  dt = 1 / 120,
): DrivingInput {
  const overtakeDistance = 340;
  let state = states.get(car);
  if (!state) {
    state = { pace: clamp(pace, MIN_AI_PACE, 1), lane: car.projection.offset, targetLane: car.projection.offset, blend: 0, age: 0, passId: null, passSide: 0, defendFor: 0, defendCooldown: 0, decisionIn: 0, stuckFor: 0, reverseFor: 0 };
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
    if (gap > -200 && gap < overtakeDistance + 100)
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
      steer: -clamp(Math.atan(2 * Math.sin(error) * WHEELBASE / 75) / steeringAngle(car.speed), -1, 1) };
  }
  const alongside = traffic.filter((t) => Math.abs(t.gap) < 58);
  let leader = traffic.find((t) => t.gap > 0 && t.gap < overtakeDistance);
  const committed = traffic.find((t) => t.car.id === state!.passId);
  // Hold the lane until the rear bumper clears; never cut across a car beside us.
  if (committed && committed.gap > -65 && committed.gap < overtakeDistance + 80)
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
      let runway = overtakeDistance;
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
      const stillBehind = other.car.id === state.passId && other.gap > 0 &&
        Math.abs(car.projection.offset - other.offset) < 38;
      const side = (stillBehind ? state.passSide : Math.sign(car.projection.offset - other.offset)) || state.passSide || 1;
      requestedLane = clamp(other.offset + side * CLEARANCE, -LANE_LIMIT, LANE_LIMIT);
    }
  }

  const cornerTurn = wrapAngle(track.pointAt(distance + 190).heading - car.projection.heading);
  const threatened = traffic.some((t) => t.gap < -70 && t.gap > -180 && t.speed > speed + 5);
  if (!leader && alongside.length === 0 && threatened &&
    Math.abs(cornerTurn) > 0.12 && state.defendCooldown === 0) {
    state.defendFor = 0.85;
    state.defendCooldown = 4;
    requestedLane = Math.sign(cornerTurn) * 28;
  }
  if (state.defendFor > 0 && !leader && alongside.length === 0) useLane = true;
  const fastBattle = leader !== undefined && leader.speed > 250 &&
    !traffic.some((other) => other !== leader && Math.abs(other.gap) < 200);
  state.targetLane = requestedLane;
  state.lane += clamp(requestedLane - state.lane, -90 * dt, 90 * dt);
  state.blend += clamp((useLane ? 1 : 0) - state.blend, -2 * dt, 3 * dt);

  const routeAt = (d: number) => {
    const plan = line.pointAt(d);
    return track.pointAt(d, plan.offset * (1 - state.blend) + state.lane * state.blend);
  };
  const lookahead = state.age > 2.5 && leader && leader.speed < 50 && leader.gap > 0 && Math.abs(leader.offset - car.projection.offset) < 38
    ? Math.min(60 + car.speed * 0.2, Math.max(25, leader.gap * 0.35))
    : 60 + car.speed * 0.2;
  const anticipation = 0.32 - state.blend * (fastBattle ? 0.06 : 0.12);
  const target = routeAt(distance + lookahead + car.speed * anticipation);
  const px = car.x + car.vx * anticipation, py = car.y + car.vy * anticipation;
  const velocityHeading = car.speed > 30 ? Math.atan2(car.vy, car.vx) : car.heading;
  const heading = car.heading + car.yawRate * anticipation + wrapAngle(velocityHeading - car.heading) * 0.6;
  const error = wrapAngle(Math.atan2(target.y - py, target.x - px) - heading);
  const curvature = 2 * Math.sin(error) / Math.max(35, Math.hypot(target.x - px, target.y - py));
  let steer = clamp(Math.atan(curvature * WHEELBASE) / steeringAngle(car.speed), -1, 1);
  // Latch/slew pace only where the road is straight. A changed sector or gap
  // cannot create a throttle step halfway through a corner.
  const straight = Math.abs(line.pointAt(distance).curvature) < 0.0015 &&
    Math.abs(line.pointAt(distance + 150).curvature) < 0.0015;
  if (straight) state.pace += clamp(clamp(pace, MIN_AI_PACE, 1) - state.pace, -0.08 * dt, 0.08 * dt);
  let desired = MAX_SPEED;

  for (let ahead = 0; ahead <= 380; ahead += 30) {
    const d = distance + ahead + (useLane && state.passId ? 0 : 18);
    const plan = line.pointAt(d);
    const cornerSpeed = Math.sqrt(850 / Math.max(0.0001, Math.abs(plan.curvature)));
    let planned = Math.min(plan.speed * 1.1, cornerSpeed);
    if (state.blend > 0.05) {
      // Passing/defending lanes have different radii. Inspect their actual
      // geometry instead of blindly reusing the fastest-line speed envelope.
      const a = routeAt(d - 30), b = routeAt(d), c = routeAt(d + 30);
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const k = Math.abs(2 * cross / Math.max(1, Math.hypot(b.x-a.x,b.y-a.y)*Math.hypot(c.x-b.x,c.y-b.y)*Math.hypot(c.x-a.x,c.y-a.y)));
      const steeringCap = 205 * (0.57 / Math.atan(WHEELBASE * Math.max(0.0001, k)) - 1);
      const laneSpeed = Math.min(MAX_SPEED, Math.max(65, steeringCap), Math.sqrt(850 / Math.max(0.0001,k)));
      planned = planned * (1 - state.blend) + laneSpeed * state.blend;
    }
    desired = Math.min(desired, Math.sqrt(planned ** 2 + 2 * BRAKE_DECELERATION * ahead));
  }
  // The straight-latched pace is held through the corner, below the physical
  // envelope. Traffic and asphalt safeguards always take priority.
  desired *= Math.min(1, state.pace);
  for (const other of traffic) {
    if (other.gap <= 0) continue;
    const currentOverlap = Math.abs(other.offset - car.projection.offset) < 38;
    const targetOverlap = Math.abs(other.offset - state.lane) < 38;
    if (!currentOverlap && !(useLane && targetOverlap)) continue;
    // Brake for the closing distance until lateral separation actually exists.
    const separation = Math.min(Math.abs(other.offset - car.projection.offset),
      useLane ? Math.abs(other.offset - state.lane) : Infinity);
    const reserve = (other.speed < 50 ? Math.sqrt(Math.max(0, CLEARANCE ** 2 - separation ** 2)) : 45) +
      speed * 0.055;
    const safeSpeed = Math.sqrt(other.speed ** 2 + 2 * BRAKE_DECELERATION * Math.max(0, other.gap - reserve));
    desired = Math.min(desired, safeSpeed);
  }
  // Predict the car's swept body near the asphalt edge and steer inward before
  // it reaches the kerb. This is a control input, never a position clamp.
  const safetyTime = 0.4 - state.blend * (fastBattle ? 0 : 0.1);
  const turn = car.yawRate * safetyTime * 0.5;
  const predicted = track.project({
    x: car.x + (car.vx * Math.cos(turn) - car.vy * Math.sin(turn)) * safetyTime,
    y: car.y + (car.vx * Math.sin(turn) + car.vy * Math.cos(turn)) * safetyTime,
  });
  const futureAngle = wrapAngle(car.heading + car.yawRate * safetyTime - predicted.heading);
  const extent = Math.abs(Math.sin(futureAngle)) * 23 + Math.abs(Math.cos(futureAngle)) * 13;
  const excess = Math.abs(predicted.offset) + extent - (track.width / 2 - 5 - state.blend * (fastBattle ? 6 : 11));
  if (excess > 0) {
    steer = clamp(steer - Math.sign(predicted.offset) * clamp(excess / 18, 0, 0.9), -1, 1);
    desired = Math.min(desired, Math.max(45, car.speed - excess * 3));
  }
  // The long prediction can look safe while a lane change briefly sweeps the
  // rear corner over a kerb. Also protect the body's immediate outward motion.
  const bodyAngle = wrapAngle(car.heading - car.projection.heading);
  const bodyNow = Math.abs(car.projection.offset) +
    Math.abs(Math.sin(bodyAngle)) * 23 + Math.abs(Math.cos(bodyAngle)) * 13;
  const outward = Math.sign(car.projection.offset) *
    (-car.vx * Math.sin(car.projection.heading) + car.vy * Math.cos(car.projection.heading));
  const immediateExcess = bodyNow + Math.max(0, outward) * 0.18 - (track.width / 2 - 2);
  if (traffic.length > 0 && immediateExcess > 0 && outward > 0) {
    steer = clamp(steer - Math.sign(car.projection.offset) * clamp(immediateExcess / 12, 0, 0.65), -1, 1);
    desired = Math.min(desired, Math.max(45, car.speed - immediateExcess * 3));
  }
  if (Math.abs(error) > 0.8 || car.isOffTrack) desired = Math.min(desired, 100);

  return {
    throttle: car.speed < desired ? (straight ? Math.min(1, state.pace) : 1) : 0,
    brake: clamp((car.speed - desired) / 35, 0, 1),
    steer,
  };
}
