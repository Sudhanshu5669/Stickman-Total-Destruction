import { G, ALL } from "../core/physics";
import type { Actor, GameCtx, TargetRef } from "../core/types";
import { BIPED, BIPED_LITE, Ragdoll } from "./ragdoll";
import { drawBiped } from "../render/creatures";
import { angleDelta, clamp, dist, rand, v, type V } from "../core/math";
import { at, rgba, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";
import { Bullet, RIFLE, SHOTGUN, SMG, SNIPER, type BulletSpec } from "./bullet";

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

/**
 * How an armed stickman behaves. Campaign and endless levels hand these out; the
 * playground worlds leave them off entirely, so the sandbox stays a sandbox.
 *
 * - `sentry`  roots to the spot it was placed on. Roof and battlement gunners.
 * - `patrol`  paces a fixed beat and shoots whatever wanders into it.
 * - `hunter`  closes on the player and keeps firing.
 */
export type Behavior = "sentry" | "patrol" | "hunter";

export interface CombatSpec {
  behavior: Behavior;
  gun: BulletSpec;
  /** Metres at which it opens fire. Also the distance it first notices you. */
  range: number;
  /** Seconds between shots. */
  interval: number;
  /** Rounds per trigger pull — the shotgun guard fires a cone. */
  pellets: number;
  /** Aim error, radians. The whole difficulty curve lives here. */
  spread: number;
  /** Reaction delay before the first shot after acquiring the player. */
  reaction: number;
  /** How far a patroller wanders from its post, metres. */
  patrol: number;
  /** Walk speed, m/s. */
  speed: number;
  /** `hunter` only: distance it tries to hold. */
  standoff: number;
}

export type GunId = "smg" | "rifle" | "sniper" | "shotgun";

const GUNS: Record<GunId, BulletSpec> = { smg: SMG, rifle: RIFLE, sniper: SNIPER, shotgun: SHOTGUN };

export interface CombatOptions {
  behavior?: Behavior;
  gun?: GunId;
  range?: number;
  interval?: number;
  pellets?: number;
  spread?: number;
  reaction?: number;
  patrol?: number;
  speed?: number;
  standoff?: number;
}

/** Sensible defaults per behaviour, so a level only names what it wants to change. */
export function combat(opts: CombatOptions = {}): CombatSpec {
  const behavior = opts.behavior ?? "sentry";
  const gunId = opts.gun ?? (behavior === "sentry" ? "rifle" : "smg");
  const gun = GUNS[gunId];
  const base: CombatSpec = {
    behavior,
    gun,
    range: gunId === "sniper" ? 72 : gunId === "shotgun" ? 16 : 34,
    interval: gunId === "sniper" ? 2.4 : gunId === "shotgun" ? 1.5 : gunId === "rifle" ? 1.05 : 0.34,
    pellets: gunId === "shotgun" ? 5 : 1,
    spread: gunId === "sniper" ? 0.03 : gunId === "shotgun" ? 0.16 : 0.09,
    reaction: 0.55,
    patrol: behavior === "patrol" ? 7 : 0,
    speed: behavior === "hunter" ? 3.4 : 2.2,
    standoff: 12,
  };
  return {
    ...base,
    ...(opts.range !== undefined ? { range: opts.range } : {}),
    ...(opts.interval !== undefined ? { interval: opts.interval } : {}),
    ...(opts.pellets !== undefined ? { pellets: opts.pellets } : {}),
    ...(opts.spread !== undefined ? { spread: opts.spread } : {}),
    ...(opts.reaction !== undefined ? { reaction: opts.reaction } : {}),
    ...(opts.patrol !== undefined ? { patrol: opts.patrol } : {}),
    ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
    ...(opts.standoff !== undefined ? { standoff: opts.standoff } : {}),
  };
}

const RIDE = 0.95;
const RIDE_SPRING = 190;
const RIDE_DAMP = 24;

/**
 * Neck gains. The head is a 9kg ball on a 16cm lever, so a weak spring simply loses
 * to gravity and the head hangs off the joint limit instead of sitting on the neck.
 */
const NECK_STIFF = 1200;
const NECK_DAMP = 60;

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

  // ---------------------------------------------------------------- combat
  /** Null for the playground worlds: unarmed stickmen that only panic and fall over. */
  readonly combat: CombatSpec | null;
  /** Where it was placed. Sentries hold it; patrollers pace around it. */
  private readonly post: V;
  /** Aim angle, eased toward the player so it visibly tracks rather than snapping. */
  private aimAngle = 0;
  private fireCd = rand(0.2, 1.2);
  /** Seconds of continuous sight of the player; gates the first shot. */
  private sighted = 0;
  private hasTarget = false;
  private patrolDir: 1 | -1 = 1;
  private patrolPause = 0;
  private muzzle = 0;
  private strafePhase = rand(0, 10);

  constructor(
    private readonly game: GameCtx, kind: EnemyKind, x: number, y: number,
    facing: 1 | -1 = -1, combatSpec: CombatSpec | null = null,
  ) {
    this.kind = kind;
    this.combat = combatSpec;
    this.post = v(x, y);
    this.aimAngle = facing < 0 ? Math.PI : 0;
    this.patrolDir = facing;
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

    if (this.combat) this.updateCombat(dt);

    if (!r.limp) {
      this.balance(dt);
      this.pose(dt);
    }

    if (this.pos.y < -45) r.takeDamage(9999);
  }

  // ------------------------------------------------------------------ combat

  /** Horizontal walk intent, -1..1, written by the combat brain and read by `balance`. */
  private moveIntent = 0;

  /**
   * Acquire, aim, move, shoot.
   *
   * The three behaviours differ only in what they do with their feet — acquisition,
   * aiming and the trigger are shared, so a sentry and a hunter are equally accurate
   * and the difficulty of a level is set by the spread and interval it hands out.
   */
  private updateCombat(dt: number) {
    const c = this.combat!;
    const r = this.ragdoll;
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.muzzle = Math.max(0, this.muzzle - dt * 9);
    this.moveIntent = 0;

    const target = this.game.target();
    const eye = r.bonePos("torso");
    let visible = false;

    if (target && target.alive && !r.limp) {
      const d = dist(eye, target.aimPos);
      // Line of sight is a real ray, so a wall genuinely protects the player. The
      // pelvis is excluded or the enemy's own body blocks the query at point blank.
      visible = d < c.range && this.game.physics.lineOfSight(eye, target.aimPos, r.bone("pelvis").body);
    }

    this.hasTarget = visible;
    if (visible && target) {
      this.sighted += dt;
      // Measured from the muzzle, not the eye: the laser is drawn from the hand and
      // the bullet leaves from the hand, so an angle taken anywhere else makes the
      // laser a lie — it would run parallel to the shot, about half a metre off.
      // Acquisition still uses the torso, which is the right place to see from.
      const hand = this.hand;
      const want = Math.atan2(target.aimPos.y - hand.y, target.aimPos.x - hand.x);
      // Ease onto the target instead of snapping: it reads as tracking, and it gives
      // the player a moment to break contact after stepping into the open.
      this.aimAngle += angleDelta(this.aimAngle, want) * Math.min(1, dt * 7);
      this.moveIntent = this.combatSteer(c, target);
      // `aiming` is also what gates the shooting *pose*, so tying the trigger to it
      // keeps the two honest: a panicking enemy flails instead of firing blind, which
      // turns suppressing fire into a real mechanic rather than a cosmetic one.
      if (this.aiming && this.sighted > c.reaction && this.fireCd <= 0 && this.grounded) {
        this.shoot(c);
      }
    } else {
      this.sighted = Math.max(0, this.sighted - dt * 1.5);
      this.idleSteer(c, dt);
    }
  }

  /** Where the feet want to go while the player is in sight. */
  private combatSteer(c: CombatSpec, target: TargetRef): number {
    const x = this.pos.x;
    const dx = target.pos.x - x;
    if (c.behavior === "sentry") return 0;

    if (c.behavior === "hunter") {
      const d = Math.abs(dx);
      // Close to standoff range, then shuffle sideways so it isn't a static target.
      if (d > c.standoff + 1.5) return Math.sign(dx);
      if (d < c.standoff * 0.55) return -Math.sign(dx);
      return Math.sin(this.strafePhase) * 0.5;
    }

    // Patrollers hold their beat but face the fight; they only close if you are
    // outside their patrol box, which keeps them off the edges of their platform.
    const off = x - this.post.x;
    if (Math.abs(off) > c.patrol) return -Math.sign(off);
    return Math.abs(dx) > c.range * 0.8 ? Math.sign(dx) * 0.6 : 0;
  }

  /** Pacing while nothing is in sight. */
  private idleSteer(c: CombatSpec, dt: number) {
    this.strafePhase += dt * 2.2;
    if (c.behavior === "sentry") {
      // Sweep the muzzle slowly across its arc so it does not look switched off.
      const sweep = (this.patrolDir < 0 ? Math.PI : 0) + Math.sin(this.strafePhase * 0.35) * 0.35;
      this.aimAngle += angleDelta(this.aimAngle, sweep) * Math.min(1, dt * 2);
      return;
    }
    if (c.behavior === "hunter") {
      // Hunters drift toward where the player was last seen rather than freezing.
      this.moveIntent = this.patrolDir * 0.45;
    }

    if (this.patrolPause > 0) {
      this.patrolPause -= dt;
      this.moveIntent = 0;
    } else {
      const off = this.pos.x - this.post.x;
      const reach = Math.max(2, c.patrol);
      if (off > reach) this.patrolDir = -1;
      else if (off < -reach) this.patrolDir = 1;
      else if (Math.random() < dt * 0.12) {
        this.patrolPause = rand(0.6, 2.2);
        this.patrolDir = (Math.random() < 0.5 ? -1 : 1) as 1 | -1;
      }
      if (this.patrolPause <= 0) this.moveIntent = this.patrolDir * 0.8;
    }
    const face = this.moveIntent < 0 ? Math.PI : 0;
    this.aimAngle += angleDelta(this.aimAngle, face) * Math.min(1, dt * 3);
  }

  private shoot(c: CombatSpec) {
    // Jitter the cadence so a squad never falls into an audible drum machine.
    this.fireCd = c.interval * rand(0.85, 1.2);
    this.muzzle = 1;

    const hand = this.hand;
    const from = v(hand.x + Math.cos(this.aimAngle) * 0.6 * this.spec.scale,
                   hand.y + Math.sin(this.aimAngle) * 0.6 * this.spec.scale);
    for (let i = 0; i < c.pellets; i++) {
      const a = this.aimAngle + rand(-c.spread, c.spread);
      this.game.add(new Bullet(this.game, c.gun, from, v(Math.cos(a), Math.sin(a))));
    }
    sfx.shoot(0.12 + Math.min(0.35, c.gun.damage / 60));
    // A little recoil so the shooter is visibly doing something.
    this.ragdoll.impulseAt("torso", v(-Math.cos(this.aimAngle) * 6, 0));
  }

  /**
   * The muzzle hand — the far end of the front arm, exactly as the player computes
   * it. Bullets leave from here and the gun is drawn here, so what you see is what
   * shoots you.
   */
  private get hand(): V {
    const r = this.ragdoll;
    const b = r.bones.get("armFrontLo") ?? r.bones.get("armFront");
    if (!b) return r.bonePos("torso");
    return r.bonePos(b.name, 0, -b.hh);
  }

  /** Whether the aiming pose should override the idle/panic pose. */
  private get aiming() {
    return !!this.combat && !this.ragdoll.limp && !this.ragdoll.dead && this.panic < 0.55;
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
    // A marksman has to stay awake out to its own engagement range, or a sniper nest
    // 70m away would sleep through the entire fight it was placed to pick.
    const reach = this.combat ? Math.max(SLEEP_RANGE, this.combat.range + 14) : SLEEP_RANGE;
    const far = dx > reach || dy > reach;
    const near = dx < reach - (SLEEP_RANGE - WAKE_RANGE) && dy < reach - (SLEEP_RANGE - WAKE_RANGE);

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

    // Armed stickmen hold their ground and manoeuvre; unarmed ones only ever run.
    if (this.combat && this.grounded && this.panic < 0.75) {
      if (this.moveIntent !== 0) {
        const want = this.moveIntent * this.combat.speed;
        const dv = want - pelvis.linvel().x;
        pelvis.applyImpulse(v(clamp(dv * 8, -26, 26) * total * dt, 0), true);
      } else {
        // Actively brake, or a sentry slides off its perch after every knock.
        pelvis.applyImpulse(v(clamp(-pelvis.linvel().x * 5, -18, 18) * total * dt, 0), true);
      }
    } else if (this.panic > 0.3 && this.grounded) {
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

    if (this.aiming) {
      // Front arm points down the barrel, back arm braces under it.
      //
      // The arm hangs along its own -y from the shoulder, so its world direction is
      // (childRotation - PI/2); a revolute joint's angle is (child - parent), giving
      // target = aim + PI/2 - torsoRotation. `setMotor` mirrors by facing, so the
      // value is pre-multiplied to cancel that out and land on the true angle.
      const body = r.boneAngle("torso");
      const aim = angleDelta(0, this.aimAngle + Math.PI / 2 - body) * r.facing;
      const kick = this.muzzle * 0.3 * r.facing;
      if (lite) {
        r.setMotor("armFront", aim - kick, stiff * 1.8, damp * 1.5);
        r.setMotor("armBack", aim + 0.4 - kick * 0.5, stiff * 1.3, damp * 1.3);
      } else {
        r.setMotor("armFrontUp", aim - kick, stiff * 1.8, damp * 1.5);
        // Nearly straight: a bent elbow puts the gun somewhere the aim isn't.
        r.setMotor("armFrontLo", -0.04, stiff, damp);
        r.setMotor("armBackUp", aim + 0.4 - kick * 0.5, stiff * 1.3, damp * 1.3);
        r.setMotor("armBackLo", -0.3, stiff, damp);
      }
      const lean = clamp(this.moveIntent * 0.12, -0.12, 0.12);
      r.setMotor("torso", lean, 620, 48);
      r.setMotor("head", clamp(angleDelta(body, this.aimAngle) * 0.2, -0.4, 0.4), NECK_STIFF, NECK_DAMP);
      this.poseLegs(dt);
      return;
    }

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

    r.setMotor("head", Math.sin(this.idlePhase * 0.7) * 0.18, NECK_STIFF * 0.75, NECK_DAMP * 0.75);
    this.poseLegs(dt);
  }

  /** Leg motors — shared by the idle, panic and aiming poses. */
  private poseLegs(dt: number) {
    void dt;
    const r = this.ragdoll;
    const lite = r.has("armBack");
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
    if (this.combat && !r.dead) this.drawGun(ctx);

    if (!r.dead && r.hp < r.maxHp) this.drawHealthBar(ctx);
    if (fade < 1) ctx.globalAlpha = 1;
  }

  /**
   * The enemy's rifle, plus a "you are being aimed at" laser while it has line of
   * sight. The laser is the fairness valve: it tells the player exactly who is about
   * to shoot and from where, which is the difference between hard and cheap.
   */
  private drawGun(ctx: Ctx) {
    const c = this.combat!;
    const s = this.spec.scale;
    const hand = this.hand;
    const len = (c.gun === SNIPER ? 1.5 : c.gun === SHOTGUN ? 1.0 : 1.15) * s;

    if (this.hasTarget && this.sighted > 0.12) {
      const t = clamp(this.sighted / Math.max(0.05, c.reaction), 0, 1);
      // Stop the beam on the player rather than running it out to full range —
      // otherwise every sightline continues off past the target and across the sky.
      const tgt = this.game.target();
      const beam = tgt ? clamp(dist(hand, tgt.aimPos), 1, c.range) : Math.min(c.range, 40);
      ctx.strokeStyle = rgba(c.gun.tint, 0.1 + t * 0.3);
      ctx.lineWidth = 0.035 + t * 0.03;
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y);
      ctx.lineTo(hand.x + Math.cos(this.aimAngle) * beam, hand.y + Math.sin(this.aimAngle) * beam);
      ctx.stroke();
    }

    at(ctx, hand.x, hand.y, this.aimAngle, () => {
      ctx.translate(-this.muzzle * 0.12 * s, 0);
      ctx.fillStyle = "#2a3040";
      ctx.fillRect(0.05 * s, -0.07 * s, len * 0.72, 0.14 * s);
      ctx.fillStyle = "#4b5568";
      ctx.fillRect(len * 0.6, -0.05 * s, len * 0.42, 0.1 * s);
      ctx.fillStyle = "#171b23";
      ctx.fillRect(0.12 * s, 0.04 * s, 0.22 * s, 0.2 * s);

      if (this.muzzle > 0.05) {
        ctx.globalAlpha = this.muzzle;
        ctx.fillStyle = "#fff2c2";
        ctx.beginPath();
        ctx.moveTo(len * 1.02, -0.16 * s);
        ctx.lineTo(len * 1.02 + 0.5 * s, 0);
        ctx.lineTo(len * 1.02, 0.16 * s);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });
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
    return this.dormant ? this.restPos : this.pos;
  }

  cullRadius = 2.4;

  /**
   * Natives are adapted to their own weather. Deliberately no damage: acid strong
   * enough to threaten the player clears every enemy off an open level in under a
   * minute, so the hazard would solve the level for you.
   */
  takeAcid(_amount: number) {}

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
