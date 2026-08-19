import { clamp, lerp, type V } from "../core/math";
import type { Camera } from "../core/camera";
import type { Particles } from "./particles";
import type { Decals } from "./decals";

/**
 * One curve for how hard everything hits.
 *
 * Before this module every call site invented its own numbers, which is why a killing
 * blow (`hitstop(0.045)`, `addTrauma(0.16)`) landed softer than a crate falling over.
 * The fix is not bigger numbers everywhere — that is how you get a game that shakes
 * constantly and therefore never shakes. It is *one* scale that every violent event is
 * expressed on, so the response is monotonic: a harder thing always feels harder, and
 * the rare things at the top of the scale stay rare enough to still mean something.
 *
 * The scale is a plain number, `Magnitude`, in 0..1. It is deliberately the whole
 * interface — the audio director scores the same value, so sound and picture come off
 * one curve instead of two that drift apart.
 *
 * Numbers below are from standard game-feel practice: Jan Willem Nijman's "The Art of
 * Screenshake" (freeze frames and permanent-feeling impact), Steve Swink's *Game Feel*
 * (impact as a compound cue, not a single effect), and Squirrel Eiserloh on trauma-based
 * shake that decays fast and scales with the square.
 */
export type Magnitude = number;

export type ImpactTier = "tap" | "solid" | "heavy" | "kill" | "brutal" | "catastrophic";

/** The slice of the game `juice` needs. `Game` satisfies it structurally via `GameCtx`. */
export interface JuiceHost {
  readonly camera: Camera;
  readonly particles: Particles;
  readonly decals: Decals;
  hitstop(seconds: number): void;
  slowmo(seconds: number, scale?: number): void;
  flash(strength: number, color?: string): void;
}

/** Everything one impact is worth. See `impactCue`. */
export interface ImpactCue {
  magnitude: Magnitude;
  tier: ImpactTier;
  /** Seconds of frozen simulation. `Game.hitstop` clamps at 0.22s. */
  hitstop: number;
  /** Camera trauma to add. Shake amplitude is trauma *squared*, so this curve is steep. */
  trauma: number;
  /** Zoom punch; negative pushes the view outward. */
  punch: number;
  /** Directional frame-shove, 0..1, for `Camera.addKick`. */
  kick: number;
  /** Full-screen flash strength. */
  flash: number;
  /** Slow-motion seconds, and the time scale it runs at. Zero for everything common. */
  slowmo: number;
  slowmoScale: number;
  /** Suggested particle count for this event, before the pool's own headroom is applied. */
  burst: number;
}

/**
 * The table. Rows are interpolated, so the shape between them matters as much as the
 * values on them.
 *
 * - **hitstop** stays inside 50–120ms for anything that happens more than once a minute.
 *   Three to seven frames at 60Hz reads as weight; past ~200ms it stops reading as impact
 *   and starts reading as the game dropping frames, so 200ms is the hard top and only the
 *   nuke gets there.
 * - **trauma** is squared by the camera before it becomes amplitude. 0.14 is roughly a
 *   1px nudge, 0.38 about 4px, 0.85 a genuine slam. That non-linearity is on purpose: it
 *   is what keeps a rifle round and a collapsing tower distinguishable.
 * - **slowmo** is zero until 0.8. Slow motion is a reward frame; make it ambient and it
 *   is just latency. `requestSlowmo` additionally rate-limits it.
 * - **burst** counts particles, not "intensity" — the pool is hard-capped and the emit
 *   helpers scale these against its remaining headroom.
 */
const CURVE: readonly ImpactCue[] = [
  { magnitude: 0.00, tier: "tap", hitstop: 0.000, trauma: 0.00, punch: 0.000, kick: 0.00, flash: 0.00, slowmo: 0, slowmoScale: 1, burst: 0 },
  { magnitude: 0.12, tier: "tap", hitstop: 0.020, trauma: 0.05, punch: 0.000, kick: 0.10, flash: 0.00, slowmo: 0, slowmoScale: 1, burst: 4 },
  { magnitude: 0.30, tier: "solid", hitstop: 0.060, trauma: 0.14, punch: -0.010, kick: 0.24, flash: 0.04, slowmo: 0, slowmoScale: 1, burst: 10 },
  { magnitude: 0.50, tier: "heavy", hitstop: 0.090, trauma: 0.26, punch: -0.030, kick: 0.40, flash: 0.12, slowmo: 0, slowmoScale: 1, burst: 22 },
  { magnitude: 0.68, tier: "kill", hitstop: 0.120, trauma: 0.38, punch: -0.060, kick: 0.55, flash: 0.20, slowmo: 0, slowmoScale: 1, burst: 38 },
  { magnitude: 0.86, tier: "brutal", hitstop: 0.160, trauma: 0.58, punch: -0.130, kick: 0.75, flash: 0.36, slowmo: 0.28, slowmoScale: 0.42, burst: 70 },
  { magnitude: 1.00, tier: "catastrophic", hitstop: 0.200, trauma: 0.85, punch: -0.260, kick: 1.00, flash: 0.70, slowmo: 0.60, slowmoScale: 0.26, burst: 130 },
];

/**
 * Reused so the per-impact path allocates nothing — `Game.dispatchImpacts` walks every
 * contact in the world on every fixed step. The returned object is only valid until the
 * next call; copy out of it, or pass your own `out`.
 */
const scratch: ImpactCue = { ...CURVE[0] };

/** Where an event's magnitude lands on the curve. The audio director reads this too. */
export function tierOf(m: Magnitude): ImpactTier {
  let row = CURVE[0];
  for (const r of CURVE) if (m >= r.magnitude) row = r;
  return row.tier;
}

/** Interpolates the table at `m`. Allocation-free; see `scratch`. */
export function impactCue(m: Magnitude, out: ImpactCue = scratch): ImpactCue {
  const g = clamp(m, 0, 1);
  let i = 0;
  while (i < CURVE.length - 2 && g > CURVE[i + 1].magnitude) i++;
  const a = CURVE[i];
  const b = CURVE[i + 1];
  const t = b.magnitude === a.magnitude ? 0 : (g - a.magnitude) / (b.magnitude - a.magnitude);

  out.magnitude = g;
  // The *lower* row's tier, so an event only earns a name once it has fully arrived at it.
  out.tier = a.tier;
  out.hitstop = lerp(a.hitstop, b.hitstop, t);
  out.trauma = lerp(a.trauma, b.trauma, t);
  out.punch = lerp(a.punch, b.punch, t);
  out.kick = lerp(a.kick, b.kick, t);
  out.flash = lerp(a.flash, b.flash, t);
  out.slowmo = lerp(a.slowmo, b.slowmo, t);
  out.slowmoScale = lerp(a.slowmoScale, b.slowmoScale, t);
  out.burst = Math.round(lerp(a.burst, b.burst, t));
  return out;
}

// --------------------------------------------------------------- magnitude sources

/**
 * Collision energy in kilojoules — what `Physics` already reports.
 *
 * Logarithmic, because collision energy spans four orders of magnitude between a crate
 * tipping over and a jetliner arriving, and a linear mapping would spend the entire
 * interesting part of the curve on the last 1% of events. 6 kJ (the threshold `game.ts`
 * already ignores below) lands at 0.09; a car into a wall around 0.59; 5 MJ tops out.
 */
export const fromEnergy = (kj: number) =>
  clamp(Math.log(1 + Math.max(0, kj) / 8) / Math.log(1 + 4000 / 8), 0, 1);

/**
 * Damage as a multiple of what the body could take — `damage / maxHp`, the same ratio
 * `severLimbs` already grades dismemberment on.
 *
 * Exactly lethal (1.0) is a "kill", not a "brutal": an ordinary kill has to leave
 * headroom above it or a direct rocket has nowhere left to go. Above lethal it is
 * logarithmic so that a 60x nuke overkill and a 6x rocket are still distinguishable
 * without the rocket already saturating.
 */
export const fromOverkill = (ratio: number) =>
  ratio <= 1
    ? clamp(0.12 + Math.max(0, ratio) * 0.54, 0, 0.66)
    : clamp(0.66 + Math.log10(ratio) * 0.3, 0.66, 1);

/**
 * Blast radius in metres. A grenade-sized 3m blast is "heavy", the 6m rocket sits just
 * under "kill", and only the nuke is allowed the top of the scale.
 */
export const fromExplosion = (radiusM: number, nuke = false) =>
  nuke ? 1 : clamp(0.22 + radiusM * 0.066, 0, 0.92);

/** Impact speed in m/s, for landings and falls. Terminal-ish (35 m/s) is nearly the top. */
export const fromFall = (speed: number) => clamp((speed - 4) / 34, 0, 1);

/**
 * How wide a collapse is, in metres of the structure that came down. A single wall panel
 * is a "heavy"; a sixteen-storey tower going over is the second-biggest thing in the game.
 */
export const fromCollapse = (extentM: number) => clamp(0.3 + extentM * 0.028, 0, 0.95);

// --------------------------------------------------------------------- application

/**
 * Slow motion is rationed here rather than at the call sites.
 *
 * Every individual call site has a fair case for slowing time down, and if they all act
 * on it the game spends half its life in slow motion and the effect stops being read as
 * significance at all. One gate, one cooldown, and the threshold sits above everything
 * that happens routinely.
 */
const SLOWMO_MIN = 0.8;
/** Seconds of real time before another one is allowed. Longer than any single run of kills. */
const SLOWMO_COOLDOWN = 7;
let lastSlowmo = -1e9;

/** Wall-clock seconds. Real time on purpose: slow-motion must not measure its own gate. */
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** Resets the slow-motion cooldown. Call on level load so a fresh run starts unpenalised. */
export function resetJuice() {
  lastSlowmo = -1e9;
}

/** Takes the slow-motion if it is earned and available. Returns whether it fired. */
export function requestSlowmo(host: JuiceHost, seconds: number, scale: number, m: Magnitude) {
  if (m < SLOWMO_MIN || seconds <= 0) return false;
  const t = now();
  if (t - lastSlowmo < SLOWMO_COOLDOWN) return false;
  lastSlowmo = t;
  host.slowmo(seconds, scale);
  return true;
}

/**
 * The whole camera-and-time response for one event, off the curve.
 *
 * `(dirX, dirY)` is the direction the force travelled — the impact normal, the direction
 * away from a blast, the way a body was thrown. Pass it whenever it is known: an undirected
 * hit says something happened, a directed one says what and from where, and it is the same
 * cost either way.
 *
 * Returns the cue so callers can size their own particles and audio from the same numbers.
 */
export function applyImpact(
  host: JuiceHost, m: Magnitude, dirX = 0, dirY = 0, flashColor = "#ffffff",
): ImpactCue {
  const cue = impactCue(m);
  const cam = host.camera;
  if (cue.hitstop > 0) host.hitstop(cue.hitstop);
  if (cue.trauma > 0) cam.addTrauma(cue.trauma);
  if (cue.punch !== 0) cam.addPunch(cue.punch);
  if (cue.kick > 0) cam.addKick(dirX, dirY, cue.kick);
  if (cue.flash > 0) host.flash(cue.flash, flashColor);
  requestSlowmo(host, cue.slowmo, cue.slowmoScale, cue.magnitude);
  return cue;
}

/**
 * A generic world impact: something hit something else hard enough to knock material off.
 *
 * The debris leaves *along the surface normal* and inherits a fraction of the impactor's
 * velocity, which is what stops every collision in the game looking like the same
 * omnidirectional puff played at different sizes.
 */
export function hit(
  host: JuiceHost, at: V, m: Magnitude,
  nx = 0, ny = 1, color = "#cbb99a", velX = 0, velY = 0,
) {
  // Two rings, because "can I feel it" and "can I see it" are different questions. Just
  // off the edge of the screen should still land on the camera — a tower coming down
  // behind you is the one impact you most want to be told about — but a collapse two
  // hundred metres up the level has no business shaking anything, and in a big cascade
  // there are hundreds of those per step.
  const p = host.particles;
  const cam = host.camera;
  if (!cam.isVisible(at, 12)) return impactCue(m);
  const cue = applyImpact(host, m, nx, ny);
  if (!cam.isVisible(at, 4)) return cue;

  const n = budget(p, cue.burst);
  if (n <= 0) return cue;
  // A fifth of the impactor's velocity: enough that fast debris visibly trails the hit,
  // little enough that the spray still reads as coming *off* the surface.
  p.spray(at.x, at.y, Math.max(1, n >> 1), nx, ny, 3 + m * 16, color, 0.7, velX * 0.2, velY * 0.2);
  p.dust(at.x, at.y, Math.max(1, n >> 2), 1.5 + m * 4, color);
  if (m > 0.45) p.metalSparks(at.x, at.y, Math.max(2, n >> 2), nx, ny, 8 + m * 14);
  return cue;
}

/**
 * A killing blow. `overkill` is `damage / maxHp` — 1 is exactly lethal.
 *
 * Kills get a floor under them (`Math.max(0.55, …)`) that ordinary impacts do not,
 * because the moment a stickman stops being alive is the moment this game is selling
 * and it should never land softer than the crate next to him.
 */
export function kill(
  host: JuiceHost, at: V, overkill = 1, dirX = 0, dirY = 1, color = "#c0263a",
) {
  const m = Math.max(0.55, fromOverkill(overkill));
  const cue = applyImpact(host, m, dirX, dirY, "#ffdede");
  const p = host.particles;
  if (!host.camera.isVisible(at, 4)) return cue;
  const n = budget(p, cue.burst);
  if (n > 0) p.spray(at.x, at.y, Math.max(2, n >> 2), dirX, dirY, 6 + m * 14, color, 1.0);
  // A ring is the cheapest possible "that one counted" — one stroked circle, and it reads
  // at any zoom because it scales with the blow rather than with the camera.
  p.ring(at.x, at.y, 0.4 + m * 0.9, "#ffffff", 0.24 + m * 0.2);
  return cue;
}

/**
 * A structure coming down: the dust front, the smoke that hangs afterwards, the mark it
 * leaves, and the camera stepping back far enough to actually show it.
 *
 * `extentM` is how wide the thing that fell was. The spectacle framing is the point of
 * this one — a tower toppling outside the frame is a sound effect.
 */
export function collapse(host: JuiceHost, at: V, extentM: number, groundY = at.y) {
  const m = fromCollapse(extentM);
  const cue = applyImpact(host, m, 0, -1);
  const p = host.particles;
  const n = budget(p, cue.burst);
  if (host.camera.isVisible(at, 8) && n > 0) {
    // Few and large: a rolling front, not confetti. See `Particles.collapseDust`.
    p.collapseDust(at.x, groundY, Math.max(2, Math.round(n * 0.35)), 3 + extentM * 0.5);
    p.linger(at.x, groundY + 1, Math.max(1, Math.round(n * 0.12)), 0.8 + extentM * 0.05);
    host.decals.dust(at.x, groundY, 1.5 + extentM * 0.35);
  }
  // Widen to fit the thing that fell, briefly. Weight is well under 1 so the player's own
  // character never leaves frame — you must still be able to run away from it.
  host.camera.frameSpectacle(at, extentM * 0.8 + 6, 1.1, 0.42);
  return cue;
}

/**
 * An explosion. Only the camera/time half — the fire, smoke and gas belong to whatever
 * detonated and are already authored per-round in `entities/projectile.ts`.
 */
export function explosion(host: JuiceHost, at: V, radiusM: number, nuke = false) {
  const m = fromExplosion(radiusM, nuke);
  const cue = applyImpact(host, m, 0, 0, nuke ? "#fff6d0" : "#ffb257");
  if (nuke) {
    // The one event in the game allowed to ignore the slow-motion budget: there are three
    // rounds of it and it ends the fight. `requestSlowmo` would have refused a second one.
    host.slowmo(1.1, 0.25);
    host.camera.frameSpectacle(at, radiusM * 1.1, 1.6, 0.55);
  } else if (m > 0.6) {
    host.camera.frameSpectacle(at, radiusM * 1.4, 0.7, 0.3);
  }
  return cue;
}

/**
 * A score number with weight behind it.
 *
 * Size scales with the square root of the magnitude rather than linearly: text area grows
 * as the square of its height, so a linear ramp makes big numbers overwhelm the screen
 * long before they have earned it.
 */
export function popup(host: JuiceHost, at: V, text: string, m: Magnitude, color = "#ffd23f") {
  const g = clamp(m, 0, 1);
  // 0.46m base is legible at the resting frame; 1.15m is about a tenth of the screen
  // height, which is as much as a number should ever take.
  host.particles.popup(at.x, at.y + 0.8, text, color, 0.46 + Math.sqrt(g) * 0.7, 0.75 + g * 0.4);
}

/** "Look at that." Thin pass-through so call sites never need to import `Camera`. */
export function spectacle(host: JuiceHost, at: V, radiusM: number, seconds = 1.2, weight = 0.5) {
  host.camera.frameSpectacle(at, radiusM, seconds, weight);
}

/**
 * Scales a requested burst against what the pool has left.
 *
 * The pool is hard-capped, and a nuke asking for its full allowance while a fire is
 * already burning would evict every effect on screen to draw itself. Degrading the new
 * burst instead is the cheaper trade: nobody counts particles, everybody notices the
 * screen blinking.
 */
function budget(p: Particles, want: number) {
  return Math.round(want * clamp(p.headroom * 1.4, 0.15, 1));
}
