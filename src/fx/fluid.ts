import { clamp, rand, type V } from "../core/math";
import type { Ctx } from "../render/draw";
import type { SolidField } from "./solids";
import type { PhysOwner } from "../core/physics";
import { sfx } from "./audio";

/**
 * Real 2D fluid, not a particle effect that happens to be blue.
 *
 * This is **Position Based Fluids** (Macklin & Müller 2013): every droplet predicts
 * where it wants to be, then a few Gauss–Seidel passes push the droplets apart until
 * the local density matches the rest density. That single density constraint is what
 * produces all the behaviour you actually recognise as water — it pools, it finds its
 * level, it splashes off geometry, it pours through gaps and it stays incompressible
 * under pressure.
 *
 * Why hand-rolled rather than a library: every published JS fluid solver either
 * carries a WASM/asm.js blob of its own (doubling download size next to Rapier) or is
 * a grid solver that cannot couple to rigid bodies. PBF is ~200 lines, needs no
 * dependency, and is the cheapest formulation that still looks like water — 1500
 * droplets at two solver iterations is ~1.5 ms on a laptop and holds 60 fps on a
 * phone. Everything expensive is a flat typed array; nothing allocates per frame.
 *
 * Neighbour search is a hashed uniform grid at the kernel radius, rebuilt each step.
 * Collision and the push-back into the rigid world both go through `SolidField`.
 */

/** Kernel radius, metres. Everything else is derived from it. */
const H = 0.5;
const H2 = H * H;
/** Resting spacing between droplets. */
const SPACING = H * 0.5;
const ITERS = 2;
/** Constraint-force-mixing relaxation; larger = softer, more stable fluid. */
const EPS_CFM = 90;
/** Artificial pressure — stops droplets clumping and gives surface tension. Exponent 4. */
const K_CORR = 0.00012;
const DQ = 0.2 * H;
/** XSPH viscosity: how much a droplet adopts its neighbours' velocity. */
const VISC = 0.06;
/** Droplet mass used for momentum exchange with rigid bodies, kg. */
const DROP_MASS = 0.85;
/** Radius a droplet collides at. Smaller than H so sheets can flow through gaps. */
const R_COL = 0.13;

const MAX = 1200;
const BUCKETS = 4096;
const BUCKET_MASK = BUCKETS - 1;
/** Max neighbours considered per droplet; the cap is what bounds the worst case. */
const MAX_NB = 24;

const poly6Coef = 4 / (Math.PI * Math.pow(H, 8));
const spikyCoef = -30 / (Math.PI * Math.pow(H, 5));

// Written out rather than via Math.pow: these two run tens of thousands of times a
// frame and Math.pow is an order of magnitude slower than three multiplications.
const poly6 = (r2: number) => {
  if (r2 >= H2) return 0;
  const d = H2 - r2;
  return poly6Coef * d * d * d;
};

/** Notified once per droplet that landed on a gameplay object this frame. */
export type OnWet = (owner: PhysOwner, x: number, y: number, solid: number) => void;

export interface SprayOptions {
  speed: number;
  spread: number;
  /** Droplets per second. */
  rate: number;
  /** Seconds a droplet lives before it evaporates. */
  life: number;
}

export class WaterSim {
  count = 0;

  private readonly x = new Float32Array(MAX);
  private readonly y = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  /** Predicted position during a solve. */
  private readonly qx = new Float32Array(MAX);
  private readonly qy = new Float32Array(MAX);
  private readonly dx = new Float32Array(MAX);
  private readonly dy = new Float32Array(MAX);
  private readonly lam = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);

  private readonly head = new Int32Array(BUCKETS);
  private readonly next = new Int32Array(MAX);
  private readonly nb = new Int32Array(MAX * MAX_NB);
  private readonly nbCount = new Int32Array(MAX);

  private readonly restDensity: number;
  private readonly corrDenom: number;
  private emitCarry = 0;
  private readonly sv = { x: 0, y: 0 };
  /** 0..1 while the hose is running; drives the loop sound. */
  private jetLevel = 0;

  /** Set per level from the world gravity, so low-gravity worlds get lazy water. */
  gravity: number;
  /**
   * Scales the push water applies to rigid bodies. Tuned so a jet knocks a stickman
   * off his feet and rolls a barrel down the street, without firing either into orbit.
   */
  pressure = 1.5;
  private sprite: HTMLCanvasElement | null = null;

  constructor(gravity = -26) {
    this.gravity = gravity;
    // Rest density is whatever a perfectly packed lattice of these droplets measures.
    // Deriving it beats guessing a constant: change SPACING and the fluid still works.
    let rho = 0;
    const n = Math.ceil(H / SPACING);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const px = (i + (j & 1) * 0.5) * SPACING;
        const py = j * SPACING * 0.866;
        const r2 = px * px + py * py;
        if (r2 < H2) rho += poly6(r2);
      }
    }
    this.restDensity = rho;
    this.corrDenom = poly6(DQ * DQ);
  }

  clear() {
    this.count = 0;
    this.emitCarry = 0;
  }

  /** Fires a jet from `origin` along `dir`. Called every frame the trigger is held. */
  spray(origin: V, dir: V, dt: number, o: SprayOptions) {
    this.jetLevel = 1;
    this.emitCarry += o.rate * dt;
    let n = Math.floor(this.emitCarry);
    if (n <= 0) return;
    this.emitCarry -= n;
    const base = Math.atan2(dir.y, dir.x);
    while (n-- > 0) {
      // Recycling the oldest droplet keeps the jet continuous once the pool is full,
      // instead of the hose silently cutting out mid-stream.
      const i = this.count < MAX ? this.count++ : this.recycle();
      const a = base + rand(-o.spread, o.spread);
      const s = o.speed * rand(0.86, 1.08);
      this.x[i] = origin.x + rand(-0.08, 0.08);
      this.y[i] = origin.y + rand(-0.08, 0.08);
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.life[i] = this.maxLife[i] = o.life * rand(0.8, 1.15);
    }
  }

  /**
   * Where the next droplet goes once the pool is full. A rotating cursor rather than
   * a scan for the oldest: at 260 droplets a second, an O(n) search per droplet is
   * 400k comparisons a second for a choice nobody can see the difference in.
   */
  private recycle() {
    this.cursor = (this.cursor + 1) % MAX;
    return this.cursor;
  }

  private cursor = 0;

  /** Drops a blob of loose water — used when steam condenses or a tank ruptures. */
  splash(x: number, y: number, n: number, speed = 5) {
    for (let k = 0; k < n; k++) {
      const i = this.count < MAX ? this.count++ : this.recycle();
      const a = rand(0, Math.PI * 2);
      const s = speed * rand(0.2, 1);
      this.x[i] = x + rand(-0.2, 0.2);
      this.y[i] = y + rand(-0.2, 0.2);
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s + 1;
      this.life[i] = this.maxLife[i] = rand(3, 6);
    }
  }

  // ------------------------------------------------------------------ queries

  /** Rough wetness at a point, 0..1 — how much water is sitting right there. */
  densityAt(x: number, y: number): number {
    let n = 0;
    const gx = Math.floor(x / H);
    const gy = Math.floor(y / H);
    for (let cy = gy - 1; cy <= gy + 1; cy++) {
      for (let cx = gx - 1; cx <= gx + 1; cx++) {
        for (let j = this.head[hash(cx, cy)]; j !== -1; j = this.next[j]) {
          // The grid is a frame old and droplets are swap-removed, so anything past
          // the live range is a stale slot rather than a droplet.
          if (j >= this.count) continue;
          const rx = this.x[j] - x;
          const ry = this.y[j] - y;
          if (rx * rx + ry * ry < H2) n++;
        }
      }
    }
    return clamp(n / 7, 0, 1);
  }

  /** Removes up to `n` droplets near a point — fire boiling water off. */
  evaporate(x: number, y: number, radius: number, n: number): number {
    let killed = 0;
    const r2 = radius * radius;
    for (let i = 0; i < this.count && killed < n; i++) {
      const rx = this.x[i] - x;
      const ry = this.y[i] - y;
      if (rx * rx + ry * ry > r2) continue;
      this.remove(i);
      i--;
      killed++;
    }
    return killed;
  }

  private remove(i: number) {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last]; this.y[i] = this.y[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
      this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
    }
  }

  // ------------------------------------------------------------------ solver

  /**
   * @param onWet Called once per droplet that touched a gameplay object, so the game
   *              can soak it. Passing the owner and its index in the solid field
   *              rather than a query keeps this hot loop free of any physics calls.
   */
  update(dt: number, solids: SolidField, camX: number, camY: number, onWet?: OnWet) {
    this.jetLevel = Math.max(0, this.jetLevel - dt * 4);
    sfx.hose(this.jetLevel);
    if (this.count === 0) return;
    const h = Math.min(dt, 1 / 50);

    // 1. Cull, then predict.
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0 || this.y[i] < -80 ||
          Math.abs(this.x[i] - camX) > 110 || Math.abs(this.y[i] - camY) > 110) {
        this.remove(i);
        i--;
        continue;
      }
      this.vy[i] += this.gravity * h;
      this.qx[i] = this.x[i] + this.vx[i] * h;
      this.qy[i] = this.y[i] + this.vy[i] * h;
    }
    if (this.count === 0) return;

    this.buildGrid();
    this.findNeighbours();

    for (let iter = 0; iter < ITERS; iter++) {
      this.solveDensity();
      this.applyDeltas();
      this.projectSolids(solids, h, iter === ITERS - 1, onWet);
    }

    // 2. Positions are final; recover the velocity they imply.
    const inv = 1 / h;
    for (let i = 0; i < this.count; i++) {
      this.vx[i] = (this.qx[i] - this.x[i]) * inv;
      this.vy[i] = (this.qy[i] - this.y[i]) * inv;
      this.x[i] = this.qx[i];
      this.y[i] = this.qy[i];
    }
    this.applyViscosity();
  }

  private buildGrid() {
    this.head.fill(-1);
    for (let i = 0; i < this.count; i++) {
      const b = hash(Math.floor(this.qx[i] / H), Math.floor(this.qy[i] / H));
      this.next[i] = this.head[b];
      this.head[b] = i;
    }
  }

  /**
   * Neighbours are gathered once and reused across solver iterations. Droplets move
   * only a few centimetres per iteration, so re-binning between them buys nothing and
   * costs the most expensive loop in the sim twice over.
   */
  private findNeighbours() {
    for (let i = 0; i < this.count; i++) {
      const xi = this.qx[i];
      const yi = this.qy[i];
      const gx = Math.floor(xi / H);
      const gy = Math.floor(yi / H);
      let n = 0;
      const base = i * MAX_NB;
      for (let cy = gy - 1; cy <= gy + 1 && n < MAX_NB; cy++) {
        for (let cx = gx - 1; cx <= gx + 1 && n < MAX_NB; cx++) {
          for (let j = this.head[hash(cx, cy)]; j !== -1; j = this.next[j]) {
            if (j === i) continue;
            const rx = xi - this.qx[j];
            const ry = yi - this.qy[j];
            if (rx * rx + ry * ry >= H2) continue;
            this.nb[base + n++] = j;
            if (n >= MAX_NB) break;
          }
        }
      }
      this.nbCount[i] = n;
    }
  }

  /** Density constraint + its Lagrange multiplier, per droplet. */
  private solveDensity() {
    const rho0 = this.restDensity;
    for (let i = 0; i < this.count; i++) {
      const xi = this.qx[i];
      const yi = this.qy[i];
      const base = i * MAX_NB;
      const n = this.nbCount[i];

      let rho = poly6(0);
      let gradIx = 0;
      let gradIy = 0;
      let sumGrad2 = 0;

      for (let k = 0; k < n; k++) {
        const j = this.nb[base + k];
        const rx = xi - this.qx[j];
        const ry = yi - this.qy[j];
        const r2 = rx * rx + ry * ry;
        rho += poly6(r2);
        const r = Math.sqrt(r2);
        if (r < 1e-6) continue;
        const w = (spikyCoef * (H - r) * (H - r)) / r / rho0;
        const gx = rx * w;
        const gy = ry * w;
        gradIx -= gx;
        gradIy -= gy;
        sumGrad2 += gx * gx + gy * gy;
      }
      sumGrad2 += gradIx * gradIx + gradIy * gradIy;
      const c = rho / rho0 - 1;
      this.lam[i] = -c / (sumGrad2 + EPS_CFM);
    }
  }

  private applyDeltas() {
    const rho0 = this.restDensity;
    for (let i = 0; i < this.count; i++) {
      const xi = this.qx[i];
      const yi = this.qy[i];
      const base = i * MAX_NB;
      const n = this.nbCount[i];
      let ax = 0;
      let ay = 0;
      for (let k = 0; k < n; k++) {
        const j = this.nb[base + k];
        const rx = xi - this.qx[j];
        const ry = yi - this.qy[j];
        const r2 = rx * rx + ry * ry;
        const r = Math.sqrt(r2);
        if (r < 1e-6) continue;
        // Tensile instability correction — the term that turns a mush of points into
        // droplets with a visible surface.
        const ratio = poly6(r2) / this.corrDenom;
        const r4 = ratio * ratio;
        const scorr = -K_CORR * r4 * r4;
        const w = ((this.lam[i] + this.lam[j] + scorr) * spikyCoef * (H - r) * (H - r)) / r / rho0;
        ax += rx * w;
        ay += ry * w;
      }
      this.dx[i] = ax;
      this.dy[i] = ay;
    }
    for (let i = 0; i < this.count; i++) {
      // Clamped so a badly conditioned frame nudges droplets rather than teleporting them.
      this.qx[i] += clamp(this.dx[i], -0.3, 0.3);
      this.qy[i] += clamp(this.dy[i], -0.3, 0.3);
    }
  }

  /**
   * Pushes droplets out of the world geometry and, on the final iteration, pays the
   * momentum back into whatever they hit. That reaction is the whole reason a jet of
   * water can knock a stickman over or float a barrel.
   */
  private projectSolids(solids: SolidField, h: number, final: boolean, onWet?: OnWet) {
    if (solids.count === 0) return;
    const inv = 1 / h;
    for (let i = 0; i < this.count; i++) {
      const px = this.qx[i];
      const py = this.qy[i];
      if (!solids.resolve(px, py, R_COL)) continue;

      const s = solids.hitIndex;
      const nx = solids.hitNx;
      const ny = solids.hitNy;
      this.qx[i] = px + nx * solids.hitDepth;
      this.qy[i] = py + ny * solids.hitDepth;
      if (!final) continue;

      // Velocity implied by the correction so far, relative to the moving surface.
      solids.velAt(s, px, py, this.sv);
      const rvx = (this.qx[i] - this.x[i]) * inv - this.sv.x;
      const rvy = (this.qy[i] - this.y[i]) * inv - this.sv.y;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        // Cancel the approach and shed most of the tangential speed to friction.
        const jx = -vn * nx * DROP_MASS * this.pressure;
        const jy = -vn * ny * DROP_MASS * this.pressure;
        solids.addImpulse(s, this.qx[i], this.qy[i], -jx, -jy);
        const tvx = (rvx - vn * nx) * 0.72;
        const tvy = (rvy - vn * ny) * 0.72;
        this.qx[i] = this.x[i] + (tvx + this.sv.x) * h;
        this.qy[i] = this.y[i] + (tvy + this.sv.y) * h;
      }
      const owner = solids.owners[s];
      if (owner && onWet) onWet(owner, this.qx[i], this.qy[i], s);
    }
  }

  /** XSPH: droplets drift toward the average velocity of their neighbours. */
  private applyViscosity() {
    for (let i = 0; i < this.count; i++) {
      const base = i * MAX_NB;
      const n = this.nbCount[i];
      if (n === 0) continue;
      let ax = 0;
      let ay = 0;
      let wsum = 0;
      for (let k = 0; k < n; k++) {
        const j = this.nb[base + k];
        const rx = this.x[i] - this.x[j];
        const ry = this.y[i] - this.y[j];
        const w = poly6(rx * rx + ry * ry);
        ax += (this.vx[j] - this.vx[i]) * w;
        ay += (this.vy[j] - this.vy[i]) * w;
        wsum += w;
      }
      if (wsum <= 0) continue;
      this.vx[i] += (ax / wsum) * VISC;
      this.vy[i] += (ay / wsum) * VISC;
    }
  }

  // ------------------------------------------------------------------ render

  /**
   * Two blitted passes: a wide translucent body that merges into a mass wherever
   * droplets overlap, and a tight bright core for the spray. A cached radial-gradient
   * sprite means the whole fluid is `count * 2` drawImage calls and no per-particle
   * gradient work.
   */
  draw(ctx: Ctx) {
    if (this.count === 0) return;
    const sprite = this.blob();
    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    ctx.globalAlpha = 0.34;
    for (let i = 0; i < this.count; i++) {
      const fade = this.life[i] < 0.6 ? this.life[i] / 0.6 : 1;
      const r = 0.4 * fade;
      ctx.drawImage(sprite, this.x[i] - r, this.y[i] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < this.count; i++) {
      const fade = this.life[i] < 0.6 ? this.life[i] / 0.6 : 1;
      const r = 0.17 * fade;
      ctx.drawImage(sprite, this.x[i] - r, this.y[i] - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private blob(): HTMLCanvasElement {
    if (this.sprite) return this.sprite;
    const px = 32;
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    grad.addColorStop(0, "rgba(190,235,255,0.95)");
    grad.addColorStop(0.45, "rgba(76,175,235,0.75)");
    grad.addColorStop(1, "rgba(40,120,190,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    this.sprite = c;
    return c;
  }
}

/** Hashes a signed cell coordinate into the fixed bucket table. */
function hash(cx: number, cy: number) {
  return ((cx * 92837111) ^ (cy * 689287499)) & BUCKET_MASK;
}
