import type { Camera } from "../core/camera";
import { clamp, TAU, v, type V } from "../core/math";
import type { Ctx } from "../render/draw";
import { keyLabel } from "../core/keylabel";
import { settings } from "./settings";

/**
 * The first-time-user experience.
 *
 * This replaces the nine-line CONTROLS card that used to sit over the first frame of
 * every run. A reference manual is the wrong shape for the first ten seconds of a
 * portal game: it asks the player to read before they have any reason to care, it
 * teaches nine things when they only need one, and it hides the thing it is
 * describing behind itself.
 *
 * So instead: one instruction at a time, drawn beside the stickman rather than in the
 * middle of the screen, led by a picture of the control rather than by prose, and
 * dismissed by *doing the thing*. The first prompt is a mouse with its left button
 * lit and the word FIRE, and nothing else — everything after that waits until the
 * player has proved they know the previous one. A player who never touches the
 * jetpack simply never gets a jetpack lesson, and a returning player gets none of it.
 *
 * Nothing here consumes input, blocks a frame or pauses anything: the prompts are
 * decoration over a live game, and the whole system can be switched off from the
 * pause menu (`settings.tips`) or from `skipAll()`.
 *
 * The coach owns its own "already taught" memory rather than living in `progress`,
 * because it is not progression — wiping your save should not make the game start
 * explaining the mouse button again, and the two have no reason to share a schema.
 */

export type LessonId = "fire" | "move" | "swap" | "fly" | "limp";

/** Everything the coach needs to know about the frame. Assembled by the game. */
export interface CoachInput {
  /** False while paused, downed, dead or under an overlay — the coach hides. */
  live: boolean;
  /** The trigger is being pulled this frame. */
  firing: boolean;
  /** Horizontal move axis, -1..1, from either input source. */
  moveX: number;
  /** Index into the current ammo list; any change counts as a swap. */
  ammoIndex: number;
  /** How many rounds this run issued — with one there is nothing to swap to. */
  ammoCount: number;
  /** Jetpack throttle, 0..1. */
  jetThrottle: number;
  /** The player has gone limp on purpose. */
  limp: boolean;
  /** On-screen controls are live, so prompts show thumbs instead of keys. */
  touch: boolean;
}

/** Which picture a lesson leads with. Drawn, not written — see `drawGlyph`. */
type Glyph = "click" | "tap" | "keys-ad" | "drag" | "keys-13" | "swap-buttons" | "space" | "stick-up" | "key-r" | "limp-button";

interface Lesson {
  id: LessonId;
  /** One word for what the control does. The picture carries the rest. */
  verb: string;
  /** Keyboard and mouse illustration. */
  keys: Glyph;
  /** Touchscreen illustration, or null when the gesture does not exist on a phone. */
  thumbs: Glyph | null;
  /** Seconds of calm after the previous lesson before this one appears. */
  delay: number;
  /**
   * Seconds on screen before the coach gives up and moves on. The first lesson has
   * no patience at all: a player who has not fired has not started playing, and
   * quietly retiring the only prompt on screen would leave them with nothing.
   */
  patience: number;
  ready(s: CoachInput): boolean;
  done(s: CoachInput, held: number): boolean;
}

const LESSONS: Lesson[] = [
  {
    id: "fire",
    verb: "FIRE",
    keys: "click",
    thumbs: "tap",
    delay: 0.7,
    patience: Infinity,
    ready: () => true,
    done: (s) => s.firing,
  },
  {
    id: "move",
    verb: "MOVE",
    keys: "keys-ad",
    thumbs: "drag",
    delay: 2.6,
    patience: 18,
    ready: () => true,
    done: (s) => Math.abs(s.moveX) > 0.4,
  },
  {
    id: "swap",
    verb: "SWAP ROUNDS",
    keys: "keys-13",
    thumbs: "swap-buttons",
    delay: 7,
    patience: 16,
    // Campaign missions can issue a single round; there is nothing to teach then.
    ready: (s) => s.ammoCount > 1,
    // Satisfied by the selection changing, so the wheel and the on-screen buttons
    // count as well as the number row. Handled in `update`.
    done: () => false,
  },
  {
    id: "fly",
    verb: "FLY",
    keys: "space",
    thumbs: "stick-up",
    delay: 9,
    patience: 16,
    ready: () => true,
    // A tap of the jump key is a jump; holding the throttle open is the jetpack.
    done: (s, held) => s.jetThrottle > 0.25 && held > 0.25,
  },
  {
    id: "limp",
    verb: "GO LIMP",
    keys: "key-r",
    thumbs: "limp-button",
    delay: 12,
    patience: 14,
    ready: () => true,
    done: (s) => s.limp,
  },
];

const KEY = "stickman.coach.v1";

function taught(): Set<string> {
  try {
    return new Set((localStorage.getItem(KEY) ?? "").split(",").filter(Boolean));
  } catch {
    return new Set();
  }
}

function remember(ids: Iterable<string>) {
  try {
    localStorage.setItem(KEY, [...ids].join(","));
  } catch {
    // Locked-down storage: the player just gets taught again next session.
  }
}

const GOLD = "#ffd23f";
const CREAM = "#f4f1e8";
const GREEN = "#6ddc7a";

export class Coach {
  /** Lessons already completed, in this session or a previous one. */
  private learned = taught();
  private idx = 0;
  /** Seconds since the current lesson became eligible to appear. */
  private wait = 0;
  /** Seconds the current prompt has been on screen. */
  private shown = 0;
  private alpha = 0;
  /** Last seen ammo selection, so a change is detectable without a key binding. */
  private lastAmmo = -1;
  /** How long the jetpack has been open, so a jump does not count as flight. */
  private jetHeld = 0;
  /** Counts down after a lesson is satisfied — the tick, then the fade. */
  private celebrate = 0;
  private t = 0;
  private glyph: Glyph = "click";
  private verb = "";

  /** True once there is nothing left to teach. */
  get idle() {
    return this.idx >= LESSONS.length || !settings.tips;
  }

  /**
   * Starts a run's coaching. Cheap enough to call on every level load — lessons the
   * player has already passed are skipped, so a veteran's coach is idle immediately.
   */
  begin() {
    this.learned = taught();
    this.idx = 0;
    this.wait = 0;
    this.shown = 0;
    this.alpha = 0;
    this.celebrate = 0;
    this.lastAmmo = -1;
    this.jetHeld = 0;
    this.skipLearned();
  }

  /** Retires the coach for good. The pause menu's TIPS switch is the player's route in. */
  skipAll() {
    this.idx = LESSONS.length;
    this.celebrate = 0;
    remember(LESSONS.map((l) => l.id));
    this.learned = taught();
  }

  /** Forgets everything, so the next run coaches from scratch. For testing the FTUE. */
  static forget() {
    remember([]);
  }

  private skipLearned() {
    while (this.idx < LESSONS.length && this.learned.has(LESSONS[this.idx].id)) this.idx++;
  }

  private complete(id: LessonId) {
    this.learned.add(id);
    remember(this.learned);
    this.celebrate = 0.9;
  }

  update(dt: number, s: CoachInput) {
    this.t += dt;
    this.jetHeld = s.jetThrottle > 0.2 ? this.jetHeld + dt : 0;
    if (this.lastAmmo < 0) this.lastAmmo = s.ammoIndex;

    if (this.celebrate > 0) {
      this.celebrate = Math.max(0, this.celebrate - dt);
      this.alpha = clamp(this.celebrate / 0.4, 0, 1);
      if (this.celebrate === 0) this.lastAmmo = s.ammoIndex;
      return;
    }

    if (this.idle || !s.live) {
      this.alpha = Math.max(0, this.alpha - dt * 4);
      return;
    }

    const lesson = LESSONS[this.idx];
    // A gesture the device cannot make is not a lesson. Retire it silently rather
    // than telling a phone player to press R.
    const picture = s.touch ? lesson.thumbs : lesson.keys;
    if (!picture || !lesson.ready(s)) {
      this.advance();
      return;
    }
    this.glyph = picture;
    this.verb = lesson.verb;

    this.wait += dt;
    if (this.wait < lesson.delay) {
      this.alpha = Math.max(0, this.alpha - dt * 4);
      return;
    }

    this.shown += dt;
    this.alpha = Math.min(1, this.alpha + dt * 3);

    const swapped = lesson.id === "swap" && s.ammoIndex !== this.lastAmmo;
    if (swapped || lesson.done(s, this.jetHeld)) {
      this.complete(lesson.id);
      this.advance();
      return;
    }
    // Out of patience: stop nagging, but do not bank it as learned — a player who
    // ignored the jetpack once should still be offered it on their next run.
    if (this.shown > lesson.patience) this.advance();
  }

  private advance() {
    this.idx++;
    this.wait = 0;
    this.shown = 0;
    this.skipLearned();
  }

  /**
   * Draws the current prompt beside the player.
   *
   * Diegetic on purpose: an instruction in the middle of the screen is a modal the
   * player has to dismiss, while one hovering over the stickman is part of the world
   * and reads in peripheral vision while they are already aiming.
   */
  draw(ctx: Ctx, w: number, h: number, camera: Camera, world: V | null) {
    if (this.alpha < 0.01) return;
    const k = clamp(Math.min(w, h) / 900, 0.72, 1.3);
    const done = this.celebrate > 0;

    const anchor = world ? screenAnchor(camera, world, w, h) : v(w / 2, h * 0.5);
    const gw = 62 * k;
    const bh = 54 * k;
    const labelW = measure(ctx, this.verb, 17 * k, 900);
    const bw = gw + labelW + 40 * k;

    // Kept inside a margin wide enough for the whole pill, so a player pinned against
    // the edge of the world still gets a readable prompt instead of half of one.
    const px = clamp(anchor.x, bw / 2 + 12 * k, w - bw / 2 - 12 * k);
    const py = clamp(anchor.y - 84 * k, 100 * k, h - 160 * k);
    const bob = Math.sin(this.t * 2.4) * 3 * k;
    const x = px - bw / 2;
    const y = py - bh / 2 + bob;

    ctx.save();
    ctx.globalAlpha = this.alpha;

    // A drop shadow behind the pill, because the prompt has to survive being over a
    // bright Mars sky and a black castle wall without changing colour.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 18 * k;
    ctx.shadowOffsetY = 4 * k;
    ctx.fillStyle = "rgba(12,14,20,0.92)";
    roundRect(ctx, x, y, bw, bh, 14 * k);
    ctx.fill();
    ctx.restore();

    const pulse = 0.55 + 0.45 * Math.sin(this.t * 4);
    ctx.strokeStyle = done ? "rgba(109,220,122,0.95)" : `rgba(255,210,63,${0.32 + pulse * 0.55})`;
    ctx.lineWidth = 2 * k;
    roundRect(ctx, x, y, bw, bh, 14 * k);
    ctx.stroke();

    // Picture first, word second — the control is a shape you look for on the desk,
    // not a noun in a sentence.
    if (done) drawTick(ctx, x + 14 * k + gw / 2, y + bh / 2, gw * 0.42, k);
    else drawGlyph(ctx, this.glyph, x + 14 * k + gw / 2, y + bh / 2, gw, k, this.t);

    text(ctx, this.verb, x + gw + 26 * k, y + bh / 2 + 1 * k, 17 * k, done ? GREEN : CREAM, "left", "middle", 900);

    // A stub pointing back down at whoever is being told what to do.
    if (world) {
      ctx.fillStyle = "rgba(12,14,20,0.92)";
      ctx.beginPath();
      ctx.moveTo(px - 8 * k, y + bh - 1);
      ctx.lineTo(px + 8 * k, y + bh - 1);
      ctx.lineTo(px, y + bh + 12 * k);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * World point to CSS pixels, mirroring `Camera.apply` — minus the shake roll, which
 * is deliberately ignored so an explosion does not throw the prompt around the screen.
 */
export function screenAnchor(cam: Camera, world: V, w: number, h: number): V {
  const z = cam.effectiveZoom;
  return v(w / 2 + (world.x - cam.pos.x) * z, h / 2 - (world.y - cam.pos.y) * z);
}

// ---------------------------------------------------------------- illustrations

/**
 * The control, drawn.
 *
 * All of it is flat vector work on a handful of paths — the prompt is on screen for a
 * few seconds at a time on hardware that has to hold sixty frames on a Chromebook, so
 * nothing here allocates, caches or blurs.
 */
function drawGlyph(ctx: Ctx, glyph: Glyph, cx: number, cy: number, size: number, k: number, t: number) {
  const beat = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2 * k;

  switch (glyph) {
    case "click": {
      // A mouse in outline with the left button filled and pulsing.
      const mw = size * 0.42;
      const mh = size * 0.62;
      ctx.strokeStyle = CREAM;
      ctx.beginPath();
      ctx.roundRect(-mw / 2, -mh / 2, mw, mh, mw * 0.48);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,210,63,${0.5 + beat * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(-mw / 2, -mh * 0.06);
      ctx.lineTo(-mw / 2, -mh / 2 + mw * 0.42);
      ctx.arcTo(-mw / 2, -mh / 2, 0, -mh / 2, mw * 0.48);
      ctx.lineTo(0, -mh * 0.06);
      ctx.closePath();
      ctx.fill();
      // Impact ticks, so the button reads as being pressed rather than merely lit.
      ctx.strokeStyle = `rgba(255,210,63,${beat})`;
      for (const a of [-0.9, 0, 0.9]) {
        ctx.beginPath();
        ctx.moveTo(Math.sin(a) * mw * 0.8, -mh * 0.55 - Math.cos(a) * mh * 0.12);
        ctx.lineTo(Math.sin(a) * mw * 1.05, -mh * 0.72 - Math.cos(a) * mh * 0.16);
        ctx.stroke();
      }
      break;
    }
    case "tap": {
      // A fingertip and an expanding contact ring.
      ctx.strokeStyle = `rgba(255,210,63,${1 - beat * 0.7})`;
      ctx.beginPath();
      ctx.arc(0, size * 0.06, size * (0.16 + beat * 0.26), 0, TAU);
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(0, size * 0.06, size * 0.13, 0, TAU);
      ctx.fill();
      break;
    }
    // The letters come from the player's own layout, not from the QWERTY name of the
    // code — an AZERTY keyboard has no A where we bind `KeyA`, and drawing one there
    // sends them hunting for a key that does nothing. See `core/keylabel`.
    case "keys-ad": {
      keycap(ctx, -size * 0.24, 0, size * 0.4, k, keyLabel("KeyA"), beat > 0.5);
      keycap(ctx, size * 0.24, 0, size * 0.4, k, keyLabel("KeyD"), beat <= 0.5);
      break;
    }
    case "keys-13": {
      keycap(ctx, -size * 0.24, 0, size * 0.4, k, keyLabel("Digit1"), beat > 0.5);
      keycap(ctx, size * 0.24, 0, size * 0.4, k, keyLabel("Digit3"), beat <= 0.5);
      break;
    }
    case "swap-buttons": {
      keycap(ctx, -size * 0.24, 0, size * 0.4, k, "‹", beat > 0.5);
      keycap(ctx, size * 0.24, 0, size * 0.4, k, "›", beat <= 0.5);
      break;
    }
    case "key-r": {
      keycap(ctx, 0, 0, size * 0.44, k, keyLabel("KeyR"), beat > 0.5);
      break;
    }
    // The on-screen twin of `key-r`: the same falling figure the button itself draws,
    // so the prompt and the thing it points at are recognisably one control.
    case "limp-button": {
      const bw = size * 0.5;
      ctx.strokeStyle = `rgba(244,241,232,${0.3 + beat * 0.5})`;
      ctx.lineWidth = 1.6 * k;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bw / 2, bw, bw, bw * 0.24);
      ctx.stroke();

      const r = bw * 0.3;
      ctx.save();
      ctx.rotate(1.35);
      ctx.strokeStyle = `rgba(255,210,63,${0.6 + beat * 0.4})`;
      ctx.lineWidth = Math.max(1.8, bw * 0.055);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, -r * 0.78, r * 0.26, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(0, r * 0.34);
      ctx.moveTo(0, -r * 0.24);
      ctx.lineTo(-r * 0.56, r * 0.1);
      ctx.moveTo(0, -r * 0.24);
      ctx.lineTo(r * 0.5, r * 0.2);
      ctx.moveTo(0, r * 0.34);
      ctx.lineTo(-r * 0.42, r * 0.82);
      ctx.moveTo(0, r * 0.34);
      ctx.lineTo(r * 0.46, r * 0.78);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case "space": {
      // A wide bar, held down, with thrust coming out from under it.
      const bw = size * 0.86;
      const bh = size * 0.26;
      ctx.fillStyle = `rgba(255,210,63,${0.55 + beat * 0.45})`;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2 + size * 0.1, bw, bh, 4 * k);
      ctx.fill();
      ctx.strokeStyle = CREAM;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.1);
      ctx.lineTo(0, -size * 0.42);
      ctx.moveTo(-size * 0.11, -size * 0.28);
      ctx.lineTo(0, -size * 0.44);
      ctx.lineTo(size * 0.11, -size * 0.28);
      ctx.stroke();
      break;
    }
    case "stick-up": {
      // The floating stick, pushed to the top of its ring.
      ctx.strokeStyle = "rgba(244,241,232,0.5)";
      ctx.beginPath();
      ctx.arc(0, size * 0.06, size * 0.34, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,210,63,${0.6 + beat * 0.4})`;
      ctx.beginPath();
      ctx.arc(0, size * 0.06 - size * 0.28, size * 0.15, 0, TAU);
      ctx.fill();
      break;
    }
    case "drag": {
      // A thumb sliding along a track.
      ctx.strokeStyle = "rgba(244,241,232,0.45)";
      ctx.beginPath();
      ctx.moveTo(-size * 0.36, size * 0.06);
      ctx.lineTo(size * 0.36, size * 0.06);
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc((beat - 0.5) * size * 0.62, size * 0.06, size * 0.14, 0, TAU);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function keycap(ctx: Ctx, x: number, y: number, s: number, k: number, label: string, lit: boolean) {
  ctx.fillStyle = lit ? GOLD : "rgba(244,241,232,0.14)";
  ctx.beginPath();
  ctx.roundRect(x - s / 2, y - s / 2, s, s, 5 * k);
  ctx.fill();
  ctx.strokeStyle = lit ? GOLD : "rgba(244,241,232,0.5)";
  ctx.lineWidth = 1.5 * k;
  ctx.stroke();
  text(ctx, label, x, y + 0.5 * k, s * 0.6, lit ? "#141820" : CREAM, "center", "middle", 900);
}

function drawTick(ctx: Ctx, cx: number, cy: number, r: number, k: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 3.5 * k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.7, 0);
  ctx.lineTo(-r * 0.15, r * 0.55);
  ctx.lineTo(r * 0.75, -r * 0.6);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- primitives

const font = (size: number, weight: number) =>
  `${weight} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;

function measure(ctx: Ctx, str: string, size: number, weight: number) {
  ctx.font = font(size, weight);
  return ctx.measureText(str).width;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
}

function text(
  ctx: Ctx, str: string, x: number, y: number, size: number, color: string,
  align: CanvasTextAlign = "left", baseline: CanvasTextBaseline = "alphabetic", weight = 700,
) {
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
