# APEX — Evergreen GP

A responsive, playable top-down racing simulator built with Vite, TypeScript, and HTML5 Canvas. Start immediately with seven cars, Medium difficulty, and three laps, or open Race setup to choose Easy / Medium / Hard, 2–10 cars, and 1–10 laps. No runtime dependencies or external assets are required.

## Run

```sh
npm install
npm run dev -- --port 5173
```

Open <http://localhost:5173>. Use Node.js 22.12+ or 24+. On a machine that requires its system certificate store for npm, use `NODE_USE_SYSTEM_CA=1 npm install` with a Node version supporting that option.

```sh
npm run build    # Strict TypeScript check and production bundle in dist/
npm test         # Physics, collisions, checkpoints, and complete AI races
npm run preview  # Serve the production bundle
```

## Controls

| Action                        | Keyboard                   |
| ----------------------------- | -------------------------- |
| Accelerate                    | W / ↑                      |
| Brake                         | S / ↓                      |
| Steer                         | A, D / ←, →                |
| Handbrake / drift             | Space                      |
| Reset race to the grid        | R                          |
| Pause / resume                | P / Escape                 |
| Follow car / circuit overview | C                          |
| Start race                    | Enter or Start race button |

Touch devices and narrow screens show steering, gas, brake, and drift buttons. Hold buttons to drive; simultaneous pointers are supported. The toolbar offers camera, pause, and reset controls. The Racing Line toggle shows a thin dotted trace of your actual fastest lap. There is no line until a PB trajectory exists; no suggested braking or acceleration colours are displayed. Switching tabs or losing window focus pauses the race.

All cars stay stationary through the 3–2–1 countdown, then GO releases the grid. Hold S / ↓ (or the touch BRAKE / R pedal) to brake to a stop, then engage reverse after a short neutral dwell. Reverse is capped at 39.6 km/h and steering reverses naturally. Hold W / ↑ to brake out of reverse and return to drive. Low-speed runoff traction and sliding wall contacts allow recovery without resetting.

Track PB, race PB, completed races, and wins persist locally when browser storage is available. Race PBs compare identical difficulty, car count, and lap count; wins are cumulative. Track PB time and trajectory are saved together. Existing time-only records migrate automatically and gain a trace when beaten. Blocked storage falls back to in-memory records. Timing uses ordered sector gates and forward track progress; backing across the start line or teleporting between checkpoints cannot award a lap.

## Modules

- `src/physics.ts` — fixed-step bicycle steering, acceleration/braking, lateral tire grip, handbrake slip, grass drag, barrier response, and car contacts.
- `src/track.ts` — a closed Catmull–Rom spline with distance sampling and nearest-segment projection.
- `src/ai.ts` — difficulty-specific pace, slip/steering anticipation, inside/outside passing with blocked-lane switching, Hard braking-zone defence, predictive asphalt-edge avoidance, and stopped-traffic reverse recovery. All drivers plan from the same simulation instant. All cars share the same physics; there is no rubber banding or AI position clamping.
- `src/racing-line.ts` — multiscale constrained lap-time optimization inside the asphalt margins, with curvature/steering limits and a cyclic acceleration/braking speed envelope. The line is a numerical local optimum of that vehicle model, not a guaranteed global optimum. This private route is only used by the AI.
- `src/setup.ts`, `src/grid.ts` — validated race options and spaced grid slots, with the player starting mid-to-back.
- `src/lap-trace.ts` — bounded spatial sampling of the player’s actual trajectory, with interpolated finish-line endpoints.
- `src/records.ts` — validated, versioned persistence, race-format record keys, and legacy lap-record migration.
- `src/race.ts` — configurable lap timing, ordered sectors, splits, and standings.
- `src/renderer.ts` — cached circuit scenery, kerbs, grid markings, cars, smoothing camera, and fading asphalt skid marks.
- `src/input.ts` — keyboard and multi-pointer driving controls.
- `src/hud.ts`, `src/hud.css` — responsive speed/gear/RPM telemetry, splits, leaderboard, minimap, start/pause/finish overlays.
- `src/main.ts` — app shell, grid/countdown lifecycle, 120 Hz simulation, and requestAnimationFrame rendering.

The HUD was implemented through `delegate_task` using provider `claudeAgent`, model `claude-opus-5-5`, against the shared contract in `src/hud-types.ts`, then integrated and verified with the simulation.

The simulator uses an approachable arcade driving model with speed-dependent steering and tire slip. Forward gears and RPM are automatic telemetry derived from speed; reverse is a real signed drivetrain state. Rendering targets 60 FPS, limits pixel density to 2×, and caps catch-up time after slow frames.


## v3 validation

`npm test` covers PB trajectory recording and reload, old time-only records, bounded traces, slower-lap rejection, moving/stopped traffic passes, changing a blocked passing lane, defence, and full-body asphalt clearance after contacts.

Deterministic 120 Hz simulations, same car/engine/tyre model as the player:

| Difficulty | Standing-start lap | Mean of next 3 flying laps |
| --- | ---: | ---: |
| Easy | 21.987 s | 20.410 s |
| Medium | 17.855 s | 16.417 s |
| Hard | 16.027 s | 14.625 s |

All ten-car fields complete four laps on each difficulty with zero off-asphalt body-corner samples. Hard's maximum body-corner distance from the track centre is 66.51 units against a 75-unit asphalt half-width. The assertions inspect all four body corners every fixed step after collisions, rather than accepting a percentage of off-road time. Congested laps naturally take longer than the solo benchmark; these are measured simulations, not a claim of a globally optimal lap or a guarantee against a player deliberately ramming a rival off-road.
