import type { PhysOwner, RAPIER } from "../core/physics";
import { clamp, dist, norm, v, type V } from "../core/math";
import { at, type Ctx } from "../render/draw";
import type { Particles } from "./particles";
import { sfx } from "./audio";

/**
 * The tow cable: a harpoon on a winch.
 *
 * The Harpoon Gun fires a barbed head on a line. The head buries itself in the first
 * thing it touches and the winch hauls that thing back toward the shooter — and the
 * whole round is what happens when the winch pulls against real mass:
 *
 * - a crate, a chair, a stickman: light enough that the winch wins, and it comes at
 *   you head-first, flailing;
 * - a loaded pillar, a car, a slab of concrete: too heavy to reel, so the *reaction*
 *   wins instead and you are dragged off your feet into the building;
 * - a wall: nothing to reel at all, so it is a pure grappling zip — the one way in the
 *   game to cross a gap on The Drift under your own power.
 *
 * That split is the verb. Nothing else in the arsenal *pulls* — the black hole drags
 * everything radially for three seconds and lets go; this is a directed line onto one
 * body that you can point.
 *
 * ## Why a force loop and not a Rapier joint
 *
 * Rapier joint creation is not even wrapped in `core/physics` — everything jointed in
 * this game is a ragdoll, built once. A tow line is short-lived and attached to a body
 * that may be destroyed mid-reel, so it follows the same rule the buoyancy sim spells
 * out: **nothing holds a Rapier handle across frames.** Each step it re-resolves the
 * anchor body through `PhysOwner.eachBody`, and an owner that yields no bodies (reeled
 * a stickman into a wall hard enough to gib him) is simply the signal to cut the line.
 *
 * ## Why the pull is a capped acceleration
 *
 * `REEL_FORCE / mass`, clamped to `REEL_ACCEL_CAP`. A fixed *force* alone would fling a
 * 5 kg forearm at a hundred metres a second while a concrete block sat still — the cap
 * is what keeps a light target readable as "reeled in" rather than "railgunned", and it
 * is applied per body so a hooked ragdoll comes in as one piece instead of being pulled
 * apart at the shoulder.
 *
 * ## Why `resist` is measured, not assumed
 *
 * How hard the line hauls the *shooter* the other way is `resist`, and the honest number
 * for it is not `REEL_FORCE / mass` — a one-metre block wedged under four courses of
 * wall has a small mass and moves nowhere, and the round has to notice that and drag you
 * into the wall instead. So `resist` is the larger of the nominal figure and a *stall*
 * reading: how far short of the target closing speed the gap is actually shrinking. A
 * body that will not come, for whatever reason, pulls you off your feet.
 */

/** Newtons the winch pulls with. Divided by the target's mass to get an acceleration. */
const REEL_FORCE = 45000;
/** Acceleration ceiling, m/s². A light target is reeled hard, not launched to orbit. */
const REEL_ACCEL_CAP = 42;
/** Closing-speed ceiling on a reeled body, m/s, so a chair does not arrive as a bullet. */
const REEL_MAX_SPEED = 18;
/** Closing speed the winch is trying to achieve on the gap, m/s — the stall yardstick. */
const REEL_TARGET_CLOSE = 8;
/** Metres between anchor and hand at which the reel decides it is done. */
const ARRIVED_DIST = 1.2;
/** Constant tug on the shooter toward the anchor, m/s², even when the target reels freely. */
const REACT_BASE = 4;
/** Extra tug on the shooter, m/s², scaled by how immovable the target turned out to be. */
const REACT_HEAVY = 34;
/** `resist` above this, sustained, means the target won't come — so the shooter goes. */
const YANK_RESIST = 0.5;
/** Seconds of that before the shooter is actually pulled off their feet. */
const YANK_DELAY = 0.12;
/** Past this stretch the cable snaps — a runaway target does not tow the whole level. */
const SNAP_STRETCH = 30;

/** The projectile, seen by the sim while it is still in the air. */
interface FlyingHead {
  readonly pos: V;
  readonly dead: boolean;
}

interface Line {
  spec: TetherSpec;
  /** Set while the head is in flight; cleared the instant it bites. */
  flying: FlyingHead | null;
  /** The body the head is buried in. Null once it is stuck in the terrain. */
  owner: PhysOwner | null;
  /** Index into the owner's body list, re-resolved every step — never a handle. */
  bi: number;
  /** Local anchor on that body, metres. */
  lx: number;
  ly: number;
  /** World anchor, for a terrain hit that has no body. */
  wx: number;
  wy: number;
  /** Cached world anchor so `draw` never touches Rapier. */
  ax: number;
  ay: number;
  /** Gap to the hand last step, for the stall reading. -1 until first measured. */
  lastGap: number;
  /** Seconds `resist` has been over the yank threshold. */
  yankFor: number;
  /** Seconds of winch left once hooked. */
  reel: number;
  dead: boolean;
}

export interface TetherSpec {
  /** Seconds the winch runs for after the head bites. */
  duration: number;
  /** Multiplier on how hard the line hauls the shooter around. */
  reactScale: number;
}

export interface TowHost {
  readonly particles: Particles;
  /** The shooter's hand in world space, or null when nobody is holding the gun. */
  towOrigin(): V | null;
  /**
   * The cable's other end pulling on the shooter — a velocity change (m/s). `hard` is
   * set once the target has proven it will not come, and means "take them off their
   * feet": the winch is now reeling the shooter in, not the target.
   */
  towReact(dv: V, hard: boolean): void;
}

export class TowSim {
  private readonly lines: Line[] = [];
  /** One reused body list, so a reel a frame allocates nothing. */
  private readonly scratch: RAPIER.RigidBody[] = [];

  constructor(private readonly host: TowHost) {}

  /** Cables currently live. Debug overlay only. */
  get count() {
    return this.lines.length;
  }

  clear() {
    this.lines.length = 0;
  }

  /** Registers a harpoon that has just left the barrel, so the line draws in flight. */
  launch(head: FlyingHead, spec: TetherSpec) {
    this.lines.push({
      spec,
      flying: head,
      owner: null,
      bi: 0, lx: 0, ly: 0, wx: 0, wy: 0,
      ax: head.pos.x, ay: head.pos.y,
      lastGap: -1,
      yankFor: 0,
      reel: spec.duration,
      dead: false,
    });
  }

  /**
   * The head has bitten. `source` is the projectile itself, matched by identity against
   * the flying line it belongs to; `owner` is what it hit (null or `terrain` = stuck in
   * the world). Called from `RigidProjectile.onImpact`, before the projectile dies.
   */
  hook(source: FlyingHead, owner: PhysOwner | null, point: V) {
    const ln = this.lines.find((l) => l.flying === source && !l.dead);
    if (!ln) return;
    ln.flying = null;
    ln.reel = ln.spec.duration;
    ln.lastGap = -1;
    ln.yankFor = 0;
    ln.ax = point.x;
    ln.ay = point.y;

    const bodies = owner && owner.kind !== "terrain" ? this.collect(owner) : [];
    if (owner && bodies.length) {
      // Free an anchored wall block so the winch has something to pull on.
      owner.disturb?.();
      let bi = 0;
      let best = Infinity;
      for (let i = 0; i < bodies.length; i++) {
        const t = bodies[i].translation();
        const d = (t.x - point.x) ** 2 + (t.y - point.y) ** 2;
        if (d < best) { best = d; bi = i; }
      }
      const b = bodies[bi];
      const t = b.translation();
      const rot = b.rotation();
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const dx = point.x - t.x;
      const dy = point.y - t.y;
      ln.owner = owner;
      ln.bi = bi;
      ln.lx = dx * cos + dy * sin;
      ln.ly = -dx * sin + dy * cos;
    } else {
      ln.owner = null;
      ln.wx = point.x;
      ln.wy = point.y;
    }

    this.host.particles.sparks(point.x, point.y, 9, 6, "#ffd23f");
    sfx.thud(0.6, "metal");
  }

  update(dt: number) {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const ln = this.lines[i];

      // Still in the air: the projectile owns its own motion, we just trail a rope.
      if (ln.flying) {
        if (ln.flying.dead) { this.lines.splice(i, 1); continue; }
        ln.ax = ln.flying.pos.x;
        ln.ay = ln.flying.pos.y;
        continue;
      }

      const origin = this.host.towOrigin();
      if (!origin) { this.drop(i, ln); continue; }

      // Re-resolve the anchor from scratch every step.
      let dynamicBody: RAPIER.RigidBody | null = null;
      let bodies: RAPIER.RigidBody[] = [];
      if (ln.owner) {
        bodies = this.collect(ln.owner);
        if (!bodies.length) { this.drop(i, ln); continue; }
        const b = bodies[Math.min(ln.bi, bodies.length - 1)];
        const t = b.translation();
        const rot = b.rotation();
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        ln.ax = t.x + ln.lx * cos - ln.ly * sin;
        ln.ay = t.y + ln.lx * sin + ln.ly * cos;
        if (b.isDynamic()) dynamicBody = b;
      } else {
        ln.ax = ln.wx;
        ln.ay = ln.wy;
      }

      const d = dist(v(ln.ax, ln.ay), origin);
      if (d > SNAP_STRETCH) {
        this.host.particles.sparks(ln.ax, ln.ay, 6, 8, "#c9d2de");
        this.drop(i, ln);
        continue;
      }

      // Unit vector from the anchor toward the hand.
      const pull = norm(v(origin.x - ln.ax, origin.y - ln.ay));

      // Reel the hooked body (and the rest of its owner with it, at the same
      // acceleration, so a ragdoll arrives whole).
      let nominalResist = 1;
      if (dynamicBody) {
        const accel = Math.min(REEL_FORCE / Math.max(dynamicBody.mass(), 1), REEL_ACCEL_CAP);
        nominalResist = 1 - accel / REEL_ACCEL_CAP;
        ln.owner?.disturb?.();
        for (const b of bodies) {
          const m = b.mass();
          b.applyImpulse({ x: pull.x * accel * m * dt, y: pull.y * accel * m * dt }, true);
          const lv = b.linvel();
          const closing = lv.x * pull.x + lv.y * pull.y;
          if (closing > REEL_MAX_SPEED) {
            const over = closing - REEL_MAX_SPEED;
            b.applyImpulse({ x: -pull.x * over * m, y: -pull.y * over * m }, true);
          }
        }
      }

      // Stall: how far short of the target the gap is actually closing. A wedged block
      // reads as immovable here even though its mass is small.
      let stallResist = 1;
      if (ln.lastGap >= 0) {
        const closingGap = (ln.lastGap - d) / dt;
        stallResist = clamp(1 - closingGap / REEL_TARGET_CLOSE, 0, 1);
      }
      ln.lastGap = d;
      const resist = Math.max(nominalResist, stallResist);

      // The cable's other end. A light target barely tugs you; a wall, a laden pillar or
      // anything else that won't come hauls you in — that is the whole round.
      const hard = resist > YANK_RESIST;
      ln.yankFor = hard ? ln.yankFor + dt : 0;
      const reactA = (REACT_BASE + REACT_HEAVY * resist) * ln.spec.reactScale;
      this.host.towReact(
        { x: -pull.x * reactA * dt, y: -pull.y * reactA * dt },
        ln.yankFor > YANK_DELAY,
      );

      if (d < ARRIVED_DIST) { this.drop(i, ln); continue; }
      ln.reel -= dt;
      if (ln.reel <= 0) { this.drop(i, ln); continue; }
    }
  }

  draw(ctx: Ctx) {
    if (!this.lines.length) return;
    const origin = this.host.towOrigin();
    if (!origin) return;

    for (const ln of this.lines) {
      const ex = ln.ax;
      const ey = ln.ay;
      const mx = (origin.x + ex) / 2;
      const my = (origin.y + ey) / 2;
      // A slack rope in flight, drawing taut as it reels in.
      const len = Math.hypot(ex - origin.x, ey - origin.y);
      const sag = ln.flying ? clamp(len * 0.05, 0, 0.7) : Math.max(0, 0.35 - ln.reel * 0.4);

      ctx.save();
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(mx, my - sag, ex, ey);
      // A dark casing with a lit core so the line reads over both the pale sky and the
      // dark subsoil without being a heavy black bar across the frame.
      ctx.strokeStyle = "#12151b";
      ctx.lineWidth = 0.11;
      ctx.stroke();
      ctx.strokeStyle = "#5b6672";
      ctx.lineWidth = 0.045;
      ctx.stroke();

      if (!ln.flying) {
        // The buried head, pointing back down the line.
        const a = Math.atan2(ey - my, ex - mx);
        at(ctx, ex, ey, a, () => {
          ctx.fillStyle = "#8b929e";
          ctx.strokeStyle = "#191d24";
          ctx.lineWidth = 0.03;
          ctx.beginPath();
          ctx.moveTo(0.2, 0);
          ctx.lineTo(-0.16, 0.14);
          ctx.lineTo(-0.05, 0);
          ctx.lineTo(-0.16, -0.14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ internals

  private drop(i: number, ln: Line) {
    if (!ln.dead) {
      ln.dead = true;
      this.host.particles.sparks(ln.ax, ln.ay, 5, 4, "#9aa3b0");
    }
    this.lines.splice(i, 1);
  }

  /** The owner's live bodies, into shared scratch. Handles are never kept past the call. */
  private collect(owner: PhysOwner): RAPIER.RigidBody[] {
    this.scratch.length = 0;
    owner.eachBody?.((b) => this.scratch.push(b));
    return this.scratch;
  }
}
