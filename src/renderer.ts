import { Track } from "./track";
import type { Car } from "./physics";

interface Skid {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  born: number;
}
export class Renderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly scenery: HTMLCanvasElement;
  private readonly forest: CanvasPattern | null;
  private readonly observer: ResizeObserver;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private camera = { x: 1020, y: 820, zoom: 0.5 };
  private skids: Skid[] = [];
  private previousTires = new Map<string, { x: number; y: number }[]>();
  private clock = 0;
  private readonly linePaths = new Map<string, Path2D>();
  overview = false;
  get skidMarkCount(): number {
    return this.skids.length;
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly track: Track,
  ) {
    this.context = canvas.getContext("2d", { alpha: false })!;
    const line = track.racingLine.points;
    for (const cue of ["accelerate", "brake", "carry"]) {
      const path = new Path2D();
      line.forEach((point, i) => {
        if (point.cue !== cue) return;
        const next = line[(i + 1) % line.length];
        path.moveTo(point.x, point.y);
        path.lineTo(next.x, next.y);
      });
      this.linePaths.set(cue, path);
    }
    this.scenery = this.buildScenery();
    this.forest = this.context.createPattern(this.buildForestTile(), "repeat");
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
  }
  /** Seamless tree tile that continues the scenery past its edges, so the
   * follow camera never reveals a hard seam near the circuit's outer corners. */
  private buildForestTile(): HTMLCanvasElement {
    const size = 640;
    const tile = document.createElement("canvas");
    tile.width = tile.height = size;
    const ctx = tile.getContext("2d")!;
    ctx.fillStyle = "#314739";
    ctx.fillRect(0, 0, size, size);
    let seed = 97;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 70; i++) {
      const x = random() * size,
        y = random() * size,
        radius = 9 + random() * 22,
        tone = ["#253e30", "#2b4333", "#38503b", "#2b4030"][
          Math.floor(random() * 4)
        ];
      for (const ox of [-size, 0, size])
        for (const oy of [-size, 0, size]) {
          ctx.fillStyle = "rgba(8,20,13,.19)";
          ctx.beginPath();
          ctx.arc(x + ox + 5, y + oy + 8, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = tone;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(127,147,85,.08)";
          ctx.beginPath();
          ctx.arc(x + ox - 4, y + oy - 5, radius * 0.66, 0, Math.PI * 2);
          ctx.fill();
        }
    }
    return tile;
  }
  private buildScenery(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 2150;
    canvas.height = 1710;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#314739";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Deterministic, softly striped grass and a tree line; cached offscreen once.
    ctx.save();
    ctx.rotate(-0.35);
    for (let x = -800; x < 2600; x += 115) {
      ctx.fillStyle = "rgba(186,205,141,.025)";
      ctx.fillRect(x, -700, 55, 3000);
    }
    ctx.restore();
    let seed = 41;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 900; i++) {
      const x = random() * 2150,
        y = random() * 1710;
      if (this.track.project({ x, y }).distanceFromCenter < 165) continue;
      const radius = 9 + random() * 22;
      ctx.fillStyle = "rgba(8,20,13,.19)";
      ctx.beginPath();
      ctx.arc(x + 5, y + 8, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ["#253e30", "#2b4333", "#38503b", "#2b4030"][
        Math.floor(random() * 4)
      ];
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(127,147,85,.08)";
      ctx.beginPath();
      ctx.arc(x - 4, y - 5, radius * 0.66, 0, Math.PI * 2);
      ctx.fill();
    }
    const path = new Path2D();
    this.track.points.forEach((p, i) =>
      i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y),
    );
    path.closePath();
    ctx.lineJoin = "round";
    const stroke = (color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke(path);
    };
    stroke("#182c22", 278);
    stroke("#7d8b7b", 264);
    stroke("#485749", 252);
    stroke("#58604f", 207);
    stroke("#c5c5b0", 170);
    ctx.setLineDash([21, 21]);
    stroke("#ac5545", 170);
    ctx.setLineDash([]);
    stroke("#bdc5b1", 151);
    stroke("#303735", 145);
    // Quiet asphalt grain remains below the painted markings.
    ctx.save();
    ctx.strokeStyle = "rgba(215,222,213,.035)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4200; i++) {
      const p = this.track.pointAt(
        random() * this.track.length,
        (random() - 0.5) * 136,
      );
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 2, p.y + 1);
      ctx.stroke();
    }
    ctx.restore();
    // Pit building, garage bays, and striped pit apron beside the opening straight.
    ctx.fillStyle = "#697365";
    ctx.fillRect(780, 1520, 555, 92);
    ctx.fillStyle = "#283c30";
    ctx.fillRect(793, 1533, 529, 66);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 3 === 0 ? "#9b9f72" : "#63715e";
      ctx.fillRect(803 + i * 57, 1541, 44, 50);
      ctx.fillStyle = "#18291f";
      ctx.fillRect(809 + i * 57, 1547, 32, 4);
    }
    ctx.fillStyle = "#c8cbb3";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText("P I T   L A N E", 1057, 1640);
    ctx.save();
    ctx.translate(1115, 1030);
    ctx.rotate(-0.16);
    ctx.fillStyle = "rgba(207,222,175,.16)";
    ctx.font = "italic 900 112px Arial, sans-serif";
    ctx.fillText("APEX", 0, 0);
    ctx.font = "12px monospace";
    ctx.fillText("M O T O R S P O R T   P A R K", 0, 32);
    ctx.restore();
    const start = this.track.pointAt(0);
    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(start.heading);
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 ? "#2c3330" : "#e3e3cb";
        ctx.fillRect(col * 9 - 9, row * 12 - 72, 9, 12);
      }
    ctx.restore();
    this.track.sectorDistances.slice(0, 2).forEach((distance, i) => {
      const a = this.track.pointAt(distance, -72),
        b = this.track.pointAt(distance, 72);
      ctx.strokeStyle = "rgba(213,245,91,.25)";
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 9]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const sign = this.track.pointAt(distance, -113);
      ctx.fillStyle = "#192a20";
      ctx.fillRect(sign.x - 18, sign.y - 13, 36, 26);
      ctx.fillStyle = "#d5f55b";
      ctx.font = "bold 13px monospace";
      ctx.fillText(`S${i + 1}`, sign.x, sign.y + 5);
    });
    // Directional chevrons help the first-time driver read the circuit.
    for (let d = 330; d < this.track.length; d += 550) {
      const p = this.track.pointAt(d);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.heading);
      ctx.strokeStyle = "rgba(225,231,211,.13)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-9, -10);
      ctx.lineTo(3, 0);
      ctx.lineTo(-9, 10);
      ctx.stroke();
      ctx.restore();
    }
    return canvas;
  }
  reset(): void {
    this.skids = [];
    this.previousTires.clear();
  }
  recordSkids(cars: Car[], dt: number): void {
    this.clock += dt;
    for (const car of cars) {
      const c = Math.cos(car.heading),
        s = Math.sin(car.heading);
      const tires = [-9, 9].map((side) => ({
        x: car.x - c * 14 - s * side,
        y: car.y - s * 14 + c * side,
      }));
      const previous = this.previousTires.get(car.id);
      if (previous && car.isDrifting && !car.isOffTrack)
        tires.forEach((p, i) => {
          if (Math.hypot(p.x - previous[i].x, p.y - previous[i].y) < 25)
            this.skids.push({
              x1: previous[i].x,
              y1: previous[i].y,
              x2: p.x,
              y2: p.y,
              born: this.clock,
            });
        });
      this.previousTires.set(car.id, tires);
    }
    this.skids = this.skids
      .filter((skid) => this.clock - skid.born < 24)
      .slice(-2200);
  }
  render(cars: Car[], dt: number, phase: string, showLine: boolean): void {
    const ctx = this.context,
      player = cars.find((car) => car.isPlayer)!;
    const b = this.track.bounds;
    const fit = Math.min(
      this.width / (b.maxX - b.minX + 140),
      this.height / (b.maxY - b.minY + 100),
    );
    const overview = this.overview || phase === "ready" || phase === "finished";
    const targetZoom = overview
      ? fit
      : Math.min(
          this.width / (this.width < 700 ? 620 : 950),
          this.height / 780,
        );
    const tx = overview
      ? (b.minX + b.maxX) / 2
      : player.x + Math.cos(player.heading) * 100;
    const ty = overview
      ? (b.minY + b.maxY) / 2
      : player.y + Math.sin(player.heading) * 100;
    const smoothing = 1 - Math.exp(-4 * Math.min(dt, 0.1));
    this.camera.x += (tx - this.camera.x) * smoothing;
    this.camera.y += (ty - this.camera.y) * smoothing;
    this.camera.zoom += (targetZoom - this.camera.zoom) * smoothing;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = "#314739";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(this.width * 0.5, this.height * 0.5);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    if (this.forest) {
      const halfW = this.width / 2 / this.camera.zoom + 2,
        halfH = this.height / 2 / this.camera.zoom + 2;
      ctx.fillStyle = this.forest;
      ctx.fillRect(
        this.camera.x - halfW,
        this.camera.y - halfH,
        halfW * 2,
        halfH * 2,
      );
    }
    ctx.drawImage(this.scenery, 0, 0);
    for (let grid = 0; grid < cars.length; grid++) {
      const p = this.track.gridPosition(grid);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.heading);
      ctx.strokeStyle = "rgba(220,225,206,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-23, -16);
      ctx.lineTo(25, -16);
      ctx.lineTo(25, 16);
      ctx.lineTo(-23, 16);
      ctx.stroke();
      ctx.restore();
    }
    if (showLine) {
      // Keep the line at least ~1.6px on screen, with a dark casing so the
      // cue colours read on asphalt, kerbs and grass alike.
      const width = Math.max(3, 1.6 / this.camera.zoom);
      ctx.lineCap = "round";
      ctx.lineWidth = width * 2.2;
      ctx.strokeStyle = "rgba(10,14,12,.5)";
      for (const path of this.linePaths.values()) ctx.stroke(path);
      ctx.lineWidth = width;
      ctx.globalAlpha = 0.9;
      for (const [cue, path] of this.linePaths) {
        ctx.strokeStyle =
          cue === "brake"
            ? "#f18d70"
            : cue === "accelerate"
              ? "#d5f55b"
              : "#dce4ce";
        ctx.stroke(path);
      }
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const skid of this.skids) {
      ctx.strokeStyle = `rgba(8,13,11,${0.34 * (1 - (this.clock - skid.born) / 24)})`;
      ctx.beginPath();
      ctx.moveTo(skid.x1, skid.y1);
      ctx.lineTo(skid.x2, skid.y2);
      ctx.stroke();
    }
    for (const car of [...cars.filter((c) => !c.isPlayer), player])
      this.drawCar(ctx, car);
    ctx.restore();
    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.height * 0.2,
      this.width / 2,
      this.height / 2,
      this.width * 0.68,
    );
    vignette.addColorStop(0, "rgba(8,17,12,0)");
    vignette.addColorStop(1, "rgba(8,17,12,.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }
  private drawCar(ctx: CanvasRenderingContext2D, car: Car): void {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    ctx.fillStyle = "rgba(4,12,7,.4)";
    ctx.beginPath();
    ctx.roundRect(-20 + 4, -12 + 5, 44, 26, 6);
    ctx.fill();
    ctx.fillStyle = "#101713";
    for (const x of [-13, 12])
      for (const y of [-13, 13]) {
        ctx.save();
        ctx.translate(x, y);
        if (x > 0) ctx.rotate(car.steering * 0.35);
        ctx.fillRect(-6, -3, 12, 6);
        ctx.restore();
      }
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.roundRect(-22, -11, 45, 22, [5, 8, 8, 5]);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,240,.2)";
    ctx.fillRect(-17, -9, 33, 2);
    ctx.fillStyle = "#1b2c27";
    ctx.beginPath();
    ctx.roundRect(-7, -8, 17, 16, 3);
    ctx.fill();
    ctx.fillStyle = "#75958a";
    ctx.fillRect(6, -7, 4, 14);
    ctx.fillStyle = car.color;
    ctx.fillRect(-3, -7, 6, 14);
    ctx.fillStyle = "#111b16";
    ctx.fillRect(-20, -14, 4, 28);
    ctx.fillStyle = "#f1efce";
    ctx.fillRect(20, -8, 3, 5);
    ctx.fillRect(20, 3, 3, 5);
    ctx.fillStyle = car.braking ? "#ff5247" : "#853e34";
    ctx.fillRect(-23, -8, 3, 5);
    ctx.fillRect(-23, 3, 3, 5);
    ctx.restore();
    if (car.isPlayer) {
      ctx.fillStyle = "#d5f55b";
      ctx.beginPath();
      ctx.moveTo(car.x, car.y - 28);
      ctx.lineTo(car.x - 4, car.y - 35);
      ctx.lineTo(car.x + 4, car.y - 35);
      ctx.fill();
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("YOU", car.x, car.y - 42);
    }
  }
  destroy(): void {
    this.observer.disconnect();
  }
}
