# APEX — Evergreen GP

A responsive, playable top-down racing simulator built with Vite, TypeScript, and HTML5 Canvas. Start immediately with seven cars, Dynamic AI, and three laps, or open Race setup to choose 2–10 cars and 1–10 laps. The field learns your pace from recent sectors and laps and remembers it for rematches in the same session. No runtime dependencies or external assets are required.

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
| Reset race to the grid        | R                          |
| Pause / resume                | P / Escape                 |
| Follow car / circuit overview | C                          |
| Start race                    | Enter or Start race button |

Touch devices use a floating analog stick: touch anywhere on the left and drag to steer. The right thumb can slide between large gas and brake pads without lifting. Both thumbs work simultaneously. Landscape fills the viewport with a closer chase camera, compact timing, a minimap, and expandable standings. Portrait remains playable with a rotation hint. Desktop retains the toolbar for camera, pause, and reset. The Racing Line toggle shows a thin dotted trace of your actual fastest lap. There is no line until a PB trajectory exists; no suggested braking or acceleration colours are displayed. Switching tabs or losing window focus pauses the race.

All cars stay stationary through the 3–2–1 countdown, then GO releases the grid. Hold S / ↓ (or the touch BRAKE / R pedal) to brake to a stop, then engage reverse after a short neutral dwell. Reverse is capped at 39.6 km/h and steering reverses naturally. Hold W / ↑ to brake out of reverse and return to drive. Low-speed runoff traction and sliding wall contacts allow recovery without resetting.

Track PB, race PB, completed races, and wins persist locally when browser storage is available. Race PBs compare identical Dynamic AI car and lap counts; wins are cumulative. A faster PB updates the time; if that lap has no valid trajectory, the previous complete ghost stays saved. Rejected samples invalidate only the current trace, and recording recovers at the next lap boundary. Legacy difficulty race records remain separate from Dynamic AI race records. Existing time-only records migrate automatically and gain a trace when beaten. Blocked storage falls back to in-memory records. Timing uses ordered sector gates and forward track progress; backing across the start line or teleporting between checkpoints cannot award a lap.

## Modules

- `src/physics.ts` — fixed-step bicycle steering, acceleration/braking, lateral tire grip, grass drag, barrier response, and car contacts.
- `src/track.ts` — a closed Catmull–Rom spline with distance sampling and nearest-segment projection.
- `src/ai.ts` — pace-aware throttle and braking, slip/steering anticipation, inside/outside passing with blocked-lane switching, braking-zone defence, predictive asphalt-edge avoidance, and stopped-traffic reverse recovery. All drivers plan from the same simulation instant and share the same physics.
- `src/ai-pace.ts` — EWMA player lap/sector estimates that discount opening-lap congestion, time held behind slower traffic and incidents, a calibrated pace response spanning approximately 13–33 s laps, per-car spread, and clamped pressure from unwrapped race gaps. The controller adjusts the target gradually on straights and holds it through corners; it cannot exceed the physical speed envelope. A car five seconds behind pushes toward that ceiling, while leaders ease for slower players. Traffic-delayed samples can improve the estimate but cannot detune the field; clean slower sectors still teach slower pace. Faster cars lapping a beginner are excluded from the blockage filter.
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


## Validation

`npm test` covers ghost rejection/recovery, time-only PB persistence, ordered checkpoints, drivetrain and runoff recovery, dynamic pace smoothing, actual lap matching for 15/18/22 s players, rematch learning, traffic feedback across complete races/rematches, and real lap-time changes, drafting, moving/stopped traffic passes, blocked passing lanes, defence, and full-body asphalt clearance after contacts.

The deterministic 120 Hz solo benchmark produces a 14.254 s standing-start lap and approximately 12.84 s flying laps with the same engine, brakes, steering and tyres as the player. All four body corners are checked at every step. The four-lap ten-car dynamic field also completes with zero off-asphalt body-corner samples. Congestion naturally changes race pace; the controller cannot guarantee asphalt clearance if a human deliberately rams a rival.

The AI planner uses a 32-unit body/tracking margin (43 units of usable half-width), the shared 560-unit maximum speed and 460-unit braking deceleration. Preventing collapsed optimizer segments avoids misleading hairpin shortcuts. Passing lanes use their own curvature limits instead of a blanket speed penalty. A committed pass brakes later, and an aligned straight-line tow reduces aerodynamic drag for both player and AI without changing engine power or maximum speed.

Independent Claude Opus 5.5 QA passed all 31 unit/simulation tests, the production build, desktop and mobile Chromium checks, Dynamic AI setup, actual lap recording/rendering, and ghost persistence across a new race and reload, with zero console/page errors. Beginner adaptation and repeated-race learning were verified in the live app. Development diagnostics are read-only; no QA autoplay hooks ship in production.

Known limitation: in a slow pack jam, a car recovering at a large angle can briefly put its body corners over the asphalt edge while its centre remains on track. QA observed recovery within about three seconds and classified this as nonblocking. The fast solo and deterministic ten-car benchmarks above check full-body clearance; they do not guarantee it for every traffic recovery.
