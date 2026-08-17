import { RAPIER, type PhysOwner, FILTER, G, ig, ALL } from "../core/physics";
import type { Actor, GameCtx } from "../core/types";
import { clamp, hash01, rand, randSign, v, type V } from "../core/math";
import { at, rgba, roundBox, shade, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";

export type MaterialId = "wood" | "brick" | "concrete" | "glass" | "metal" | "ice" | "explosive" | "gold";

export interface Material {
  id: MaterialId;
  color: string;
  /** kg per m^2 — a 2D slab density, so mass = density * w * h. */
  density: number;
  /** Hit points per m^2 of face area. */
  toughness: number;
  friction: number;
  restitution: number;
  /**
   * Impact damage is computed in kilojoules, not joules: real masses at real speeds
   * produce five-digit joule counts, and kJ keeps every tuning number readable.
   */
  ignore: number;
  /** Hit points removed per kJ of impact energy above `ignore`. */
  fragility: number;
  sound: "wood" | "stone" | "glass" | "metal" | "flesh";
  debris: string;
  points: number;
  explodes?: { radius: number; force: number; damage: number };
}

export const MATERIALS: Record<MaterialId, Material> = {
  wood: {
    id: "wood", color: "#b5813f", density: 220, toughness: 130, friction: 0.85, restitution: 0.06,
    ignore: 0.5, fragility: 3.5, sound: "wood", debris: "#8b6130", points: 10,
  },
  brick: {
    id: "brick", color: "#b4503f", density: 700, toughness: 300, friction: 0.9, restitution: 0.03,
    ignore: 2.0, fragility: 2.6, sound: "stone", debris: "#8e3d30", points: 15,
  },
  concrete: {
    id: "concrete", color: "#9aa0a8", density: 900, toughness: 520, friction: 0.92, restitution: 0.02,
    ignore: 3.5, fragility: 2.0, sound: "stone", debris: "#767c85", points: 25,
  },
  glass: {
    id: "glass", color: "#8fd8e8", density: 260, toughness: 26, friction: 0.4, restitution: 0.05,
    ignore: 0.05, fragility: 40, sound: "glass", debris: "#bff0fb", points: 8,
  },
  metal: {
    id: "metal", color: "#7f8896", density: 1400, toughness: 900, friction: 0.6, restitution: 0.14,
    ignore: 7, fragility: 1.3, sound: "metal", debris: "#5e6875", points: 40,
  },
  ice: {
    id: "ice", color: "#bfe9ff", density: 330, toughness: 60, friction: 0.05, restitution: 0.1,
    ignore: 0.2, fragility: 12, sound: "glass", debris: "#e4f7ff", points: 12,
  },
  explosive: {
    id: "explosive", color: "#e8433a", density: 300, toughness: 45, friction: 0.8, restitution: 0.05,
    ignore: 0.15, fragility: 20, sound: "metal", debris: "#ffb03a", points: 60,
    explodes: { radius: 6.5, force: 22, damage: 240 },
  },
  gold: {
    id: "gold", color: "#f2c14e", density: 1500, toughness: 280, friction: 0.8, restitution: 0.05,
    ignore: 2, fragility: 2.6, sound: "metal", debris: "#ffe08a", points: 250,
  },
};

export interface BlockOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  material: MaterialId;
  angle?: number;
  /**
   * Anchored blocks spawn as static bodies and convert to dynamic the moment
   * anything disturbs them. Default true — see the note on `Block`.
   */
  anchored?: boolean;
}

/**
 * One destructible chunk of a building.
 *
 * Blocks are born **anchored** (static rigid bodies) and only become dynamic once
 * something disturbs them: a hit, a blast, or a neighbour being destroyed. That
 * matters for two reasons. A 16-storey tower of loose stacked boxes cannot stand up
 * on its own — it topples from solver noise within a second — and a level holding
 * ~800 static bodies costs the solver essentially nothing until you start shooting.
 *
 * Collapse still cascades for free: a woken block falls, hits its anchored neighbour
 * hard enough to disturb it, and the failure propagates down the structure.
 */
export class Block implements Actor, PhysOwner {
  readonly kind = "block" as const;
  dead = false;
  z = 10;

  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  readonly mat: Material;
  readonly w: number;
  readonly h: number;
  anchored: boolean;
  readonly seed = Math.random() * 997;

  hp: number;
  maxHp: number;
  /** Rises on damage, decays over time; drives the flash overlay. */
  private hurtFlash = 0;
  /**
   * Freshly built structures drop a few centimetres as the solver resolves the stack.
   * Without a grace window that settling counts as impact damage and glass panes
   * shatter before the player has even moved.
   */
  private settle = 1.1;

  constructor(private readonly game: GameCtx, o: BlockOptions) {
    this.mat = MATERIALS[o.material];
    this.w = o.w;
    this.h = o.h;
    this.anchored = o.anchored ?? true;
    this.maxHp = this.hp = Math.max(6, this.mat.toughness * o.w * o.h);

    const desc = (this.anchored ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(o.x, o.y)
      .setRotation(o.angle ?? 0)
      .setLinearDamping(0.02)
      .setAngularDamping(0.06);
    this.body = game.physics.world.createRigidBody(desc);

    const cd = RAPIER.ColliderDesc.cuboid(o.w / 2, o.h / 2)
      .setDensity(this.mat.density)
      .setFriction(this.mat.friction)
      .setRestitution(this.mat.restitution)
      .setCollisionGroups(FILTER.BLOCK);
    this.collider = game.physics.world.createCollider(cd, this.body);
    game.physics.register(this.collider, this);
  }

  /** Converts an anchored block into a free-falling one. Idempotent and cheap. */
  disturb() {
    if (!this.anchored || this.dead) return;
    this.anchored = false;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  }

  /** Frees every block near `at` — used when one of them is destroyed. */
  private disturbNeighbours(at_: V, radius: number) {
    for (const o of this.game.physics.ownersInRadius(at_, radius)) {
      if (o !== this && o.kind === "block") o.disturb?.();
    }
  }

  get pos(): V {
    const t = this.body.translation();
    return v(t.x, t.y);
  }

  onImpact(_other: PhysOwner | null, energy: number, point: V) {
    if (this.dead || this.settle > 0) return;
    const m = this.mat;
    const kj = energy / 1000;
    // Any real knock shakes a block loose, even one too weak to damage it. This is
    // what lets a collapse propagate upward through an otherwise static building.
    if (kj > 0.12) this.disturb();
    if (kj <= m.ignore) return;
    const dmg = (kj - m.ignore) * m.fragility;
    if (dmg < 1) return;
    this.takeDamage(dmg, point);
  }

  takeDamage(amount: number, point?: V) {
    if (this.dead || amount <= 0) return;
    this.disturb();
    this.hp -= amount;
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / this.maxHp);

    const p = point ?? this.pos;
    if (this.hp > 0) {
      const n = clamp(Math.round(amount / 12), 1, 6);
      this.game.particles.shards(p.x, p.y, n, this.mat.debris, 5);
      if (amount > this.maxHp * 0.12) {
        sfx.thud(clamp(amount / this.maxHp, 0.15, 1), this.mat.sound);
      }
      return;
    }
    this.shatter(p);
  }

  private shatter(at_: V) {
    if (this.dead) return;
    this.dead = true;

    const p = this.pos;
    const area = this.w * this.h;
    // Whatever this block was holding up is now on its own.
    this.disturbNeighbours(p, Math.max(this.w, this.h) * 0.75 + 1.4);
    const chunks = clamp(Math.round(area * 26) + 5, 6, 34);
    this.game.particles.shards(p.x, p.y, chunks, this.mat.debris, 7 + area * 4);
    this.game.particles.dust(p.x, p.y, clamp(Math.round(area * 12), 3, 16), 3.2, shade(this.mat.color, 0.35));
    sfx.thud(0.85, this.mat.sound);

    // A couple of real rubble bodies per block: enough that the ground fills with
    // wreckage you can shoot again, without doubling the block count outright.
    if (this.mat.id !== "glass" && this.mat.id !== "ice") {
      const vel = this.body.linvel();
      const n = clamp(Math.round(area * 4), 1, 4);
      for (let i = 0; i < n; i++) {
        this.game.spawnDebris(
          p.x + rand(-this.w, this.w) * 0.3,
          p.y + rand(-this.h, this.h) * 0.3,
          Math.min(this.w, this.h) * rand(0.22, 0.4),
          this.mat.debris,
          v(vel.x * 0.6 + rand(-5, 5), vel.y * 0.6 + rand(0, 6)),
        );
      }
    }

    if (this.mat.explodes) {
      const e = this.mat.explodes;
      this.game.particles.flash(p.x, p.y, e.radius * 0.55);
      this.game.particles.fire(p.x, p.y, 34, 11);
      this.game.particles.smoke(p.x, p.y, 18, 4);
      this.game.particles.ring(p.x, p.y, 0.6, "#ffd08a", 0.45);
      this.game.physics.explode(p, e.radius, e.force, e.damage, this);
      this.game.alertEnemiesNear(p, e.radius * 2.4);
      this.game.camera.addTrauma(0.45);
      this.game.flash(0.35, "#ffb257");
      sfx.explode(1.1);
    }

    // Combo first, so this block's own points get the multiplier it just earned.
    this.game.reportDestruction("block", p);
    this.game.award(this.mat.points, at_);
  }

  update(_dt: number) {
    if (this.settle > 0) this.settle -= _dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - _dt * 2.6);
    // Anything that falls out of the world is gone for good.
    if (!this.anchored && this.body.translation().y < -80) this.dead = true;
  }

  cullPos() {
    return this.pos;
  }

  get cullRadius() {
    return Math.max(this.w, this.h);
  }

  draw(ctx: Ctx) {
    const t = this.body.translation();
    const r = this.body.rotation();
    const m = this.mat;
    const dmgFrac = 1 - clamp(this.hp / this.maxHp, 0, 1);

    at(ctx, t.x, t.y, r, () => {
      const base = m.id === "glass" || m.id === "ice" ? rgba(m.color, 0.55) : m.color;
      roundBox(ctx, this.w, this.h, Math.min(0.06, this.w * 0.2), base, shade(m.color, -0.4), 0.045);

      // Top highlight gives the flat blocks a readable light direction.
      ctx.fillStyle = rgba("#ffffff", m.id === "glass" ? 0.22 : 0.13);
      ctx.fillRect(-this.w / 2 + 0.03, this.h / 2 - Math.min(0.09, this.h * 0.22), this.w - 0.06, Math.min(0.07, this.h * 0.18));

      if (m.id === "brick") this.drawBrickCourses(ctx);
      if (m.id === "explosive") this.drawHazardStripes(ctx);
      if (m.id === "gold") {
        ctx.fillStyle = rgba("#ffffff", 0.5);
        ctx.fillRect(-this.w * 0.3, -this.h * 0.1, this.w * 0.16, this.h * 0.5);
      }

      if (dmgFrac > 0.18) this.drawCracks(ctx, dmgFrac);

      if (this.hurtFlash > 0.02) {
        ctx.fillStyle = rgba("#ffffff", this.hurtFlash * 0.5);
        ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      }
    });
  }

  private drawBrickCourses(ctx: Ctx) {
    ctx.strokeStyle = rgba("#000000", 0.18);
    ctx.lineWidth = 0.025;
    const rows = Math.max(1, Math.round(this.h / 0.22));
    for (let i = 1; i < rows; i++) {
      const y = -this.h / 2 + (i * this.h) / rows;
      ctx.beginPath();
      ctx.moveTo(-this.w / 2, y);
      ctx.lineTo(this.w / 2, y);
      ctx.stroke();
      const off = i % 2 ? 0 : this.w / 4;
      ctx.beginPath();
      ctx.moveTo(-this.w / 4 + off, y);
      ctx.lineTo(-this.w / 4 + off, y + this.h / rows);
      ctx.stroke();
    }
  }

  private drawHazardStripes(ctx: Ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.clip();
    ctx.strokeStyle = "#1b1e26";
    ctx.lineWidth = 0.07;
    const span = this.w + this.h;
    for (let i = -span; i < span; i += 0.22) {
      ctx.beginPath();
      ctx.moveTo(-this.w / 2 + i, -this.h / 2);
      ctx.lineTo(-this.w / 2 + i + this.h, this.h / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Deterministic crack pattern so damage looks like it accumulates, not flickers. */
  private drawCracks(ctx: Ctx, frac: number) {
    const n = Math.round(frac * 5) + 1;
    ctx.strokeStyle = rgba("#000000", 0.45 * frac + 0.2);
    ctx.lineWidth = 0.028;
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const h1 = hash01(this.seed + i * 3.7);
      const h2 = hash01(this.seed + i * 7.1 + 1);
      const h3 = hash01(this.seed + i * 11.3 + 2);
      let x = (h1 - 0.5) * this.w;
      let y = (h2 - 0.5) * this.h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 3; s++) {
        x += (hash01(this.seed + i * 13 + s) - 0.5) * this.w * 0.5;
        y += (h3 - 0.5) * this.h * 0.55;
        ctx.lineTo(clamp(x, -this.w / 2, this.w / 2), clamp(y, -this.h / 2, this.h / 2));
      }
      ctx.stroke();
    }
  }

  destroy() {
    this.game.physics.removeBody(this.body);
  }
}

/** Immovable world geometry: ground slabs, cliffs, platforms. */
export class Terrain implements Actor, PhysOwner {
  readonly kind = "terrain" as const;
  dead = false;
  z = 0;
  body: RAPIER.RigidBody;

  constructor(
    private readonly game: GameCtx,
    readonly x: number, readonly y: number,
    readonly w: number, readonly h: number,
    readonly color = "#3a4b3a",
    readonly topColor = "#5c8a43",
  ) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y);
    this.body = game.physics.world.createRigidBody(desc);
    const cd = RAPIER.ColliderDesc.cuboid(w / 2, h / 2)
      .setFriction(0.95)
      .setRestitution(0.0)
      .setCollisionGroups(ig(G.TERRAIN, ALL));
    const col = game.physics.world.createCollider(cd, this.body);
    game.physics.register(col, this);
  }

  update(_dt: number) {}

  draw(ctx: Ctx) {
    const x = this.x - this.w / 2;
    const y = this.y - this.h / 2;
    ctx.fillStyle = this.color;
    ctx.fillRect(x, y, this.w, this.h);

    // Soil strata: without them the ground reads as a flat void under the action.
    ctx.fillStyle = rgba("#000000", 0.1);
    for (let i = 1; i <= 3; i++) {
      ctx.fillRect(x, y + this.h - 0.28 - i * 0.9, this.w, 0.18);
    }
    ctx.fillStyle = this.topColor;
    ctx.fillRect(x, y + this.h - 0.28, this.w, 0.28);
    ctx.strokeStyle = rgba("#000000", 0.3);
    ctx.lineWidth = 0.05;
    ctx.strokeRect(x, y, this.w, this.h);

    // Sparse grass tufts, seeded off world position so they never shimmer.
    // Ground slabs are hundreds of metres wide, so only tuft the visible span.
    ctx.strokeStyle = this.topColor;
    ctx.lineWidth = 0.05;
    ctx.lineCap = "round";
    const step = 0.7;
    const half = this.game.camera.visibleHalf(2);
    const from = Math.max(x + 0.3, this.game.camera.pos.x - half.x);
    const to = Math.min(x + this.w, this.game.camera.pos.x + half.x);
    for (let gx = Math.ceil(from / step) * step; gx < to; gx += step) {
      const h = hash01(gx * 3.1);
      if (h < 0.45) continue;
      const top = y + this.h;
      ctx.beginPath();
      ctx.moveTo(gx, top);
      ctx.lineTo(gx + (h - 0.5) * 0.3, top + 0.16 + h * 0.16);
      ctx.stroke();
    }
  }

  destroy() {
    this.game.physics.removeBody(this.body);
  }
}

/**
 * Short-lived physical rubble. Cheap collision groups (terrain + blocks only) keep a
 * few hundred of these from ever bogging the solver down.
 */
export class Debris implements Actor, PhysOwner {
  readonly kind = "debris" as const;
  dead = false;
  z = 8;
  body: RAPIER.RigidBody;
  private life: number;
  private readonly maxLife: number;

  constructor(
    private readonly game: GameCtx,
    x: number, y: number,
    private readonly w: number, private readonly h: number,
    private readonly color: string,
    vel: V, life = 6,
  ) {
    this.maxLife = this.life = life;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(rand(0, Math.PI))
      .setLinvel(vel.x, vel.y)
      .setAngvel(rand(3, 14) * randSign())
      .setLinearDamping(0.05)
      .setAngularDamping(0.1);
    this.body = game.physics.world.createRigidBody(desc);
    const cd = RAPIER.ColliderDesc.cuboid(w / 2, h / 2)
      .setDensity(9)
      .setFriction(0.7)
      .setRestitution(0.22)
      .setCollisionGroups(FILTER.DEBRIS);
    const col = game.physics.world.createCollider(cd, this.body);
    game.physics.register(col, this);
  }

  update(dt: number) {
    this.life -= dt;
    if (this.life <= 0 || this.body.translation().y < -60) this.dead = true;
  }

  cullPos() {
    const t = this.body.translation();
    return v(t.x, t.y);
  }

  cullRadius = 0.6;

  draw(ctx: Ctx) {
    const t = this.body.translation();
    const alpha = clamp(this.life / Math.min(1.2, this.maxLife), 0, 1);
    at(ctx, t.x, t.y, this.body.rotation(), () => {
      ctx.fillStyle = alpha >= 1 ? this.color : rgba(this.color, alpha);
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    });
  }

  destroy() {
    this.game.physics.removeBody(this.body);
  }
}
