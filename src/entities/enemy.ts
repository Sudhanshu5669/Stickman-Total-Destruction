import { G, ALL } from "../core/physics";
import type { Actor, GameCtx } from "../core/types";
import { BIPED, BIPED_LITE, Ragdoll } from "./ragdoll";
import { drawBiped } from "../render/creatures";
import { angleDelta, clamp, dist, rand, v, type V } from "../core/math";
import { at, rgba, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";

export type EnemyKind = "grunt" | "guard" | "boss";

interface KindSpec {
  hp: number;
  scale: number;
  full: boolean;
  points: number;
  ink: string;
  hat: "none" | "cap" | "helmet" | "crown";
  weight: number;
}

const KINDS: Record<EnemyKind, KindSpec> = {
  grunt: { hp: 65, scale: 1, full: false, points: 100, ink: "#37506b", hat: "none", weight: 1 },
  guard: { hp: 130, scale: 1.1, full: false, points: 200, ink: "#6b3746", hat: "helmet", weight: 1.15 },
  boss: { hp: 420, scale: 1.45, full: true, points: 750, ink: "#2f2440", hat: "crown", weight: 1.35 },
};

const RIDE = 0.95;
const RIDE_SPRING = 190;
const RIDE_DAMP = 24;

/** Half-extent (metres from the camera) beyond which an enemy leaves the simulation. */
const SLEEP_RANGE = 46;
const WAKE_RANGE = 38;

/**
 * A stickman that stands on something until that something stops existing.
 *
 * It balances with a much weaker controller than the player's, so it topples from a
 * shove and a collapsing floor takes it down with the building — which is the point.
 */
export class Enemy implements Actor {
  dead = false;
  z = 21;

  readonly ragdoll: Ragdoll;
  readonly spec: KindSpec;
  readonly kind: EnemyKind;

  private grounded = false;
  private groundDist = 99;
  private panic = 0;
  private idlePhase = rand(0, 10);
  private flailPhase = rand(0, 10);
  private corpseTimer = 0;
  private voiceCd = rand(0, 3);

  constructor(private readonly game: GameCtx, kind: EnemyKind, x: number, y: number, facing: 1 | -1 = -1) {
    this.kind = kind;
    const s = (this.spec = KINDS[kind]);

    this.ragdoll = new Ragdoll(game.physics, s.full ? BIPED : BIPED_LITE, {
      x, y, facing, scale: s.scale,
      group: G.ENEMY,
      filter: ALL & ~G.DEBRIS,
      color: s.ink,
    });
    this.ragdoll.hp = this.ragdoll.maxHp = s.hp;
    this.ragdoll.impactIgnore = 0.9;
    this.ragdoll.impactFragility = 15;
    this.ragdoll.splatColor = "#c0263a";
    this.ragdoll.onHurt = (_r, amount, at_) => this.onHurt(amount, at_);
    this.ragdoll.onDeath = () => this.onDeath();
    // Same trick as the player: pinned hips while standing, released the instant
    // anything happens to them. See Ragdoll.lockRoot.
    this.ragdoll.lockRoot(true);
  }

  get pos(): V {
    return this.ragdoll.center();
  }

  private onHurt(amount: number, at_: V) {
    this.panic = 1;
    this.game.particles.blood(at_.x, at_.y, clamp(Math.round(amount / 2), 2, 16), undefined, 7);
    if (amount > 12) {
      // A solid hit staggers them into a full ragdoll for a moment.
      this.ragdoll.goLimp();
      this.staggerLeft = 0.9;
      sfx.scream();
    }
  }

  private staggerLeft = 0;

  private onDeath() {
    const c = this.pos;
    this.game.particles.blood(c.x, c.y, 26, undefined, 12);
    this.game.particles.stars(c.x, c.y, 7);
    this.game.reportDestruction("enemy", c);
    this.game.award(this.spec.points, c);
    sfx.scream();
    this.corpseTimer = 14;
  }

  /** Alerts this enemy — used when something explodes nearby. */
  alert(from: V, strength = 1) {
    if (this.ragdoll.dead) return;
    // An explosion can reach further than the dormancy radius, so being alerted is
    // itself a reason to rejoin the simulation.
    if (this.dormant) {
      this.dormant = false;
      this.ragdoll.setEnabled(true);
    }
    this.panic = Math.max(this.panic, clamp(strength, 0, 1));
    if (this.voiceCd <= 0 && strength > 0.5) {
      this.voiceCd = rand(1.2, 2.6);
      sfx.scream();
    }
    void from;
  }

  update(dt: number) {
    const r = this.ragdoll;
    if (this.updateDormancy()) return;
    this.voiceCd = Math.max(0, this.voiceCd - dt);

    if (r.dead) {
      this.corpseTimer -= dt;
      // Corpses stick around so the aftermath is visible, then are reclaimed.
      if (this.corpseTimer <= 0 || this.pos.y < -55) this.dead = true;
      return;
    }

    if (this.staggerLeft > 0) {
      this.staggerLeft -= dt;
      if (this.staggerLeft <= 0) r.stiffen();
      return;
    }

    this.panic = Math.max(0, this.panic - dt * 0.35);
    this.probeGround();

    // Falling for more than a moment means the floor is gone. Release the hips so they
    // tumble down with the building instead of descending bolt upright.
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    if (this.airTime > 0.28 && r.rootLocked) {
      r.lockRoot(false);
      this.panic = 1;
    } else if (this.grounded && !r.rootLocked && !r.limp && Math.abs(r.boneAngle("pelvis")) < 0.35) {
      // Landed roughly upright again — let them recover their footing.
      r.lockRoot(true);
    }

    if (!r.limp) {
      this.balance(dt);
      this.pose(dt);
    }

    if (this.pos.y < -45) r.takeDamage(9999);
  }

  private airTime = 0;
  private dormant = false;
  /** Last known position, kept so a dormant enemy can still be culled and drawn. */
  private restPos: V = v(0, 0);

  /**
   * Switches this enemy in and out of the simulation based on camera distance.
   * @returns true when the enemy is dormant and `update` should do nothing else.
   */
  private updateDormancy(): boolean {
    const p = this.dormant ? this.restPos : this.ragdoll.center();
    const dx = Math.abs(p.x - this.game.camera.pos.x);
    const dy = Math.abs(p.y - this.game.camera.pos.y);
    // Hysteresis: sleep further out than we wake, so an enemy sitting exactly on the
    // boundary doesn't flip state every frame.
    const far = dx > SLEEP_RANGE || dy > SLEEP_RANGE;
    const near = dx < WAKE_RANGE && dy < WAKE_RANGE;

    if (!this.dormant && far) {
      this.restPos = p;
      this.dormant = true;
      this.ragdoll.setEnabled(false);
    } else if (this.dormant && near) {
      this.dormant = false;
      this.ragdoll.setEnabled(true);
    }
    return this.dormant;
  }

  private probeGround() {
    const pelvis = this.ragdoll.bone("pelvis");
    const p = pelvis.body.translation();
    const ride = RIDE * this.spec.scale;
    const hit = this.game.physics.groundRay(v(p.x, p.y), ride + 0.3, pelvis.body);
    this.groundDist = hit ?? Infinity;
    this.grounded = hit !== null;
  }

  private balance(dt: number) {
    const pelvis = this.ragdoll.bone("pelvis").body;
    const total = this.ragdoll.totalMass();
    const ride = RIDE * this.spec.scale;
    if (this.grounded && this.groundDist < ride + 0.3) {
      const vel = pelvis.linvel();
      const accel = (ride - this.groundDist) * RIDE_SPRING - vel.y * RIDE_DAMP;
      // Scaled by whole-body mass — see the note on Player.balance().
      if (accel > 0) pelvis.applyImpulse(v(0, accel * total * dt), true);
    }

    // While the hips are free (mid-fall, or just landed askew) nudge them back toward
    // vertical. Deliberately weak — they should look like they are struggling.
    if (!this.ragdoll.rootLocked) {
      const err = angleDelta(pelvis.rotation(), 0);
      this.ragdoll.applyAngularAccel(clamp(err * 14 - pelvis.angvel() * 5, -9, 9), dt);
    }

    if (this.panic > 0.3 && this.grounded) {
      // Scramble away from the middle of the chaos.
      const away = Math.sign(pelvis.translation().x - this.game.camera.pos.x) || 1;
      const want = away * 4.2 * this.panic;
      const dv = want - pelvis.linvel().x;
      pelvis.applyImpulse(v(clamp(dv * 6, -22, 22) * total * dt, 0), true);
    }
  }

  private pose(dt: number) {
    const r = this.ragdoll;
    this.idlePhase += dt * 1.6;
    this.flailPhase += dt * (7 + this.panic * 9);
    const lite = r.has("armBack");
    const stiff = 240 * this.spec.weight;
    const damp = 22 * this.spec.weight;

    if (this.panic > 0.25) {
      const a = 1.5 * this.panic;
      if (lite) {
        r.setMotor("armBack", Math.sin(this.flailPhase) * a - 1.4, stiff, damp);
        r.setMotor("armFront", Math.sin(this.flailPhase + 2.1) * a - 1.4, stiff, damp);
      } else {
        r.setMotor("armBackUp", Math.sin(this.flailPhase) * a - 1.4, stiff, damp);
        r.setMotor("armFrontUp", Math.sin(this.flailPhase + 2.1) * a - 1.4, stiff, damp);
        r.setMotor("armBackLo", -0.4 - Math.abs(Math.sin(this.flailPhase)) * 0.8, stiff * 0.7, damp);
        r.setMotor("armFrontLo", -0.4 - Math.abs(Math.sin(this.flailPhase + 1)) * 0.8, stiff * 0.7, damp);
      }
      r.setMotor("torso", Math.sin(this.flailPhase * 0.5) * 0.18, 500, 42);
    } else {
      const sway = Math.sin(this.idlePhase) * 0.1;
      if (lite) {
        r.setMotor("armBack", 0.12 + sway, stiff * 0.7, damp);
        r.setMotor("armFront", -0.12 - sway, stiff * 0.7, damp);
      } else {
        r.setMotor("armBackUp", 0.12 + sway, stiff * 0.7, damp);
        r.setMotor("armFrontUp", -0.12 - sway, stiff * 0.7, damp);
        r.setMotor("armBackLo", -0.25, stiff * 0.6, damp);
        r.setMotor("armFrontLo", -0.25, stiff * 0.6, damp);
      }
      r.setMotor("torso", sway * 0.3, 520, 44);
    }

    r.setMotor("head", Math.sin(this.idlePhase * 0.7) * 0.18, 90, 10);

    const legStiff = 320 * this.spec.weight;
    if (lite) {
      r.setMotor("legBack", -0.06, legStiff, 28);
      r.setMotor("legFront", 0.06, legStiff, 28);
    } else {
      r.setMotor("thighBack", -0.05, legStiff, 28);
      r.setMotor("thighFront", 0.05, legStiff, 28);
      r.setMotor("shinBack", 0.12, legStiff, 28);
      r.setMotor("shinFront", 0.12, legStiff, 28);
      r.setMotor("footBack", 0, legStiff * 0.4, 16);
      r.setMotor("footFront", 0, legStiff * 0.4, 16);
    }
  }

  draw(ctx: Ctx) {
    const r = this.ragdoll;
    const fade = r.dead ? clamp(this.corpseTimer / 2.5, 0, 1) : 1;
    if (fade < 1) ctx.globalAlpha = fade;

    drawBiped(ctx, r, { ink: this.spec.ink, fill: this.spec.ink, weight: this.spec.weight });
    this.drawHat(ctx);

    if (!r.dead && r.hp < r.maxHp) this.drawHealthBar(ctx);
    if (fade < 1) ctx.globalAlpha = 1;
  }

  private drawHat(ctx: Ctx) {
    if (this.spec.hat === "none") return;
    const head = this.ragdoll.bones.get("head");
    if (!head) return;
    const t = head.body.translation();
    const rot = head.body.rotation();
    const rad = head.hw;
    at(ctx, t.x, t.y, rot, () => {
      if (this.spec.hat === "helmet") {
        ctx.fillStyle = "#8d95a3";
        ctx.beginPath();
        ctx.arc(0, 0, rad * 1.08, 0.05, Math.PI - 0.05);
        ctx.fill();
        ctx.fillRect(-rad * 1.25, rad * 0.02, rad * 2.5, rad * 0.16);
      } else if (this.spec.hat === "crown") {
        ctx.fillStyle = "#ffd23f";
        ctx.beginPath();
        ctx.moveTo(-rad * 0.8, rad * 0.68);
        ctx.lineTo(-rad * 0.55, rad * 1.35);
        ctx.lineTo(-rad * 0.2, rad * 0.85);
        ctx.lineTo(0, rad * 1.5);
        ctx.lineTo(rad * 0.2, rad * 0.85);
        ctx.lineTo(rad * 0.55, rad * 1.35);
        ctx.lineTo(rad * 0.8, rad * 0.68);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  private drawHealthBar(ctx: Ctx) {
    const c = this.ragdoll.bonePos("head");
    const w = 0.9 * this.spec.scale;
    const y = c.y + 0.45 * this.spec.scale;
    ctx.fillStyle = rgba("#000000", 0.45);
    ctx.fillRect(c.x - w / 2, y, w, 0.12);
    const f = clamp(this.ragdoll.hp / this.ragdoll.maxHp, 0, 1);
    ctx.fillStyle = f > 0.5 ? "#6ddc7a" : f > 0.22 ? "#ffd23f" : "#e8433a";
    ctx.fillRect(c.x - w / 2, y, w * f, 0.12);
  }

  cullPos() {
    return this.pos;
  }

  cullRadius = 2.4;

  destroy() {
    this.ragdoll.destroy();
  }
}

/** Wakes up every enemy within `radius` — called after every explosion. */
export function alertNearby(enemies: readonly Enemy[], at_: V, radius: number) {
  for (const e of enemies) {
    if (e.dead || e.ragdoll.dead) continue;
    const d = dist(e.pos, at_);
    if (d < radius) e.alert(at_, 1 - d / radius);
  }
}
