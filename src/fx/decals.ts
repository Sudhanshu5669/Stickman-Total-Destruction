import { TAU, clamp, hash01, rand } from "../core/math";
import { rgba, type Ctx } from "../render/draw";
import type { PhysOwner, RAPIER } from "../core/physics";

/**
 * Marks the world keeps after the particles are gone: blood pools, scorch, wet
 * patches. Purely cosmetic and physics-free, but they are most of what makes a fight
 * *look* like it happened — a fading spark burst says nothing about the last minute,
 * a floor covered in it says everything.
 *
 * The pool is a hard-capped ring buffer, so the oldest marks are quietly overwritten
 * rather than growing without bound over a long session.
 *
 * **Every mark belongs to a surface, not to a coordinate.** A mark painted at a fixed
 * world position is correct for exactly as long as the thing under it holds still,
 * and in a game whose entire premise is knocking buildings over that is not long: the
 * wall falls, the block is destroyed, and the blood is left hanging in mid-air. So a
 * mark that lands on something that can move is stored in *that body's* frame and
 * transformed back each frame, and it is discarded the moment the body is destroyed.
 */

export type DecalKind = "blood" | "scorch" | "wet";

/** Ties a mark to the body it was painted on, in that body's local frame. */
export interface DecalAnchor {
  owner: PhysOwner;
  body: RAPIER.RigidBody;
  lx: number;
  ly: number;
}

interface Decal {
  kind: DecalKind;
  x: number;
  y: number;
  r: number;
  /** Painted-on rotation; the anchor's rotation is added on top. */
  angle0: number;
  angle: number;
  anchor: DecalAnchor | null;
  /** Grows in over `spread` seconds so a pool visibly seeps outward. */
  grown: number;
  spread: number;
  life: number;
  maxLife: number;
  alpha: number;
  color: string;
  seed: number;
}

const MAX = 320;

/**
 * Whether a mark painted on `owner` will still make sense a second later.
 *
 * Terrain and blocks are surfaces — one never moves, the other is anchored here.
 * A ragdoll, a fired chicken or a tumbling piece of debris is not: painting a scorch
 * on a stickman who then walks away is precisely how you get a mark floating in
 * empty air, so those are refused outright rather than anchored.
 */
export function canMark(owner: PhysOwner | null | undefined) {
  return !owner || owner.kind === "terrain" || owner.kind === "block";
}

/**
 * Converts a world point into an anchor on `body`.
 *
 * Returns null for terrain and anything else that cannot move or be destroyed —
 * a fixed mark needs no per-frame bookkeeping, and skipping it keeps the common case
 * (blood on the ground) free of a Rapier transform read every frame.
 */
export function anchorAt(
  owner: PhysOwner | null | undefined,
  body: RAPIER.RigidBody | null | undefined,
  x: number,
  y: number,
): DecalAnchor | null {
  if (!owner || !body || owner.kind !== "block") return null;
  const t = body.translation();
  const r = -body.rotation();
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - t.x;
  const dy = y - t.y;
  return { owner, body, lx: dx * c - dy * s, ly: dx * s + dy * c };
}

export class Decals {
  private list: Decal[] = [];
  private head = 0;

  get active() {
    return this.list.length;
  }

  clear() {
    this.list.length = 0;
    this.head = 0;
  }

  private push(d: Decal) {
    if (this.list.length < MAX) this.list.push(d);
    else {
      this.list[this.head] = d;
      this.head = (this.head + 1) % MAX;
    }
  }

  /** A pool of blood. Long-lived: it should still be there when you come back. */
  blood(x: number, y: number, r: number, color = "#8e1220", anchor: DecalAnchor | null = null) {
    const a = rand(0, TAU);
    this.push({
      kind: "blood", x, y, r, angle0: a, angle: a, anchor,
      grown: 0, spread: rand(0.5, 1.4),
      life: 90, maxLife: 90, alpha: rand(0.55, 0.8), color, seed: Math.random() * 900,
    });
  }

  /** Charred ground and walls, left behind by the flamethrower. */
  scorch(x: number, y: number, r: number, anchor: DecalAnchor | null = null) {
    const a = rand(0, TAU);
    this.push({
      kind: "scorch", x, y, r, angle0: a, angle: a, anchor,
      grown: r, spread: 0.001,
      life: 60, maxLife: 60, alpha: rand(0.3, 0.55), color: "#16120f", seed: Math.random() * 900,
    });
  }

  /** Dark wet patch under a soaking. Dries out in well under a minute. */
  wet(x: number, y: number, r: number, anchor: DecalAnchor | null = null) {
    this.push({
      kind: "wet", x, y, r, angle0: 0, angle: 0, anchor,
      grown: r, spread: 0.001,
      life: 14, maxLife: 14, alpha: 0.28, color: "#20486b", seed: Math.random() * 900,
    });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.life -= dt;
      if (d.grown < d.r) d.grown = Math.min(d.r, d.grown + (d.r / d.spread) * dt);
      if (d.anchor) this.follow(d);
      if (d.life <= 0) {
        const last = this.list.pop()!;
        if (i < this.list.length) this.list[i] = last;
      }
    }
  }

  /**
   * Rides the body the mark was painted on.
   *
   * Reading the transform back every frame is what keeps blood on a toppling wall
   * *on* the wall all the way down. Once the body is destroyed there is nothing left
   * to hold the mark up, so it is cut loose and wiped out over a few frames rather
   * than being left hanging where the wall used to be.
   */
  private follow(d: Decal) {
    const a = d.anchor!;
    if (a.owner.dead) {
      d.anchor = null;
      // Rescaled together so the shared `life / (maxLife * 0.2)` fade still resolves
      // to a clean one-to-zero ramp over the whole 0.4s.
      d.life = Math.min(d.life, 0.4);
      d.maxLife = 2;
      return;
    }
    const t = a.body.translation();
    const r = a.body.rotation();
    const c = Math.cos(r);
    const s = Math.sin(r);
    d.x = t.x + a.lx * c - a.ly * s;
    d.y = t.y + a.lx * s + a.ly * c;
    d.angle = d.angle0 + r;
  }

  draw(ctx: Ctx) {
    if (!this.list.length) return;
    ctx.save();
    for (const d of this.list) {
      // Only the last fifth of the life is spent fading, so marks read as permanent.
      const fade = clamp(d.life / (d.maxLife * 0.2), 0, 1);
      const a = d.alpha * fade;
      if (a < 0.01 || d.grown <= 0.01) continue;
      ctx.fillStyle = rgba(d.color, a);
      // Three offset ellipses per mark: an irregular splat rather than a circle,
      // seeded off the decal so it never crawls between frames.
      for (let k = 0; k < 3; k++) {
        const h1 = hash01(d.seed + k * 7.7);
        const h2 = hash01(d.seed + k * 13.3);
        const rr = d.grown * (0.55 + h1 * 0.55);
        const ox = (h1 - 0.5) * d.grown * 1.1;
        const oy = (h2 - 0.5) * d.grown * 0.5;
        ctx.beginPath();
        ctx.ellipse(d.x + ox, d.y + oy, rr, rr * (0.34 + h2 * 0.22), d.angle, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
