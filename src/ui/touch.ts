import type { Input } from "../core/input";
import { TAU, clamp, v, type V } from "../core/math";
import { rgba, type Ctx } from "../render/draw";

/**
 * On-screen controls for phones and tablets.
 *
 * A twin-stick layout, split down the middle of the screen: the left thumb gets a
 * floating stick that appears wherever it lands, the right thumb aims and fires by
 * touching where you want the shot to go. Both halves track their own pointer id, so
 * moving and shooting at the same time works — which on a game built entirely around
 * aiming while airborne is not optional.
 *
 * The stick *floats* rather than sitting at a fixed spot because a fixed stick means
 * looking at your thumb to find it. It anchors on touch-down and measures from there,
 * so wherever you grab is the centre.
 *
 * Everything here writes into the plain `virtual*` fields on `Input`; nothing
 * downstream knows a touchscreen exists.
 */

/**
 * Radius the stick saturates at, in CSS pixels.
 *
 * Deliberately *not* scaled by the viewport: a thumb is the same size on a 6" phone
 * and a 13" tablet, so the throw of the stick has to be an absolute distance. The ring
 * is drawn at exactly this radius for the same reason — a ring that saturates before
 * the input does makes the stick feel like it is fighting you.
 */
const STICK_R = 62;
/** Smallest a control may be drawn, in CSS pixels. Comfortably above a 44pt thumb. */
const MIN_TOUCH = 64;
/** Dead zone as a fraction of the radius, so a resting thumb doesn't creep. */
const DEAD = 0.16;
/** Push the stick past this fraction, upward, to jump and hold the jetpack. */
const JUMP_Y = 0.55;
/** Pull it below this to crouch. */
const CROUCH_Y = 0.62;

interface Thumb {
  id: number;
  origin: V;
  at: V;
}

export class TouchControls {
  /** True once we have seen a real touch. Until then nothing is drawn. */
  active = false;

  private move: Thumb | null = null;
  private aim: Thumb | null = null;
  /** Rectangles for the swap buttons, in CSS pixels; rebuilt every draw. */
  private swapLeft = { x: 0, y: 0, w: 0, h: 0 };
  private swapRight = { x: 0, y: 0, w: 0, h: 0 };
  private pauseBtn = { x: 0, y: 0, w: 0, h: 0 };
  private tappedSwap = 0;
  /** Set for one frame when the on-screen pause button is hit. */
  pausePressed = false;
  private flash = { left: 0, right: 0, pause: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly input: Input) {
    canvas.addEventListener("pointerdown", this.onDown, { passive: false });
    canvas.addEventListener("pointermove", this.onMove, { passive: false });
    addEventListener("pointerup", this.onUp);
    addEventListener("pointercancel", this.onUp);
  }

  /**
   * Whether this device should get on-screen controls at all.
   *
   * Coarse pointer *and* a touch point: a laptop with a touchscreen still has a mouse
   * and a keyboard, and covering a quarter of its screen in thumb sticks would be a
   * downgrade. The controls also arm themselves lazily on the first real touch, so a
   * wrong guess here corrects itself the moment somebody actually prods the screen.
   */
  static shouldEnable(): boolean {
    try {
      const coarse = matchMedia("(pointer: coarse)").matches;
      return coarse && navigator.maxTouchPoints > 0;
    } catch {
      return false;
    }
  }

  private local(e: PointerEvent): V {
    const r = this.canvas.getBoundingClientRect();
    return v(e.clientX - r.left, e.clientY - r.top);
  }

  private hit(b: { x: number; y: number; w: number; h: number }, p: V) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    e.preventDefault();
    this.arm();
    const p = this.local(e);

    // Buttons win over the sticks, so a thumb on the swap key doesn't also aim.
    if (this.hit(this.pauseBtn, p)) {
      this.pausePressed = true;
      this.flash.pause = 1;
      return;
    }
    if (this.hit(this.swapLeft, p)) {
      this.tappedSwap = -1;
      this.flash.left = 1;
      return;
    }
    if (this.hit(this.swapRight, p)) {
      this.tappedSwap = 1;
      this.flash.right = 1;
      return;
    }

    const half = this.canvas.clientWidth * 0.42;
    if (p.x < half && !this.move) {
      this.move = { id: e.pointerId, origin: p, at: p };
    } else if (!this.aim) {
      this.aim = { id: e.pointerId, origin: p, at: p };
      // Aim lands on the first frame, so a tap-to-shoot goes where you tapped rather
      // than wherever the crosshair happened to be sitting.
      this.input.mouse.x = p.x;
      this.input.mouse.y = p.y;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const p = this.local(e);
    if (this.move && e.pointerId === this.move.id) {
      e.preventDefault();
      this.move.at = p;
    } else if (this.aim && e.pointerId === this.aim.id) {
      e.preventDefault();
      this.aim.at = p;
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (this.move && e.pointerId === this.move.id) this.move = null;
    if (this.aim && e.pointerId === this.aim.id) this.aim = null;
  };

  /** First real touch: take over input routing. */
  private arm() {
    if (this.active) return;
    this.active = true;
    this.input.touchMode = true;
    this.input.engaged = true;
  }

  /**
   * Pushes this frame's thumb state into `Input`. Called before the simulation reads
   * it, so a touch and the step that consumes it land on the same frame.
   */
  update(dt: number) {
    for (const k of ["left", "right", "pause"] as const) {
      this.flash[k] = Math.max(0, this.flash[k] - dt * 4);
    }
    if (!this.active) return;

    const inp = this.input;
    if (this.move) {
      const dx = (this.move.at.x - this.move.origin.x) / STICK_R;
      const dy = (this.move.at.y - this.move.origin.y) / STICK_R;
      const mag = Math.hypot(dx, dy);
      if (mag < DEAD) {
        inp.virtualMoveX = 0;
        inp.virtualJumpHeld = false;
        inp.virtualCrouch = false;
      } else {
        inp.virtualMoveX = clamp(dx, -1, 1);
        // Screen Y grows downward, so "up" is negative.
        const wantJump = -dy > JUMP_Y;
        if (wantJump && !inp.virtualJumpHeld) inp.virtualJumpPressed = true;
        inp.virtualJumpHeld = wantJump;
        inp.virtualCrouch = dy > CROUCH_Y;
      }
    } else {
      inp.virtualMoveX = 0;
      inp.virtualJumpHeld = false;
      inp.virtualCrouch = false;
    }

    if (this.aim) {
      inp.mouse.x = this.aim.at.x;
      inp.mouse.y = this.aim.at.y;
      if (!inp.mouseDown) inp.mousePressed = true;
      inp.mouseDown = true;
    } else {
      inp.mouseDown = false;
    }

    if (this.tappedSwap) {
      inp.virtualCycle = this.tappedSwap;
      this.tappedSwap = 0;
    }
  }

  /** Clears held state — used when the game pauses or the run ends. */
  release() {
    this.move = null;
    this.aim = null;
    this.input.virtualMoveX = 0;
    this.input.virtualJumpHeld = false;
    this.input.virtualCrouch = false;
    this.input.mouseDown = false;
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Draws the controls in screen space, after the HUD.
   *
   * Deliberately faint: on a 6" screen the controls compete with the thing they are
   * controlling, and a stickman is easier to lose behind a bright UI than behind a
   * ghost of one. The stick only appears where a thumb actually is.
   */
  /**
   * Lays the controls out and draws them.
   *
   * Two rules drive the placement. Controls are never smaller than `MIN_TOUCH`, no
   * matter how small the viewport gets — scaling a button down with the screen is
   * exactly backwards, because the small screen is the one being operated with a
   * thumb. And nothing sits in the bottom band across the middle of the screen, which
   * belongs to the HUD's ammo strip; the swap keys are lifted clear of it so the two
   * never fight for the same pixels on a 390-wide phone.
   */
  draw(ctx: Ctx, w: number, h: number, playing: boolean) {
    if (!this.active) return;
    const k = clamp(Math.min(w, h) / 780, 0.7, 1.5);

    const bs = Math.max(MIN_TOUCH, 58 * k);
    const pad = 16 * k;
    // Height of the HUD's ammo plate plus its margin — see `Hud.drawAmmoBar`.
    const ammoBand = 82 * k;
    const btnY = h - pad - ammoBand - bs;
    this.swapRight = { x: w - pad - bs, y: btnY, w: bs, h: bs };
    this.swapLeft = { x: w - pad - bs * 2 - 10 * k, y: btnY, w: bs, h: bs };
    const ps = Math.max(52, 46 * k);
    this.pauseBtn = { x: pad, y: pad, w: ps, h: ps };

    if (!playing) return;

    this.button(ctx, this.swapLeft, "‹", k, this.flash.left);
    this.button(ctx, this.swapRight, "›", k, this.flash.right);
    this.pauseGlyph(ctx, k);

    if (this.move) {
      const o = this.move.origin;
      const r = STICK_R;
      ctx.strokeStyle = "rgba(244,241,232,0.22)";
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, TAU);
      ctx.stroke();

      // Knob, clamped to the ring so it never wanders off with the thumb.
      const dx = this.move.at.x - o.x;
      const dy = this.move.at.y - o.y;
      const mag = Math.hypot(dx, dy) || 1;
      const s = Math.min(1, mag / r) * r;
      const kx = o.x + (dx / mag) * s;
      const ky = o.y + (dy / mag) * s;
      ctx.fillStyle = this.input.virtualJumpHeld ? "rgba(255,210,63,0.5)" : "rgba(244,241,232,0.3)";
      ctx.beginPath();
      ctx.arc(kx, ky, Math.max(24, 22 * k), 0, TAU);
      ctx.fill();

      // A hint at the top of the ring, since "push up to fly" is not discoverable.
      ctx.fillStyle = rgba("#ffd23f", this.input.virtualJumpHeld ? 0.9 : 0.35);
      ctx.font = `900 ${12 * k}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("FLY", o.x, o.y - r - 14 * k);
    }
  }

  /** Glyph and corner radius are sized off the button, not off `k`, so a button held
   * at its floor on a small screen still gets a glyph that fills it. */
  private button(ctx: Ctx, b: { x: number; y: number; w: number; h: number }, glyph: string, k: number, flash: number) {
    ctx.fillStyle = `rgba(20,23,31,${0.4 + flash * 0.4})`;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, b.w * 0.24);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.14 + flash * 0.5})`;
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
    ctx.fillStyle = "rgba(244,241,232,0.72)";
    ctx.font = `900 ${b.w * 0.48}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, b.x + b.w / 2, b.y + b.h / 2);
  }

  private pauseGlyph(ctx: Ctx, k: number) {
    const b = this.pauseBtn;
    ctx.fillStyle = `rgba(20,23,31,${0.35 + this.flash.pause * 0.4})`;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, b.w * 0.24);
    ctx.fill();
    ctx.fillStyle = "rgba(244,241,232,0.7)";
    const bw = b.w * 0.11;
    const bh = b.h * 0.4;
    ctx.fillRect(b.x + b.w / 2 - bw - b.w * 0.06, b.y + b.h / 2 - bh / 2, bw, bh);
    ctx.fillRect(b.x + b.w / 2 + b.w * 0.06, b.y + b.h / 2 - bh / 2, bw, bh);
    void k;
  }
}
