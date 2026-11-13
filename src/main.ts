import "./style.css";
import { Track, clamp } from "./track";
import { constrainToTrack, resolveCarCollisions, slipstream, stepCar } from "./physics";
import { createGrid } from "./grid";
import { DEFAULT_SETUP, normalizeSetup } from "./setup";
import type { RaceSetup } from "./setup";
import { PersonalRecords, browserRecordStorage } from "./records";
import { getAIInput } from "./ai";
import { DynamicPace } from "./ai-pace";
import { Race } from "./race";
import { Renderer } from "./renderer";
import { InputController, TOUCH_QUERY } from "./input";
import { createHUD } from "./hud";
import type { HudTelemetry } from "./hud-types";
import "./mobile.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="./" aria-label="APEX home"><svg viewBox="0 0 40 32" aria-hidden="true"><path d="M0 29 17 2h9L10 29zm23 0 7-12 10 12z"/></svg><span>APEX<span class="brand-dot">®</span></span></a>
    <span class="brand-caption">THE ART OF THE RACING LINE</span>
    <div class="session"><span class="live-dot"></span> LOCAL SESSION <span class="version">/ 01</span></div>
  </header>
  <main class="shell">
    <section class="race-heading" aria-label="Circuit information">
      <div><div class="eyebrow">CIRCUIT 01 <span>/</span> CLUB SERIES</div><h1>Evergreen <span>GP.</span></h1></div>
      <div class="circuit-stats"><div><strong id="lap-count">03</strong><span>LAPS</span></div><div><strong id="car-count">07</strong><span>DRIVERS</span></div><div class="weather"><strong>☀ <span>22°</span></strong><span>DRY TRACK</span></div></div>
      <div class="toolbar"><button id="camera" class="tool-button" title="Switch camera (C)" aria-label="Switch to circuit overview"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4"/></svg><span>Overview</span></button><button id="pause" class="icon-button" title="Pause (P)" aria-label="Pause race"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4v12M13 4v12"/></svg></button><button id="reset" class="icon-button" title="Reset race (R)" aria-label="Reset race"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7a6 6 0 1 1 0 6M4 3v5h5"/></svg></button></div>
    </section>
    <section class="game-stage" aria-label="Racing simulator">
      <canvas id="race-canvas" aria-label="Top-down racing circuit. Steer with A/D or arrow keys, W for gas, S for brake and reverse. On touch screens, drag the left side to steer and use the pedals on the right." tabindex="0"></canvas>
      <div class="stage-topline"><span><i></i> EVERGREEN MOTORSPORT PARK</span><span class="stage-meta"><span id="session-status">GRID READY</span><span class="stage-meta__sep" aria-hidden="true">·</span><span id="fps">60 FPS</span></span></div>
      <div id="hud"></div>
      <div id="go-signal" aria-hidden="true">GO<span>FIND YOUR LINE</span></div>
      <div class="rotate-prompt"><span aria-hidden="true">↻</span> Rotate your phone for the best drive</div>
      <button class="touch-pause" aria-label="Pause race">Ⅱ</button>
      <div class="touch-controls" aria-label="Driving controls">
        <div class="touch-stick" aria-hidden="true"><i></i></div>
        <div class="touch-pedals"><button data-control="brake" class="touch-brake" aria-label="Brake or hold to reverse">BRAKE<span class="reverse-pedal-hint">/ R</span></button><button data-control="throttle" class="touch-gas" aria-label="Accelerate">GAS ↑</button></div>
      </div>
    </section>
    <footer class="race-footer"><div class="keyboard-guide"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <span class="or">/</span> <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd><b>DRIVE</b></span><span><kbd>R</kbd><b>RESET</b></span><span><kbd>P</kbd><b>PAUSE</b></span></div><button class="line-toggle" id="racing-line" aria-pressed="true" title="Your fastest lap, traced in dots. Appears after setting a Track PB."><span class="toggle-track"><i></i></span> RACING LINE</button></footer>
    <div class="bottom-note"><span>PRECISION OVER SPEED.</span><span>BUILT FOR THE NEXT LAP <span class="little-arrow">↗</span></span></div>
  </main>`;

const track = new Track();
const canvas = document.querySelector<HTMLCanvasElement>("#race-canvas")!;
const renderer = new Renderer(canvas, track);
const hudRoot = document.querySelector<HTMLElement>("#hud")!;
const stage = document.querySelector<HTMLElement>(".game-stage")!;
const status = document.querySelector<HTMLElement>("#session-status")!;
const goSignal = document.querySelector<HTMLElement>("#go-signal")!;
const cameraButton = document.querySelector<HTMLButtonElement>("#camera")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
let setup: RaceSetup = { ...DEFAULT_SETUP };
let cars = createGrid(track, setup);
let race = new Race(track, cars, setup.laps);
const dynamicPace = new DynamicPace(race);
const records = new PersonalRecords(browserRecordStorage());
let phase: HudTelemetry["phase"] = "ready";
let resumePhase: "countdown" | "racing" = "racing";
let countdown = 3;
let showLine = true;
let personalBest = false;
let racePersonalBest = false;
let lapCount = 0;
let accumulator = 0;
let lastTimestamp = 0;
let hudElapsed = 0;
let fpsTime = 0;
let fpsFrames = 0;
let frameId = 0;
const FIXED_STEP = 1 / 120;

function changeSetup(next: RaceSetup): void {
  if (phase !== "ready") return;
  setup = normalizeSetup(next);
  cars = createGrid(track, setup);
  race = new Race(track, cars, setup.laps);
  dynamicPace.resetRace();
  hud.update(telemetry());
  syncShell();
}
function focusTrack() {
  canvas.focus({ preventScroll: true });
}
function reset(start = true): void {
  cars = createGrid(track, setup);
  race = new Race(track, cars, setup.laps);
  dynamicPace.resetRace();
  phase = start ? "countdown" : "ready";
  countdown = 3;
  lapCount = 0;
  personalBest = false;
  racePersonalBest = false;
  accumulator = 0;
  renderer.reset();
  input.clear();
  hud.update(telemetry());
  syncShell();
  focusTrack();
}
function start(): void {
  if (phase === "ready" || phase === "finished") reset(true);
}
function pause(): void {
  if (phase === "paused") phase = resumePhase;
  else if (phase === "countdown" || phase === "racing") {
    resumePhase = phase;
    phase = "paused";
  } else return;
  accumulator = 0;
  input.clear();
  hud.update(telemetry());
  syncShell();
  focusTrack();
}
function camera(): void {
  renderer.overview = !renderer.overview;
  cameraButton.querySelector("span")!.textContent = renderer.overview
    ? "Follow car"
    : "Overview";
  cameraButton.setAttribute(
    "aria-label",
    renderer.overview
      ? "Switch to follow camera"
      : "Switch to circuit overview",
  );
  cameraButton.setAttribute("aria-pressed", String(renderer.overview));
  focusTrack();
}
const hud = createHUD(
  hudRoot,
  {
    points: track.points,
    width: track.width,
    bounds: track.bounds,
    sectorPoints: track.sectorDistances.map((distance) =>
      track.pointAt(distance),
    ),
  },
  {
    onStart: start,
    onRestart: () => reset(true),
    onResume: pause,
    onSetupChange: changeSetup,
    onSetup: () => reset(false),
  },
);
const input = new InputController(stage, {
  reset: () => reset(phase !== "ready"),
  pause,
  camera,
  start,
});
const touchDevice = matchMedia(TOUCH_QUERY);
const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
const desktopViewport = viewportMeta.content;
const viewportEvents = new AbortController();
function resizeViewport(): void {
  const viewport = window.visualViewport;
  const width = viewport?.width ?? innerWidth;
  const height = viewport?.height ?? innerHeight;
  if (touchDevice.matches) {
    stage.style.setProperty("--play-width", `${width}px`);
    stage.style.setProperty("--play-height", `${height}px`);
    viewportMeta.content = `${desktopViewport}, maximum-scale=1, user-scalable=no`;
  } else {
    stage.style.removeProperty("--play-width");
    stage.style.removeProperty("--play-height");
    viewportMeta.content = desktopViewport;
  }
  renderer.touchLandscape = touchDevice.matches && width > height;
  if (touchDevice.matches) input.clear();
}
resizeViewport();
window.addEventListener("resize", resizeViewport, { signal: viewportEvents.signal });
window.visualViewport?.addEventListener("resize", resizeViewport, { signal: viewportEvents.signal });
touchDevice.addEventListener("change", resizeViewport, { signal: viewportEvents.signal });
document
  .querySelector("#reset")!
  .addEventListener("click", () => reset(phase !== "ready"));
pauseButton.addEventListener("click", pause);
document.querySelector(".touch-pause")!.addEventListener("click", pause);
cameraButton.addEventListener("click", camera);
document.querySelector("#racing-line")!.addEventListener("click", (event) => {
  showLine = !showLine;
  (event.currentTarget as HTMLElement).setAttribute(
    "aria-pressed",
    String(showLine),
  );
  focusTrack();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (phase === "racing" || phase === "countdown")) pause();
});
window.addEventListener("blur", () => {
  if (phase === "racing" || phase === "countdown") pause();
});

function syncShell(): void {
  document.querySelector("#lap-count")!.textContent = String(
    setup.laps,
  ).padStart(2, "0");
  document.querySelector("#car-count")!.textContent = String(
    setup.cars,
  ).padStart(2, "0");
  stage.dataset.phase = phase;
  status.textContent = {
    ready: "GRID READY",
    countdown: "LIGHTS OUT SOON",
    racing: "RACE IN PROGRESS",
    paused: "SESSION PAUSED",
    finished: "CHEQUERED FLAG",
  }[phase];
  pauseButton.disabled = phase === "ready" || phase === "finished";
  pauseButton.setAttribute(
    "aria-label",
    phase === "paused" ? "Resume race" : "Pause race",
  );
  pauseButton.setAttribute("aria-pressed", String(phase === "paused"));
  goSignal.classList.toggle("visible", phase === "racing" && race.time < 1.15);
}
function telemetry(): HudTelemetry {
  const player = cars[0],
    progress = race.drivers.get("player")!;
  const standings = race.standings();
  const leader = standings[0];
  const speed = Math.round(player.speed * 0.36);
  const gear =
    player.driveDirection === -1
      ? -1
      : speed < 2
        ? 0
        : clamp(Math.floor(speed / 42) + 1, 1, 5);
  const recordSummary = records.summary(setup);
  return {
    phase,
    countdown: Math.ceil(countdown),
    speed,
    gear,
    rpm:
      gear === 0
        ? 0.08
        : gear === -1
          ? clamp(0.2 + speed / 50, 0, 1)
          : clamp(0.3 + ((speed % 42) / 42) * 0.7, 0, 1),
    lap: Math.min(progress.laps.length + 1, setup.laps),
    totalLaps: setup.laps,
    lapTime:
      progress.finishTime !== null
        ? progress.laps.at(-1)!
        : race.time - progress.lapStarted,
    bestLap: recordSummary.bestLap,
    raceTime: progress.finishTime ?? race.time,
    sector: progress.nextGate + 1,
    sectorSplits: progress.splits,
    sectorDelta: progress.sectorDelta,
    position: standings.findIndex((driver) => driver.id === "player") + 1,
    drivers: standings.map((driver, i) => {
      const car = cars.find((candidate) => candidate.id === driver.id)!;
      return {
        id: car.id,
        name: car.name,
        color: car.color,
        isPlayer: car.isPlayer,
        position: i + 1,
        lap: Math.min(driver.laps.length + 1, setup.laps),
        gap:
          i === 0
            ? "LEADER"
            : driver.finishTime !== null && leader.finishTime !== null
              ? `+${(driver.finishTime - leader.finishTime).toFixed(1)}s`
              : `+${Math.max(0, (leader.distance - driver.distance) * 0.1).toFixed(0)}m`,
        x: car.x,
        y: car.y,
        heading: car.heading,
      };
    }),
    isOffTrack: player.isOffTrack,
    bestLapIsPersonalBest: personalBest,
    completedLaps: progress.laps,
    setup: { ...setup },
    records: recordSummary,
    raceBestIsPersonalBest: racePersonalBest,
  };
}
function simulate(dt: number): void {
  if (phase === "countdown") {
    countdown -= dt;
    if (countdown <= 0) {
      phase = "racing";
      countdown = 0;
      syncShell();
    }
    return;
  }
  if (phase !== "racing") return;
  // Every driver plans against the same instant, independent of grid order.
  const paceTargets = dynamicPace.targets(race);
  const tows = cars.map((car) => slipstream(car, cars, track));
  const inputs = cars.map((car) => car.isPlayer ? input.read() :
    getAIInput(car, track, cars, paceTargets.get(car.id), dt));
  cars.forEach((car, i) => stepCar(car, inputs[i], track, dt, tows[i]));
  resolveCarCollisions(cars);
  for (const car of cars) constrainToTrack(car, track);
  race.step(cars, dt);
  dynamicPace.observe(race);
  renderer.recordSkids(cars, dt);
  const playerProgress = race.drivers.get("player")!;
  if (playerProgress.laps.length > lapCount) {
    lapCount = playerProgress.laps.length;
    const lap = playerProgress.laps.at(-1)!;
    const improved = records.recordLap(lap, race.playerLapValid ? race.playerLapPath : null);
    personalBest ||= improved;
  }
  if (playerProgress.finishTime !== null) {
    const position =
      race.standings().findIndex((driver) => driver.id === "player") + 1;
    racePersonalBest = records.finishRace(
      playerProgress.finishTime,
      position,
      setup,
    );
    phase = "finished";
    input.clear();
    syncShell();
  }
}
function frame(timestamp: number): void {
  const elapsed = lastTimestamp
    ? Math.min((timestamp - lastTimestamp) / 1000, 0.1)
    : 1 / 60;
  lastTimestamp = timestamp;
  accumulator += elapsed;
  while (accumulator >= FIXED_STEP) {
    simulate(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }
  renderer.setGhostPath(records.bestLapPath);
  renderer.render(cars, elapsed, phase, showLine);
  hudElapsed += elapsed;
  if (hudElapsed >= 1 / 20) {
    hudElapsed = 0;
    hud.update(telemetry());
    syncShell();
  }
  fpsTime += elapsed;
  fpsFrames++;
  if (fpsTime >= 0.75) {
    document.querySelector("#fps")!.textContent =
      `${Math.round(fpsFrames / fpsTime)} FPS`;
    fpsTime = 0;
    fpsFrames = 0;
  }
  frameId = requestAnimationFrame(frame);
}
hud.update(telemetry());
syncShell();
frameId = requestAnimationFrame(frame);

// Read-only diagnostics for browser verification; no gameplay automation in production.
if (import.meta.env.DEV)
  Object.defineProperty(window, "__APEX__", {
    configurable: true,
    get: () => ({
      state: telemetry(),
      cars: cars.map((car) => ({
        id: car.id,
        x: car.x,
        y: car.y,
        heading: car.heading,
        speed: car.speed,
        forwardSpeed: car.forwardSpeed,
        driveDirection: car.driveDirection,
        offTrack: car.isOffTrack,
      })),
      input: input.read(),
      camera: renderer.cameraState,
      trackLength: track.length,
      skidMarks: renderer.skidMarkCount,
      racingLine: {
        visible: showLine && records.bestLapPath !== null,
        ghostPoints: records.bestLapPath?.length ?? 0,
      },
    }),
  });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frameId);
    renderer.destroy();
    input.destroy();
    hud.destroy();
    viewportEvents.abort();
  });
