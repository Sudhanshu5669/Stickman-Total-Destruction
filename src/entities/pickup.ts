import type { Actor, GameCtx } from "../core/types";
import { clamp, TAU, v, type V } from "../core/math";
import { rgba, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";

/**
 * A thing lying on the ground that the player walks into.
 *
 * The game has exactly one of these and it is the jetpack, so this is written for that
 * job rather than as a general item system: no inventory, no respawn, no despawn timer.
 * It sits, it is loud, and the first time the player touches it, it fires a callback
 * and dies.
 *
 * ## Why it is drawn this brightly
 *
 * It is the only object in the game the player has to *walk into* rather than shoot,
 * and nothing up to this point has taught them that walking into things does anything.
 * So it is deliberately the loudest thing on screen — a beam, a ring, a bobbing
 * silhouette and a chevron — and it stays that way until it is taken. Subtlety here
 * costs the player the reward the whole level was built to hand them.
 */
export interface PickupOptions {
  x: number;
  /** Ground level. The pack floats above it. */
  y: number;
  label: string;
  /** Fires the instant it is collected. */
  onTake(): void;
  /**
   * Seconds to stay alive after collection before `then` fires. Use it to buy the
   * player a moment with whatever they were just given.
   */
  linger?: number;
  then?(): void;
}

export class Pickup implements Actor {
  dead = false;
  /** Above the blocks, below the characters: visible through rubble, never over a face. */
  z = 12;
  cullRadius = 12;

  private t = 0;
  /** Grows from 0 as the pickup arrives, so it can be dropped in mid-level. */
  private arrive = 0;
  private taken = false;

  /** Counts down after collection, while `linger` runs. */
  private lingerLeft = 0;

  constructor(private readonly game: GameCtx, private readonly o: PickupOptions) {
    this.x = o.x;
    this.y = o.y;
  }

  readonly x: number;
  readonly y: number;

  update(dt: number) {
    this.t += dt;
    this.arrive = Math.min(1, this.arrive + dt * 1.6);

    if (this.taken) {
      // Collected, invisible, and still alive: this is the window the player gets to
      // actually *use* the thing before whatever happens next happens. Handing someone
      // a jetpack and cutting straight to a results card wastes the only moment in the
      // game where a new capability is a surprise.
      this.lingerLeft -= dt;
      if (this.lingerLeft <= 0) {
        this.dead = true;
        this.o.then?.();
      }
      return;
    }

    const target = this.game.target();
    if (!target) return;
    const p = target.pos;
    const dx = p.x - this.x;
    const dy = p.y - (this.y + 0.9);
    // A generous capsule rather than a tight circle: this is a reward, and making the
    // player line up precisely to collect it would be a puzzle nobody asked for.
    if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.9) return;

    this.taken = true;
    this.o.onTake();
    this.lingerLeft = this.o.linger ?? 0;
    if (this.lingerLeft <= 0) {
      this.dead = true;
      this.o.then?.();
    }
  }

  cullPos(): V {
    return v(this.x, this.y + 1.5);
  }

  draw(ctx: Ctx) {
    const a = this.arrive;
    if (a <= 0.01 || this.taken) return;
    const bob = Math.sin(this.t * 2.2) * 0.14;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3.4);
    const cy = this.y + 1.05 + bob;

    // Shaft of light. Drawn first so everything else sits inside it.
    const beamH = 9 * a;
    const g = ctx.createLinearGradient(0, this.y, 0, this.y + beamH);
    g.addColorStop(0, rgba("#5ec8ff", 0.34 * a));
    g.addColorStop(1, rgba("#5ec8ff", 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(this.x - 0.75, this.y);
    ctx.lineTo(this.x + 0.75, this.y);
    ctx.lineTo(this.x + 1.5, this.y + beamH);
    ctx.lineTo(this.x - 1.5, this.y + beamH);
    ctx.closePath();
    ctx.fill();

    // Ground ring, so the exact spot to stand on is unambiguous.
    ctx.strokeStyle = rgba("#5ec8ff", (0.4 + pulse * 0.4) * a);
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 0.06, 1.15 + pulse * 0.18, 0.34 + pulse * 0.06, 0, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.translate(this.x, cy);
    ctx.scale(a, a);

    // The pack: two tanks, a harness plate and a pair of nozzles.
    ctx.fillStyle = "#2c333f";
    ctx.beginPath();
    ctx.roundRect(-0.42, -0.5, 0.84, 0.86, 0.12);
    ctx.fill();
    ctx.fillStyle = "#8f9aa8";
    for (const sx of [-0.24, 0.24]) {
      ctx.beginPath();
      ctx.roundRect(sx - 0.16, -0.42, 0.32, 0.72, 0.14);
      ctx.fill();
    }
    ctx.fillStyle = "#e8a33a";
    ctx.fillRect(-0.42, -0.08, 0.84, 0.12);
    // Nozzles, lit from inside.
    ctx.fillStyle = rgba("#5ec8ff", 0.5 + pulse * 0.5);
    for (const sx of [-0.24, 0.24]) {
      ctx.beginPath();
      ctx.moveTo(sx - 0.13, -0.5);
      ctx.lineTo(sx + 0.13, -0.5);
      ctx.lineTo(sx + 0.08, -0.72);
      ctx.lineTo(sx - 0.08, -0.72);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Chevron above, bouncing on its own phase so it reads as an instruction.
    const chev = this.y + 2.5 + Math.sin(this.t * 3.6) * 0.18;
    ctx.strokeStyle = rgba("#ffd23f", (0.55 + pulse * 0.45) * a);
    ctx.lineWidth = 0.11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.x - 0.32, chev + 0.3);
    ctx.lineTo(this.x, chev);
    ctx.lineTo(this.x + 0.32, chev + 0.3);
    ctx.stroke();

    // The word, drawn manually rather than through `worldText` so it stays upright in
    // a Y-flipped world without the caller having to know that.
    ctx.save();
    ctx.translate(this.x, this.y + 3.35);
    ctx.scale(1, -1);
    ctx.font = `900 ${0.42}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 0.14;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(this.o.label, 0, 0);
    ctx.fillStyle = rgba("#ffd23f", clamp(0.7 + pulse * 0.3, 0, 1) * a);
    ctx.fillText(this.o.label, 0, 0);
    ctx.restore();
  }

  destroy() {
    // Nothing physical to release.
  }

  /** The noise it makes when collected. Called by the level, so the level owns the beat. */
  static collected() {
    sfx.levelUp();
  }
}
