import { G, ALL, ig } from "../core/physics";
import type { Actor, GameCtx, TargetRef } from "../core/types";
import { BIPED, BIPED_LITE, Ragdoll } from "./ragdoll";
import { drawBiped } from "../render/creatures";
import { angleDelta, clamp, damp, dist, rand, v, type V } from "../core/math";
import { at, rgba, type Ctx } from "../render/draw";
import { sfx } from "../fx/audio";
import { bleed, bloodBurst, bloodPool, severLimbs } from "../fx/gore";
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

/**
 * What a stickman is trying to do about the situation, as opposed to what kind of
 * stickman it is. See `Enemy.tactic`.
 */
type Tactic = "idle" | "search" | "engage" | "cover" | "flank" | "retreat" | "flee";

/**
 * Every living armed stickman in the level.
 *
 * A plain array rather than a spatial structure: an arena holds a dozen or two, and an
 * O(n) sweep over twenty entries once per step is cheaper than building the index that
 * would avoid it. Registration happens in the constructor and removal in `destroy()`,
 * so nothing else has to remember to keep it honest.
 */
const roster: Enemy[] = [];

/**
 * The squad blackboard — one shared contact report, and nothing else.
 *
 * This is the entirety of enemy "coordination", and it is deliberately the smallest
 * thing that fixes the actual problem. The old build had every stickman searching
 * alone, so a player could work along a rooftop dropping sentries one at a time while
 * the next one over stared placidly at the horizon. One shared "he was last over
 * there" turns that into a building that notices.
 *
 * No orders, no roles, no assignment: those would need arbitration, arbitration needs
 * a leader, and a leader is a thing the player can kill to switch the AI off.
 */
const squad = {
  x: 0,
  y: 0,
  /** Game time of the report. -99 means nobody has ever seen anything. */
  at: -99,

  report(p: V, time: number) {
    // Freshest wins outright. Averaging two sightings would put the squad's attention
    // in a place neither of them actually saw the player.
    if (time < this.at) return;
    this.x = p.x;
    this.y = p.y;
    this.at = time;
  },

  contact(): V {
    return v(this.x, this.y);
  },

  /** Called on level load: contacts must not survive into a world that no longer exists. */
  reset() {
    this.at = -99;
    this.x = 0;
    this.y = 0;
  },
};

/** Clears per-level AI state. Called by the game when a world is built. */
export function resetSquad() {
  squad.reset();
  roster.length = 0;
}

/**
 * How far above and below its own feet a stickman will consider a cover spot.
 *
 * Deliberately tight. Cover has to be somewhere it can *walk*, and this AI has no
 * pathfinding — it steers with a single horizontal intent — so anything requiring a
 * climb or a drop is not reachable, however well it blocks the sightline.
 */
/** Fraction of ride height a full crouch removes. Enough to drop the chest below a
 * one-metre parapet, not so much that the stickman is sitting down. */
const CROUCH_DROP = 0.45;

/**
 * Chest height above the feet, standing and crouched, in metres per unit scale.
 * Measured off a live stickman rather than derived — the ragdoll's proportions come out
 * of its joint limits, not out of a table, so the only honest source is the thing itself.
 */
const CHEST_STAND = 1.2;
const CHEST_CROUCH = 0.78;

/** Seconds between sightline tests. See `Enemy.look`. */
const LOOK_INTERVAL = 1 / 20;
/** The fixed step this entity is ticked at, for the throttles above. */
const FIXED_STEP = 1 / 60;
/** How many one-metre steps out the cover fan reaches. Past six it is a different room. */
const COVER_STEPS = 6;

const STEP_UP = 1.4;
const STEP_DOWN = 1.6;

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
    // Armed stickmen space themselves against each other; unarmed ones have no feet
    // worth coordinating, so they stay out of the sweep entirely.
    if (combatSpec) roster.push(this);
  }

  get pos(): V {
    return this.ragdoll.center();
  }

  private onHurt(amount: number, at_: V) {
    // Suppression, not panic, is what a *tactical* stickman does about being shot:
    // panic makes it flail and stop fighting, suppression makes it get behind
    // something and keep fighting worse. Only a serious hit does both.
    this.suppressed = Math.min(1, this.suppressed + clamp(amount / 30, 0.35, 1));
    this.panic = amount > 12 ? 1 : Math.max(this.panic, 0.3);
    bloodBurst(this.game, at_, undefined, amount * 0.7, this.ragdoll.splatColor);
    // Anything past a graze leaves a mark on the floor under it.
    if (amount > 18 && Math.random() < 0.5) bloodPool(this.game, at_, rand(0.3, 0.8));
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
    const r = this.ragdoll;
    // How hard the killing blow was decides whether this is a corpse or a mess.
    const cut = severLimbs(this.game, r, r.lastDamage);
    bloodBurst(this.game, c, undefined, 34 + cut * 16, r.splatColor);
    bloodPool(this.game, c, rand(0.8, 1.5) + cut * 0.35);
    this.game.particles.stars(c.x, c.y, 7);
    this.game.reportDestruction("enemy", c);
    this.game.award(this.spec.points, c);
    sfx.scream();
    // Bodies that came apart are worth looking at for longer.
    this.corpseTimer = cut > 0 ? 22 : 14;
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
    bleed(this.game, r, dt);

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

    // Being on fire is not something a stickman takes calmly.
    if (r.burning > 0.01) this.panic = 1;
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
    // Eased down faster than up: dropping behind a parapet is a flinch, standing back
    // up is a decision.
    this.crouchNow = damp(this.crouchNow, this.crouch, this.crouch > this.crouchNow ? 14 : 9, dt);

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
   * What the stickman is currently trying to do about the situation.
   *
   * The build this replaced had no tactical state at all: acquire, aim, and then do one
   * of exactly three things forever depending on a field set at level-build time. It
   * never took the cover it was standing next to, never noticed the floor leaving, and
   * never reacted to a sedan arriving at 40 m/s. "They just stand there" was a fair
   * description, and this is the fix.
   *
   * `Behavior` still decides *disposition* — where a stickman considers home and how
   * willing it is to leave — but no longer decides everything it will ever do.
   */
  private tactic: Tactic = "idle";
  /** Seconds in the current tactic. Most transitions have a floor so they cannot chatter. */
  private tacticT = 0;

  /** Where the player was last known to be, from this enemy's own eyes or a squadmate's. */
  private lastSeen: V | null = null;
  private lastSeenAt = -99;
  /** Throttle on the sightline test. See `look`. */
  private lookCd = 0;
  /** World X of the cover spot being used or moved toward. */
  private coverX: number | null = null;
  /** Throttle on the cover search — it costs a fan of raycasts. */
  private coverCd = 0;
  /** Throttle on the incoming-projectile scan. */
  private scanCd = 0;
  /** Throttle on the "is the floor still there" probe. */
  private floorCd = 0;
  /**
   * 0..1. While in cover, rises to lean out and shoot, then drops back behind it.
   * This is what makes cover readable rather than just a place the enemy vanishes.
   */
  private peek = 0;
  private peekPhase = rand(0, 6);
  /**
   * 0..1, smoothed. Drops the whole stickman by lowering its ride height.
   *
   * This is what makes cover *work* in a side-on game. With full-height walls an enemy
   * is either already behind one or has no lateral cover it could reach without walking
   * through the thing it wants to hide behind — the geometry admits no third option, so
   * a standing-only AI can never meaningfully "take cover" no matter how good its search
   * is. Ducking below a low wall is the move that exists, and because the crouch is
   * physical — the body really is lower — the player's shots miss it for the same reason
   * its line of sight is broken. Nothing is faked on either side.
   */
  private crouch = 0;
  /** Recently shot at or hurt. Decays; high values push toward cover and spoil aim. */
  private suppressed = 0;
  /** Sidestep in progress: direction and seconds remaining. */
  private dodgeDir: 1 | -1 = 1;
  private dodgeLeft = 0;
  /**
   * Per-enemy standoff jitter, so a squad closing on the player forms a line rather
   * than a stack. Fixed at construction: a jitter that re-rolled would read as dithering.
   */
  private readonly slot = rand(-1, 1);

  /**
   * Sense, decide, act — once per fixed step.
   *
   * The split matters. Every tactic reads the same picture of the world, gathered once,
   * so two enemies looking at the same thing cannot disagree about it; and the
   * expensive queries (cover fans, projectile scans, floor probes) are throttled in one
   * place rather than scattered through the behaviours.
   */
  private updateCombat(dt: number) {
    const c = this.combat!;
    // Default to standing; only `actCover` asks for anything else, so no tactic can
    // leave the stickman stuck in a duck it never chose.
    this.crouch = 0;
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.muzzle = Math.max(0, this.muzzle - dt * 9);
    this.moveIntent = 0;
    this.tacticT += dt;
    this.suppressed = Math.max(0, this.suppressed - dt * 0.5);
    this.strafePhase += dt * 2.2;
    this.peekPhase += dt;

    const target = this.game.target();
    const visible = this.look(c, target);
    this.senseDanger(dt);

    this.choose(c, target, visible);
    this.act(dt, c, target, visible);
  }

  /**
   * Line of sight, and what it tells the squad.
   *
   * A real ray, so a wall genuinely protects the player — and, now that enemies use
   * cover themselves, so a wall genuinely protects them. Anything seen is written to
   * the squad blackboard, which is the whole of the "coordination": nobody is issued
   * orders, they simply all know where the player was last seen. Shooting one sentry
   * no longer leaves the rest of the building facing the wrong way.
   */
  private look(c: CombatSpec, target: TargetRef | null): boolean {
    const r = this.ragdoll;
    if (!target || !target.alive || r.limp) {
      this.hasTarget = false;
      return false;
    }

    // Sightlines are re-tested at 20 Hz, not 60, and phase-offset per enemy so a squad
    // never tests on the same frame. This was measured as the most expensive single
    // thing the AI does — a ray per enemy per step is 900 raycasts a second across a
    // garrison — and a third of a step of staleness in "can I see him" is well under
    // the reaction delay every enemy already waits out before firing.
    this.lookCd -= FIXED_STEP;
    if (this.lookCd > 0) return this.hasTarget;
    this.lookCd = LOOK_INTERVAL + this.slot * 0.008;

    const eye = r.bonePos("torso");
    const d = dist(eye, target.aimPos);
    // The pelvis is excluded or the enemy's own body blocks the query at point blank.
    const seen = d < c.range
      && this.game.physics.lineOfSight(eye, target.aimPos, r.bone("pelvis").body);

    this.hasTarget = seen;
    if (seen) {
      this.lastSeen = v(target.pos.x, target.pos.y);
      this.lastSeenAt = this.game.time;
      squad.report(target.pos, this.game.time);
    } else if (squad.at > this.lastSeenAt) {
      // Somebody else has eyes on. Borrow their contact rather than searching blind.
      this.lastSeen = squad.contact();
      this.lastSeenAt = squad.at;
    }
    return seen;
  }

  /**
   * The two things a stickman ought to notice without being told: something large
   * arriving at speed, and the floor leaving.
   *
   * Both are throttled and phase-offset per enemy, so a dozen of them never run their
   * queries on the same frame.
   */
  private senseDanger(dt: number) {
    const p = this.pos;

    // ---- incoming ------------------------------------------------------------
    this.scanCd -= dt;
    if (this.scanCd <= 0) {
      this.scanCd = 0.2 + this.slot * 0.05;
      const threat = this.incoming(p);
      if (threat !== 0 && this.dodgeLeft <= 0) {
        // Sidestep across the line of travel rather than along it.
        this.dodgeDir = threat > 0 ? -1 : 1;
        this.dodgeLeft = rand(0.45, 0.75);
        this.panic = Math.max(this.panic, 0.5);
      }
    }
    if (this.dodgeLeft > 0) this.dodgeLeft -= dt;

    // ---- the floor -----------------------------------------------------------
    this.floorCd -= dt;
    if (this.floorCd <= 0) {
      this.floorCd = 0.25;
      if (this.grounded && this.standingOnSomethingFalling()) {
        // Not merely alarming — actionable. A stickman on a collapsing roof should be
        // trying to get off it, which is what `flee` does with its feet.
        this.panic = 1;
        if (this.tactic !== "flee") {
          this.tactic = "flee";
          this.tacticT = 0;
        }
      }
    }
  }

  /**
   * @returns the X direction a threatening body is travelling, or 0 for "nothing to
   *          worry about". Only momentum worth respecting counts: a bouncing crate is
   *          not a reason to abandon a firing position, an airborne sedan is.
   */
  private incoming(p: V): number {
    const bodies = this.game.physics.bodiesInRadius(p, 12);
    for (const b of bodies) {
      const vel = b.linvel();
      const sp = Math.hypot(vel.x, vel.y);
      if (sp < 11) continue;
      if (b.mass() * sp < 260) continue;
      // People are not incoming ordnance. Without this the player sprinting past — or
      // worse, a squadmate being flung through the air — reads as a projectile, and the
      // whole squad breaks off to dodge a colleague.
      const col = b.numColliders() > 0 ? b.collider(0) : null;
      const owner = col ? this.game.physics.ownerOf(col.handle) : null;
      if (owner && owner.kind === "ragdoll") continue;
      const t = b.translation();
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      // Closing, not receding.
      const closing = dx * vel.x + dy * vel.y;
      if (closing <= 0) continue;
      // Time to closest approach, and how close that approach actually is.
      const tc = closing / (sp * sp);
      if (tc > 1.4) continue;
      const missX = dx - vel.x * tc;
      const missY = dy - vel.y * tc;
      if (Math.hypot(missX, missY) > 2.6) continue;
      return Math.sign(vel.x) || 1;
    }
    return 0;
  }

  /** True when whatever is underfoot is dynamic and on its way down. */
  private standingOnSomethingFalling(): boolean {
    const pelvis = this.ragdoll.bone("pelvis");
    const t = pelvis.body.translation();
    const hit = this.game.physics.rayCast(
      v(t.x, t.y), v(0, -1), this.rideHeight + 0.6,
      ig(G.SENSOR, G.TERRAIN | G.BLOCK), pelvis.body,
    );
    const body = hit?.body;
    if (!body || !body.isDynamic()) return false;
    const vel = body.linvel();
    return vel.y < -2.4 || Math.abs(body.angvel()) > 2.2;
  }

  /**
   * Picks a tactic.
   *
   * Ordered by how much the situation overrides preference: being on fire beats being
   * hurt, being hurt beats being outgunned, and all of them beat whatever the level
   * author had in mind. Each branch has a dwell time, so a stickman sitting on the
   * boundary between two of them commits to one rather than vibrating between both.
   */
  private choose(c: CombatSpec, target: TargetRef | null, visible: boolean) {
    const health = this.ragdoll.hp / this.ragdoll.maxHp;
    const next = (t: Tactic) => {
      if (this.tactic !== t) {
        this.tactic = t;
        this.tacticT = 0;
      }
    };

    // Panic outranks everything. Nothing tactical happens while on fire.
    if (this.panic > 0.55 || this.ragdoll.burning > 0.01) return next("flee");

    // Badly hurt: break contact. A sentry is allowed to abandon its post to live —
    // holding a roof to the last hit point is not brave, it is target practice.
    if (health < 0.34 && visible && this.tacticT > 0.4) return next("retreat");

    // Cover hides you. That is the point of it, and it means a stickman that has just
    // successfully ducked behind a parapet is, by its own line-of-sight test, no longer
    // in contact — which would demote it to `search`, stand it up to look around, and
    // get it shot. While the contact is fresh, staying hidden counts as still fighting.
    const fresh = this.game.time - this.lastSeenAt < 3;
    if (this.tactic === "cover" && fresh && (this.suppressed > 0.15 || this.tacticT < 2.2)) {
      return next("cover");
    }

    if (visible && target) {
      const d = Math.abs(target.pos.x - this.pos.x);
      // Under fire and not yet behind anything: get behind something.
      //
      // Asymmetric thresholds on purpose. Suppression decays in about two seconds, so a
      // symmetric test had stickmen ducking behind a wall and stepping straight back out
      // before they had finished the animation — which reads as indecision rather than
      // as tactics. Getting into cover takes real fire (0.45); leaving it takes the fire
      // genuinely stopping (0.15) *and* a couple of seconds of it having stopped.
      if (this.tactic === "cover") {
        if (this.suppressed > 0.15 || this.tacticT < 2.2) return next("cover");
      } else if (this.suppressed > 0.45 && this.tacticT > 0.5) {
        return next("cover");
      }
      // A shotgunner at forty metres is not fighting, it is posing. Close the distance.
      if (c.behavior !== "sentry" && d > c.range * 0.85) return next("flank");
      return next("engage");
    }

    // No eyes on. Somebody's contact is worth walking toward; otherwise back to work.
    if (this.lastSeen && this.game.time - this.lastSeenAt < 6) return next("search");
    return next("idle");
  }

  /** Turns the chosen tactic into feet, aim and a trigger. */
  private act(dt: number, c: CombatSpec, target: TargetRef | null, visible: boolean) {
    // A dodge overrides the feet of every tactic — it is a reflex, not a plan.
    if (this.dodgeLeft > 0) {
      this.moveIntent = this.dodgeDir;
      if (visible && target) this.aimAt(target, dt);
      return;
    }

    switch (this.tactic) {
      case "engage": if (target) this.actEngage(dt, c, target); return;
      case "cover": this.actCover(dt, c, target); return;
      case "flank": if (target) this.actFlank(dt, c, target); return;
      case "retreat": if (target) this.actRetreat(dt, c, target); return;
      case "search": this.actSearch(dt, c); return;
      case "flee": this.peek = 0; return;
      default: this.actIdle(dt, c); return;
    }
  }

  /** Hold an angle and shoot, with enough motion not to be a stationary target. */
  private actEngage(dt: number, c: CombatSpec, target: TargetRef) {
    this.sighted += dt;
    this.aimAt(target, dt);

    if (c.behavior === "sentry") {
      this.moveIntent = 0;
    } else {
      const dx = target.pos.x - this.pos.x;
      const d = Math.abs(dx);
      // Each enemy holds a slightly different distance, so a squad forms a line
      // instead of a stack. Separation on top of that, because two stickmen sharing
      // one metre read as one confused stickman.
      const want = c.standoff * (1 + this.slot * 0.28);
      if (d > want + 1.5) this.moveIntent = Math.sign(dx);
      else if (d < want * 0.6) this.moveIntent = -Math.sign(dx);
      else this.moveIntent = Math.sin(this.strafePhase) * 0.55;
      this.moveIntent = clamp(this.moveIntent + this.separation(), -1, 1);
    }
    this.tryShoot(c);
  }

  /**
   * Behind something, leaning out on a rhythm to fire.
   *
   * The peek is the point. An enemy that simply stands behind a wall has removed
   * itself from the game; one that leans out, fires, and ducks back gives the player a
   * window to hit and a reason to reposition, which is a fight rather than a stalemate.
   */
  private actCover(dt: number, c: CombatSpec, target: TargetRef | null) {
    this.coverCd -= dt;
    if ((this.coverX === null || this.coverCd <= 0) && target) {
      this.coverCd = 0.8;
      this.coverX = this.findCover(target);
    }

    if (this.coverX === null) {
      // Nowhere to hide. Engaging beats standing still pretending to be behind
      // something that is not there.
      this.tactic = "engage";
      this.tacticT = 0;
      return;
    }

    const off = this.coverX - this.pos.x;
    if (Math.abs(off) > 0.6) {
      // Moving to cover, not yet in it. Upright: a crouch-walk would be slower to
      // arrive and is the one moment being lower buys nothing.
      this.moveIntent = clamp(off * 0.8, -1, 1);
      this.peek = 0;
      this.crouch = 0;
      return;
    }

    // In position. Lean out on a cycle whose duty ratio falls as the fire thickens.
    const boldness = clamp(1 - this.suppressed * 0.7, 0.25, 1);
    const cycle = (Math.sin(this.peekPhase * 1.5) + 1) / 2;
    this.peek = cycle > 1 - boldness * 0.55 ? 1 : 0;
    // Down between peeks, up to shoot. The rise has to lead the shot slightly or the
    // first round of every peek leaves while the muzzle is still below the parapet.
    this.crouch = this.peek ? 0 : 1;
    this.moveIntent = this.peek && target
      ? clamp(Math.sign(target.pos.x - this.pos.x) * 0.35, -1, 1)
      : 0;

    if (target && this.peek > 0) {
      this.aimAt(target, dt);
      // Only shoot on the way out, and only if the lean actually bought a sightline.
      if (this.hasTarget) this.tryShoot(c);
    }
  }

  /**
   * Cover search: a fan of standable spots, nearest first, kept if standing there
   * would break the player's line to us.
   *
   * Raycasts rather than authored cover markers, so this works identically in a
   * hand-built arena, a tileset village, and a pile of rubble that was a wall ten
   * seconds ago — which is the only kind of cover this game reliably has.
   */
  private findCover(target: TargetRef): number | null {
    // Nothing here a moment ago means nothing here now. A *successful* search is cheap
    // — it stops at the first hit — but a failed one walks the entire fan, and an enemy
    // standing in the open with no cover anywhere is precisely the case that fails, so
    // without this the most expensive path is also the most frequently taken one.
    if (this.game.time < this.noCoverUntil) return null;
    const phys = this.game.physics;
    const body = this.ragdoll.bone("pelvis").body;
    const here = this.pos;
    const away = (Math.sign(here.x - target.pos.x) || 1) as 1 | -1;
    let best: number | null = null;
    let bestScore = -Infinity;

    // i = 0 is "stay exactly where you are and get lower", and it has to be in the set.
    // A stickman standing in the open behind a parapet is already in the right *place*
    // and wrong only about its height; a search that starts a metre away will march it
    // sideways to an equivalent spot and call that taking cover.
    for (let i = 0; i <= COVER_STEPS; i++) {
      // Away from the player first — that is where cover usually is — but both sides
      // are considered, because the nearest wall is sometimes one you are already past.
      for (const side of (i === 0 ? [away] : [away, -away as 1 | -1])) {
        const x = here.x + side * i * 1.1;
        // Probe a short window around the enemy's own footing rather than a deep one.
        //
        // A deep probe finds the floor of the building for a stickman standing on its
        // roof, and calls it cover. It is cover — it is also a five metre drop, and an
        // AI that walks off a tower to get behind something has not made a decision,
        // it has made a mistake. Only spots on roughly this ledge count.
        const from = v(x, here.y + STEP_UP);
        const drop = phys.groundRay(from, STEP_UP + STEP_DOWN, body);
        // A hit at zero distance means the probe *started* inside something — the
        // candidate is not a place to stand, it is the inside of the wall. Left in, it
        // is the best cover the search will ever find: perfectly sightline-proof and
        // completely unreachable, so the stickman picks it, walks into the bricks, and
        // stands there having arrived at nothing.
        if (drop === null || drop <= 0.08) continue;
        const standY = from.y - drop;
        if (Math.abs(standY - here.y) > STEP_DOWN) continue;

        // Reachable in a straight line? This AI steers with one horizontal intent and
        // has no pathfinding, so a spot it would have to walk around something to reach
        // is a spot it will walk *into* something trying to reach. The ray starts clear
        // of the stickman's own body, which the query would otherwise begin inside.
        const step = v(here.x + side * 0.6, here.y);
        if (!phys.lineOfSight(step, v(x, standY + 0.5), body)) continue;

        // Evaluated at the height this stickman will actually *be* at once it gets
        // there — crouched, if crouching is what makes the spot work. Testing only the
        // standing height was why a perfectly good parapet never registered as cover:
        // it does not hide a man standing behind it, which is exactly why he ducks.
        const stand = v(x, standY + CHEST_STAND * this.spec.scale);
        const duck = v(x, standY + CHEST_CROUCH * this.spec.scale);
        const hiddenStanding = !phys.lineOfSight(stand, target.aimPos, body);
        const hiddenCrouched = hiddenStanding || !phys.lineOfSight(duck, target.aimPos, body);
        if (!hiddenCrouched) continue;
        // Covered. Prefer near, prefer not crossing the player's fire, and prefer a
        // spot that works without having to duck — standing cover lets you shoot back.
        const score = -i - (side === away ? 0 : 2.5) + (hiddenStanding ? 0.75 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = x;
        }
      }
      if (best !== null && bestScore > -3) break;
    }
    if (best === null) this.noCoverUntil = this.game.time + rand(2.2, 3.2);
    return best;
  }

  /** Game time before which the cover search is known to be pointless. See `findCover`. */
  private noCoverUntil = 0;

  /** Close the distance rather than trading at a range the weapon cannot hold. */
  private actFlank(dt: number, c: CombatSpec, target: TargetRef) {
    this.aimAt(target, dt);
    const dx = target.pos.x - this.pos.x;
    this.moveIntent = clamp(Math.sign(dx) * 0.9 + this.separation(), -1, 1);
    // Fire on the move, worse for it — the accuracy cost is what makes closing a
    // decision rather than a free action.
    if (this.hasTarget) this.tryShoot(c, 1.7);
  }

  /** Break contact toward cover, still shooting, but not eager about it. */
  private actRetreat(dt: number, c: CombatSpec, target: TargetRef) {
    this.aimAt(target, dt);
    this.coverCd -= dt;
    if (this.coverX === null || this.coverCd <= 0) {
      this.coverCd = 1;
      this.coverX = this.findCover(target);
    }
    this.moveIntent = this.coverX !== null
      ? clamp((this.coverX - this.pos.x) * 0.8, -1, 1)
      : -Math.sign(target.pos.x - this.pos.x);
    if (this.hasTarget && Math.random() < 0.5) this.tryShoot(c, 1.5);
  }

  /** Walk toward the last contact, weapon up. */
  private actSearch(dt: number, c: CombatSpec) {
    this.sighted = Math.max(0, this.sighted - dt * 1.5);
    const goal = this.lastSeen;
    if (!goal) {
      this.actIdle(dt, c);
      return;
    }
    const dx = goal.x - this.pos.x;
    if (Math.abs(dx) < 1.5) {
      // Arrived and found nothing. Sweep, then give up and go back to the post.
      this.sweep(dt, 0.5);
      if (this.tacticT > 3) this.lastSeen = null;
      return;
    }
    // Sentries look but do not leave; everyone else investigates.
    this.moveIntent = c.behavior === "sentry" ? 0 : Math.sign(dx) * 0.7;
    const face = dx < 0 ? Math.PI : 0;
    this.aimAngle += angleDelta(this.aimAngle, face) * Math.min(1, dt * 3);
  }

  /** Nothing happening: patrol, or sweep the arc. */
  private actIdle(dt: number, c: CombatSpec) {
    this.sighted = Math.max(0, this.sighted - dt * 1.5);
    this.peek = 0;
    if (c.behavior === "sentry") {
      this.sweep(dt, 0.35);
      return;
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

  /** Slow muzzle sweep, so a stickman with nothing to do does not look switched off. */
  private sweep(dt: number, amount: number) {
    const base = (this.patrolDir < 0 ? Math.PI : 0) + Math.sin(this.strafePhase * 0.35) * amount;
    this.aimAngle += angleDelta(this.aimAngle, base) * Math.min(1, dt * 2);
  }

  /**
   * Ease onto the target rather than snapping: it reads as tracking, and it gives the
   * player a moment to break contact after stepping into the open.
   *
   * Measured from the muzzle, not the eye — the laser is drawn from the hand and the
   * bullet leaves from the hand, so an angle taken anywhere else makes the laser a lie.
   */
  private aimAt(target: TargetRef, dt: number) {
    const hand = this.hand;
    const want = Math.atan2(target.aimPos.y - hand.y, target.aimPos.x - hand.x);
    // Being shot at costs you your aim. This is what makes suppressing fire a real
    // mechanic rather than a cosmetic one.
    const rate = 7 * clamp(1 - this.suppressed * 0.55, 0.35, 1);
    this.aimAngle += angleDelta(this.aimAngle, want) * Math.min(1, dt * rate);
  }

  /** Trigger discipline, shared by every tactic that shoots. */
  private tryShoot(c: CombatSpec, spreadMul = 1) {
    if (!this.aiming || this.sighted <= c.reaction || this.fireCd > 0 || !this.grounded) return;
    this.shoot(c, spreadMul);
  }

  /**
   * Keep out of each other's way.
   *
   * Without this a squad converging on one player becomes a single column of
   * overlapping stickmen shoving each other off a ledge, which looks like a bug and is
   * one. O(roster) over a dozen entries, once per step — cheaper than any query.
   */
  private separation(): number {
    let push = 0;
    for (const other of roster) {
      if (other === this || other.dead || other.ragdoll.dead) continue;
      const dx = this.pos.x - other.pos.x;
      const ad = Math.abs(dx);
      if (ad > 1.7) continue;
      push += (Math.sign(dx) || 1) * (1 - ad / 1.7) * 0.6;
    }
    return clamp(push, -0.8, 0.8);
  }

  /**
   * @param spreadMul Accuracy penalty for the tactic doing the shooting. Firing while
   *                  closing is worse than firing from a held position — that cost is
   *                  what makes closing a decision rather than a free action.
   */
  private shoot(c: CombatSpec, spreadMul = 1) {
    // Jitter the cadence so a squad never falls into an audible drum machine.
    this.fireCd = c.interval * rand(0.85, 1.2);
    this.muzzle = 1;

    const hand = this.hand;
    const from = v(hand.x + Math.cos(this.aimAngle) * 0.6 * this.spec.scale,
                   hand.y + Math.sin(this.aimAngle) * 0.6 * this.spec.scale);
    // Suppression spoils aim on top of whatever the tactic already costs.
    const spread = c.spread * spreadMul * (1 + this.suppressed * 0.8);
    for (let i = 0; i < c.pellets; i++) {
      const a = this.aimAngle + rand(-spread, spread);
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

  /** Eased toward `crouch` so ducking is a movement rather than a teleport. */
  private crouchNow = 0;

  /** Ride height for this frame, in metres. A crouch is literally a lower hover. */
  private get rideHeight() {
    return RIDE * this.spec.scale * (1 - this.crouchNow * CROUCH_DROP);
  }

  private probeGround() {
    const pelvis = this.ragdoll.bone("pelvis");
    const p = pelvis.body.translation();
    const ride = this.rideHeight;
    const hit = this.game.physics.groundRay(v(p.x, p.y), ride + 0.3, pelvis.body);
    this.groundDist = hit ?? Infinity;
    this.grounded = hit !== null;
  }

  private balance(dt: number) {
    const pelvis = this.ragdoll.bone("pelvis").body;
    const total = this.ragdoll.totalMass();
    const ride = this.rideHeight;
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
    // Knees fold as the ride height drops, so a crouch reads as a crouch rather than as
    // a stickman sinking into the floor.
    const k = this.crouchNow;
    if (lite) {
      r.setMotor("legBack", -0.06 - k * 0.5, legStiff, 28);
      r.setMotor("legFront", 0.06 + k * 0.5, legStiff, 28);
    } else {
      r.setMotor("thighBack", -0.05 - k * 0.55, legStiff, 28);
      r.setMotor("thighFront", 0.05 + k * 0.55, legStiff, 28);
      r.setMotor("shinBack", 0.12 + k * 0.9, legStiff, 28);
      r.setMotor("shinFront", 0.12 + k * 0.9, legStiff, 28);
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
    const i = roster.indexOf(this);
    if (i >= 0) roster.splice(i, 1);
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
