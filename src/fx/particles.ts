import { TAU, clamp, rand, randSign, randSpread, smoothstep, type V } from "../core/math";
import type { Camera } from "../core/camera";
import { circle, rgba, worldText, type Ctx } from "../render/draw";

export type PKind =
  | "spark" | "smoke" | "dust" | "fire" | "blood" | "feather"
  | "shard" | "ring" | "flash" | "popup" | "star" | "glint";

interface Particle {
  kind: PKind;
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  grow: number;
  spin: number;
  angle: number;
  drag: number;
  gravity: number;
  color: string;
  text?: string;
  /** Shards keep a stable silhouette so they read as chunks of debris, not blobs. */
  seed: number;
}

const MAX = 1400;

/**
 * A single flat pool for every visual effect. Particles are purely cosmetic — nothing
 * here touches the physics world, so we can spam them freely and cull hard.
 */
export class Particles {
  private pool: Particle[] = [];
  private count = 0;
  /**
   * World gravity multiplier, set per level. Only applied to particles that *fall*
   * (negative gravity); smoke and fire carry authored buoyancy that shouldn't change
   * just because the planet did.
   */
  gravityScale = 1;

  constructor() {
    for (let i = 0; i < MAX; i++) this.pool.push(blank());
  }

  get active() {
    return this.count;
  }

  clear() {
    this.count = 0;
  }

  /**
   * How much of the pool is still free, 0..1. Callers sizing a big burst multiply by
   * this so a nuke degrades into a smaller nuke instead of wiping out every effect on
   * screen — the pool has a hard cap and nothing is allowed to pretend otherwise.
   */
  get headroom() {
    return 1 - this.count / MAX;
  }

  private spawn(): Particle | null {
    if (this.count >= MAX) {
      // Saturated: recycle whichever of three random candidates has the least life left.
      // Uniform recycling throws away brand-new effects as readily as dying ones, which
      // is what makes a saturated pool flicker; three samples is enough to bias strongly
      // toward the dying ones and is still O(1).
      let best = this.pool[(Math.random() * MAX) | 0];
      for (let i = 0; i < 2; i++) {
        const c = this.pool[(Math.random() * MAX) | 0];
        if (c.life < best.life) best = c;
      }
      return best;
    }
    return this.pool[this.count++];
  }

  emit(kind: PKind, x: number, y: number, opts: Partial<Particle> = {}) {
    const p = this.spawn();
    if (!p) return;
    p.kind = kind;
    p.x = x; p.y = y;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.maxLife = opts.maxLife ?? 0.6;
    p.life = p.maxLife;
    p.size = opts.size ?? 0.12;
    p.grow = opts.grow ?? 0;
    p.spin = opts.spin ?? 0;
    p.angle = opts.angle ?? rand(0, TAU);
    p.drag = opts.drag ?? 1.2;
    p.gravity = opts.gravity ?? 0;
    p.color = opts.color ?? "#ffffff";
    p.text = opts.text;
    p.seed = Math.random() * 1000;
  }

  // ------------------------------------------------------------------ presets

  sparks(x: number, y: number, n: number, speed = 9, color = "#ffd23f") {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = speed * rand(0.35, 1);
      this.emit("spark", x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        maxLife: rand(0.16, 0.42), size: rand(0.05, 0.13),
        gravity: -14, drag: 2.4, color,
      });
    }
  }

  dust(x: number, y: number, n: number, spread = 3, color = "#cbb99a") {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.emit("dust", x, y, {
        vx: Math.cos(a) * rand(0.4, spread), vy: Math.abs(Math.sin(a)) * rand(0.4, spread) * 0.8,
        maxLife: rand(0.5, 1.3), size: rand(0.18, 0.5), grow: rand(0.5, 1.6),
        drag: 2.2, gravity: 1.4, color,
      });
    }
  }

  smoke(x: number, y: number, n: number, vy = 2, color = "#5a5f6b") {
    for (let i = 0; i < n; i++) {
      this.emit("smoke", x, y, {
        vx: rand(-1.2, 1.2), vy: rand(0.3, 1) * vy,
        maxLife: rand(0.8, 2.1), size: rand(0.2, 0.55), grow: rand(0.8, 2.2),
        drag: 0.9, gravity: 1.2, color, spin: rand(-1, 1),
      });
    }
  }

  fire(x: number, y: number, n: number, speed = 5) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.emit("fire", x, y, {
        vx: Math.cos(a) * rand(0.2, 1) * speed, vy: Math.sin(a) * rand(0.2, 1) * speed + 2,
        maxLife: rand(0.22, 0.6), size: rand(0.25, 0.7), grow: rand(-0.4, 1.2),
        drag: 2.0, gravity: 3.5,
        color: ["#fff3b0", "#ffb03a", "#ff6b2c", "#e03b1e"][(Math.random() * 4) | 0],
      });
    }
  }

  blood(x: number, y: number, n: number, dir?: V, speed = 8, color = "#c0263a") {
    for (let i = 0; i < n; i++) {
      const a = dir ? Math.atan2(dir.y, dir.x) + rand(-0.9, 0.9) : rand(0, TAU);
      const s = speed * rand(0.2, 1);
      this.emit("blood", x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + rand(0, 3),
        maxLife: rand(0.5, 1.4), size: rand(0.06, 0.19),
        drag: 0.55, gravity: -20, color,
      });
    }
  }

  feathers(x: number, y: number, n: number, color = "#fff8e6") {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.emit("feather", x, y, {
        vx: Math.cos(a) * rand(1, 5), vy: Math.sin(a) * rand(1, 5) + 2,
        maxLife: rand(1.4, 3.2), size: rand(0.09, 0.2),
        drag: 2.8, gravity: -1.6, spin: rand(-6, 6), color,
      });
    }
  }

  shards(x: number, y: number, n: number, color: string, speed = 8) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = speed * rand(0.25, 1);
      this.emit("shard", x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + rand(0, 3),
        maxLife: rand(0.7, 1.9), size: rand(0.08, 0.26),
        drag: 0.45, gravity: -20, spin: rand(-14, 14), color,
      });
    }
  }

  /**
   * Debris thrown *along* a direction and carrying the velocity of whatever threw it.
   *
   * An omnidirectional burst reads as "an effect played here". A spray that leaves along
   * the impact normal and inherits the impactor's velocity reads as material being
   * knocked off something, which is most of the difference between a hit that lands and
   * a hit that merely plays.
   */
  spray(
    x: number, y: number, n: number, dirX: number, dirY: number,
    speed: number, color: string, spread = 0.75, inheritX = 0, inheritY = 0,
  ) {
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < n; i++) {
      const a = base + randSpread(spread);
      const s = speed * rand(0.3, 1);
      this.emit("shard", x, y, {
        vx: Math.cos(a) * s + inheritX, vy: Math.sin(a) * s + inheritY,
        maxLife: rand(0.6, 1.7), size: rand(0.1, 0.32),
        drag: 0.5, gravity: -20, spin: rand(-16, 16), color,
      });
    }
  }

  /**
   * The heavy, slow, ground-hugging dust a collapse pushes out.
   *
   * Deliberately few and large. One big translucent puff costs a fraction of the fill
   * rate of the dozen small ones it replaces — overdraw is this renderer's real budget
   * ceiling — and a collapse reads better as a rolling front than as confetti.
   */
  collapseDust(x: number, y: number, n: number, spread = 6, color = "#c3b49b") {
    for (let i = 0; i < n; i++) {
      this.emit("dust", x, y, {
        vx: randSign() * rand(1.5, spread), vy: rand(0.2, 1.8),
        maxLife: rand(1.6, 3.4), size: rand(0.5, 1.3), grow: rand(1.2, 3),
        drag: 1.5, gravity: 0.5, color,
      });
    }
  }

  /** Smoke that hangs, for the half-minute *after* the blast when the site should still read as one. */
  linger(x: number, y: number, n: number, size = 1, color = "#6a6f7b") {
    for (let i = 0; i < n; i++) {
      this.emit("smoke", x, y, {
        vx: rand(-0.6, 0.6), vy: rand(0.15, 0.7),
        maxLife: rand(2.6, 5.5), size: rand(0.6, 1.5) * size, grow: rand(0.3, 0.9) * size,
        drag: 0.7, gravity: 0.35, color, spin: rand(-0.5, 0.5),
      });
    }
  }

  /** Sparks off metal: a tight cone along the surface, white-hot at the core, falling fast. */
  metalSparks(x: number, y: number, n: number, dirX: number, dirY: number, speed = 13) {
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < n; i++) {
      const a = base + randSpread(0.6);
      const s = speed * rand(0.3, 1);
      this.emit("spark", x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        maxLife: rand(0.12, 0.5), size: rand(0.05, 0.14),
        gravity: -22, drag: 1.6,
        // A third of them white so the burst has a core rather than one flat colour.
        color: Math.random() < 0.35 ? "#fffdf2" : "#ffd23f",
      });
    }
  }

  /** Glass, which is only worth drawing differently from rubble because it catches the light. */
  glass(x: number, y: number, n: number, dirX: number, dirY: number, speed = 9, color = "#d6f2ff") {
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < n; i++) {
      const a = base + randSpread(1.1);
      const s = speed * rand(0.25, 1);
      this.emit("glint", x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + rand(0, 2.5),
        maxLife: rand(0.8, 2.1), size: rand(0.07, 0.22),
        drag: 0.4, gravity: -20, spin: rand(-20, 20), color,
      });
    }
  }

  ring(x: number, y: number, size: number, color = "#ffffff", life = 0.4) {
    this.emit("ring", x, y, { size, grow: size * 7, maxLife: life, color, drag: 0 });
  }

  flash(x: number, y: number, size: number, color = "#fff6d0", life = 0.16) {
    this.emit("flash", x, y, { size, grow: size * 2.2, maxLife: life, color, drag: 0 });
  }

  stars(x: number, y: number, n: number, color = "#ffe45e") {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.emit("star", x, y, {
        vx: Math.cos(a) * rand(1, 4), vy: Math.sin(a) * rand(1, 4) + 2,
        maxLife: rand(0.4, 0.9), size: rand(0.12, 0.24), spin: rand(-10, 10),
        drag: 2, gravity: -3, color,
      });
    }
  }

  /**
   * A number that punches out of the impact and drifts away.
   *
   * `life` stays inside 0.6–1.2s: shorter and the eye cannot land on it, longer and the
   * numbers from three separate hits are on screen together and none of them belongs to
   * anything. There is no spawn delay anywhere in the chain, deliberately — a popup that
   * arrives even a frame or two after its impact stops being read as caused by it.
   */
  popup(x: number, y: number, text: string, color = "#ffd23f", size = 0.6, life = 1.0) {
    this.emit("popup", x, y, {
      vy: 4.2, vx: rand(-1, 1) * 0.6, maxLife: clamp(life, 0.6, 1.2),
      size, color, text, drag: 2.6, gravity: -2,
    });
  }

  // ------------------------------------------------------------------ sim

  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        // Swap-remove keeps the live range contiguous without shifting the array.
        this.pool[i] = this.pool[this.count - 1];
        this.pool[this.count - 1] = p;
        this.count--;
        i--;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vy += (p.gravity < 0 ? p.gravity * this.gravityScale : p.gravity) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      p.size += p.grow * dt;
    }
  }

  /**
   * Pass `cam` to skip anything off-screen.
   *
   * Simulation is a few arithmetic ops per particle and stays cheap; *drawing* is a
   * canvas call each, and this renderer's ceiling is draw calls and overdraw rather
   * than maths. Lingering smoke in particular outlives the player's interest in the
   * place it was made, and there is no reason to pay for it once they have moved on.
   */
  draw(ctx: Ctx, cam?: Camera) {
    ctx.lineCap = "round";
    // Hoisted out of the loop and held as scalars: this is the hottest loop in the file.
    let cx = 0;
    let cy = 0;
    let hx = Infinity;
    let hy = Infinity;
    if (cam) {
      const z = cam.effectiveZoom;
      cx = cam.pos.x;
      cy = cam.pos.y;
      // 2m of slack absorbs shake offset and the largest authored particle radius.
      hx = cam.viewW / 2 / z + 2;
      hy = cam.viewH / 2 / z + 2;
    }

    for (let i = 0; i < this.count; i++) {
      const p = this.pool[i];
      const t = clamp(p.life / p.maxLife, 0, 1);
      const s = Math.max(0.001, p.size);
      if (Math.abs(p.x - cx) > hx + s || Math.abs(p.y - cy) > hy + s) continue;

      switch (p.kind) {
        case "spark":
        case "star": {
          ctx.strokeStyle = rgba(p.color, t);
          ctx.lineWidth = s * 0.9;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
          break;
        }
        case "fire": {
          ctx.fillStyle = rgba(p.color, t * 0.92);
          circle(ctx, p.x, p.y, s * t);
          ctx.fill();
          break;
        }
        case "smoke":
        case "dust": {
          ctx.fillStyle = rgba(p.color, t * 0.42);
          circle(ctx, p.x, p.y, s);
          ctx.fill();
          break;
        }
        case "blood": {
          ctx.fillStyle = rgba(p.color, Math.min(1, t * 1.6));
          circle(ctx, p.x, p.y, s);
          ctx.fill();
          break;
        }
        case "feather": {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = rgba(p.color, t);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 1.9, s * 0.6, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
          break;
        }
        case "shard": {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = rgba(p.color, Math.min(1, t * 1.5));
          const w = s * (0.6 + (p.seed % 7) / 10);
          ctx.beginPath();
          ctx.moveTo(-w, -s * 0.7);
          ctx.lineTo(s, -s * 0.2);
          ctx.lineTo(s * 0.4, s);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case "glint": {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = rgba(p.color, Math.min(1, t * 1.5));
          ctx.beginPath();
          ctx.moveTo(-s * 0.8, -s * 0.5);
          ctx.lineTo(s, -s * 0.3);
          ctx.lineTo(s * 0.3, s);
          ctx.closePath();
          ctx.fill();
          // The catch: a white face that flares twice a rotation. It is the only thing
          // that makes glass read as glass rather than as pale rubble, and it costs one
          // extra fill on a shape that is already in the path.
          const face = Math.sin(p.angle * 2 + p.seed);
          if (face > 0.72) {
            ctx.fillStyle = rgba("#ffffff", (face - 0.72) * 3 * t);
            ctx.fill();
          }
          ctx.restore();
          break;
        }
        case "ring": {
          ctx.strokeStyle = rgba(p.color, t * t * 0.85);
          ctx.lineWidth = 0.06 + s * 0.08;
          circle(ctx, p.x, p.y, s);
          ctx.stroke();
          break;
        }
        case "flash": {
          ctx.fillStyle = rgba(p.color, t * 0.9);
          circle(ctx, p.x, p.y, s);
          ctx.fill();
          break;
        }
        case "popup": {
          const age = p.maxLife - p.life;
          // Overshoot: snap past full size in ~70ms, then settle back. The overshoot is
          // what makes a number read as a *hit* instead of as UI text drifting upward,
          // and it costs one exp() on a handful of particles.
          const rise = Math.min(1, age / 0.07);
          const scale = (0.3 + 0.7 * rise) * (1 + 0.34 * rise * Math.exp(-Math.max(0, age - 0.07) * 11));
          // Held at full opacity for two thirds of its life, then out. Fading from the
          // first frame reads as a number that was never confident it belonged.
          const a = smoothstep(clamp(t * 3, 0, 1));
          worldText(ctx, p.text ?? "", p.x, p.y, p.size * scale, rgba(p.color, a), "center", rgba("#000000", a * 0.75));
          break;
        }
      }
    }
  }
}

function blank(): Particle {
  return {
    kind: "spark", x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
    size: 0.1, grow: 0, spin: 0, angle: 0, drag: 1, gravity: 0,
    color: "#fff", seed: 0,
  };
}

/** Random unit-ish direction helper shared by callers that want a cone of particles. */
export const coneDir = (baseAngle: number, spread: number): V => {
  const a = baseAngle + rand(-spread, spread) * randSign();
  return { x: Math.cos(a), y: Math.sin(a) };
};
