import { RAPIER, type PhysOwner, type Physics } from "../core/physics";
import { v } from "../core/math";

/**
 * A flat, per-frame snapshot of the collision geometry near the action.
 *
 * The water and fire simulations run thousands of particles a frame, and every one of
 * them needs to know what it just hit. Asking Rapier per particle is out of the
 * question — each query crosses the WASM boundary — so instead we cross it *once*,
 * copy the handful of nearby colliders into plain typed arrays, and do the particle
 * collision maths in JS against those. One query per frame replaces ~50 000.
 *
 * It doubles as the coupling channel back into the rigid world: particles accumulate
 * impulses per solid here, and `flush()` applies them to the real bodies in one pass.
 */

export const BOX = 0;
export const BALL = 1;
export const CAPSULE = 2;

const MAX_SOLIDS = 320;
const MAX_ENTRIES = 6144;
/** Anything wider than this (ground slabs) is tested directly instead of binned. */
const HUGE = 14;

const GRID = 64;
const CELL = 2.6;
const SPAN = GRID * CELL;

export class SolidField {
  count = 0;

  readonly kind = new Uint8Array(MAX_SOLIDS);
  readonly px = new Float32Array(MAX_SOLIDS);
  readonly py = new Float32Array(MAX_SOLIDS);
  readonly cos = new Float32Array(MAX_SOLIDS);
  readonly sin = new Float32Array(MAX_SOLIDS);
  /** Half-extents. For a ball `hw` is the radius; for a capsule `hw` is the radius and `hh` the segment half-length. */
  readonly hw = new Float32Array(MAX_SOLIDS);
  readonly hh = new Float32Array(MAX_SOLIDS);
  readonly vx = new Float32Array(MAX_SOLIDS);
  readonly vy = new Float32Array(MAX_SOLIDS);
  readonly om = new Float32Array(MAX_SOLIDS);
  readonly invMass = new Float32Array(MAX_SOLIDS);

  /** Public so callers can anchor decals to whatever a particle just hit. */
  readonly bodies: (RAPIER.RigidBody | null)[] = new Array(MAX_SOLIDS).fill(null);
  readonly owners: (PhysOwner | null)[] = new Array(MAX_SOLIDS).fill(null);

  /** Impulse accumulated by particle contacts this frame, applied by `flush()`. */
  private readonly ax = new Float32Array(MAX_SOLIDS);
  private readonly ay = new Float32Array(MAX_SOLIDS);
  private readonly atq = new Float32Array(MAX_SOLIDS);
  private touched = false;

  private readonly head = new Int32Array(GRID * GRID);
  private readonly entrySolid = new Int32Array(MAX_ENTRIES);
  private readonly entryNext = new Int32Array(MAX_ENTRIES);
  private entries = 0;
  private big: number[] = [];
  private originX = 0;
  private originY = 0;

  // Last contact produced by `resolve`, kept in fields to avoid an allocation per particle.
  hitIndex = -1;
  hitNx = 0;
  hitNy = 0;
  hitDepth = 0;

  /**
   * Snapshots every collider overlapping the box centred on (cx, cy). Called once per
   * frame by the game, before either particle sim runs.
   */
  rebuild(physics: Physics, cx: number, cy: number, halfW: number, halfH: number) {
    this.count = 0;
    this.entries = 0;
    this.big.length = 0;
    this.head.fill(-1);
    this.originX = cx - SPAN / 2;
    this.originY = cy - SPAN / 2;

    const shape = new RAPIER.Cuboid(halfW, halfH);
    physics.world.intersectionsWithShape(v(cx, cy), 0, shape, (collider) => {
      if (this.count >= MAX_SOLIDS) return false;
      const t = collider.shapeType();
      let kind: number;
      let hw: number;
      let hh: number;
      if (t === RAPIER.ShapeType.Cuboid) {
        const he = collider.halfExtents();
        if (!he) return true;
        kind = BOX;
        hw = he.x;
        hh = he.y;
      } else if (t === RAPIER.ShapeType.Ball) {
        kind = BALL;
        hw = collider.radius();
        hh = hw;
      } else if (t === RAPIER.ShapeType.Capsule) {
        kind = CAPSULE;
        hw = collider.radius();
        hh = collider.halfHeight();
      } else {
        return true;
      }

      const i = this.count++;
      const p = collider.translation();
      const r = collider.rotation();
      const body = collider.parent();
      this.kind[i] = kind;
      this.px[i] = p.x;
      this.py[i] = p.y;
      this.cos[i] = Math.cos(r);
      this.sin[i] = Math.sin(r);
      this.hw[i] = hw;
      this.hh[i] = hh;
      this.bodies[i] = body;
      this.owners[i] = physics.ownerOf(collider.handle);
      if (body && body.isDynamic()) {
        const lv = body.linvel();
        this.vx[i] = lv.x;
        this.vy[i] = lv.y;
        this.om[i] = body.angvel();
        this.invMass[i] = body.invMass();
      } else {
        this.vx[i] = 0;
        this.vy[i] = 0;
        this.om[i] = 0;
        this.invMass[i] = 0;
      }
      this.ax[i] = 0;
      this.ay[i] = 0;
      this.atq[i] = 0;
      this.bin(i, kind === BOX ? Math.hypot(hw, hh) : kind === CAPSULE ? hh + hw : hw);
      return true;
    });
  }

  /** Files a solid into every grid cell its bounding circle touches. */
  private bin(i: number, radius: number) {
    if (radius > HUGE) {
      this.big.push(i);
      return;
    }
    const x0 = Math.floor((this.px[i] - radius - this.originX) / CELL);
    const x1 = Math.floor((this.px[i] + radius - this.originX) / CELL);
    const y0 = Math.floor((this.py[i] - radius - this.originY) / CELL);
    const y1 = Math.floor((this.py[i] + radius - this.originY) / CELL);
    for (let gy = Math.max(0, y0); gy <= Math.min(GRID - 1, y1); gy++) {
      for (let gx = Math.max(0, x0); gx <= Math.min(GRID - 1, x1); gx++) {
        if (this.entries >= MAX_ENTRIES) return;
        const cell = gy * GRID + gx;
        const e = this.entries++;
        this.entrySolid[e] = i;
        this.entryNext[e] = this.head[cell];
        this.head[cell] = e;
      }
    }
  }

  /**
   * Deepest overlap between a particle of radius `r` at (x, y) and the field.
   * Returns true and fills `hit*` with an outward normal and a penetration depth.
   */
  resolve(x: number, y: number, r: number): boolean {
    this.hitIndex = -1;
    this.hitDepth = 0;
    const gx = Math.floor((x - this.originX) / CELL);
    const gy = Math.floor((y - this.originY) / CELL);
    if (gx >= 0 && gy >= 0 && gx < GRID && gy < GRID) {
      for (let e = this.head[gy * GRID + gx]; e !== -1; e = this.entryNext[e]) {
        this.test(this.entrySolid[e], x, y, r);
      }
    }
    for (let k = 0; k < this.big.length; k++) this.test(this.big[k], x, y, r);
    return this.hitIndex >= 0;
  }

  /** Signed-distance test against one solid, keeping the deepest hit found so far. */
  private test(i: number, x: number, y: number, r: number) {
    // World -> solid local.
    const dx = x - this.px[i];
    const dy = y - this.py[i];
    const c = this.cos[i];
    const s = this.sin[i];
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;

    let nx = 0;
    let ny = 1;
    let d = 0;

    if (this.kind[i] === BALL) {
      const l = Math.hypot(lx, ly);
      d = l - this.hw[i];
      if (d >= r) return;
      if (l > 1e-6) { nx = lx / l; ny = ly / l; }
    } else if (this.kind[i] === CAPSULE) {
      const hh = this.hh[i];
      const qy = ly < -hh ? ly + hh : ly > hh ? ly - hh : 0;
      const l = Math.hypot(lx, qy);
      d = l - this.hw[i];
      if (d >= r) return;
      if (l > 1e-6) { nx = lx / l; ny = qy / l; }
    } else {
      const qx = Math.abs(lx) - this.hw[i];
      const qy = Math.abs(ly) - this.hh[i];
      if (qx >= r || qy >= r) return;
      if (qx > 0 || qy > 0) {
        // Outside: the nearest point is on an edge or a corner.
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        d = Math.hypot(ox, oy);
        if (d >= r) return;
        const inv = d > 1e-6 ? 1 / d : 0;
        nx = ox * inv * (lx < 0 ? -1 : 1);
        ny = oy * inv * (ly < 0 ? -1 : 1);
      } else {
        // Inside: leave by the nearest face.
        d = qx > qy ? qx : qy;
        if (qx > qy) { nx = lx < 0 ? -1 : 1; ny = 0; } else { nx = 0; ny = ly < 0 ? -1 : 1; }
      }
    }

    const depth = r - d;
    if (depth <= this.hitDepth) return;
    this.hitDepth = depth;
    this.hitIndex = i;
    // Local -> world normal.
    this.hitNx = nx * c - ny * s;
    this.hitNy = nx * s + ny * c;
  }

  /** Surface velocity of solid `i` at a world point, including its spin. */
  velAt(i: number, x: number, y: number, out: { x: number; y: number }) {
    const rx = x - this.px[i];
    const ry = y - this.py[i];
    out.x = this.vx[i] - this.om[i] * ry;
    out.y = this.vy[i] + this.om[i] * rx;
  }

  /** Queues an impulse from a particle contact. Applied in `flush()`. */
  addImpulse(i: number, x: number, y: number, ix: number, iy: number) {
    if (this.invMass[i] <= 0) return;
    this.ax[i] += ix;
    this.ay[i] += iy;
    this.atq[i] += (x - this.px[i]) * iy - (y - this.py[i]) * ix;
    this.touched = true;
  }

  /**
   * Applies one frame of accumulated particle pressure to the rigid bodies. The total
   * is capped per body: a hose pointed at a chicken should shove it, not launch it
   * into orbit because a thousand droplets landed on the same frame.
   */
  flush() {
    if (!this.touched) return;
    this.touched = false;
    for (let i = 0; i < this.count; i++) {
      const ix = this.ax[i];
      const iy = this.ay[i];
      const tq = this.atq[i];
      if (ix === 0 && iy === 0 && tq === 0) continue;
      this.ax[i] = 0;
      this.ay[i] = 0;
      this.atq[i] = 0;
      const body = this.bodies[i];
      if (!body) continue;
      const m = body.mass();
      const cap = m * 4;
      const mag = Math.hypot(ix, iy);
      const k = mag > cap ? cap / mag : 1;
      body.applyImpulse(v(ix * k, iy * k), true);
      const tcap = m * 1.2;
      body.applyTorqueImpulse(Math.max(-tcap, Math.min(tcap, tq * k)), true);
    }
  }
}
