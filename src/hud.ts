import "./hud.css";
import { DEFAULT_SETUP } from "./setup";
import type { RaceSetup } from "./setup";
import type {
  HudActions,
  HudController,
  HudDriver,
  HudTelemetry,
  HudTrack,
} from "./hud-types";

type Phase = HudTelemetry["phase"];

const RPM_SEGMENTS = 18;
const SECTOR_COUNT = 3;
let idCounter = 0;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function setClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function formatTime(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t) || t < 0) return "-:--.---";
  const totalMs = Math.floor(t * 1000 + 1e-6);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${minutes}:${pad(seconds, 2)}.${pad(ms, 3)}`;
}

function formatSplit(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t) || t < 0) return "--.---";
  if (t >= 60) return formatTime(t);
  return t.toFixed(3);
}

function formatDelta(d: number): string {
  const sign = d < 0 ? "−" : "+";
  return `${sign}${Math.abs(d).toFixed(3)}`;
}

function formatGear(gear: number): string {
  if (gear === 0) return "N";
  if (gear < 0) return "R";
  return String(Math.round(gear));
}

/* ------------------------------------------------------------------ */
/* Minimap                                                             */
/* ------------------------------------------------------------------ */

class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly base: HTMLCanvasElement;
  private readonly track: HudTrack;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private lastDrivers: HudDriver[] = [];
  private readonly observer: ResizeObserver | null;

  constructor(track: HudTrack) {
    this.track = track;
    this.canvas = el("canvas", "hud-map__canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.ctx = this.canvas.getContext("2d");
    this.base = document.createElement("canvas");
    this.observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => this.resize())
        : null;
    this.observer?.observe(this.canvas);
  }

  destroy(): void {
    this.observer?.disconnect();
  }

  private project(x: number, y: number): [number, number] {
    const b = this.track.bounds;
    return [
      this.offX + (x - b.minX) * this.scale,
      this.offY + (y - b.minY) * this.scale,
    ];
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 2 || h < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;

    const b = this.track.bounds;
    const pad = Math.max(12, Math.min(w, h) * 0.12);
    const tw = Math.max(1, b.maxX - b.minX);
    const th = Math.max(1, b.maxY - b.minY);
    this.scale = Math.min((w - pad * 2) / tw, (h - pad * 2) / th);
    this.offX = (w - tw * this.scale) / 2;
    this.offY = (h - th * this.scale) / 2;
    this.drawBase();
    this.draw(this.lastDrivers);
  }

  private drawBase(): void {
    const ctx = this.base.getContext("2d");
    if (!ctx) return;
    const pts = this.track.points;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (pts.length < 2) return;

    const trace = (): void => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.project(p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Tarmac band
    trace();
    ctx.strokeStyle = "rgba(237, 240, 232, 0.10)";
    ctx.lineWidth = Math.max(4, this.track.width * this.scale);
    ctx.stroke();
    // Circuit outline (the main canvas alone displays the player’s PB ghost).
    trace();
    ctx.strokeStyle = "rgba(237, 240, 232, 0.62)";
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Start / finish tick
    const [sx, sy] = this.project(pts[0].x, pts[0].y);
    const [nx, ny] = this.project(pts[1].x, pts[1].y);
    let dx = nx - sx;
    let dy = ny - sy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const half = Math.max(5, (this.track.width * this.scale) / 2 + 2);
    ctx.beginPath();
    ctx.moveTo(sx - dy * half, sy + dx * half);
    ctx.lineTo(sx + dy * half, sy - dx * half);
    ctx.strokeStyle = "#d5f55b";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sector markers + labels, pushed outward from the circuit centroid
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    [cx, cy] = this.project(cx / pts.length, cy / pts.length);
    ctx.font = '600 9px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.track.sectorPoints.forEach((p, i) => {
      const [x, y] = this.project(p.x, p.y);
      let ox = x - cx;
      let oy = y - cy;
      const ol = Math.hypot(ox, oy) || 1;
      ox /= ol;
      oy /= ol;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#8e9b90";
      ctx.fill();
      const lx = Math.min(this.cssW - 8, Math.max(8, x + ox * 11));
      const ly = Math.min(this.cssH - 6, Math.max(6, y + oy * 11));
      ctx.fillStyle = "rgba(142, 155, 144, 0.95)";
      ctx.fillText(`S${i + 1}`, lx, ly);
    });
  }

  draw(drivers: HudDriver[]): void {
    this.lastDrivers = drivers;
    const ctx = this.ctx;
    if (!ctx || this.cssW === 0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    let player: HudDriver | null = null;
    for (const d of drivers) {
      if (d.isPlayer) {
        player = d;
        continue;
      }
      const [x, y] = this.project(d.x, d.y);
      ctx.beginPath();
      ctx.arc(x, y, 3.25, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(16, 20, 18, 0.9)";
      ctx.stroke();
    }
    if (player) {
      const [x, y] = this.project(player.x, player.y);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(213, 245, 91, 0.18)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#edf0e8";
      ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export function createHUD(
  root: HTMLElement,
  track: HudTrack,
  actions: HudActions,
): HudController {
  const uid = `hud${++idCounter}`;
  let phase: Phase | null = null;
  let destroyed = false;

  const hud = el("div", "hud");
  hud.dataset.phase = "ready";

  /* ---------- live status (phase changes only) ---------- */
  const status = el("div", "hud-sr");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  /* ---------- top-left: timing ---------- */
  const tl = el("div", "hud-tl hud-fade");

  const timing = el("section", "hud-panel hud-timing");
  timing.setAttribute("aria-label", "Lap timing");
  const tRow = el("div", "hud-timing__row");
  const lapBox = el("div", "hud-timing__lap");
  lapBox.append(el("span", "hud-label", "Lap"));
  const lapValue = el("span", "hud-mono hud-timing__lapval", "1/3");
  lapBox.append(lapValue);
  const bestBox = el("div", "hud-timing__best");
  bestBox.append(el("span", "hud-label", "PB"));
  bestBox.title = "Track personal best — saved across sessions";
  const bestValue = el("span", "hud-mono", formatTime(null));
  const pbBadge = el("span", "hud-badge", "NEW");
  pbBadge.hidden = true;
  bestBox.append(bestValue, pbBadge);
  tRow.append(lapBox, bestBox);

  const lapTimeRow = el("div", "hud-timing__main");
  const lapTime = el("span", "hud-mono hud-timing__time", formatTime(0));
  const delta = el("span", "hud-mono hud-delta");
  delta.hidden = true;
  lapTimeRow.append(lapTime, delta);

  const sectors = el("div", "hud-sectors");
  const sectorCells: { cell: HTMLElement; value: HTMLElement }[] = [];
  for (let i = 0; i < SECTOR_COUNT; i++) {
    const cell = el("div", "hud-sector");
    cell.append(el("span", "hud-sector__label", `S${i + 1}`));
    const value = el("span", "hud-mono hud-sector__value", formatSplit(null));
    cell.append(value);
    sectors.append(cell);
    sectorCells.push({ cell, value });
  }
  const timingRecords = el("div", "hud-timing__records hud-mono");
  const position = el("span", "hud-position hud-mono");
  timing.append(tRow, lapTimeRow, sectors, timingRecords, position);

  /* ---------- left: leaderboard ---------- */
  const lb = el("section", "hud-panel hud-lb hud-fade");
  lb.setAttribute("aria-label", "Standings");
  const lbHead = el("div", "hud-lb__head");
  lbHead.append(el("span", "hud-label", "Standings"));
  const lbPos = el("span", "hud-mono hud-lb__pos", "P-");
  lbHead.append(lbPos);
  const lbToggle = el("button", "hud-lb__toggle");
  lbToggle.type = "button";
  lbToggle.setAttribute("aria-expanded", "false");
  lbToggle.setAttribute("aria-controls", `${uid}-lb`);
  const lbToggleLabel = el("span", "hud-label", "Standings");
  const lbTogglePos = el("span", "hud-mono hud-lb__pos", "P-");
  const lbChevron = el("span", "hud-lb__chev");
  lbChevron.setAttribute("aria-hidden", "true");
  lbToggle.append(lbToggleLabel, lbTogglePos, lbChevron);
  const lbList = el("ol", "hud-lb__list");
  lbList.id = `${uid}-lb`;
  lb.append(lbHead, lbToggle, lbList);
  const lbRows = new Map<
    string,
    {
      row: HTMLLIElement;
      pos: HTMLElement;
      swatch: HTMLElement;
      name: HTMLElement;
      gap: HTMLElement;
    }
  >();
  let lbOrder = "";

  const onToggle = (): void => {
    const open = lbToggle.getAttribute("aria-expanded") !== "true";
    lbToggle.setAttribute("aria-expanded", String(open));
    setClass(lb, "is-expanded", open);
  };
  lbToggle.addEventListener("click", onToggle);

  tl.append(timing, lb);

  /* ---------- bottom-left: speed cluster ---------- */
  const speed = el("section", "hud-speed hud-fade");
  speed.setAttribute("aria-label", "Speed, gear and engine");
  const flags = el("div", "hud-flags");
  const offChip = el("span", "hud-chip hud-chip--off", "Off track");
  offChip.hidden = true;
  flags.append(offChip);

  const speedMain = el("div", "hud-speed__main");
  const speedNum = el("span", "hud-mono hud-speed__num", "0");
  const speedUnit = el("span", "hud-speed__unit", "km/h");
  const gearBox = el("div", "hud-gear");
  gearBox.append(el("span", "hud-gear__label", "Gear"));
  const gearNum = el("span", "hud-mono hud-gear__num", "N");
  gearBox.append(gearNum);
  const speedRead = el("div", "hud-speed__read");
  speedRead.append(speedNum, speedUnit);
  speedMain.append(speedRead, gearBox);

  const rpmBar = el("div", "hud-rpm");
  rpmBar.setAttribute("aria-hidden", "true");
  const rpmSegs: HTMLElement[] = [];
  for (let i = 0; i < RPM_SEGMENTS; i++) {
    const seg = el("span", "hud-rpm__seg");
    if (i >= RPM_SEGMENTS - 3) seg.classList.add("is-red");
    else if (i >= RPM_SEGMENTS - 6) seg.classList.add("is-high");
    rpmBar.append(seg);
    rpmSegs.push(seg);
  }
  let rpmLit = -1;
  speed.append(flags, speedMain, rpmBar);

  /* ---------- bottom-right: minimap ---------- */
  const mapPanel = el("section", "hud-panel hud-map hud-fade");
  mapPanel.setAttribute("aria-label", "Circuit map");
  const mapHead = el("div", "hud-map__head");
  mapHead.append(el("span", "hud-label", "Circuit"));
  const mapSector = el("span", "hud-mono hud-map__sector", "S1");
  mapHead.append(mapSector);
  const minimap = new Minimap(track);
  mapPanel.append(mapHead, minimap.canvas);

  /* ---------- countdown ---------- */
  const countdown = el("div", "hud-countdown");
  countdown.setAttribute("aria-hidden", "true");
  const countNum = el("span", "hud-mono hud-countdown__num", "3");
  const countLabel = el("span", "hud-countdown__label", "Get ready");
  countdown.append(countNum, countLabel);

  /* ---------- overlays ---------- */
  function makeOverlay(
    name: string,
    titleId: string,
  ): { overlay: HTMLElement; card: HTMLElement } {
    const overlay = el("div", `hud-overlay hud-overlay--${name}`);
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
    const card = el("section", "hud-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    card.setAttribute("aria-labelledby", titleId);
    overlay.append(card);
    return { overlay, card };
  }

  function makeCta(label: string, onClick: () => void): HTMLButtonElement {
    const btn = el("button", "hud-cta");
    btn.type = "button";
    btn.append(el("span", "", label));
    const arrow = el("span", "hud-cta__arrow", "→");
    arrow.setAttribute("aria-hidden", "true");
    btn.append(arrow);
    btn.addEventListener("click", () => {
      onClick();
      btn.blur();
    });
    // Keep the game's global key handlers from double-handling Enter/Space.
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") e.stopPropagation();
    });
    return btn;
  }

  // Ready
  const ready = makeOverlay("ready", `${uid}-ready-title`);
  ready.card.classList.add("hud-card--ready");
  const readyCopy = el("p", "hud-copy");
  function recordStrip() {
    const element = el("dl", "hud-records");
    const values = ["Track PB", "Race PB", "Wins"].map((label) => {
      const cell = el("div");
      const value = el("dd", "hud-mono");
      cell.append(el("dt", "hud-label", label), value);
      element.append(cell);
      return value;
    });
    return { element, values };
  }
  const readyRecords = recordStrip();
  const setupPanel = el("details", "hud-setup");
  const setupSummary = el("summary");
  const setupDescription = el("span", "hud-mono");
  setupSummary.append(el("span", "", "Race setup"), setupDescription);
  const setupFields = el("div", "hud-setup__fields");
  const carsInput = el("input");
  carsInput.type = "range";
  carsInput.min = "2";
  carsInput.max = "10";
  carsInput.step = "1";
  carsInput.id = `${uid}-cars`;
  carsInput.setAttribute("aria-label", "Total cars");
  const carsValue = el("output", "hud-mono");
  carsValue.htmlFor = carsInput.id;
  const lapsInput = el("input");
  lapsInput.type = "number";
  lapsInput.min = "1";
  lapsInput.max = "10";
  lapsInput.step = "1";
  lapsInput.id = `${uid}-laps`;
  lapsInput.setAttribute("aria-label", "Race laps");
  for (const [title, field, output] of [
    ["Cars", carsInput, carsValue],
    ["Laps", lapsInput],
  ] as const) {
    const row = el("div", "hud-setup__row");
    const label = el("label", "hud-label", title);
    label.htmlFor = field.id;
    row.append(label, field);
    if (output) row.append(output);
    setupFields.append(row);
  }
  const setupHint = el("p", "hud-setup__hint");
  setupFields.append(setupHint);
  setupPanel.append(setupSummary, setupFields);
  const setupChanged = () => {
    if (phase !== "ready") return;
    actions.onSetupChange({
      cars: Number(carsInput.value),
      laps: Number(lapsInput.value),
    });
  };
  carsInput.addEventListener("input", setupChanged);
  lapsInput.addEventListener("change", setupChanged);
  {
    const eyebrow = el("p", "hud-eyebrow");
    eyebrow.append(
      el("span", "hud-eyebrow__dot"),
      document.createTextNode("Your next personal best"),
    );
    const title = el("h2", "hud-title", "Find your racing line.");
    title.id = `${uid}-ready-title`;
    const cta = makeCta("Start race", () => {
      if (phase === "ready") actions.onStart();
    });
    const keys = el("ul", "hud-keys");
    keys.setAttribute("aria-label", "Keyboard controls");
    const keyRows: [string[], string][] = [
      [["W", "↑"], "Throttle"],
      [["S", "↓"], "Brake / reverse"],
      [["A", "D"], "Steer"],
      [["P"], "Pause"],
      [["R"], "Reset"],
    ];
    for (const [caps, label] of keyRows) {
      const li = el("li", "hud-keys__item");
      const capWrap = el("span", "hud-keys__caps");
      for (const c of caps) capWrap.append(el("kbd", "hud-kbd", c));
      li.append(capWrap, el("span", "hud-keys__label", label));
      keys.append(li);
    }
    const touchHint = el(
      "p",
      "hud-touch-hint",
      "Drag anywhere on the left to steer. Slide between GAS and BRAKE on the right. Hold BRAKE to stop, then reverse.",
    );
    const actionsRow = el("div", "hud-card__actions");
    actionsRow.append(cta);
    ready.card.append(
      eyebrow,
      title,
      readyCopy,
      readyRecords.element,
      setupPanel,
      actionsRow,
      keys,
      touchHint,
    );
  }
  const readyCta = ready.card.querySelector<HTMLButtonElement>(".hud-cta");

  // Paused
  const paused = makeOverlay("paused", `${uid}-pause-title`);
  const pauseLap = el("span", "hud-mono");
  const pauseTime = el("span", "hud-mono");
  const pausePos = el("span", "hud-mono");
  const pauseCta = makeCta("Resume", () => {
    if (phase === "paused") actions.onResume();
  });
  {
    const eyebrow = el("p", "hud-eyebrow");
    eyebrow.append(
      el("span", "hud-eyebrow__dot hud-eyebrow__dot--still"),
      document.createTextNode("Session paused"),
    );
    const title = el("h2", "hud-title hud-title--sm", "Take a breath.");
    title.id = `${uid}-pause-title`;
    const stats = el("dl", "hud-stats hud-stats--3");
    const stat = (label: string, value: HTMLElement): void => {
      const box = el("div", "hud-stat");
      box.append(el("dt", "hud-label", label));
      const dd = el("dd", "hud-stat__value");
      dd.append(value);
      box.append(dd);
      stats.append(box);
    };
    stat("Position", pausePos);
    stat("Lap", pauseLap);
    stat("Race time", pauseTime);
    const actionsRow = el("div", "hud-card__actions");
    actionsRow.append(pauseCta);
    paused.card.append(eyebrow, title, stats, actionsRow);
  }

  // Finished
  const finished = makeOverlay("finished", `${uid}-finish-title`);
  const finPos = el("span", "hud-mono hud-finish__pos");
  const finOf = el("span", "hud-finish__of");
  const finTitle = el("h2", "hud-title hud-title--sm");
  finTitle.id = `${uid}-finish-title`;
  const finTotal = el("span", "hud-mono");
  const finBest = el("span", "hud-mono");
  const finBestPb = el("span", "hud-badge", "PB");
  const finLaps = el("ol", "hud-laps");
  const finishRecords = recordStrip();
  const finishRecordNotice = el("p", "hud-record-notice");
  const finCta = makeCta("Race again", () => {
    if (phase === "finished") actions.onRestart();
  });
  let finKey = "";
  {
    const eyebrow = el("p", "hud-eyebrow");
    eyebrow.append(
      el("span", "hud-eyebrow__dot hud-eyebrow__dot--still"),
      document.createTextNode("Chequered flag"),
    );
    const head = el("div", "hud-finish__head");
    const posWrap = el("div", "hud-finish__poswrap");
    posWrap.append(finPos, finOf);
    const headText = el("div", "hud-finish__text");
    headText.append(eyebrow, finTitle, finishRecordNotice);
    head.append(posWrap, headText);

    const stats = el("dl", "hud-stats hud-stats--2");
    const total = el("div", "hud-stat");
    total.append(el("dt", "hud-label", "Total time"));
    const totalDd = el("dd", "hud-stat__value");
    totalDd.append(finTotal);
    total.append(totalDd);
    const best = el("div", "hud-stat");
    best.append(el("dt", "hud-label", "Best lap"));
    const bestDd = el("dd", "hud-stat__value hud-stat__value--accent");
    bestDd.append(finBest, finBestPb);
    best.append(bestDd);
    stats.append(total, best);

    const lapsHead = el("p", "hud-label hud-laps__head", "Lap times");
    const actionsRow = el("div", "hud-card__actions");
    const setupButton = el("button", "hud-secondary", "Race setup");
    setupButton.type = "button";
    setupButton.addEventListener("click", () => {
      if (phase === "finished") {
        setupPanel.open = true;
        actions.onSetup();
      }
    });
    actionsRow.append(finCta, setupButton);
    finished.card.append(
      head,
      stats,
      finishRecords.element,
      lapsHead,
      finLaps,
      actionsRow,
    );
  }

  hud.append(
    tl,
    speed,
    mapPanel,
    countdown,
    ready.overlay,
    paused.overlay,
    finished.overlay,
    status,
  );
  root.append(hud);
  minimap.resize();

  const overlays: Partial<
    Record<Phase, { overlay: HTMLElement; focus: HTMLButtonElement | null }>
  > = {
    ready: { overlay: ready.overlay, focus: readyCta },
    paused: { overlay: paused.overlay, focus: pauseCta },
    finished: { overlay: finished.overlay, focus: finCta },
  };

  /* ---------- per-section updaters ---------- */

  function updateTiming(s: HudTelemetry): void {
    const lap = Math.min(Math.max(1, s.lap), Math.max(1, s.totalLaps));
    setText(lapValue, `${lap}/${s.totalLaps}`);
    setText(lapTime, formatTime(s.lapTime));
    setText(bestValue, formatTime(s.bestLap));
    setText(
      timingRecords,
      `Race PB ${formatTime(s.records.bestRace)} · ${s.records.wins} ${s.records.wins === 1 ? "win" : "wins"}`,
    );
    timingRecords.title = `Race PB for ${s.setup.laps} laps, ${s.setup.cars} cars, Dynamic AI`;
    const pb = s.bestLap != null && s.bestLapIsPersonalBest;
    if (pbBadge.hidden === pb) pbBadge.hidden = !pb;

    if (s.sectorDelta == null || !Number.isFinite(s.sectorDelta)) {
      if (!delta.hidden) delta.hidden = true;
    } else {
      if (delta.hidden) delta.hidden = false;
      setText(delta, formatDelta(s.sectorDelta));
      setClass(delta, "is-faster", s.sectorDelta <= 0);
      setClass(delta, "is-slower", s.sectorDelta > 0);
    }

    for (let i = 0; i < SECTOR_COUNT; i++) {
      const { cell, value } = sectorCells[i];
      const split = s.sectorSplits[i] ?? null;
      const current =
        s.sector === i + 1 && (s.phase === "racing" || s.phase === "countdown");
      setText(value, formatSplit(split));
      setClass(cell, "is-current", current);
      setClass(cell, "is-done", split != null && !current);
    }
  }

  function updateLeaderboard(s: HudTelemetry): void {
    const drivers = [...s.drivers].sort((a, b) => a.position - b.position);
    const total = drivers.length;
    const posText = `P${s.position}/${total}`;
    setText(position, posText);
    setText(lbPos, posText);
    setText(lbTogglePos, posText);

    const seen = new Set<string>();
    for (const d of drivers) {
      seen.add(d.id);
      let r = lbRows.get(d.id);
      if (!r) {
        const row = el("li", "hud-lb__row");
        const pos = el("span", "hud-mono hud-lb__rpos");
        const swatch = el("span", "hud-lb__swatch");
        swatch.setAttribute("aria-hidden", "true");
        const name = el("span", "hud-lb__name");
        const gap = el("span", "hud-mono hud-lb__gap");
        row.append(pos, swatch, name, gap);
        r = { row, pos, swatch, name, gap };
        lbRows.set(d.id, r);
      }
      setText(r.pos, String(d.position));
      if (r.swatch.style.backgroundColor !== d.color)
        r.swatch.style.backgroundColor = d.color;
      setText(r.name, d.name);
      setText(r.gap, d.position === 1 ? "Leader" : d.gap);
      setClass(r.row, "is-player", d.isPlayer);
    }
    for (const [id, r] of lbRows) {
      if (!seen.has(id)) {
        r.row.remove();
        lbRows.delete(id);
      }
    }
    const order = drivers.map((d) => d.id).join("|");
    if (order !== lbOrder) {
      lbOrder = order;
      for (const d of drivers) {
        const r = lbRows.get(d.id);
        if (r) lbList.append(r.row);
      }
    }
  }

  function updateSpeed(s: HudTelemetry): void {
    setText(speedNum, String(Math.max(0, Math.round(s.speed))));
    setText(gearNum, formatGear(s.gear));
    setClass(gearBox, "is-reverse", s.gear < 0);
    const rpm = Math.min(1, Math.max(0, Number.isFinite(s.rpm) ? s.rpm : 0));
    const lit = Math.round(rpm * RPM_SEGMENTS);
    if (lit !== rpmLit) {
      rpmLit = lit;
      for (let i = 0; i < RPM_SEGMENTS; i++)
        setClass(rpmSegs[i], "is-on", i < lit);
    }
    setClass(rpmBar, "is-limiter", rpm >= 0.97);
    const showOff = s.isOffTrack;
    if (offChip.hidden === showOff) offChip.hidden = !showOff;
  }

  let lastCount = "";
  function updateCountdown(s: HudTelemetry): void {
    const value = s.countdown > 0 ? String(Math.ceil(s.countdown)) : "GO";
    if (value !== lastCount) {
      lastCount = value;
      countNum.textContent = value;
      setClass(countNum, "is-go", value === "GO");
      setText(countLabel, value === "GO" ? "Lights out" : "Get ready");
      // restart the pulse animation
      countNum.classList.remove("is-tick");
      void countNum.offsetWidth;
      countNum.classList.add("is-tick");
    }
  }

  function updatePaused(s: HudTelemetry): void {
    setText(pausePos, `P${s.position}/${s.drivers.length}`);
    setText(
      pauseLap,
      `${Math.min(Math.max(1, s.lap), s.totalLaps)}/${s.totalLaps}`,
    );
    setText(pauseTime, formatTime(s.raceTime));
  }

  function updateFinished(s: HudTelemetry): void {
    const key = `${s.position}|${s.drivers.length}|${s.raceTime.toFixed(3)}|${s.bestLap}|${s.completedLaps.join(",")}|${s.records.wins}|${s.records.bestRace}|${s.raceBestIsPersonalBest}`;
    if (key === finKey) return;
    finKey = key;
    finPos.textContent = `P${s.position}`;
    finOf.textContent = `of ${s.drivers.length}`;
    finTitle.textContent =
      s.position === 1
        ? "Victory. Clean and quick."
        : s.position <= 3
          ? "On the podium."
          : "Race complete.";
    setClass(finPos, "is-win", s.position === 1);
    finTotal.textContent = formatTime(s.raceTime);
    const laps = s.completedLaps;
    const fastest = laps.length ? Math.min(...laps) : null;
    const best = fastest;
    finBest.textContent = formatTime(best);
    finBestPb.hidden = !(s.bestLapIsPersonalBest && best != null);
    updateRecords(finishRecords, s);
    setText(
      finishRecordNotice,
      [
        s.bestLapIsPersonalBest ? "New track PB" : "",
        s.raceBestIsPersonalBest ? "New race PB" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    finishRecordNotice.hidden =
      !s.bestLapIsPersonalBest && !s.raceBestIsPersonalBest;
    setClass(
      finishRecords.values[0].parentElement!,
      "is-new",
      s.bestLapIsPersonalBest,
    );
    setClass(
      finishRecords.values[1].parentElement!,
      "is-new",
      s.raceBestIsPersonalBest,
    );

    const frag = document.createDocumentFragment();
    laps.forEach((t, i) => {
      const li = el("li", "hud-laps__row");
      const isBest = fastest != null && t === fastest;
      if (isBest) li.classList.add("is-best");
      li.append(el("span", "hud-label hud-laps__n", `Lap ${i + 1}`));
      const bar = el("span", "hud-laps__bar");
      bar.setAttribute("aria-hidden", "true");
      const fill = el("span", "hud-laps__fill");
      const slowest = Math.max(...laps);
      const ratio = slowest > 0 ? t / slowest : 1;
      fill.style.width = `${Math.max(8, Math.round(ratio * 100))}%`;
      bar.append(fill);
      li.append(bar);
      li.append(el("span", "hud-mono hud-laps__t", formatTime(t)));
      li.append(
        el(
          "span",
          "hud-mono hud-laps__d",
          isBest ? "Best" : fastest != null ? formatDelta(t - fastest) : "",
        ),
      );
      frag.append(li);
    });
    if (!laps.length) {
      frag.append(el("li", "hud-laps__empty", "No completed laps recorded."));
    }
    finLaps.replaceChildren(frag);
  }

  function announce(s: HudTelemetry): void {
    let msg = "";
    switch (s.phase) {
      case "ready":
        msg = "Ready. Press Start race to begin.";
        break;
      case "countdown":
        msg = "Countdown started.";
        break;
      case "racing":
        msg = `Racing. Lap ${Math.max(1, s.lap)} of ${s.totalLaps}.`;
        break;
      case "paused":
        msg = "Race paused.";
        break;
      case "finished":
        msg = `Race finished. Position ${s.position} of ${s.drivers.length}. Total time ${formatTime(s.raceTime)}.`;
        break;
    }
    status.textContent = msg;
  }

  function setPhase(next: Phase, s: HudTelemetry): void {
    const prev = phase;
    phase = next;
    hud.dataset.phase = next;
    for (const key of Object.keys(overlays) as Phase[]) {
      const entry = overlays[key];
      if (!entry) continue;
      const open = key === next;
      setClass(entry.overlay, "is-open", open);
      entry.overlay.setAttribute("aria-hidden", String(!open));
      entry.overlay.inert = !open;
    }
    setClass(countdown, "is-open", next === "countdown");
    if (next !== "countdown") lastCount = "";
    if (prev !== null || next !== "ready") announce(s);

    const target = overlays[next]?.focus;
    if (target) {
      const active = document.activeElement;
      const canSteal =
        !active || active === document.body || hud.contains(active);
      if (canSteal) {
        requestAnimationFrame(() => {
          if (!destroyed && phase === next)
            target.focus({ preventScroll: true });
        });
      }
    } else if (
      hud.contains(document.activeElement) &&
      document.activeElement !== lbToggle
    ) {
      (document.activeElement as HTMLElement).blur();
    }
  }

  /* ---------- public API ---------- */

  function updateRecords(
    strip: ReturnType<typeof recordStrip>,
    s: HudTelemetry,
  ): void {
    setText(strip.values[0], formatTime(s.records.bestLap));
    setText(strip.values[1], formatTime(s.records.bestRace));
    setText(strip.values[2], String(s.records.wins));
    strip.element.title = `Saved on this device. Race PB compares ${s.setup.laps} ${s.setup.laps === 1 ? "lap" : "laps"}, ${s.setup.cars} cars, Dynamic AI. Wins are across all setups.`;
  }
  function updateReady(s: HudTelemetry): void {
    setText(
      readyCopy,
      "Brake late, carry speed through the apex and chase a clean lap.",
    );
    setText(
      setupDescription,
      `Dynamic AI · ${s.setup.cars} cars · ${s.setup.laps} ${s.setup.laps === 1 ? "lap" : "laps"}`,
    );
    carsInput.value = String(s.setup.cars);
    carsValue.value = String(s.setup.cars);
    if (document.activeElement !== lapsInput)
      lapsInput.value = String(s.setup.laps);
    setText(
      setupHint,
      "Dynamic AI learns your pace, finds a tow and fights for position.",
    );
    updateRecords(readyRecords, s);
  }

  function update(s: HudTelemetry): void {
    if (destroyed) return;
    if (s.phase !== phase) {
      if (s.phase === "finished") updateFinished(s);
      setPhase(s.phase, s);
    }

    switch (s.phase) {
      case "ready":
        updateReady(s);
        break;
      case "countdown":
      case "racing":
        updateTiming(s);
        updateLeaderboard(s);
        updateSpeed(s);
        setText(mapSector, `S${Math.min(SECTOR_COUNT, Math.max(1, s.sector))}`);
        minimap.draw(s.drivers);
        if (s.phase === "countdown") updateCountdown(s);
        break;
      case "paused":
        updateTiming(s);
        updatePaused(s);
        break;
      case "finished":
        updateFinished(s);
        break;
    }
  }

  const onWindowResize = (): void => minimap.resize();
  window.addEventListener("resize", onWindowResize);

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("resize", onWindowResize);
    lbToggle.removeEventListener("click", onToggle);
    minimap.destroy();
    hud.remove();
  }

  // Initial paint: ready card visible before the first update arrives.
  setPhase("ready", {
    phase: "ready",
    countdown: 0,
    speed: 0,
    gear: 0,
    rpm: 0,
    lap: 1,
    totalLaps: 3,
    lapTime: 0,
    bestLap: null,
    raceTime: 0,
    sector: 1,
    sectorSplits: [null, null, null],
    sectorDelta: null,
    position: 1,
    drivers: [],
    isOffTrack: false,
    bestLapIsPersonalBest: false,
    completedLaps: [],
    setup: { ...DEFAULT_SETUP },
    records: { bestLap: null, bestRace: null, wins: 0, races: 0 },
    raceBestIsPersonalBest: false,
  });

  return { update, destroy };
}
