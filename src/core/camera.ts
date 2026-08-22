import { clamp, damp, hash01, lerp, smoothstep, v, type V } from "./math";

/**
 * World units are metres, Y points up. The camera installs a flipped transform so
 * gameplay code can draw in physics space directly; see `apply()`.
 */

/**
 * How much world the camera frames vertically at rest, in metres.
 *
 * Framing is authored as *metres of world height* rather than as a fixed pixels-per-metre
 * so a 1.84 m stickman occupies the same fraction of the screen on every display instead
 * of shrinking on a big monitor. At 13.5 m he is ~13.6% of the viewport height; the old
 * flat 40 px/m put him under 10% on a 717 px viewport, which is why the ragdoll flail —
 * the one thing this game is actually selling — did not read.
 */
const FRAME_HEIGHT = 17;

/**
 * Horizontal guarantees, applied after the height rule.
 *
 * A phone in portrait is so tall that height-driven framing would leave under 6 m of
 * world across the screen — unplayable — so the width floor takes over there and accepts
 * a lot of sky in exchange. An ultrawide is the mirror case: past 30 m the action stops
 * growing and just spreads out, so the extra pixels go to width rather than to zoom.
 *
 * The 10 m floor is not arbitrary: it is what the old fixed 40 px/m already gave a 390 px
 * portrait phone. Phones were the one viewport the flat zoom happened to frame well, so
 * the floor is set to leave them exactly where they shipped rather than to "improve" them
 * into a tighter view than they can afford.
 */
const MIN_FRAME_WIDTH = 10;
const MAX_FRAME_WIDTH = 44;

/**
 * The `base` argument to `autoZoom`/`framedZoom` is a *preference*, not a literal
 * px/m: it is divided by this to become a multiplier on the framed zoom. 40 is what
 * `game.ts` has always passed, so the shipped value maps to exactly 1.0 and a director
 * tweaking `BASE_ZOOM` still gets "tighter" / "wider" in the direction they expect.
 */
const REFERENCE_BASE = 40;

/**
 * Push-in on a quiet moment, and pull-out at full tilt. See `autoZoom`.
 *
 * The quiet push-in is gentler than it was (1.12): with the wider resting frame it was
 * spending a quarter of the new view before the player had done anything wrong.
 */
const QUIET_IN = 1.05;
const FAST_OUT = 0.66;
/** Speed (m/s) at which the pull-out is fully committed. A sprint is ~7, a launch ~30. */
const SPEED_WIDE = 26;

/**
 * Where the followed point sits vertically, as a fraction of the *visible height*
 * pushed above centre. The camera sitting above the action is what stops a third of
 * the frame being spent on empty ground, and expressing it as a fraction rather than
 * in metres keeps the composition identical at every zoom level.
 *
 * 0.19 puts the player about three quarters of the way down the screen and cuts the
 * ground band from ~32% of the frame to ~24%. Pushing it further does keep trimming the
 * ground, but it also walks the character toward the bottom edge, and a player pinned to
 * the floor of their own screen has nowhere to fall to.
 */
const FRAME_UP = 0.19;
/** ...but capped in metres, or a tall portrait viewport parks the player near the floor. */
const FRAME_UP_MAX = 3.4;

/** Vertical look-ahead: seconds of the followed point's own velocity to lead by. */
const RISE_LEAD = 0.2;

/**
 * How far aiming may pull the frame, as a fraction of the visible half-extent.
 *
 * Expressed as a fraction rather than in metres so an ultrawide gets more reach than a
 * portrait phone without either being tuned separately, and so the reach grows when the
 * camera pulls out at speed instead of staying a fixed distance into a bigger picture.
 *
 * 0.46 horizontally is the largest value that still leaves the player comfortably
 * inside the frame at full deflection — past about half, the character starts leaving
 * the screen on the opposite side, and a game where aiming loses you your own stickman
 * is worse than one where you cannot see the target.
 */
const AIM_LEAD_X = 0.46;

/**
 * Vertical lead is deliberately asymmetric.
 *
 * Up is where everything interesting is: the top of a tower you are about to drop, the
 * arc of a mortar round, wherever the jetpack is taking you. Down, from a stickman
 * standing on the ground, is *dirt* — the terrain slab is six metres thick and there is
 * nothing in it. Leading down as far as up spends a third of the frame on the inside of
 * the floor, which is how the wider camera could have ended up feeling worse than the
 * narrow one.
 *
 * Downward lead is not zero, because falling down a shaft or firing into a pit are both
 * real, and both want a little warning of what is underneath.
 */
const AIM_LEAD_UP = 0.34;
const AIM_LEAD_DOWN = 0.12;

/**
 * Cursor travel from the centre, as a fraction of the half-viewport, before the frame
 * begins to move at all.
 *
 * Without a deadzone the camera drifts continuously under a resting hand, which reads
 * as the game being unable to sit still. With one, small aiming corrections are free
 * and only a deliberate push toward the edge of the screen asks to see further.
 */
const AIM_DEADZONE = 0.22;

/**
 * Maps a raw -1..1 aim offset to a smooth 0..1 pull, past the deadzone.
 *
 * `smoothstep` rather than a straight ramp because the interesting part of this control
 * is the *end* of its travel — shoving the cursor at the screen edge to look downrange —
 * and a linear map spends most of its range on the small corrections the deadzone
 * already exists to ignore.
 */
function leadCurve(t: number) {
  const a = Math.abs(t);
  if (a <= AIM_DEADZONE) return 0;
  return Math.sign(t) * smoothstep((a - AIM_DEADZONE) / (1 - AIM_DEADZONE));
}

/** Shake amplitude at full trauma, in CSS pixels. Screen-space so zoom can't change it. */
const SHAKE_PX = 30;
/** Roll at full trauma, radians. Rotation is the most nausea-prone axis — keep it small. */
const SHAKE_ROLL = 0.035;
/** Directional frame-shove at full strength, CSS pixels. See `addKick`. */
const KICK_PX = 26;
/** Shake frequency in Hz. Below ~15 it reads as a wobble, above ~30 as static. */
const SHAKE_HZ = 24;
const ROLL_HZ = 17;

const TRAUMA_DECAY = 2.2;
/** How fast the "recently shaken" ledger drains. See `addTrauma`. */
const LOAD_DECAY = 1.6;
/** How hard a full ledger discounts new trauma, and the floor it can never discount past. */
const LOAD_BITE = 2.2;
const LOAD_FLOOR = 0.4;

/**
 * 1D gradient noise. Coherent shake reads as a physical camera being knocked about;
 * per-frame `random()` reads as flicker, which is the single cheapest quality win
 * available here (Eiserloh, "Juicing Your Cameras With Math").
 *
 * Allocation-free and four `hash01` calls deep, i.e. free at three axes per frame.
 */
function noise1(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const g0 = hash01(i) * 2 - 1;
  const g1 = hash01(i + 1) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  // *1.9 because 1D gradient noise only reaches ~±0.53 in practice; clamped so a lucky
  // pair of gradients can't overshoot the authored amplitude.
  return clamp(lerp(g0 * f, g1 * (f - 1), u) * 1.9, -1, 1);
}

export class Camera {
  pos: V = v(0, 6);
  /** Pixels per metre. */
  zoom = 34;
  targetZoom = 34;
  minZoom = 8;
  maxZoom = 260;

  /**
   * Global shake scalar, 0..1. Screenshake is a documented motion-sickness trigger, so
   * it is a settings-menu control rather than a constant. 0 is *genuinely* zero: it
   * mutes the offset, the roll and the zoom punch, and every unprojection stays exact
   * because all three are read back through the same scalar.
   */
  shakeIntensity = 1;

  /** 0..1 "how rattled are we" — decays every frame, shake scales with its square. */
  trauma = 0;
  /** Trauma spent recently, used to stop sustained fire integrating into nausea. */
  private traumaLoad = 0;
  private shakeOffset: V = v(0, 0);
  private shakeAngle = 0;
  private shakeT = 0;
  /** Momentary punch applied on top of zoom, e.g. an explosion snapping the view in. */
  private punch = 0;
  /** Directional frame-shove in CSS pixels, decayed to zero. */
  private kickX = 0;
  private kickY = 0;

  viewW = 1;
  viewH = 1;

  private target: V = v(0, 6);
  private lead: V = v(0, 0);
  /** Smoothed vertical look-ahead, metres. Derived in `follow` from the target's motion. */
  private rise = 0;

  /** The "look at that" override. Fields are inlined rather than boxed — see `frameSpectacle`. */
  private specX = 0;
  private specY = 0;
  private specR = 0;
  private specT = 0;
  private specDur = 1;
  private specW = 0;
  /** This frame's spectacle envelope, advanced once per `update`. */
  private specEnv = 0;

  /**
   * Point the camera at `p`, biased toward where the player is aiming.
   *
   * `aimX` / `aimY` are the crosshair's offset from the centre of the *screen*, -1..1,
   * with +Y up. Screen space, not world space, and that distinction is the whole fix.
   *
   * The previous version took a world-space delta — a fraction of the way from the
   * player to the crosshair. That can never reveal anything outside the current frame,
   * because the crosshair is itself bounded by the frame: the lead was capped by the
   * very view it was supposed to extend, so aiming at the edge of the screen bought
   * about four metres and long shots stayed blind.
   *
   * Reading the cursor's screen position instead breaks that loop, and cannot start
   * another one: moving the camera does not move the mouse, so the input to this
   * function is exactly what the player's hand is doing and nothing else. Pushing the
   * crosshair to the edge of the screen now pans the frame that way and keeps it there.
   */
  follow(p: V, aimX = 0, aimY = 0, dt = 1 / 60) {
    // Vertical look-ahead is derived from the target's own motion rather than passed in,
    // so the camera needs no knowledge of jumps, jetpacks, launches or respawns: anything
    // that throws the player upward leads upward, and a long fall leans down to show the
    // ground coming. Clamped hard because a respawn teleport is an infinite velocity.
    const vy = clamp((p.y - this.target.y) / Math.max(dt, 1e-4), -34, 34);
    this.rise = damp(this.rise, clamp(vy * RISE_LEAD, -3, 4.5), 3, dt);

    this.target.x = p.x;
    this.target.y = p.y;

    // Converted to metres here rather than by the caller, because only the camera knows
    // the zoom and viewport the fraction is a fraction *of*.
    const z = Math.max(1e-3, this.zoom);
    const halfW = this.viewW / 2 / z;
    const halfH = this.viewH / 2 / z;
    const wantX = leadCurve(aimX) * halfW * AIM_LEAD_X;
    const leadY = leadCurve(aimY);
    const wantY = leadY * halfH * (leadY >= 0 ? AIM_LEAD_UP : AIM_LEAD_DOWN);

    // Eased more slowly than the old ±7 m lead was (7/s): this travels three times as
    // far, and at the old rate the frame lurched every time the cursor crossed the
    // deadzone. Slow enough to read as a deliberate look, fast enough not to feel late.
    this.lead.x = damp(this.lead.x, wantX, 4.5, dt);
    this.lead.y = damp(this.lead.y, wantY, 4.5, dt);
  }

  /**
   * Adds shake, discounted by how much shaking we have already done this second.
   *
   * Without this an automatic weapon at ten rounds a second integrates into a permanent
   * tremor: every individual kick is reasonable, the sum is nausea, and the player's aim
   * never settles. The ledger drains in well under a second, so a single big hit landing
   * out of the quiet still delivers its full slam — which is the whole point of having
   * shake at all.
   */
  addTrauma(t: number) {
    const discount = clamp(1 / (1 + this.traumaLoad * LOAD_BITE), LOAD_FLOOR, 1);
    const applied = t * discount;
    this.trauma = clamp(this.trauma + applied, 0, 1);
    this.traumaLoad = Math.min(2, this.traumaLoad + applied);
  }

  /** Negative values push the view outward (explosions), positive snap it in. */
  addPunch(p: number) {
    this.punch = clamp(this.punch + p, -0.5, 0.5);
  }

  /**
   * Shoves the whole frame along `(dx, dy)` — the direction the force travelled.
   *
   * Undirected shake says "something happened"; a frame that jumps *away* from the
   * blast says what happened and where. It is folded into `shakeOffset` rather than
   * into `pos` precisely so `screenToWorld` keeps compensating for it for free.
   */
  addKick(dx: number, dy: number, amount: number) {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6 || amount <= 0) return;
    const px = clamp(amount, 0, 1) * KICK_PX;
    this.kickX = clamp(this.kickX + (dx / l) * px, -KICK_PX, KICK_PX);
    this.kickY = clamp(this.kickY + (dy / l) * px, -KICK_PX, KICK_PX);
  }

  /**
   * "Look at that." Briefly widens and re-centres on a big event — a tower going over,
   * a nuke — so the player actually sees the thing they just caused.
   *
   * Deliberately partial and deliberately short: the blend is capped well below 1 so
   * the player's own character never leaves the frame, the widening is capped at 1.8x
   * so it cannot become a dolly-out, and the envelope eases both in and out because a
   * hard cut back to the player reads as a second, unexplained camera move.
   *
   * @param radius metres of the event that should fit on screen.
   * @param weight 0..0.6, how far toward the event the frame is allowed to travel.
   */
  frameSpectacle(at: V, radius: number, seconds = 1.2, weight = 0.5) {
    const w = clamp(weight, 0, 0.6);
    const r = Math.max(1, radius);
    // A small event must not steal the frame from a bigger one already running.
    if (this.specT > 0 && w * r <= this.specW * this.specR) return;
    this.specX = at.x;
    this.specY = at.y;
    this.specR = r;
    this.specT = seconds;
    this.specDur = Math.max(0.05, seconds);
    this.specW = w;
  }

  /** True while a spectacle framing is running; lets callers avoid stacking cues. */
  get framingSpectacle() {
    return this.specT > 0;
  }

  update(dt: number, snap = false) {
    this.specEnv = this.advanceSpectacle(dt);

    let wantZoom = clamp(this.targetZoom, this.minZoom, this.maxZoom);
    if (this.specEnv > 0) {
      // Fit the event, but never wider than 1.8x — past that the stickman stops reading
      // and the "look at that" becomes "where did I go".
      //
      // Normalised against the cap rather than against this call's own weight, so
      // `weight` governs both how far the frame travels *and* how far it widens: a
      // modest event should be a modest move on both axes, not a small pan with a full
      // dolly-out attached.
      const fit = Math.max((Math.min(this.viewW, this.viewH) * 0.5) / this.specR, wantZoom * 0.55);
      wantZoom = lerp(wantZoom, Math.min(wantZoom, fit), this.specEnv / 0.6);
    }
    this.zoom = snap ? wantZoom : damp(this.zoom, wantZoom, 4, dt);

    // Composition, in metres, against the zoom we are about to draw with.
    const halfH = this.viewH / 2 / Math.max(1e-3, this.zoom);
    const up = Math.min(FRAME_UP * halfH * 2, FRAME_UP_MAX);
    // The whole vertical budget is clamped rather than each contributor, so aim lead,
    // look-ahead and framing share one honest limit and no combination of them can bury
    // the player at the top or bottom edge.
    // The whole vertical budget shares one honest limit, but not a symmetric one. The
    // upward allowance was 0.5 and is the thing that was quietly eating the aim lead:
    // `up` alone already spends most of it, leaving under a metre for aiming even at
    // full deflection. 0.66 lets a deliberate look upward actually show the top of the
    // tower, while still leaving the player a quarter of the frame beneath them.
    const offY = clamp(this.lead.y + this.rise + up, -halfH * 0.34, halfH * 0.66);

    let tx = this.target.x + this.lead.x;
    let ty = this.target.y + offY;
    if (this.specEnv > 0) {
      tx = lerp(tx, this.specX, this.specEnv);
      ty = lerp(ty, this.specY + up * 0.5, this.specEnv);
    }

    // ~80ms to close the gap. Slower than this and the camera reads as input lag even
    // though the character is responding immediately.
    const rate = snap ? 1000 : 13;
    this.pos.x = damp(this.pos.x, tx, rate, dt);
    this.pos.y = damp(this.pos.y, ty, rate, dt);

    this.trauma = Math.max(0, this.trauma - dt * TRAUMA_DECAY);
    this.traumaLoad = Math.max(0, this.traumaLoad - dt * LOAD_DECAY);
    this.punch = damp(this.punch, 0, 9, dt);
    // ~60ms to spend a kick: long enough to see, short enough that it never fights aim.
    this.kickX = damp(this.kickX, 0, 16, dt);
    this.kickY = damp(this.kickY, 0, 16, dt);
    this.shakeT += dt;

    // Squaring trauma keeps small hits subtle while big ones still slam.
    const s = this.trauma * this.trauma * this.shakeIntensity;
    const z = Math.max(1e-3, this.zoom);
    const amp = (s * SHAKE_PX) / z;
    const t = this.shakeT * SHAKE_HZ;
    // Separate noise streams per axis, far enough apart in the hash that they never
    // correlate into a diagonal wobble.
    this.shakeOffset.x = noise1(t) * amp + (this.kickX * this.shakeIntensity) / z;
    this.shakeOffset.y = noise1(t + 137.7) * amp + (this.kickY * this.shakeIntensity) / z;
    this.shakeAngle = noise1(this.shakeT * ROLL_HZ + 911.3) * s * SHAKE_ROLL;
    // Snapped to exactly zero at rest so `screenToWorld` can skip the rotation entirely.
    if (Math.abs(this.shakeAngle) < 1e-5) this.shakeAngle = 0;
  }

  /**
   * Records the viewport. `screenToWorld` needs it, and unprojecting the mouse has to
   * happen *before* the world is drawn, so it cannot wait for `apply()`.
   */
  setViewport(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
  }

  /** Installs world->screen transform. Call inside save()/restore(). */
  apply(ctx: CanvasRenderingContext2D, w: number, h: number) {
    this.setViewport(w, h);
    const z = this.effectiveZoom;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.shakeAngle);
    ctx.scale(z, -z); // flip Y so +Y is up in world space
    ctx.translate(-(this.pos.x + this.shakeOffset.x), -(this.pos.y + this.shakeOffset.y));
  }

  get effectiveZoom() {
    return this.zoom * (1 + this.punch * this.shakeIntensity);
  }

  /**
   * Exact inverse of `apply()`, **including the shake roll**. Leaving the rotation out
   * costs up to ~35px of error at the edge of a 1440p viewport during heavy trauma,
   * which shows up as the crosshair and the gun disagreeing exactly when the screen is
   * shaking and you most want to trust your aim.
   */
  screenToWorld(sx: number, sy: number): V {
    const z = this.effectiveZoom;
    let dx = sx - this.viewW / 2;
    let dy = sy - this.viewH / 2;
    if (this.shakeAngle !== 0) {
      const c = Math.cos(-this.shakeAngle);
      const s = Math.sin(-this.shakeAngle);
      const rx = dx * c - dy * s;
      dy = dx * s + dy * c;
      dx = rx;
    }
    return v(
      dx / z + this.pos.x + this.shakeOffset.x,
      -dy / z + this.pos.y + this.shakeOffset.y,
    );
  }

  worldToScreen(p: V): V {
    const z = this.effectiveZoom;
    let dx = (p.x - this.pos.x - this.shakeOffset.x) * z;
    let dy = -(p.y - this.pos.y - this.shakeOffset.y) * z;
    if (this.shakeAngle !== 0) {
      const c = Math.cos(this.shakeAngle);
      const s = Math.sin(this.shakeAngle);
      const rx = dx * c - dy * s;
      dy = dx * s + dy * c;
      dx = rx;
    }
    return v(dx + this.viewW / 2, dy + this.viewH / 2);
  }

  /** Half-extents of the visible world rect, plus `pad` metres of slack for culling. */
  visibleHalf(pad = 0): V {
    const z = this.effectiveZoom;
    return v(this.viewW / 2 / z + pad, this.viewH / 2 / z + pad);
  }

  /** Allocation-free: this runs once per actor per frame across hundreds of blocks. */
  isVisible(p: V, pad = 3) {
    const z = this.effectiveZoom;
    return (
      Math.abs(p.x - this.pos.x) < this.viewW / 2 / z + pad &&
      Math.abs(p.y - this.pos.y) < this.viewH / 2 / z + pad
    );
  }

  /**
   * Pixels per metre that frames `FRAME_HEIGHT` metres of world on the current viewport,
   * with the width guarantees applied. This is the resting composition everything else
   * is expressed relative to.
   */
  framedZoom(base = REFERENCE_BASE) {
    // Before the first `setViewport` there is no viewport to frame against; leaving the
    // target where it is beats snapping the world to a garbage zoom for one frame.
    if (this.viewH <= 2) return this.targetZoom;
    const wantW = clamp(FRAME_HEIGHT * (this.viewW / this.viewH), MIN_FRAME_WIDTH, MAX_FRAME_WIDTH);
    const fit = Math.min(this.viewH / FRAME_HEIGHT, this.viewW / wantW);
    return clamp(fit * (base / REFERENCE_BASE), this.minZoom, this.maxZoom);
  }

  /**
   * Seats the whole camera on `at` with no history at all. For level load.
   *
   * Everything transient is cleared here on purpose. Trauma, a kick, a running spectacle
   * or a half-decayed look-ahead surviving into the next world means the first second of
   * a fresh level is still playing out the last second of the previous one — and a nuke
   * fired on the frame before a restart would shake the new level's opening.
   */
  reframe(at: V, base = REFERENCE_BASE) {
    this.target.x = at.x;
    this.target.y = at.y;
    this.lead.x = 0;
    this.lead.y = 0;
    this.rise = 0;
    this.targetZoom = this.framedZoom(base);
    this.zoom = this.targetZoom;
    this.trauma = 0;
    this.traumaLoad = 0;
    this.punch = 0;
    this.kickX = 0;
    this.kickY = 0;
    this.specT = 0;
    this.specEnv = 0;
    this.shakeOffset.x = 0;
    this.shakeOffset.y = 0;
    this.shakeAngle = 0;
    // Composed exactly as `update` would, so the very first frame is already framed
    // rather than swooping into position from wherever the last level left the camera.
    const halfH = this.viewH / 2 / Math.max(1e-3, this.zoom);
    this.pos.x = at.x;
    this.pos.y = at.y + Math.min(FRAME_UP * halfH * 2, FRAME_UP_MAX);
  }

  /**
   * Frames the action, in both directions.
   *
   * The old rule only ever pulled *out*, so the game had exactly one composition: wide.
   * A fight at a standstill is a close-quarters moment and wants to be closer than the
   * resting frame, not the same as it; only speed and spectacle earn the wide shot.
   * The pull-out is roughly twice as eager as the push-in because being shown danger
   * late is a real cost, whereas a slow creep inward is invisible.
   */
  autoZoom(speed: number, dt: number, base = REFERENCE_BASE) {
    const framed = this.framedZoom(base);
    const want = framed * lerp(QUIET_IN, FAST_OUT, smoothstep(clamp(speed / SPEED_WIDE, 0, 1)));
    this.targetZoom = damp(this.targetZoom, want, want < this.targetZoom ? 3.4 : 1.5, dt);
  }

  private advanceSpectacle(dt: number) {
    if (this.specT <= 0) return 0;
    this.specT -= dt;
    if (this.specT <= 0) {
      this.specT = 0;
      return 0;
    }
    const k = this.specT / this.specDur; // 1 at the start, 0 at the end
    // Snap over in a fifth of the window, drift back over half of it: the move toward the
    // event has to beat the event, the move back must not draw attention to itself.
    const inK = smoothstep(clamp((1 - k) / 0.2, 0, 1));
    const outK = smoothstep(clamp(k / 0.5, 0, 1));
    return inK * outK * this.specW;
  }
}
