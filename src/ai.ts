import { clamp, Track, wrapAngle } from "./track";
import { steeringAngle, WHEELBASE } from "./physics";
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
  easy: {
    pace: 0.68,
    cornerGrip: 0.76,
    brakingHorizon: 210,
    brakeStrength: 0.72,
    launch: 0.56,
    overtakeDistance: 75,
    defend: false,
  },
  medium: {
    pace: 0.89,
    cornerGrip: 0.94,
    brakingHorizon: 130,
    brakeStrength: 0.88,
    launch: 0.88,
    overtakeDistance: 135,
    defend: false,
  },
  hard: {
    pace: 1.03,
    cornerGrip: 1.08,
    brakingHorizon: 65,
    brakeStrength: 1,
    launch: 1,
    overtakeDistance: 190,
    defend: true,
  },
};
interface AIState {
  lane: number;
  stuck: number;
  reverseFor: number;
  age: number;
  passSide: number;
  defendFor: number;
  defendCooldown: number;
}
const states = new WeakMap<Car, AIState>();

/** Model-predictive speed targets on the optimized trajectory, with committed
 * passing lanes, one defensive move per approach, and reverse recovery.
 * All drivers use the player's physics and engine limits; no rubber banding.
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
    state = {
      lane: 0,
      stuck: 0,
      reverseFor: 0,
      age: 0,
      passSide: 0,
      defendFor: 0,
      defendCooldown: 0,
    };
    states.set(car, state);
  }
  state.age += dt;
  state.defendCooldown = Math.max(0, state.defendCooldown - dt);
  state.defendFor = Math.max(0, state.defendFor - dt);
  state.stuck =
    car.speed < 16 &&
    state.age > 3 &&
    state.reverseFor <= 0 &&
    car.driveDirection === 1
      ? state.stuck + dt
      : 0;
  if (state.stuck > 1.5) {
    state.reverseFor = 1.35;
    state.stuck = 0;
  }
  const directionError = wrapAngle(car.projection.heading - car.heading);
  if (state.reverseFor > 0) {
    state.reverseFor -= dt;
    return {
      throttle: 0,
      brake: 1,
      reverse: true,
      steer: -clamp(directionError * 1.3, -1, 1),
      handbrake: false,
    };
  }

  const distance = car.projection.distance;
  const lookahead = 60 + car.speed * 0.25;
  const line = track.racingLine;
  const route = line.pointAt(distance + lookahead);
  let lane = route.offset;
  let trafficSpeed = Infinity;
  let passing = false;
  for (const other of cars) {
    if (other === car || other.id === car.id) continue;
    let ahead = other.projection.distance - distance;
    if (ahead > track.length / 2) ahead -= track.length;
    if (ahead < -track.length / 2) ahead += track.length;
    const side = other.projection.offset;
    if (
      ahead > 0 &&
      ahead < profile.overtakeDistance &&
      Math.abs(other.speed - car.speed) < 240
    ) {
      if (state.passSide === 0) state.passSide = side > 0 ? -1 : 1;
      lane = clamp(side + state.passSide * 43, -43, 43);
      passing = true;
      if (ahead < 62 && Math.abs(side - car.projection.offset) < 31)
        trafficSpeed = Math.max(35, other.speed - (62 - ahead) * 1.4);
    }
    // Hard covers the inside when approached, but never swerves beside a car.
    if (
      profile.defend &&
      ahead < -45 &&
      ahead > -150 &&
      other.speed > car.speed - 15 &&
      state.defendCooldown === 0
    ) {
      state.defendFor = 1.1;
      state.defendCooldown = 4;
    }
  }
  if (!passing) state.passSide = 0;
  if (state.defendFor > 0 && !passing) {
    const corner = line.pointAt(distance + 180).curvature;
    lane = Math.sign(corner || 1) * 30;
  }
  state.lane += (lane - state.lane) * (1 - Math.exp(-3.5 * dt));
  const target = track.pointAt(
    distance + lookahead,
    clamp(state.lane, -46, 46),
  );
  const error = wrapAngle(
    Math.atan2(target.y - car.y, target.x - car.x) - car.heading,
  );
  const curvature =
    (2 * Math.sin(error)) /
    Math.max(35, Math.hypot(target.x - car.x, target.y - car.y));
  const steer = clamp(
    Math.atan(curvature * WHEELBASE) / steeringAngle(car.speed),
    -1,
    1,
  );
  let desired = 535 * profile.pace;
  for (let ahead = 0; ahead <= 320; ahead += 35) {
    const plan = line.pointAt(distance + ahead + profile.brakingHorizon);
    const corner = Math.sqrt(
      (410 * profile.cornerGrip) / Math.max(0.0001, Math.abs(plan.curvature)),
    );
    const planned = Math.min(plan.speed * profile.pace, corner);
    desired = Math.min(desired, Math.sqrt(planned ** 2 + 2 * 280 * ahead));
  }
  // Leaving the line to pass/defend requires a little extra cornering margin.
  desired *= passing || state.defendFor > 0 ? 0.94 : 1;
  desired = Math.min(desired, trafficSpeed);
  if (Math.abs(error) > 0.7 || car.isOffTrack) desired = Math.min(desired, 125);
  const launch = state.age < 2.5 ? profile.launch : 1;
  return {
    throttle: car.speed < desired ? launch : 0,
    brake: clamp((car.speed - desired) / 45, 0, profile.brakeStrength),
    steer,
    handbrake: false,
  };
}
