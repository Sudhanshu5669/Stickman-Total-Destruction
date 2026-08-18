import { RAPIER, type PhysOwner, G, ig, ALL } from "../core/physics";
import type { Actor, GameCtx } from "../core/types";
import { Ragdoll, type RagdollSpec } from "./ragdoll";
import { clamp, norm, rand, randSign, v, type V } from "../core/math";
import { at, type Ctx } from "../render/draw";
import type { PropDraw } from "../render/props";
import { sfx } from "../fx/audio";

export type TrailKind = "none" | "smoke" | "fire" | "feather" | "sparkle" | "void";
export type ImpactSound = "thud" | "ricochet" | "splat" | "piano" | "saw" | "metal" | "glass" | "none";

export interface ExplodeSpec {
  radius: number;
  force: number;
  damage: number;
  /** Impact energy (kJ) needed to set it off; 0 means "detonates on any contact". */
  minEnergy: number;
  nuke?: boolean;
}

export interface ProjectileConfig {
  shape: "box" | "ball";
  w: number;
  h: number;
  /** kg per m^2 — a 2D slab density. Multiply by w*h for the real mass. */
  density: number;
  friction: number;
  restitution: number;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  /** Constant spin, rad/s. Sawblades and anvils. */
  spin: number;
  /** Forward acceleration while `thrustTime` lasts (m/s^2). */
  thrust: number;
  thrustTime: number;
  /** Upward force scaled by forward airspeed — makes the plane actually fly. */
  lift: number;
  /** How hard the body rotates to face its own velocity, per second. */
  steer: number;
  trail: TrailKind;
  trailColor: string;
  /** Seconds until it detonates on its own; 0 disables. */
  fuse: number;
  life: number;
  explode?: ExplodeSpec;
  splat?: { color: string; count: number };
  attract?: { radius: number; strength: number; duration: number };
  /** Flat extra damage applied to whatever it touches, on top of kinetic damage. */
  bonusDamage: number;
  impactSound: ImpactSound;
  draw: PropDraw;
  points: number;
  /** Fired-from-a-gun objects need CCD or they tunnel through thin walls. */
  ccd: boolean;
}

export const defaultConfig = (): ProjectileConfig => ({
  shape: "box",
  w: 0.5, h: 0.5,
  density: 200,
  friction: 0.7,
  restitution: 0.12,
  gravityScale: 1,
  linearDamping: 0.02,
  angularDamping: 0.1,
  spin: 0,
  thrust: 0,
  thrustTime: 0,
  lift: 0,
  steer: 0,
  trail: "none",
  trailColor: "#9aa3b0",
  fuse: 0,
  life: 22,
  bonusDamage: 0,
  impactSound: "thud",
  draw: () => {},
  points: 0,
  ccd: true,
});

/** How long a fresh projectile ignores the player, so muzzle-blasts never self-hit. */
const SELF_IMMUNITY = 0.14;

/**
 * A single fired object. Everything from a watermelon to a passenger jet is one of
 * these — behaviour is entirely data, which is what makes adding new ammo cheap.
 */
export class RigidProjectile implements Actor, PhysOwner {
  readonly kind = "projectile" as const;
  dead = false;
  z = 18;

  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private age = 0;
  private exploded = false;
  private readonly cfg: ProjectileConfig;
  private attractLeft: number;
  /** Suppresses repeat impact SFX while a body grinds along a surface. */
  private soundCd = 0;

  constructor(
    private readonly game: GameCtx,
    cfg: ProjectileConfig,
    pos: V,
    vel: V,
    angle = 0,
  ) {
    this.cfg = cfg;
    this.attractLeft = cfg.attract?.duration ?? 0;

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y)
      .setRotation(angle)
      .setLinvel(vel.x, vel.y)
      .setLinearDamping(cfg.linearDamping)
      .setAngularDamping(cfg.angularDamping)
      .setGravityScale(cfg.gravityScale)
      .setCcdEnabled(cfg.ccd)
      .setSoftCcdPrediction(Math.max(cfg.w, cfg.h) * 2);
    if (cfg.spin) desc.setAngvel(cfg.spin);
    this.body = game.physics.world.createRigidBody(desc);

    const cd = cfg.shape === "ball"
      ? RAPIER.ColliderDesc.ball(Math.max(cfg.w, cfg.h) / 2)
      : RAPIER.ColliderDesc.cuboid(cfg.w / 2, cfg.h / 2);
    cd.setDensity(cfg.density)
      .setFriction(cfg.friction)
      .setRestitution(cfg.restitution)
      .setCollisionGroups(ig(G.PROJECTILE, ALL & ~G.DEBRIS & ~G.PLAYER));
    this.collider = game.physics.world.createCollider(cd, this.body);
    game.physics.register(this.collider, this);
  }

  get pos(): V {
    const t = this.body.translation();
    return v(t.x, t.y);
  }

  get mass() {
    return this.body.mass();
  }

  update(dt: number) {
    this.age += dt;
    this.soundCd = Math.max(0, this.soundCd - dt);

    if (this.age >= SELF_IMMUNITY && this.age - dt < SELF_IMMUNITY) {
      // Grace period over: it can hit the shooter now, which is half the comedy.
      this.collider.setCollisionGroups(ig(G.PROJECTILE, ALL & ~G.DEBRIS));
    }

    const c = this.cfg;
    const t = this.body.translation();
    const rot = this.body.rotation();
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.y);

    if (c.thrust > 0 && this.age < c.thrustTime) {
      const m = this.body.mass();
      this.body.applyImpulse(v(Math.cos(rot) * c.thrust * m * dt, Math.sin(rot) * c.thrust * m * dt), true);
    }

    if (c.lift > 0 && speed > 1) {
      // Lift acts perpendicular to the body's own axis, so a nose-down plane dives.
      const m = this.body.mass();
      const l = c.lift * speed * m * dt;
      this.body.applyImpulse(v(-Math.sin(rot) * l, Math.cos(rot) * l), true);
    }

    if (c.steer > 0 && speed > 2) {
      const want = Math.atan2(lv.y, lv.x);
      let d = ((want - rot + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      this.body.setAngvel(d * c.steer, true);
    }

    if (c.spin) this.body.setAngvel(c.spin, true);

    if (c.attract && this.attractLeft > 0) {
      this.attractLeft -= dt;
      this.game.physics.attract(v(t.x, t.y), c.attract.radius, c.attract.strength, dt);
      this.game.particles.emit("spark", t.x + rand(-c.attract.radius, c.attract.radius), t.y + rand(-c.attract.radius, c.attract.radius), {
        vx: 0, vy: 0, maxLife: 0.35, size: 0.09, color: "#c9a8ff", drag: 0,
      });
      if (this.attractLeft <= 0) this.detonate();
    }

    this.emitTrail(dt, v(t.x, t.y), speed, rot);

    if (c.fuse > 0 && this.age >= c.fuse) {
      this.detonate();
      return;
    }
    if (this.age >= c.life || t.y < -70) this.dead = true;
  }

  private emitTrail(dt: number, p: V, speed: number, rot: number) {
    const c = this.cfg;
    if (c.trail === "none") return;
    // Trails are frame-rate independent: emit a rate, not a fixed count per tick.
    const n = Math.max(0, Math.floor(rand(0, 1) + dt * 55));
    const back = v(p.x - Math.cos(rot) * c.w * 0.5, p.y - Math.sin(rot) * c.w * 0.5);
    switch (c.trail) {
      case "smoke":
        if (n) this.game.particles.smoke(back.x, back.y, n, 0.6, c.trailColor);
        break;
      case "fire":
        if (n) {
          this.game.particles.fire(back.x, back.y, n, 2.5);
          this.game.particles.smoke(back.x, back.y, Math.max(1, n >> 1), 0.8, "#4b4f59");
        }
        break;
      case "feather":
        if (speed > 6 && Math.random() < dt * 12) this.game.particles.feathers(p.x, p.y, 1);
        break;
      case "sparkle":
        if (n) this.game.particles.sparks(p.x, p.y, n, 3, c.trailColor);
        break;
      case "void":
        if (n) {
          this.game.particles.emit("ring", p.x, p.y, {
            size: 0.2, grow: 2.4, maxLife: 0.5, color: "#8a5cff", drag: 0,
          });
        }
        break;
    }
  }

  onImpact(other: PhysOwner | null, energy: number, point: V, normal: V) {
    if (this.dead || this.exploded) return;
    const kj = energy / 1000;
    const c = this.cfg;

    if (c.bonusDamage > 0 && other?.takeDamage) {
      other.takeDamage(c.bonusDamage, point, this);
    }

    if (this.soundCd <= 0 && kj > 0.4) {
      this.soundCd = 0.06;
      this.playImpactSound(clamp(kj / 40, 0.15, 1));
    }

    if (c.splat && kj > 1.2) {
      this.game.particles.blood(point.x, point.y, 16, normal, 9, c.splat.color);
      this.game.particles.shards(point.x, point.y, 8, c.splat.color, 5);
    }

    if (c.explode && kj >= c.explode.minEnergy) this.detonate();
  }

  private playImpactSound(strength: number) {
    switch (this.cfg.impactSound) {
      case "ricochet": sfx.ricochet(); break;
      case "splat": sfx.splat(); break;
      case "piano": sfx.pianoCrash(); break;
      case "saw": sfx.saw(); break;
      case "metal": sfx.thud(strength, "metal"); break;
      case "glass": sfx.thud(strength, "glass"); break;
      case "none": break;
      default: sfx.thud(strength, "stone");
    }
  }

  detonate() {
    if (this.exploded || this.dead) return;
    const e = this.cfg.explode;
    this.exploded = true;
    this.dead = true;
    if (!e) return;

    const p = this.pos;
    const g = this.game;
    g.physics.explode(p, e.radius, e.force, e.damage, this);
    g.alertEnemiesNear(p, e.radius * 2.6);

    if (e.nuke) {
      // The nuke gets its own presentation: white-out, ring, mushroom column.
      g.flash(1.4, "#fff6d0");
      g.camera.addTrauma(1);
      g.camera.addPunch(-0.28);
      g.slowmo(1.1, 0.25);
      g.particles.flash(p.x, p.y, e.radius * 0.9, "#fffdf0", 0.5);
      g.particles.ring(p.x, p.y, 1.5, "#ffffff", 1.1);
      g.particles.ring(p.x, p.y, 0.8, "#ffd08a", 0.9);
      g.particles.fire(p.x, p.y, 220, 34);
      g.particles.smoke(p.x, p.y, 150, 16, "#4b4f59");
      for (let i = 0; i < 60; i++) {
        g.particles.smoke(p.x + rand(-3, 3), p.y + i * 0.55, 2, 5, "#6a6f7b");
      }
      sfx.nuke();
    } else {
      const scale = clamp(e.radius / 6, 0.4, 2.4);
      g.flash(0.22 * scale, "#ffb257");
      g.camera.addTrauma(0.28 * scale);
      g.camera.addPunch(-0.05 * scale);
      g.particles.flash(p.x, p.y, e.radius * 0.5);
      g.particles.ring(p.x, p.y, 0.5, "#ffd08a", 0.4);
      g.particles.fire(p.x, p.y, Math.round(34 * scale), 10 * scale);
      g.particles.smoke(p.x, p.y, Math.round(20 * scale), 4 * scale);
      g.particles.sparks(p.x, p.y, Math.round(20 * scale), 12, "#ffd23f");
      sfx.explode(scale);
    }
  }

  draw(ctx: Ctx) {
    const t = this.body.translation();
    at(ctx, t.x, t.y, this.body.rotation(), () => {
      this.cfg.draw(ctx, this.cfg.w, this.cfg.h, this.game.time);
    });
  }

  cullPos() {
    return this.pos;
  }

  get cullRadius() {
    return Math.max(this.cfg.w, this.cfg.h);
  }

  destroy() {
    this.game.physics.removeBody(this.body);
  }
}

// --------------------------------------------------------------------------

export interface CreatureConfig {
  spec: RagdollSpec;
  scale: number;
  massScale: number;
  /** Random limb twitching while airborne — what sells "it's alive and terrified". */
  flail: number;
  hp: number;
  /** Called on spawn and occasionally in flight. */
  voice?: () => void;
  voiceInterval: number;
  splatColor: string;
  points: number;
  draw: (ctx: Ctx, r: Ragdoll) => void;
  /** Extra damage this creature inflicts on whatever it lands on. */
  bonusDamage: number;
}

/**
 * Ammo that is itself a ragdoll: chickens, elephants and screaming stickmen.
 * They tumble, flail and die on impact just like every other body in the world.
 */
export class CreatureProjectile implements Actor {
  dead = false;
  z = 19;
  readonly ragdoll: Ragdoll;
  private age = 0;
  private voiceTimer: number;
  private readonly cfg: CreatureConfig;
  private flailPhase = rand(0, 10);
  /** Position captured when the creature left the simulation, for culling and drawing. */
  private restPos: V = v(0, 0);

  constructor(private readonly game: GameCtx, cfg: CreatureConfig, pos: V, vel: V, facing: 1 | -1) {
    this.cfg = cfg;
    this.voiceTimer = rand(0, cfg.voiceInterval);

    this.ragdoll = new Ragdoll(game.physics, cfg.spec, {
      x: pos.x,
      y: pos.y - cfg.spec.height * cfg.scale * 0.5,
      facing,
      scale: cfg.scale,
      massScale: cfg.massScale,
      linvel: vel,
      angvel: rand(-4, 4),
      group: G.PROJECTILE,
      // Fired creatures ignore the player briefly via the shared muzzle offset instead
      // of a timed filter — they are large enough to spawn clear of him.
      filter: ALL & ~G.DEBRIS,
      bullet: true,
    });
    this.ragdoll.hp = this.ragdoll.maxHp = cfg.hp;
    this.ragdoll.impactIgnore = 1.2;
    this.ragdoll.impactFragility = 16;
    this.ragdoll.bonusDamage = cfg.bonusDamage;
    this.ragdoll.splatColor = cfg.splatColor;
    this.ragdoll.onDeath = () => this.onDeath();
    this.ragdoll.onHurt = (_r, amt, at_) => {
      if (amt > 8) game.particles.blood(at_.x, at_.y, Math.min(18, Math.round(amt / 3)), undefined, 7, cfg.splatColor);
    };

    cfg.voice?.();
  }

  private onDeath() {
    const c = this.ragdoll.center();
    this.game.particles.blood(c.x, c.y, 26, undefined, 11, this.cfg.splatColor);
    this.game.particles.stars(c.x, c.y, 6);
    this.game.award(this.cfg.points, c, `+${this.cfg.points}`);
    sfx.splat();
  }

  update(dt: number) {
    this.age += dt;
    const r = this.ragdoll;

    // Spent creatures pile up over a long session; the ones nobody can see should not
    // cost the joint solver anything. See Ragdoll.setEnabled.
    const c0 = r.enabled ? r.center() : this.restPos;
    const cam = this.game.camera.pos;
    const far = Math.abs(c0.x - cam.x) > 52 || Math.abs(c0.y - cam.y) > 52;
    if (far && r.enabled) {
      this.restPos = c0;
      r.setEnabled(false);
    } else if (!far && !r.enabled) {
      r.setEnabled(true);
    }
    if (!r.enabled) {
      if (this.age > 45) this.dead = true;
      return;
    }

    if (!r.dead) {
      this.voiceTimer -= dt;
      if (this.voiceTimer <= 0) {
        this.voiceTimer = this.cfg.voiceInterval * rand(0.7, 1.5);
        this.cfg.voice?.();
      }
      if (this.cfg.flail > 0) this.flailLimbs(dt);
    }

    const c = r.center();
    if (c.y < -70 || this.age > 45) this.dead = true;
  }

  /** Sine-driven motor targets with per-limb phase offsets: cheap, reads as panic. */
  private flailLimbs(dt: number) {
    this.flailPhase += dt * 9;
    const amp = this.cfg.flail;
    const stiff = 90 * this.cfg.massScale;
    const damp = 12 * this.cfg.massScale;
    let i = 0;
    for (const j of this.ragdoll.jointList) {
      if (j.name === "torso" || j.name === "head" || j.name === "body") {
        i++;
        continue;
      }
      const target = Math.sin(this.flailPhase + i * 1.9) * amp;
      this.ragdoll.setMotor(j.name, target, stiff, damp);
      i++;
    }
  }

  draw(ctx: Ctx) {
    this.cfg.draw(ctx, this.ragdoll);
  }

  cullPos() {
    return this.ragdoll.enabled ? this.ragdoll.center() : this.restPos;
  }

  get cullRadius() {
    return this.cfg.spec.height * this.cfg.scale;
  }

  destroy() {
    this.ragdoll.destroy();
  }
}

/** Small helper used by weapons to build a muzzle-relative spawn. */
export function muzzleSpawn(origin: V, dir: V, distance: number): V {
  const d = norm(dir);
  return v(origin.x + d.x * distance, origin.y + d.y * distance);
}

export const jitterDir = (dir: V, spread: number): V => {
  const a = Math.atan2(dir.y, dir.x) + rand(0, spread) * randSign();
  return v(Math.cos(a), Math.sin(a));
};
