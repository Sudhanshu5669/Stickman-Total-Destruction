import { G, ALL } from "../core/physics";
import type { Actor, GameCtx } from "../core/types";
import type { Input } from "../core/input";
import { BIPED, Ragdoll } from "./ragdoll";
import { Weapon } from "../weapons/weapon";
import { drawBiped } from "../render/creatures";
import { angleDelta, clamp, damp, norm, rand, v, type V } from "../core/math";
import { at, disc, poly, rgba, roundBox, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";

/** Everything worth feeling out, in one block. */
const TUNE = {
  /** Height the pelvis floats above the ground; the legs hang beneath it. */
  rideHeight: 0.95,
  crouchHeight: 0.62,
  rideSpring: 300,
  rideDamp: 30,
  /** Extra distance below `rideHeight` that still counts as standing on something. */
  groundSlack: 0.34,

  runSpeed: 7.4,
  airSpeed: 6.2,
  /** High enough to reach top speed in ~0.1s and reverse direction in ~0.2s. */
  groundAccel: 82,
  airAccel: 26,

  jumpSpeed: 9.6,
  coyote: 0.12,
  jumpBuffer: 0.14,

  /**
   * Jetpack. Thrust is expressed as *net* acceleration on top of whatever the world's
   * gravity is, so the pack lifts identically on Earth and on Mars — a fixed thrust
   * would be feeble at -26 and uncontrollable at -9.6.
   */
  jetNetAccel: 15,
  /** Rise speed cap, so holding thrust doesn't accelerate into orbit. */
  jetMaxRise: 9.5,
  /** Seconds of continuous burn from full. */
  jetFuelMax: 2.5,
  /** Fuel-seconds recovered per second while standing on something. */
  jetRefill: 1.5,
  /** Grace after landing before the tank starts refilling. */
  jetRefillDelay: 0.3,
  /** Horizontal control authority while the pack is lit. */
  jetAirAccel: 48,

  /** Upright PD gains, in rad/s^2 per rad and per rad/s. */
  uprightK: 46,
  uprightD: 11,
  /** Hard cap on the righting acceleration, so a big hit can't launch him. */
  uprightMaxAccel: 30,
  /** How fast the hips wind back to vertical while getting up, rad/s. */
  getUpRate: 7,
  /** Deadline for the get-up, after which the hips are snapped upright. */
  getUpTime: 0.9,

  armStiff: 340,
  armDamp: 26,
  legStiff: 460,
  legDamp: 34,
  /** High: the spine carries the head, both arms and a large gun against gravity. */
  spineStiff: 2200,
  spineDamp: 110,
  neckStiff: 120,
  neckDamp: 12,

  /** Fraction of a shot's recoil that actually moves the body. */
  recoilTransfer: 0.62,
  /** Global incoming-damage multiplier for the player. */
  selfDamage: 0.34,
  /** Damage in one hit that knocks the player into a full ragdoll. */
  knockdownDamage: 20,
  knockdownTime: 1.5,
  /** Self-inflicted knockdown from firing the heaviest rounds. */
  fireKnockdown: 0.32,
  respawnTime: 2.4,
  spawnGrace: 1.2,
  regenDelay: 4,
  regenRate: 9,
};

/**
 * Everything the character can be told to do, independent of where it came from.
 * The human path fills this from `Input`; attract mode fills it from an AI. Edge
 * fields (`jumpPressed`, `firePressed`, `selectAmmo`, `cycleAmmo`) are consumed and
 * cleared by the player once read, exactly like real input edges.
 */
export interface PlayerControl {
  moveX: number;
  jumpPressed: boolean;
  /** Held state of the jump control — this is what lights the jetpack. */
  jumpHeld: boolean;
  crouch: boolean;
  /** World-space point to aim at. */
  aimWorld: V;
  fireHeld: boolean;
  firePressed: boolean;
  selectAmmo: number | null;
  cycleAmmo: number;
}

export const blankControl = (): PlayerControl => ({
  moveX: 0, jumpPressed: false, jumpHeld: false, crouch: false, aimWorld: v(1, 0),
  fireHeld: false, firePressed: false, selectAmmo: null, cycleAmmo: 0,
});

export class Player implements Actor {
  dead = false;
  z = 22;

  /** When set, drives the character instead of the keyboard and mouse. */
  control: PlayerControl | null = null;

  ragdoll!: Ragdoll;
  readonly weapon = new Weapon();

  /** World-space crosshair target. */
  aim: V = v(1, 0);
  aimAngle = 0;
  facing: 1 | -1 = 1;

  grounded = false;
  private groundDist = 99;
  private coyoteLeft = 0;
  private jumpBuffered = 0;
  private walkPhase = 0;
  private limpLeft = 0;
  /** Time left in the scramble-to-your-feet window after a knockdown. */
  private getUpLeft = 0;
  private respawnLeft = 0;
  private graceLeft = TUNE.spawnGrace;
  private sinceHurt = 99;
  private manualRagdoll = false;
  /** Rises while airborne after a big recoil shot, purely for the camera to react to. */
  launchBoost = 0;

  /** Seconds of jetpack burn remaining. */
  fuel = TUNE.jetFuelMax;
  /** Smoothed 0..1 throttle, used for the exhaust, the audio and the HUD. */
  jetThrottle = 0;
  private jetLit = false;
  private jetGroundTimer = 0;

  spawn: V;
  kills = 0;

  constructor(private readonly game: GameCtx, private readonly input: Input, x: number, y: number) {
    this.spawn = v(x, y);
    this.build(x, y);
  }

  private build(x: number, y: number) {
    this.ragdoll = new Ragdoll(this.game.physics, BIPED, {
      x, y, facing: 1, scale: 1,
      group: G.PLAYER,
      filter: ALL & ~G.DEBRIS,
      color: "#14171f",
    });
    this.ragdoll.hp = this.ragdoll.maxHp = 100;
    // The player falls a lot on purpose, and rocket-jumping off his own ordnance is
    // a core movement tech, so he shrugs off far more than anything else in the world.
    this.ragdoll.impactIgnore = 3.2;
    this.ragdoll.impactFragility = 6.5;
    this.ragdoll.damageScale = TUNE.selfDamage;
    this.ragdoll.invulnerable = true;
    this.ragdoll.onHurt = (_r, amount, at) => this.onHurt(amount, at);
    this.ragdoll.onDeath = () => this.onDeath();
    this.graceLeft = TUNE.spawnGrace;
    this.limpLeft = 0;
    this.getUpLeft = 0;
    this.respawnLeft = 0;
    this.manualRagdoll = false;
    this.fuel = TUNE.jetFuelMax;
    this.jetThrottle = 0;
    this.jetLit = false;
    this.ragdoll.lockRoot(true);
  }

  // ------------------------------------------------------------------ state

  get pos(): V {
    return this.ragdoll.bonePos("pelvis");
  }

  get chest(): V {
    return this.ragdoll.bonePos("torso", 0, 0.16);
  }

  /** Where the gun sits — the end of the front forearm. */
  get hand(): V {
    const lo = this.ragdoll.bones.get("armFrontLo");
    if (!lo) return this.chest;
    return this.ragdoll.bonePos("armFrontLo", 0, -lo.hh);
  }

  get hp() {
    return this.ragdoll.hp;
  }

  get maxHp() {
    return this.ragdoll.maxHp;
  }

  get isDown() {
    return this.ragdoll.dead;
  }

  get respawnIn() {
    return Math.max(0, this.respawnLeft);
  }

  get fuelFrac() {
    return clamp(this.fuel / TUNE.jetFuelMax, 0, 1);
  }

  cullRadius = 3;

  cullPos(): V {
    return this.ragdoll.center();
  }

  takeAcid(amount: number) {
    if (this.ragdoll.dead) return;
    const c = this.ragdoll.center();
    this.ragdoll.takeDamage(amount, c);
    this.game.particles.emit("spark", c.x, c.y + 0.8, {
      vx: 0, vy: -3, maxLife: 0.4, size: 0.14, color: "#9dff6a", drag: 1,
    });
  }

  get isLimp() {
    return this.ragdoll.limp;
  }

  private get controllable() {
    return !this.ragdoll.dead && !this.ragdoll.limp;
  }

  // ---------------------------------------------------- control source (human or AI)

  private get wantMoveX() {
    return this.control ? clamp(this.control.moveX, -1, 1) : this.input.moveX;
  }

  private get wantCrouch() {
    return this.control ? this.control.crouch : this.input.held("KeyS", "ArrowDown");
  }

  /** Edge-consuming: returns true once per request. */
  private takeJump() {
    if (!this.control) return this.input.pressed("Space", "KeyW", "ArrowUp");
    const j = this.control.jumpPressed;
    this.control.jumpPressed = false;
    return j;
  }

  private get wantJumpHeld() {
    return this.control ? this.control.jumpHeld : this.input.held("Space", "KeyW", "ArrowUp");
  }

  private get wantFireHeld() {
    return this.control ? this.control.fireHeld : this.input.mouseDown;
  }

  private takeFirePressed() {
    if (!this.control) return this.input.mousePressed;
    const f = this.control.firePressed;
    this.control.firePressed = false;
    return f;
  }

  private takeAmmoSelect(): number | null {
    if (!this.control) {
      const d = this.input.digitPressed();
      return d > 0 ? d - 1 : null;
    }
    const s = this.control.selectAmmo;
    this.control.selectAmmo = null;
    return s;
  }

  private takeAmmoCycle(): number {
    if (!this.control) {
      return this.input.wheel + (this.input.pressed("KeyE") ? 1 : 0) - (this.input.pressed("KeyQ") ? 1 : 0);
    }
    const c = this.control.cycleAmmo;
    this.control.cycleAmmo = 0;
    return c;
  }

  // ------------------------------------------------------------------ damage

  private onHurt(amount: number, at: V) {
    this.sinceHurt = 0;
    this.game.particles.blood(at.x, at.y, Math.min(16, Math.round(amount / 2)), undefined, 7);
    if (amount >= TUNE.knockdownDamage && !this.ragdoll.dead) {
      this.knockdown(TUNE.knockdownTime);
    }
    this.game.camera.addTrauma(clamp(amount / 60, 0.05, 0.5));
  }

  private onDeath() {
    this.respawnLeft = TUNE.respawnTime;
    const c = this.ragdoll.center();
    this.game.particles.blood(c.x, c.y, 30, undefined, 12);
    this.game.particles.stars(c.x, c.y, 8);
    this.game.camera.addTrauma(0.6);
    sfx.splat();
  }

  knockdown(seconds: number) {
    if (this.ragdoll.dead) return;
    this.limpLeft = Math.max(this.limpLeft, seconds);
    this.ragdoll.goLimp();
  }

  toggleRagdoll() {
    if (this.ragdoll.dead) return;
    this.manualRagdoll = !this.manualRagdoll;
    if (this.manualRagdoll) {
      this.ragdoll.goLimp();
    } else {
      this.limpLeft = 0;
      this.ragdoll.stiffen();
      this.getUpLeft = TUNE.getUpTime;
    }
    sfx.ui(!this.manualRagdoll);
  }

  respawn(at?: V) {
    const p = at ?? this.spawn;
    this.ragdoll.destroy();
    this.build(p.x, p.y);
    this.weapon.refillAll();
    this.game.camera.addTrauma(0.15);
    sfx.levelUp();
  }

  // ------------------------------------------------------------------ update

  update(dt: number) {
    const r = this.ragdoll;
    this.sinceHurt += dt;
    this.graceLeft = Math.max(0, this.graceLeft - dt);
    if (this.graceLeft <= 0) r.invulnerable = false;
    this.launchBoost = Math.max(0, this.launchBoost - dt * 1.6);

    if (r.dead) {
      this.respawnLeft -= dt;
      if (this.respawnLeft <= 0) this.respawn();
      return;
    }

    // Slow self-repair keeps a sandbox from turning into a respawn simulator.
    if (this.sinceHurt > TUNE.regenDelay && r.hp < r.maxHp) {
      r.hp = Math.min(r.maxHp, r.hp + TUNE.regenRate * dt);
    }

    if (this.limpLeft > 0 && !this.manualRagdoll) {
      this.limpLeft -= dt;
      if (this.limpLeft <= 0) {
        r.stiffen();
        this.getUpLeft = TUNE.getUpTime;
      }
    }

    this.probeGround();
    this.updateAim();
    this.handleWeapon(dt);

    if (this.controllable) {
      this.balance(dt);
      this.jetpack(dt);
      this.locomotion(dt);
      this.jump(dt);
      this.poseLimbs(dt);
    } else {
      this.coyoteLeft = 0;
      this.jetLit = false;
      this.jetThrottle = damp(this.jetThrottle, 0, 10, dt);
    }
    sfx.jetpack(this.jetThrottle);

    if (this.pos.y < -45) {
      // Fell off the world.
      r.takeDamage(9999);
    }
  }

  private probeGround() {
    const pelvis = this.ragdoll.bone("pelvis");
    const p = pelvis.body.translation();
    const maxDist = TUNE.rideHeight + TUNE.groundSlack;
    const hit = this.game.physics.groundRay(v(p.x, p.y), maxDist, pelvis.body);
    this.groundDist = hit ?? Infinity;
    const wasGrounded = this.grounded;
    this.grounded = hit !== null && hit <= maxDist;
    if (this.grounded) {
      this.coyoteLeft = TUNE.coyote;
      if (!wasGrounded) {
        const vel = pelvis.body.linvel();
        if (vel.y < -7) {
          this.game.particles.dust(p.x, p.y - this.groundDist, 8, 3);
          sfx.thud(clamp(-vel.y / 26, 0.1, 0.7), "stone");
        }
      }
    }
  }

  /**
   * Resamples the crosshair. Called once per rendered frame as well as per simulation
   * step, so aiming stays glued to the mouse even when the sim is running slower than
   * the display (slow-motion, hitstop, high-refresh monitors).
   */
  syncAim() {
    if (this.ragdoll.dead || this.ragdoll.disposed) return;
    this.updateAim();
  }

  private updateAim() {
    const world = this.control
      ? this.control.aimWorld
      : this.game.camera.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    this.aim = world;
    const from = this.chest;
    const d = norm(v(world.x - from.x, world.y - from.y));
    this.aimAngle = Math.atan2(d.y, d.x);
    this.facing = Math.cos(this.aimAngle) >= 0 ? 1 : -1;
  }

  private handleWeapon(dt: number) {
    const w = this.weapon;
    const held = this.wantFireHeld;
    w.update(dt, held);

    // Swapping ammo is a UI action, not a physical one — it stays available while
    // knocked down. Being unable to change weapon for a second after every heavy
    // shot reads as the game ignoring you.
    const cycle = this.takeAmmoCycle();
    if (cycle) w.cycle(cycle);
    const select = this.takeAmmoSelect();
    if (select !== null) w.select(select);

    const pressed = this.takeFirePressed();
    if (!this.controllable) return;

    const hand = this.hand;
    const dir = v(Math.cos(this.aimAngle), Math.sin(this.aimAngle));
    const res = w.fire(this.game, hand, dir, this.facing, held, pressed);
    if (res.fired) {
      const t = TUNE.recoilTransfer;
      this.ragdoll.applyImpulse(v(res.recoil.x * t, res.recoil.y * t));
      // A little extra straight into the arm so the gun visibly bucks.
      const armMass = this.ragdoll.bone("armFrontUp").body.mass();
      this.ragdoll.impulseAt("armFrontUp", v(res.recoil.x * armMass * 0.9, res.recoil.y * armMass * 0.9));
      if (res.ammo.heft > 0.55) {
        this.launchBoost = Math.max(this.launchBoost, res.ammo.heft);
        // Only the truly absurd ordnance floors you. Anything lower just shoves you:
        // a knockdown costs ~1s of control, and applying that to mid-weight rounds
        // makes the whole arsenal feel like it is fighting the player.
        if (res.ammo.heft >= 0.95 && this.grounded) this.knockdown(TUNE.fireKnockdown);
      }
    }
    w.emitIdleSmoke(this.game, hand, this.aimAngle, dt);
  }

  // ------------------------------------------------------------------ control

  /**
   * Floating-pelvis balance. The body hovers on a spring instead of standing on its
   * feet, which is what lets it stay upright and still flop convincingly when hit.
   *
   * The spring force is scaled by the ragdoll's **total** mass, not the pelvis's.
   * The pelvis is only ~13kg of a ~70kg body, so scaling by pelvis mass leaves a
   * standing sag of g·total/(k·pelvis) ≈ 0.5m — the character visibly collapses.
   * Scaling by total mass makes the sag g/k ≈ 0.09m regardless of body weight.
   */
  private balance(dt: number) {
    const pelvis = this.ragdoll.bone("pelvis").body;
    const total = this.ragdoll.totalMass();
    const wantHeight = this.wantCrouch ? TUNE.crouchHeight : TUNE.rideHeight;

    if (this.grounded && this.groundDist < wantHeight + TUNE.groundSlack) {
      const vel = pelvis.linvel();
      const err = wantHeight - this.groundDist;
      const accel = err * TUNE.rideSpring - vel.y * TUNE.rideDamp;
      // Only ever push up: pulling down would glue him to ramps and cancel jumps.
      if (accel > 0) pelvis.applyImpulse(v(0, accel * total * dt), true);
    }

    this.uprightBody(dt);
  }

  /**
   * Keeps the body upright while the player is in control.
   *
   * While standing the pelvis rotation is pinned (see `Ragdoll.lockRoot`), so there is
   * nothing to correct. The interesting case is the moment after a knockdown: the root
   * is still free and the body is somewhere on the floor, so we spend `getUpTime`
   * winding its angle back to vertical before re-pinning it. That reads as scrambling
   * to your feet, and it avoids the pelvis snapping upright in a single frame.
   */
  private uprightBody(dt: number) {
    if (this.ragdoll.rootLocked) return;

    const pelvis = this.ragdoll.bone("pelvis").body;
    const err = angleDelta(pelvis.rotation(), 0);

    if (Math.abs(err) < 0.18) {
      this.getUpLeft = 0;
      this.ragdoll.lockRoot(true);
      return;
    }

    this.getUpLeft = Math.max(0, this.getUpLeft - dt);
    // Rotate the whole skeleton together so the limbs come round with the hips...
    const alpha = clamp(err * TUNE.uprightK, -TUNE.uprightMaxAccel, TUNE.uprightMaxAccel);
    this.ragdoll.applyAngularAccel(alpha * 0.4, dt);
    // ...and wind the root itself, which contacts cannot veto.
    pelvis.setRotation(pelvis.rotation() + clamp(err, -TUNE.getUpRate * dt, TUNE.getUpRate * dt), true);

    // Hard deadline: never leave the player stuck mid-recovery on awkward geometry.
    if (this.getUpLeft <= 0) {
      pelvis.setRotation(0, true);
      this.ragdoll.lockRoot(true);
    }
  }

  /**
   * Hold the jump control while airborne to burn fuel and fly.
   *
   * Thrust is applied as a uniform velocity change across every bone (like the jump)
   * rather than a shove on the hips, so the body rises as one piece instead of being
   * dragged up by its pelvis. Gravity is cancelled first and a fixed net acceleration
   * added on top, which keeps the pack feeling the same on every world.
   */
  private jetpack(dt: number) {
    const wants = this.wantJumpHeld && !this.grounded && this.fuel > 0;
    this.jetLit = wants;

    if (wants) {
      this.fuel = Math.max(0, this.fuel - dt);
      this.jetGroundTimer = TUNE.jetRefillDelay;

      const gravity = Math.abs(this.game.physics.world.gravity.y);
      const vy = this.ragdoll.bone("pelvis").body.linvel().y;
      // Ease off as the rise cap is approached so it settles instead of clipping.
      const headroom = clamp((TUNE.jetMaxRise - vy) / TUNE.jetMaxRise, 0, 1);
      const accel = gravity + TUNE.jetNetAccel * headroom;
      this.ragdoll.applyImpulse(v(0, accel * dt));
      this.launchBoost = Math.max(this.launchBoost, 0.35);

      this.emitExhaust(dt);
    } else if (this.grounded) {
      this.jetGroundTimer = Math.max(0, this.jetGroundTimer - dt);
      if (this.jetGroundTimer <= 0 && this.fuel < TUNE.jetFuelMax) {
        this.fuel = Math.min(TUNE.jetFuelMax, this.fuel + TUNE.jetRefill * dt);
      }
    }

    this.jetThrottle = damp(this.jetThrottle, wants ? 1 : 0, wants ? 22 : 9, dt);
  }

  /** Twin plumes out of the pack's nozzles, in world space. */
  private emitExhaust(dt: number) {
    const torso = this.ragdoll.bones.get("torso");
    if (!torso) return;
    const rot = torso.body.rotation();
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const back = -0.17 * this.facing;

    for (const side of [-0.09, 0.09]) {
      const lx = back + side * this.facing;
      const ly = -0.22;
      const px = torso.body.translation().x + lx * cos - ly * sin;
      const py = torso.body.translation().y + lx * sin + ly * cos;
      // Down the torso's own axis, so the plume tilts as he does.
      const dx = sin * 5;
      const dy = -cos * 5;
      if (Math.random() < dt * 100) {
        this.game.particles.emit("fire", px, py, {
          vx: dx + rand(-1.2, 1.2), vy: dy + rand(-1.2, 1.2),
          maxLife: rand(0.12, 0.3), size: rand(0.1, 0.22), grow: -0.3,
          drag: 3, gravity: 1.5,
          color: Math.random() < 0.5 ? "#fff3b0" : "#ffb03a",
        });
      }
      // Sparse, small and short-lived. The stock smoke preset is sized for
      // explosions and buries the whole character in a cloud within a second.
      if (Math.random() < dt * 9) {
        this.game.particles.emit("smoke", px + rand(-0.08, 0.08), py - 0.25, {
          vx: dx * 0.25 + rand(-0.6, 0.6), vy: dy * 0.25 + rand(-0.4, 0.4),
          maxLife: rand(0.35, 0.7), size: rand(0.08, 0.16), grow: rand(0.5, 0.9),
          drag: 2.4, gravity: 0.6, color: "#9aa3b0",
        });
      }
    }
  }

  private locomotion(dt: number) {
    const move = this.wantMoveX;
    const pelvis = this.ragdoll.bone("pelvis").body;
    const torso = this.ragdoll.bone("torso").body;

    const maxSpeed = this.grounded ? TUNE.runSpeed : TUNE.airSpeed;
    // The pack gives real steering authority; drifting helplessly while flying is
    // the difference between a jetpack and a firework.
    const accel = this.grounded ? TUNE.groundAccel : this.jetLit ? TUNE.jetAirAccel : TUNE.airAccel;
    const target = move * maxSpeed;
    const vx = pelvis.linvel().x;

    // Don't fight the player's own recoil launches: only brake back toward `target`
    // when we are actually slower than it, or when input opposes the current motion.
    const overspeed = Math.abs(vx) > maxSpeed && Math.sign(vx) === Math.sign(target || vx);
    const dv = overspeed && move !== 0 ? 0 : target - vx;
    const a = clamp(dv * 10, -accel, accel);
    // Same reasoning as the ride spring: drive against the whole body's mass, split
    // between hips and chest so he leans into the run instead of being dragged by it.
    const total = this.ragdoll.totalMass();
    pelvis.applyImpulse(v(a * total * 0.72 * dt, 0), true);
    torso.applyImpulse(v(a * total * 0.28 * dt, 0), true);

    if (this.grounded && move !== 0) {
      this.walkPhase += dt * (5.5 + Math.abs(vx) * 1.15);
      if (Math.random() < dt * Math.abs(vx) * 0.9) {
        const p = this.pos;
        this.game.particles.dust(p.x, p.y - this.groundDist, 1, 1.2);
      }
    } else if (!this.grounded) {
      this.walkPhase = damp(this.walkPhase % (Math.PI * 2), Math.PI / 2, 6, dt);
    } else {
      this.walkPhase = damp(this.walkPhase % (Math.PI * 2), 0, 8, dt);
    }
  }

  private jump(dt: number) {
    this.coyoteLeft = Math.max(0, this.coyoteLeft - dt);
    this.jumpBuffered = Math.max(0, this.jumpBuffered - dt);
    if (this.takeJump()) this.jumpBuffered = TUNE.jumpBuffer;

    if (this.jumpBuffered > 0 && this.coyoteLeft > 0) {
      this.jumpBuffered = 0;
      this.coyoteLeft = 0;
      // Uniform velocity change across every bone so the whole body leaves together.
      this.ragdoll.applyImpulse(v(0, TUNE.jumpSpeed));
      const p = this.pos;
      this.game.particles.dust(p.x, p.y - Math.min(this.groundDist, 1.2), 6, 2.4);
      sfx.whoosh(0.6);
    }
  }

  /** Drives every joint motor: gun arms, walk cycle, spine. */
  private poseLimbs(dt: number) {
    const r = this.ragdoll;
    const torsoRot = r.boneAngle("torso");

    // --- aiming arms -------------------------------------------------------
    // A bone's distal direction is its local -Y, so pointing it along `aimAngle`
    // means rotating it to aimAngle + PI/2. Wrap into (-PI, PI] for the joint limits.
    const armWorld = wrapPi(this.aimAngle + Math.PI / 2);
    const shoulder = wrapPi(armWorld - torsoRot);
    r.setMotor("armFrontUp", shoulder, TUNE.armStiff, TUNE.armDamp);
    r.setMotor("armFrontLo", -0.06, TUNE.armStiff * 0.8, TUNE.armDamp);
    r.setMotor("armBackUp", wrapPi(shoulder + 0.34 * this.facing), TUNE.armStiff * 0.7, TUNE.armDamp);
    r.setMotor("armBackLo", -0.55, TUNE.armStiff * 0.6, TUNE.armDamp);

    // --- spine + head ------------------------------------------------------
    const lean = clamp(this.wantMoveX * 0.16 + (this.grounded ? 0 : 0.08), -0.3, 0.3);
    r.setMotor("torso", -lean, TUNE.spineStiff, TUNE.spineDamp);
    // Head tracks the aim a little; looks alert without breaking the neck limits.
    r.setMotor("head", clamp(wrapPi(armWorld - torsoRot) * 0.12, -0.5, 0.5), TUNE.neckStiff, TUNE.neckDamp);

    // --- legs --------------------------------------------------------------
    const crouching = this.wantCrouch;
    const vx = r.bone("pelvis").body.linvel().x;
    const moving = this.grounded && this.wantMoveX !== 0;

    let hipF: number, hipB: number, kneeF: number, kneeB: number, footPose: number;
    if (!this.grounded) {
      // Tuck in the air; also makes the silhouette read as "airborne" instantly.
      const t = clamp(Math.abs(vx) / 12, 0, 1);
      hipF = 0.34 + t * 0.2;
      hipB = -0.18;
      kneeF = 0.62;
      kneeB = 0.95;
      footPose = -0.15;
    } else if (crouching) {
      hipF = -0.62;
      hipB = -0.52;
      kneeF = 1.28;
      kneeB = 1.18;
      footPose = 0.2;
    } else if (moving) {
      const dir = Math.sign(vx) || this.facing;
      const amp = clamp(Math.abs(vx) / TUNE.runSpeed, 0.15, 1) * 0.66 * dir;
      hipF = Math.sin(this.walkPhase) * amp;
      hipB = Math.sin(this.walkPhase + Math.PI) * amp;
      kneeF = 0.14 + 0.8 * (0.5 - 0.5 * Math.cos(this.walkPhase));
      kneeB = 0.14 + 0.8 * (0.5 - 0.5 * Math.cos(this.walkPhase + Math.PI));
      footPose = 0.05;
    } else {
      hipF = 0.04;
      hipB = -0.04;
      kneeF = kneeB = 0.13;
      footPose = 0;
    }

    const ls = TUNE.legStiff * (this.grounded ? 1 : 0.6);
    r.setMotor("thighFront", hipF, ls, TUNE.legDamp);
    r.setMotor("thighBack", hipB, ls, TUNE.legDamp);
    r.setMotor("shinFront", kneeF, ls, TUNE.legDamp);
    r.setMotor("shinBack", kneeB, ls, TUNE.legDamp);
    r.setMotor("footFront", footPose, ls * 0.45, TUNE.legDamp * 0.6);
    r.setMotor("footBack", footPose, ls * 0.45, TUNE.legDamp * 0.6);

    void dt;
  }

  // ------------------------------------------------------------------ draw

  draw(ctx: Ctx) {
    const r = this.ragdoll;

    // Grace-period shimmer so it's obvious why nothing is hurting him.
    if (this.graceLeft > 0 && Math.floor(this.graceLeft * 12) % 2 === 0) {
      const c = r.center();
      disc(ctx, c.x, c.y, 1.05, rgba("#5ec8ff", 0.12), rgba("#5ec8ff", 0.4), 0.05);
    }

    this.drawJetpack(ctx);

    drawBiped(ctx, r, {
      ink: "#14171f",
      fill: "#14171f",
      accent: "#ffd23f",
      weight: 1.08,
    });

    if (!r.dead) {
      this.weapon.draw(ctx, this.hand, this.aimAngle + this.weapon.swayAngle(this.game.time), this.game.time);
    }
  }

  /**
   * The pack, drawn on the torso's back and behind the figure so the stickman
   * silhouette stays clean. Twin tanks, twin nozzles, exhaust scaled by throttle.
   */
  private drawJetpack(ctx: Ctx) {
    const torso = this.ragdoll.bones.get("torso");
    if (!torso) return;
    const t = torso.body.translation();
    const back = -0.17 * this.facing;
    const thr = this.jetThrottle;

    at(ctx, t.x, t.y, torso.body.rotation(), () => {
      ctx.translate(back, -0.02);

      // Flames first, so the hardware sits on top of them.
      if (thr > 0.02) {
        const flicker = 0.75 + Math.sin(this.game.time * 55) * 0.25;
        for (const side of [-0.09, 0.09]) {
          const len = (0.34 + thr * 0.62) * flicker;
          const w = 0.07 + thr * 0.05;
          ctx.globalAlpha = Math.min(1, thr * 1.4);
          poly(ctx, [
            [side * this.facing - w, -0.2],
            [side * this.facing + w, -0.2],
            [side * this.facing, -0.2 - len],
          ], "#ffb03a", null);
          poly(ctx, [
            [side * this.facing - w * 0.5, -0.2],
            [side * this.facing + w * 0.5, -0.2],
            [side * this.facing, -0.2 - len * 0.6],
          ], "#fff3b0", null);
          ctx.globalAlpha = 1;
        }
      }

      roundBox(ctx, 0.3, 0.4, 0.08, "#39414f", "#171b23", 0.035);
      // Tank ribs.
      ctx.strokeStyle = rgba("#000000", 0.28);
      ctx.lineWidth = 0.025;
      for (const y of [-0.08, 0.08]) {
        ctx.beginPath();
        ctx.moveTo(-0.15, y);
        ctx.lineTo(0.15, y);
        ctx.stroke();
      }
      // Nozzles.
      for (const side of [-0.09, 0.09]) {
        roundBox2(ctx, side * this.facing, -0.23, 0.1, 0.11, "#2a3040", "#171b23");
      }
      // Fuel light: green with charge, red when dry.
      const f = clamp(this.fuel / TUNE.jetFuelMax, 0, 1);
      disc(ctx, 0, 0.13, 0.035, f > 0.25 ? "#6ddc7a" : "#e8433a", "#171b23", 0.02);
    });
  }

  /**
   * Dotted ballistic preview of the current round. Thrust and lift are ignored, so
   * guided ammo shows where it *starts* going rather than where it ends up.
   */
  drawTrajectory(ctx: Ctx) {
    if (!this.controllable) return;
    const a = this.weapon.ammo;
    const gravity = -26 * (a.id === "rocket" || a.id === "plane" || a.id === "blackhole" ? 0.3 : 1);
    const dir = v(Math.cos(this.aimAngle), Math.sin(this.aimAngle));
    const hand = this.hand;
    let px = hand.x + dir.x * a.muzzle;
    let py = hand.y + dir.y * a.muzzle;
    let vx = dir.x * a.speed;
    let vy = dir.y * a.speed;
    const step = 1 / 45;

    ctx.lineCap = "round";
    for (let i = 0; i < 90; i++) {
      vy += gravity * step;
      px += vx * step;
      py += vy * step;
      if (i % 3 !== 0) continue;
      const fade = 1 - i / 90;
      ctx.fillStyle = rgba(a.tint, fade * 0.55);
      ctx.beginPath();
      ctx.arc(px, py, 0.05 + fade * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  destroy() {
    this.ragdoll.destroy();
  }
}

/** Offset rounded box, since `roundBox` is centred on the current origin. */
function roundBox2(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
  ctx.save();
  ctx.translate(x, y);
  roundBox(ctx, w, h, 0.03, fill, stroke, 0.03);
  ctx.restore();
}

const wrapPi = (a: number) => {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
};
