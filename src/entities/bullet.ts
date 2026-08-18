import { G, ig } from "../core/physics";
import type { Actor, GameCtx } from "../core/types";
import { clamp, norm, v, type V } from "../core/math";
import { rgba, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";

/** What an enemy round is allowed to hit. Not other enemies — a firing line would wipe itself out. */
const HIT_GROUPS = ig(G.PROJECTILE, G.TERRAIN | G.BLOCK | G.PLAYER);

export interface BulletSpec {
  speed: number;
  damage: number;
  /** Metres before the round gives up. */
  range: number;
  tint: string;
  /** Knockback delivered to a ragdoll, in m/s. */
  punch: number;
}

export const RIFLE: BulletSpec = { speed: 78, damage: 9, range: 60, tint: "#ffd88a", punch: 1.6 };
export const SMG: BulletSpec = { speed: 66, damage: 5, range: 34, tint: "#ffe9b0", punch: 0.9 };
// Damage sits just under the player's knockdown threshold (20). Above it, a single
// marksman knocks you flat every 2.4s, and respawning inside its beam is unrecoverable.
export const SNIPER: BulletSpec = { speed: 132, damage: 17, range: 110, tint: "#9fe6f5", punch: 3.5 };
export const SHOTGUN: BulletSpec = { speed: 54, damage: 7, range: 20, tint: "#ffc46b", punch: 1.4 };

/**
 * An enemy bullet.
 *
 * Not a rigid body: at 80 m/s a real projectile either tunnels or forces CCD on
 * dozens of bodies at once, and a bullet has no interesting physics of its own. It
 * marches a segment per step and raycasts along it, which is exact at any speed and
 * costs one query per bullet per frame.
 *
 * It also renders as a stretched tracer, which is the only way a bullet moving
 * 1.3 metres per frame is visible at all.
 */
export class Bullet implements Actor {
  dead = false;
  z = 24;

  private pos: V;
  private readonly dir: V;
  private readonly spec: BulletSpec;
  private travelled = 0;
  /** Tail of the tracer, one step behind the head. */
  private tail: V;

  constructor(private readonly game: GameCtx, spec: BulletSpec, from: V, dir: V) {
    this.spec = spec;
    this.pos = v(from.x, from.y);
    this.tail = v(from.x, from.y);
    this.dir = norm(dir);
  }

  update(dt: number) {
    const step = Math.min(this.spec.speed * dt, this.spec.range - this.travelled);
    if (step <= 0) {
      this.dead = true;
      return;
    }

    const hit = this.game.physics.rayCast(this.pos, this.dir, step, HIT_GROUPS);
    this.tail = this.pos;

    if (hit) {
      this.impact(hit.point, hit.owner);
      this.pos = hit.point;
      this.dead = true;
      return;
    }

    this.pos = v(this.pos.x + this.dir.x * step, this.pos.y + this.dir.y * step);
    this.travelled += step;
  }

  private impact(point: V, owner: { takeDamage?(a: number, p?: V): void; disturb?(): void; kind?: string } | null) {
    const s = this.spec;

    const t = this.game.target();
    // The ray only admits terrain, blocks and the player, so a ragdoll here is the
    // player. Damage goes through `TargetRef.hurt`, which is the one path that
    // charges incoming fire at face value — see the note in `Game.target()`.
    if (owner?.kind === "ragdoll" && t) {
      t.hurt(s.damage, point);
      t.shove(v(this.dir.x * s.punch, this.dir.y * s.punch + 0.4));
      this.game.particles.blood(point.x, point.y, clamp(Math.round(s.damage / 2), 2, 10), undefined, 6);
      this.game.camera.addTrauma(clamp(s.damage / 90, 0.03, 0.3));
      sfx.thud(0.5, "flesh");
    } else {
      // Masonry: chip it, and free it if it was still anchored.
      owner?.disturb?.();
      owner?.takeDamage?.(s.damage * 0.6, point);
      this.game.particles.sparks(point.x, point.y, 4, 6, s.tint);
      this.game.particles.dust(point.x, point.y, 2, 1.6);
      if (Math.random() < 0.25) sfx.ricochet();
    }
  }

  draw(ctx: Ctx) {
    const s = this.spec;
    ctx.strokeStyle = rgba(s.tint, 0.95);
    ctx.lineWidth = 0.08;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.tail.x, this.tail.y);
    ctx.lineTo(this.pos.x, this.pos.y);
    ctx.stroke();

    ctx.fillStyle = rgba(s.tint, 0.35);
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  cullPos() {
    return this.pos;
  }

  cullRadius = 3;

  destroy() {}
}
