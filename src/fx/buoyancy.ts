import type { PhysOwner } from "../core/physics";
import type { RAPIER } from "../core/physics";
import { clamp, rand, type V } from "../core/math";
import type { Ctx } from "../render/draw";
import type { Camera } from "../core/camera";
import type { Particles } from "./particles";
import {
  BALLOON_FPS, BALLOON_FRAMES, POP_TIME, drawBalloon, drawBalloonPop, drawString,
  partyColor, popFrameAt,
} from "../render/balloonart";
import { sfx } from "./audio";

/**
 * Buoyancy: things with balloons tied to them.
 *
 * The Party Supplies round staples a fistful of balloons to whatever it hits and the
 * thing goes *up*. That is the entire system, and almost all of the work here is in
 * making sure it goes up at a rate that is funny rather than a rate that is a bug.
 *
 * ## Why lift is a mass, not a force
 *
 * `LIFT_KG` is what one balloon can carry, and the net gravity scale for a target is
 * `1 - (balloons * LIFT_KG) / mass`. Expressing lift as newtons instead would have been
 * the obvious thing and it is wrong twice over.
 *
 * It is wrong *physically*: real buoyancy is the weight of displaced air, so it scales
 * with gravity exactly as the object's own weight does. The ratio between them — which
 * is the only thing that decides whether something floats — is identical everywhere.
 *
 * And it is wrong *for this game*, for the same reason `TUNE.jetNetAccel` exists: a
 * fixed force tuned on Earth is a different weapon on The Drift, where gravity is -9.
 * A mass ratio makes four balloons lift the same crate in both worlds, which is what a
 * player expects from a round they have already learned somewhere else.
 *
 * ## The curve this produces, which is the whole design
 *
 * At `LIFT_KG = 220`, one round of four balloons carries 880 kg:
 *
 * - a stickman (~70 kg) is launched, hard, and clamped by `MIN_SCALE` so he does not
 *   leave the level;
 * - a 1 m brick block (700 kg) rises properly, at about a quarter of a fall;
 * - a concrete block (900 kg) *hangs*, a hair the wrong side of floating;
 * - metal (1400 kg) barely notices.
 *
 * So heavy things need a second round, and because balloons accumulate on a target that
 * is already carrying some, the escalation is visible on screen — you can see how close
 * a wall is to going up by counting the balloons on it. Inflating a building section by
 * section is the loop, and it only exists because the light rounds are not enough.
 *
 * ## What pops them
 *
 * Three things, all of which the player can cause on purpose: time, fire, and blast.
 * Fire is the one worth keeping — `owner.burning` is a plain field the flame sim
 * writes, so a flamethrower aimed at a floating tower brings it down and cost three
 * lines to arrange.
 */

/** What one balloon can carry, in kilograms. See the header. */
const LIFT_KG = 220;

/**
 * Ascent cap, m/s.
 *
 * Tuned against the *camera*, not against taste. The frame sees about 10 m above the
 * player, the first balloon pops at about 3 s, and the whole joke is watching a thing go
 * up and then come back down — so the apex has to land under 10 m or the payoff happens
 * somewhere the player cannot see. It started at 7 m/s, which cleared the top of the
 * screen in a second and a half and left four seconds of empty sky before the wreckage
 * came back. 2.8 m/s peaks at about 8 m.
 *
 * It also happens to be the right *character*. A balloon that leaps reads as a launch;
 * a balloon that drifts reads as a balloon, and it gives the player time to decide
 * whether to shoot it down.
 */
const MAX_RISE = 2.8;

/**
 * Floor on the net gravity scale. -0.85 means the most over-lifted object in the game
 * rises at 85% of a fall, so even a featherweight target reads as *drifting up* rather
 * than as being fired out of a second gun.
 */
const MIN_SCALE = -0.85;

/** Lateral drift, m/s^2. Floating debris that travels in a straight line looks nailed on. */
const SWAY = 1.15;

/** Seconds between pops once something is properly alight. */
const BURN_POP_INTERVAL = 0.22;

interface Tether {
  /** Index into the owner's body list, resolved fresh every step — never a handle. */
  bi: number;
  /** Local anchor on that body, in metres. */
  lx: number;
  ly: number;
  color: number;
  len: number;
  size: number;
  sag: number;
  phase: number;
  /** Cluster age at which this one goes on its own. */
  popAt: number;
  /** -1 while alive, otherwise seconds since it burst. */
  popped: number;
  /** Trailing angle, smoothed — a balloon on a moving object leans back. */
  lean: number;
  /** World anchor, cached by `update` so `draw` never touches Rapier. */
  ax: number;
  ay: number;
}

interface Cluster {
  owner: PhysOwner;
  tethers: Tether[];
  live: number;
  age: number;
  /** Gravity scale to hand back on release. Captured from the first body at attach. */
  restore: number;
  burnTimer: number;
  seed: number;
}

export interface BuoyancyHost {
  readonly particles: Particles;
}

export class BalloonSim {
  private readonly clusters: Cluster[] = [];
  /** One reused body list, so a hundred clusters a frame allocate nothing. */
  private readonly scratch: RAPIER.RigidBody[] = [];

  constructor(private readonly host: BuoyancyHost) {}

  /** Balloons currently in the air. Debug overlay and nothing else. */
  get count() {
    let n = 0;
    for (const c of this.clusters) n += c.live;
    return n;
  }

  clear() {
    // Deliberately does not restore anything: this is called when the world is being
    // thrown away, and the bodies go with it.
    this.clusters.length = 0;
  }

  /**
   * Ties `n` balloons to `owner`, or adds them to the bunch already there.
   *
   * Anchored blocks are disturbed first. A static body ignores gravity scale entirely,
   * so without this the round would decorate a wall and do nothing — and freeing the
   * wall is the correct behaviour anyway, since something just hit it.
   */
  /** World position of a tether's knot. The one place body-space is resolved. */
  private anchor(t: Tether, b: RAPIER.RigidBody) {
    const p = b.translation();
    const rot = b.rotation();
    const cos = Math.cos(rot), sin = Math.sin(rot);
    t.ax = p.x + t.lx * cos - t.ly * sin;
    t.ay = p.y + t.lx * sin + t.ly * cos;
  }

  attach(owner: PhysOwner, n: number, duration: number) {
    if (owner.dead) return;
    owner.disturb?.();

    const bodies = this.collect(owner);
    if (!bodies.length) return;

    let c = this.clusters.find((k) => k.owner === owner);
    if (!c) {
      c = {
        owner,
        tethers: [],
        live: 0,
        age: 0,
        restore: bodies[0].gravityScale(),
        burnTimer: BURN_POP_INTERVAL,
        seed: Math.floor(rand(0, 5)),
      };
      this.clusters.push(c);
    }

    const size = owner.fireSize ?? 0.5;
    for (let i = 0; i < n; i++) {
      const bi = (c.tethers.length + i) % bodies.length;
      const t: Tether = {
        bi,
        lx: rand(-1, 1) * size * 0.55,
        ly: rand(-0.2, 0.6) * size,
        color: (c.seed + c.tethers.length) % 5,
        len: rand(0.62, 1.05),
        size: rand(0.82, 1.16),
        sag: rand(-0.14, 0.14),
        phase: rand(0, Math.PI * 2),
        // Independent lifetimes, spread over the back half, so the bunch thins out
        // gradually instead of the whole thing vanishing on one frame. The first pop
        // is also what ends the climb: lift drops a quarter, the target slows, hangs,
        // and starts back down. That arc is the round.
        popAt: c.age + duration * rand(0.45, 1),
        popped: -1,
        lean: 0,
        ax: 0,
        ay: 0,
      };
      // Resolved now rather than on the first `update`. Left at the origin, a tether is
      // a balloon at world (0,0) for one step — invisible, but `popNear` measures
      // against it, so a blast anywhere near the map's origin would pop a bunch that is
      // actually forty metres away.
      this.anchor(t, bodies[bi]);
      c.tethers.push(t);
      c.live++;
    }
  }

  /**
   * Pops every balloon within `radius` of a point. Called by explosions and by any
   * impact hard enough to matter, which is what lets the player choose when a floating
   * building comes down.
   */
  popNear(at: V, radius: number) {
    const r2 = radius * radius;
    for (const c of this.clusters) {
      for (const t of c.tethers) {
        if (t.popped >= 0) continue;
        const bx = t.ax + Math.sin(t.lean) * t.len;
        const by = t.ay + Math.cos(t.lean) * t.len;
        const dx = bx - at.x, dy = by - at.y;
        if (dx * dx + dy * dy <= r2) this.pop(c, t);
      }
    }
  }

  update(dt: number, time: number) {
    for (let i = this.clusters.length - 1; i >= 0; i--) {
      const c = this.clusters[i];
      c.age += dt;

      const bodies = this.collect(c.owner);
      if (!bodies.length) {
        // The owner has been taken apart; there is nothing left to hand gravity back to.
        this.clusters.splice(i, 1);
        continue;
      }

      // Fire eats latex. `burning` is a plain field the flame sim writes, so this is a
      // read rather than a subscription.
      if ((c.owner.burning ?? 0) > 0.04 && c.live > 0) {
        c.burnTimer -= dt;
        if (c.burnTimer <= 0) {
          c.burnTimer = BURN_POP_INTERVAL;
          const alive = c.tethers.find((t) => t.popped < 0);
          if (alive) this.pop(c, alive);
        }
      }

      let mass = 0;
      for (const b of bodies) mass += b.mass();
      const scale = mass > 0
        ? clamp(1 - (c.live * LIFT_KG) / mass, MIN_SCALE, c.restore)
        : c.restore;

      for (const b of bodies) {
        b.setGravityScale(scale, true);

        const lv = b.linvel();
        // A hard clamp, and it has to be hard.
        //
        // This started as a proportional shave, on the theory that setting velocity on
        // a jointed body every frame would make a ragdoll buzz. It does not, because
        // every bone in a cluster is clamped to the *same* number on the same step, so
        // there is no differential for the joints to fight. What the soft version did
        // do was leak: a damper against a constant acceleration settles wherever the
        // two balance, which measured 3.3 m/s against a cap of 2.8 and put the apex a
        // third higher than the frame budget allows.
        if (lv.y > MAX_RISE) b.setLinvel({ x: lv.x, y: MAX_RISE }, true);
        if (c.live > 0) {
          const drift = Math.sin(time * 0.8 + c.seed * 1.7) * SWAY * b.mass() * dt;
          b.applyImpulse({ x: drift, y: 0 }, true);
        }
      }

      // Anchors and leans, cached here so `draw` is pure arithmetic.
      for (const t of c.tethers) {
        if (t.popped >= 0) {
          t.popped += dt;
          continue;
        }
        const b = bodies[Math.min(t.bi, bodies.length - 1)];
        this.anchor(t, b);

        const lv = b.linvel();
        const want = clamp(-lv.x * 0.055, -1.05, 1.05) + Math.sin(time * 1.6 + t.phase) * 0.09;
        t.lean += (want - t.lean) * Math.min(1, dt * 6);

        if (c.age >= t.popAt) this.pop(c, t);
      }

      // Drop finished bursts, and retire the cluster once the last one has played out.
      for (let j = c.tethers.length - 1; j >= 0; j--) {
        if (c.tethers[j].popped > POP_TIME) c.tethers.splice(j, 1);
      }
      if (!c.tethers.length) {
        for (const b of bodies) b.setGravityScale(c.restore, true);
        this.clusters.splice(i, 1);
      }
    }
  }

  draw(ctx: Ctx, cam?: Camera) {
    for (const c of this.clusters) {
      for (const t of c.tethers) {
        if (cam && !cam.isVisible({ x: t.ax, y: t.ay }, t.len + 1.4)) continue;
        const bx = t.ax + Math.sin(t.lean) * t.len;
        const by = t.ay + Math.cos(t.lean) * t.len;

        if (t.popped >= 0) {
          drawBalloonPop(ctx, bx, by, t.size, t.color, popFrameAt(t.popped), t.lean);
          continue;
        }
        drawString(ctx, t.ax, t.ay, bx, by, t.size, t.sag);
        const f = Math.floor((c.age + t.phase) * BALLOON_FPS) % BALLOON_FRAMES;
        drawBalloon(ctx, bx, by, t.size, t.color, f, t.lean);
      }
    }
  }

  // ------------------------------------------------------------------ internals

  /**
   * The owner's live bodies, into the shared scratch array.
   *
   * Rapier handles are never held across frames here. A block converting from static to
   * dynamic keeps its body, but a ragdoll being disposed or a block being reaped does
   * not, and `eachBody` is implemented to yield nothing once that has happened — so an
   * empty list is the signal to drop the cluster rather than something to work around.
   */
  private collect(owner: PhysOwner): RAPIER.RigidBody[] {
    this.scratch.length = 0;
    owner.eachBody?.((b) => this.scratch.push(b));
    return this.scratch;
  }

  private pop(c: Cluster, t: Tether) {
    if (t.popped >= 0) return;
    t.popped = 0;
    c.live--;
    const bx = t.ax + Math.sin(t.lean) * t.len;
    const by = t.ay + Math.cos(t.lean) * t.len;
    this.host.particles.shards(bx, by, 5, partyColor(t.color), 4.5);
    sfx.balloonPop();
  }
}
