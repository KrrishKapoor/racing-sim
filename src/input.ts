import type { DrivingInput } from "./physics";

export class InputController {
  private keys = new Set<string>();
  private pointers = new Map<number, string>();
  private abort = new AbortController();
  constructor(
    root: HTMLElement,
    actions: {
      reset: () => void;
      pause: () => void;
      camera: () => void;
      start: () => void;
    },
  ) {
    const signal = this.abort.signal;
    const controls = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "Space",
    ];
    window.addEventListener(
      "keydown",
      (event) => {
        const target =
          event.target instanceof HTMLElement ? event.target : null;
        if (target?.matches("input, textarea, select, summary")) return;
        if (event.code === "Space" && target?.closest("button")) return;
        if (controls.includes(event.code)) {
          event.preventDefault();
          this.keys.add(event.code);
        }
        if (event.repeat) return;
        if (event.code === "KeyR") actions.reset();
        if (event.code === "Escape" || event.code === "KeyP") actions.pause();
        if (event.code === "KeyC") actions.camera();
        if (event.code === "Enter" && !target?.closest("button"))
          actions.start();
      },
      { signal },
    );
    window.addEventListener("keyup", (event) => this.keys.delete(event.code), {
      signal,
    });
    window.addEventListener("blur", () => this.clear(), { signal });
    root
      .querySelectorAll<HTMLButtonElement>("[data-control]")
      .forEach((button) => {
        button.addEventListener(
          "pointerdown",
          (event) => {
            event.preventDefault();
            button.setPointerCapture(event.pointerId);
            this.pointers.set(event.pointerId, button.dataset.control!);
            button.classList.add("pressed");
          },
          { signal },
        );
        const release = (event: PointerEvent) => {
          this.pointers.delete(event.pointerId);
          button.classList.remove("pressed");
        };
        button.addEventListener("pointerup", release, { signal });
        button.addEventListener("pointercancel", release, { signal });
        button.addEventListener("lostpointercapture", release, { signal });
      });
  }
  read(): DrivingInput {
    const touch = new Set(this.pointers.values());
    const has = (...keys: string[]) =>
      keys.some((key) => this.keys.has(key) || touch.has(key));
    return {
      throttle: has("KeyW", "ArrowUp", "throttle") ? 1 : 0,
      brake: has("KeyS", "ArrowDown", "brake") ? 1 : 0,
      steer:
        (has("KeyD", "ArrowRight", "right") ? 1 : 0) -
        (has("KeyA", "ArrowLeft", "left") ? 1 : 0),
      handbrake: has("Space", "handbrake"),
    };
  }
  clear(): void {
    this.keys.clear();
    this.pointers.clear();
    document
      .querySelectorAll(".pressed")
      .forEach((button) => button.classList.remove("pressed"));
  }
  destroy(): void {
    this.abort.abort();
  }
}
