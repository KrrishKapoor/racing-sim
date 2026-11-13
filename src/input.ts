import type { DrivingInput } from "./physics";

export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
export const STICK_RADIUS = 56;
const DEADZONE = 0.08;
const DRIVE_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"];

/** Circular travel, with an 8% horizontal deadzone and continuous steering. */
export function mapStick(dx: number, dy: number) {
  const scale = Math.max(1, Math.hypot(dx, dy) / STICK_RADIUS);
  const x = dx / scale, y = dy / scale;
  const horizontal = x / STICK_RADIUS;
  const steer = Math.sign(horizontal) * Math.max(0, (Math.abs(horizontal) - DEADZONE) / (1 - DEADZONE));
  return { x, y, steer: steer || 0 };
}

export function drivingInput(keys: ReadonlySet<string>, touch = { steer: 0, throttle: false, brake: false }): DrivingInput {
  const has = (a: string, b: string) => keys.has(a) || keys.has(b);
  const keyboardSteer = Number(has("KeyD", "ArrowRight")) - Number(has("KeyA", "ArrowLeft"));
  return {
    steer: keyboardSteer || touch.steer,
    throttle: Number(has("KeyW", "ArrowUp") || touch.throttle),
    brake: Number(has("KeyS", "ArrowDown") || touch.brake),
  };
}

export class InputController {
  private keys = new Set<string>();
  private pedals = new Map<number, string | null>();
  private stick: { id: number; x: number; y: number } | null = null;
  private steer = 0;
  private abort = new AbortController();
  private ring: HTMLElement;
  private knob: HTMLElement;
  private buttons: HTMLButtonElement[];

  constructor(
    root: HTMLElement,
    actions: { reset: () => void; pause: () => void; camera: () => void; start: () => void },
  ) {
    const signal = this.abort.signal;
    const touch = matchMedia(TOUCH_QUERY);
    this.ring = root.querySelector(".touch-stick")!;
    this.knob = this.ring.querySelector("i")!;
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-control]")];
    window.addEventListener("keydown", (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches("input, textarea, select, summary")) return;
      if (DRIVE_KEYS.includes(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
      if (event.repeat) return;
      if (event.code === "KeyR") actions.reset();
      if (event.code === "Escape" || event.code === "KeyP") actions.pause();
      if (event.code === "KeyC") actions.camera();
      if (event.code === "Enter" && !target?.closest("button")) actions.start();
    }, { signal });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code), { signal });
    window.addEventListener("blur", () => this.clear(), { signal });

    // The driving surface disables native panning. Keep the expanded standings
    // scrollable without letting a drag on the list steer or scroll the page.
    const standings = root.querySelector<HTMLElement>(".hud-lb__list")!;
    let listDrag: { id: number; y: number; top: number } | null = null;
    standings.addEventListener("pointerdown", (event) => {
      if (!touch.matches || event.pointerType === "mouse") return;
      event.preventDefault();
      listDrag = { id: event.pointerId, y: event.clientY, top: standings.scrollTop };
      standings.setPointerCapture(event.pointerId);
    }, { signal });
    standings.addEventListener("pointermove", (event) => {
      if (listDrag?.id === event.pointerId)
        standings.scrollTop = listDrag.top + listDrag.y - event.clientY;
    }, { signal });
    standings.addEventListener("lostpointercapture", () => { listDrag = null; }, { signal });

    const pedalAt = (event: PointerEvent): string | null =>
      document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-control]")?.dataset.control ?? null;
    root.addEventListener("pointerdown", (event) => {
      if (!touch.matches || event.pointerType === "mouse" ||
          !["countdown", "racing"].includes(root.dataset.phase ?? "")) return;
      const target = event.target as Element;
      if (target.closest("button, input, select, summary, .hud-lb__list") && !target.closest("[data-control]")) return;
      const rect = root.getBoundingClientRect();
      if (event.clientX < rect.left + rect.width / 2) {
        if (this.stick) return;
        this.stick = { id: event.pointerId, x: event.clientX, y: event.clientY };
        this.steer = 0;
        this.ring.style.left = `${event.clientX - rect.left}px`;
        this.ring.style.top = `${event.clientY - rect.top}px`;
        this.knob.style.transform = "translate(0, 0)";
        this.ring.classList.add("active");
      } else {
        this.pedals.set(event.pointerId, pedalAt(event));
        this.paintPedals();
      }
      event.preventDefault();
      root.setPointerCapture(event.pointerId);
    }, { signal });
    root.addEventListener("pointermove", (event) => {
      if (this.stick?.id === event.pointerId) {
        event.preventDefault();
        const { x, y, steer } = mapStick(event.clientX - this.stick.x, event.clientY - this.stick.y);
        this.steer = steer;
        this.knob.style.transform = `translate(${x}px, ${y}px)`;
      } else if (this.pedals.has(event.pointerId)) {
        event.preventDefault();
        this.pedals.set(event.pointerId, pedalAt(event));
        this.paintPedals();
      }
    }, { signal });
    const release = (event: PointerEvent) => {
      if (this.stick?.id === event.pointerId) {
        this.stick = null;
        this.steer = 0;
        this.ring.classList.remove("active");
      }
      if (this.pedals.delete(event.pointerId)) this.paintPedals();
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const)
      root.addEventListener(type, release, { signal });

    // WebKit's callout/selection and gesture handling are separate from Pointer Events.
    const prevent = (event: Event) => { if (touch.matches) event.preventDefault(); };
    for (const type of ["contextmenu", "selectstart", "gesturestart", "gesturechange", "gestureend"])
      root.addEventListener(type, prevent, { passive: false, signal });
    root.addEventListener("touchmove", (event) => {
      if (touch.matches && (!(event.target as Element).closest(".hud-card") || event.touches.length > 1))
        event.preventDefault();
    }, { passive: false, signal });
  }
  private paintPedals(): void {
    for (const button of this.buttons)
      button.classList.toggle("pressed", [...this.pedals.values()].includes(button.dataset.control!));
  }
  read(): DrivingInput {
    let throttle = false, brake = false;
    for (const pedal of this.pedals.values()) {
      throttle ||= pedal === "throttle";
      brake ||= pedal === "brake";
    }
    return drivingInput(this.keys, { steer: this.steer, throttle, brake });
  }
  clear(): void {
    this.keys.clear();
    this.pedals.clear();
    this.stick = null;
    this.steer = 0;
    this.ring.classList.remove("active");
    this.paintPedals();
  }
  destroy(): void {
    this.clear();
    this.abort.abort();
  }
}
