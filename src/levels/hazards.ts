import { RAPIER, G, ig } from "../core/physics";
import type { Actor, GameCtx } from "../core/types";
import { clamp, rand, v, type V } from "../core/math";
import { rgba, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";

export interface AcidRainConfig {
  /** Drops alive at once. Purely visual density. */
  drops: number;
  /** Seconds between damage passes. */
  interval: number;
  /** Damage per pass to anything caught in the open. */
  damage: number;
  color: string;
  /** Drop fall speed, m/s. */
  speed: number;
}

const DEFAULTS: AcidRainConfig = {
  drops: 260,
  interval: 0.9,
  damage: 4.5,
  color: "#9dff6a",
  speed: 34,
};

/** Sky probe length. Anything with this much clear air above it is exposed. */
const SKY_PROBE = 60;
/** Cap on raycasts per damage pass, so a crowded scene can't stall the frame. */
const MAX_PROBES = 26;

/**
 * Corrosive weather.
 *
 * Rain is cosmetic and runs on its own recycled pool rather than the shared particle
 * system, so a downpour can't starve explosions of particles. The gameplay half is a
 * periodic pass that raycasts straight up from nearby bodies: anything with open sky
 * above it takes damage, anything under a roof does not. That turns every structure in
 * the level into cover and gives the world a reason to exist beyond its palette.
 */
export class AcidRain implements Actor {
  dead = false;
  z = 40;

  private readonly cfg: AcidRainConfig;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly vy: Float32Array;
  private readonly len: Float32Array;
  private timer = 0;
  private ambientTimer = 0;
  /** Round-robin cursor so every actor gets probed eventually, not just the first few. */
  private cursor = 0;

  constructor(private readonly game: GameCtx, cfg: Partial<AcidRainConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    const n = this.cfg.drops;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.len = new Float32Array(n);
    for (let i = 0; i < n; i++) this.reseed(i, true);
  }

  private reseed(i: number, anywhere: boolean) {
    const cam = this.game.camera.pos;
    const half = this.game.camera.visibleHalf(4);
    this.xs[i] = cam.x + rand(-half.x, half.x);
    this.ys[i] = anywhere ? cam.y + rand(-half.y, half.y) : cam.y + half.y + rand(0, 6);
    this.vy[i] = -this.cfg.speed * rand(0.85, 1.2);
    this.len[i] = rand(0.35, 0.9);
  }

  update(dt: number) {
    const cam = this.game.camera.pos;
    const half = this.game.camera.visibleHalf(4);
    const floor = cam.y - half.y;

    for (let i = 0; i < this.xs.length; i++) {
      this.ys[i] += this.vy[i] * dt;
      this.xs[i] += dt * 2.2; // slight slant, as if wind-driven
      if (this.ys[i] < floor || Math.abs(this.xs[i] - cam.x) > half.x + 2) this.reseed(i, false);
    }

    // Ambient hiss and splash, tied to the camera rather than to any one surface.
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = rand(0.5, 1.4);
      sfx.acidHiss();
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.cfg.interval;
      this.burn();
    }
  }

  /**
   * One damage pass. `damageables()[0]` is the player by contract — being able to
   * duck under a roof is the whole point, so that one is probed every pass while the
   * rest of the world is sampled round-robin within the probe budget.
   */
  private burn() {
    const actors = this.game.damageables();
    if (!actors.length) return;

    this.probe(actors[0]);

    let probes = 1;
    for (let n = 1; n < actors.length && probes < MAX_PROBES; n++) {
      const a = actors[1 + ((this.cursor + n) % (actors.length - 1))];
      if (this.probe(a)) probes++;
    }
    this.cursor = (this.cursor + probes) % Math.max(1, actors.length - 1);
  }

  /** @returns true if a raycast was actually spent on this actor. */
  private probe(a: Actor): boolean {
    if (!a || a.dead || !a.cullPos || !a.takeAcid) return false;
    const p = a.cullPos();
    if (!this.game.camera.isVisible(p, 8)) return false;
    if (!this.exposed(p)) return true;

    a.takeAcid(this.cfg.damage);
    if (Math.random() < 0.4) {
      this.game.particles.emit("spark", p.x + rand(-0.4, 0.4), p.y + 0.3, {
        vx: rand(-1, 1), vy: rand(1, 3), maxLife: 0.35, size: 0.1, color: this.cfg.color, drag: 2,
      });
    }
    return true;
  }

  /** True when nothing blocks the sky directly above `p`. */
  private exposed(p: V): boolean {
    const ray = new RAPIER.Ray(v(p.x, p.y + 0.35), v(0, 1));
    const hit = this.game.physics.world.castRay(
      ray, SKY_PROBE, true,
      undefined, ig(G.SENSOR, G.TERRAIN | G.BLOCK),
    );
    return hit === null;
  }

  draw(ctx: Ctx) {
    ctx.strokeStyle = rgba(this.cfg.color, 0.5);
    ctx.lineWidth = 0.045;
    ctx.lineCap = "butt";
    ctx.beginPath();
    for (let i = 0; i < this.xs.length; i++) {
      ctx.moveTo(this.xs[i], this.ys[i]);
      ctx.lineTo(this.xs[i] - 0.09, this.ys[i] + this.len[i]);
    }
    ctx.stroke();
  }

  destroy() {}
}

/**
 * Non-colliding scenery: torches, banners, antennae. Draws and animates, owns no
 * physics body, and is culled like anything else.
 */
export class Decor implements Actor {
  dead = false;
  z: number;
  private t = rand(0, 10);

  constructor(
    private readonly game: GameCtx,
    readonly x: number,
    readonly y: number,
    private readonly kind: "torch" | "banner" | "antenna" | "pod",
    private readonly tint = "#ffb03a",
    z = 9,
  ) {
    this.z = z;
  }

  update(dt: number) {
    this.t += dt;
    if (this.kind !== "torch") return;
    // Embers, only while on screen.
    if (Math.random() < dt * 9 && this.game.camera.isVisible(v(this.x, this.y), 4)) {
      this.game.particles.fire(this.x, this.y + 0.55, 1, 1.4);
    }
  }

  draw(ctx: Ctx) {
    const x = this.x;
    const y = this.y;
    switch (this.kind) {
      case "torch": {
        ctx.strokeStyle = "#4a3524";
        ctx.lineWidth = 0.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 0.5);
        ctx.stroke();
        const f = 0.16 + Math.sin(this.t * 9) * 0.03;
        const glow = ctx.createRadialGradient(x, y + 0.6, 0, x, y + 0.6, 2.4);
        glow.addColorStop(0, rgba(this.tint, 0.32));
        glow.addColorStop(1, rgba(this.tint, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(x - 2.4, y + 0.6 - 2.4, 4.8, 4.8);
        ctx.fillStyle = this.tint;
        ctx.beginPath();
        ctx.ellipse(x, y + 0.62, f, f * 1.7, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "banner": {
        ctx.fillStyle = this.tint;
        const sway = Math.sin(this.t * 1.6) * 0.06;
        ctx.beginPath();
        ctx.moveTo(x - 0.28, y);
        ctx.lineTo(x + 0.28, y);
        ctx.lineTo(x + 0.28 + sway, y - 1.5);
        ctx.lineTo(x, y - 1.25);
        ctx.lineTo(x - 0.28 + sway, y - 1.5);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "antenna": {
        ctx.strokeStyle = this.tint;
        ctx.lineWidth = 0.06;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 1.6);
        ctx.moveTo(x - 0.35, y + 1.2);
        ctx.lineTo(x + 0.35, y + 1.2);
        ctx.stroke();
        // Blinking beacon.
        if (Math.sin(this.t * 3) > 0.4) {
          ctx.fillStyle = "#ff5b45";
          ctx.beginPath();
          ctx.arc(x, y + 1.7, 0.09, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "pod": {
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 1.6);
        glow.addColorStop(0, rgba(this.tint, 0.22 + pulse * 0.2));
        glow.addColorStop(1, rgba(this.tint, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
        ctx.fillStyle = rgba(this.tint, 0.75);
        ctx.beginPath();
        ctx.ellipse(x, y, 0.22, 0.34 + pulse * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  cullPos() {
    return v(this.x, this.y);
  }

  cullRadius = 3;

  destroy() {}
}

export const clampDamage = (n: number) => clamp(n, 0, 9999);
