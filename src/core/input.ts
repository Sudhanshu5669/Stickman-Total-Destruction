import { v, type V } from "./math";

/**
 * Keyboard + mouse state.
 *
 * Edge state (`pressed`/`released`/`wheel`) is latched by the DOM handlers and stays
 * latched until `consumeEdges()` is called. That call belongs to whoever *reads* the
 * edges — for gameplay that is the fixed simulation step, **not** the render frame.
 * Clearing per rendered frame drops the input entirely on any display faster than the
 * simulation rate (half of all presses at 120Hz), and during hitstop and slow-motion.
 */
export class Input {
  readonly down = new Set<string>();
  private readonly pressedKeys = new Set<string>();
  private readonly releasedKeys = new Set<string>();

  /** Mouse position in CSS pixels relative to the canvas. */
  readonly mouse: V = v(0, 0);
  mouseDown = false;
  mousePressed = false;
  mouseReleased = false;
  rightDown = false;
  rightPressed = false;
  wheel = 0;
  /** True once the player has actually touched the controls (used to gate the intro hint). */
  engaged = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // Start at the centre of the viewport. Leaving it at (0,0) would make the very
    // first frames aim at the top-left corner and yank the camera off the player.
    this.mouse.x = canvas.clientWidth / 2;
    this.mouse.y = canvas.clientHeight / 2;

    addEventListener("keydown", this.onKeyDown, { passive: false });
    addEventListener("keyup", this.onKeyUp);
    addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Don't swallow devtools / reload / tab-away combos.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (!this.down.has(e.code)) this.pressedKeys.add(e.code);
    this.down.add(e.code);
    this.engaged = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
    this.releasedKeys.add(e.code);
  };

  /** Losing focus mid-keypress otherwise leaves the player sprinting forever. */
  private onBlur = () => {
    this.down.clear();
    this.mouseDown = false;
    this.rightDown = false;
  };

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.onPointerMove(e);
    this.engaged = true;
    if (e.button === 0) {
      if (!this.mouseDown) this.mousePressed = true;
      this.mouseDown = true;
    } else if (e.button === 2) {
      if (!this.rightDown) this.rightPressed = true;
      this.rightDown = true;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 0) {
      this.mouseDown = false;
      this.mouseReleased = true;
    } else if (e.button === 2) {
      this.rightDown = false;
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  held(...codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }

  pressed(...codes: string[]) {
    return codes.some((c) => this.pressedKeys.has(c));
  }

  released(...codes: string[]) {
    return codes.some((c) => this.releasedKeys.has(c));
  }

  /** -1 / 0 / +1 horizontal move axis. */
  get moveX() {
    return (this.held("KeyD", "ArrowRight") ? 1 : 0) - (this.held("KeyA", "ArrowLeft") ? 1 : 0);
  }

  /**
   * Discards latched edges. Call this exactly once per consumer pass — i.e. after each
   * fixed simulation step — so every press is seen by exactly one step.
   */
  consumeEdges() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.mousePressed = false;
    this.mouseReleased = false;
    this.rightPressed = false;
    this.wheel = 0;
  }
}

const SWALLOW = new Set([
  "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Slash", "Quote",
]);
