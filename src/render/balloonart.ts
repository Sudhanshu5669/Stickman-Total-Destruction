/**
 * Party balloons, drawn as pixel art.
 *
 * The third consumer of `render/pixel.ts`, after the guns and the rounds they fire,
 * and it exists as its own file for one reason: the balloon is the only sprite in the
 * game that is drawn *twice, differently*. `render/ammoart.ts` needs a fistful of them
 * bundled onto a clamp — that is the payload, the thing in flight. `fx/buoyancy.ts`
 * needs single balloons, one per colour, tied by a string to whatever the round stuck
 * them to, sometimes forty of them at once. Both come out of `paintBalloon` below, so
 * the bunch you fire and the balloons you end up looking at cannot drift apart.
 *
 * ## What makes a balloon read as a balloon
 *
 * Three things, in order of how much they matter at eighteen pixels across:
 *
 * 1. **The taper.** A balloon is not an ellipse. It is widest about a third of the way
 *    down and pulls into a neck at the bottom, and that asymmetry is the entire
 *    silhouette — an ellipse with a knot on it reads as a cherry. `profile()` is that
 *    curve and nothing else uses it.
 * 2. **The gloss.** Latex is shiny, and a matte balloon reads as a stone. The specular
 *    is a hard two-by-three patch of the ramp's light value, placed where rule 3 says
 *    the light is, and it is the only place the light value appears at full size — the
 *    body's own lit band is deliberately kept thin so the highlight stays the brightest
 *    thing in the sprite.
 * 3. **The knot.** Two dark pixels pinched under the neck. Without it the string looks
 *    like it is stuck on with glue.
 *
 * Rule 4 (three values per material) is honoured: dark, mid and light are the ramp, and
 * the gloss is the light value rather than a fourth tone.
 */

import { INK, Px, ramp, shadeHex, type Ramp3 } from "./pixel";
import { blitPixels, ART_PPM } from "./pixel";
import type { Ctx } from "./draw";

const TAU = Math.PI * 2;

/**
 * The party palette.
 *
 * Every one of these already exists somewhere in the game — the gold is the HUD's, the
 * blue is the hose's, the orange is the rocket's — because a round that introduces five
 * brand-new hues is five hues the rest of the art has to live with.
 */
export const PARTY: readonly string[] = [
  "#f0508a", // pink
  "#ffd23f", // gold
  "#4fc3f7", // hose blue
  "#6ecb5a", // green
  "#ff8a4c", // rocket orange
];

/** Ramps, built once. Balloons are latex: a deep shadow and a hot highlight. */
const RAMPS3: Ramp3[] = PARTY.map((c) => ramp(c, -0.34, 0.5));

export const partyRamp = (i: number) => RAMPS3[((i % RAMPS3.length) + RAMPS3.length) % RAMPS3.length];
export const partyColor = (i: number) => PARTY[((i % PARTY.length) + PARTY.length) % PARTY.length];

/** Fraction of the way down at which the balloon is widest. */
const FAT = 0.42;

/**
 * Half-width of the balloon at `t`, where 0 is the crown and 1 is the neck.
 *
 * Two curves rather than one, because the two ends of a balloon are not the same shape
 * and any single expression that tries to be both ends up an egg. The crown is a
 * quarter ellipse — blunt, already at half width a twentieth of the way down. The lower
 * two thirds is a slow power taper that never quite reaches zero, so the sprite hands a
 * couple of pixels of neck to the knot instead of coming to a point.
 */
const profile = (t: number) =>
  t < FAT
    ? Math.sqrt(Math.max(0, 1 - ((FAT - t) / FAT) ** 2))
    : (1 - (t - FAT) / 0.62) ** 0.62;

/**
 * One balloon, painted into `p` with its **knot** at `(cx, top + h)`.
 *
 * Shaded off the real surface normal rather than a flat diagonal, for the same reason
 * `Px.ball` is: on a round object a fake gradient is obvious because the terminator has
 * to curve. The normal here is taken against the *local* half-width, so the shadow
 * follows the taper instead of cutting straight across it.
 *
 * `squash` is the animation. Above 1 the balloon stretches tall and narrows; below 1 it
 * squats and widens. Area is roughly preserved, which is what stops the jiggle reading
 * as the balloon changing size.
 */
export function paintBalloon(
  p: Px, cx: number, top: number, rx: number, h: number, s: Ramp3, squash = 1,
) {
  const [dark, mid, light] = s;
  const hh = Math.max(4, Math.round(h * squash));
  const hr = Math.max(2, rx / squash);

  // The lighting sphere. It is centred on the fat part of the balloon and normalised
  // against *one* radius pair for the whole sprite, which is the fix for the obvious
  // failure here: normalising sideways against the local half-width makes every row
  // run the full -1..1, so the crown — where the balloon is two pixels across — gets
  // the same terminator as the equator and the whole top floods to the light value.
  // Shade a sphere, clip it to the balloon, and the terminator curves the way `Px.ball`
  // is careful to make it curve.
  const scy = top + hh * FAT;
  // Sized off the balloon's own height, not its width. A sphere as wide as it is tall
  // sits entirely in the crown, which throws the terminator across as a horizontal band
  // and splits the thing into a light half and a dark half.
  const sry = hh * 0.47;

  for (let j = 0; j < hh; j++) {
    const t = (j + 0.5) / hh;
    const w = hr * profile(t);
    if (w < 0.5) continue;
    const y = top + j;
    const ey = (y + 0.5 - scy) / sry;
    for (let i = -Math.ceil(w); i <= Math.ceil(w); i++) {
      const off = i + 0.5;
      if (Math.abs(off) > w) continue;
      const ex = off / hr;
      const q = Math.min(0.999, ex * ex + ey * ey);
      const d = -0.5 * ex - 0.5 * ey + 0.72 * Math.sqrt(1 - q);
      // Mid carries the surface. The light band is set past what the body can reach,
      // so the only light pixels in the sprite are the gloss painted below — which is
      // what stops a shiny object reading as a two-tone one.
      p.set(cx + i, y, d > 1.02 ? light : d < 0.3 ? dark : mid);
    }
  }

  // The gloss: a hard comma on the upper-left shoulder, where rule 3 puts the light.
  const gx = cx - Math.round(hr * 0.4);
  const gy = top + Math.round(hh * 0.17);
  if (hr >= 5) {
    p.rect(gx, gy + 1, 2, 3, light);
    p.rect(gx + 1, gy, 2, 1, light);
  } else {
    p.rect(gx, gy + 1, 1, 2, light);
  }

  // Neck and knot: a two-pixel pinch and a dark nub for the string to hang off.
  const ny0 = top + hh;
  p.rect(cx - 1, ny0 - 1, 2, 1, shadeHex(mid, -0.18));
  p.rect(cx - 1, ny0, 2, 1, dark);
}

/**
 * A burst of rubber, painted centred on `(cx, cy)`.
 *
 * Three frames rather than a particle puff, because a popped balloon is a *shape* — a
 * torn skin that snaps outward and then hangs — and a cloud of dots is the one thing it
 * is not. The particle system still throws shards on top; this is what they come out of.
 */
export function paintPop(p: Px, cx: number, cy: number, r: number, s: Ramp3, f: number) {
  const [dark, mid, light] = s;

  // Rubber, not a shockwave.
  //
  // Two drafts died here and both failed the same way: anything drawn at a constant
  // radius — a ring, an even asterisk — reads as a *blast wave*, which is the one thing
  // a balloon does not produce. What sells it is that every strip is a different length
  // at a different radius, so the eye reads torn material rather than an emitted circle.
  // `wob` and `reach` are that irregularity, and they are deterministic so the three
  // frames stay a single object coming apart rather than three unrelated bursts.
  const strips = f === 0 ? 6 : f === 1 ? 8 : 6;
  const base = [0.5, 0.95, 1.35][f] ?? 1.35;
  const thick = [2, 2, 1][f] ?? 1;

  if (f === 0) {
    // The bang itself: the skin blown wider than it is tall, an instant before it goes.
    p.ellipse(cx, cy, r * 0.95, r * 0.66, mid);
    p.ellipse(cx - r * 0.22, cy - r * 0.18, r * 0.5, r * 0.34, light);
    p.ellipse(cx + r * 0.3, cy + r * 0.2, r * 0.44, r * 0.28, dark);
  } else if (f === 1) {
    // What is left of the knot end, still recognisably rubber.
    p.ellipse(cx + r * 0.1, cy + r * 0.15, r * 0.28, r * 0.34, mid);
    p.set(cx, cy + 1, dark);
  }

  for (let i = 0; i < strips; i++) {
    const a = (i / strips) * TAU + f * 0.41 + 0.3;
    // Bounded so the longest strip still lands inside the grid: `base * wob + reach`
    // peaks at about 1.9 r, against the 2.4 r the grid affords at this radius.
    const wob = 0.7 + ((i * 43) % 17) / 30;       // where this strip starts
    const reach = 0.25 + ((i * 29) % 11) / 37;    // how long it is
    const r0 = r * base * wob;
    const r1 = r0 + r * reach;
    const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
    const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
    p.stroke(x0, y0, x1, y1, i % 3 === 0 ? light : i % 2 ? mid : dark, thick);
    // A one-pixel kink at the trailing end. Straight strips read as spokes.
    p.set(x1 + Math.cos(a + 1.6), y1 + Math.sin(a + 1.6), dark);
  }
}

// ---------------------------------------------------------------------------
// Baked sprites. One array per colour, built on first use and never rebuilt — the
// buoyancy sim draws these dozens of times a frame and cannot afford a repaint.
// ---------------------------------------------------------------------------

/**
 * One grid for both the balloon and its burst, sized for the burst.
 *
 * The balloon needs about 18 x 28 of this and the rest is transparent, which is the
 * right trade: sharing a grid means both share an origin, so the burst is guaranteed to
 * appear exactly where the balloon was rather than a pixel or two off it. Sizing them
 * separately is how you get a pop that jumps.
 */
const BW = 36;
const BH = 48;
/** The pixel the string ties to: bottom centre, under the knot. */
const KNOT_X = 18;
const KNOT_Y = 34;

/** Balloon body radius and height in art pixels — a ~0.6 m balloon at `ART_PPM`. */
const RX = 8;
const BODY_H = 24;

export const BALLOON_FRAMES = 6;
export const BALLOON_FPS = 7;
const POP_FRAMES = 3;
const POP_FPS = 16;

const bodyCache = new Map<number, (HTMLCanvasElement | undefined)[]>();
const popCache = new Map<number, (HTMLCanvasElement | undefined)[]>();

/** The idle jiggle: a slow breathe, ±6% on the long axis. */
const squashAt = (f: number) => 1 + 0.06 * Math.sin((f / BALLOON_FRAMES) * TAU);

function balloonSprite(color: number, f: number): HTMLCanvasElement {
  let frames = bodyCache.get(color);
  if (!frames) bodyCache.set(color, (frames = new Array(BALLOON_FRAMES)));
  const hit = frames[f];
  if (hit) return hit;

  const p = new Px(BW, BH);
  const sq = squashAt(f);
  const h = Math.round(BODY_H * sq);
  paintBalloon(p, KNOT_X, KNOT_Y - h - 2, RX, BODY_H, partyRamp(color), sq);
  p.outline();
  return (frames[f] = p.toCanvas());
}

function popSprite(color: number, f: number): HTMLCanvasElement {
  let frames = popCache.get(color);
  if (!frames) popCache.set(color, (frames = new Array(POP_FRAMES)));
  const hit = frames[f];
  if (hit) return hit;

  const p = new Px(BW, BH);
  paintPop(p, KNOT_X, KNOT_Y - BODY_H * 0.5, RX * 0.9, partyRamp(color), f);
  p.outline();
  return (frames[f] = p.toCanvas());
}

/**
 * Draws one balloon in the world, hanging above the point its string is tied to.
 *
 * The caller supplies the *knot* position — where the string meets the balloon — and a
 * `lean`, which is how far the balloon is trailing behind whatever it is attached to.
 * Leaning the sprite rather than just offsetting it is most of what sells a floating
 * object as being dragged around: a balloon on a car doing 30 m/s should not be sitting
 * bolt upright.
 */
export function drawBalloon(
  ctx: Ctx, x: number, y: number, scale: number, color: number, f: number, lean: number,
) {
  const s = balloonSprite(color, ((f % BALLOON_FRAMES) + BALLOON_FRAMES) % BALLOON_FRAMES);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  blitPixels(ctx, s, KNOT_X, KNOT_Y, scale / ART_PPM);
  ctx.restore();
}

/** The burst, drawn where the balloon was. `f` is the pop frame, 0..2. */
export function drawBalloonPop(
  ctx: Ctx, x: number, y: number, scale: number, color: number, f: number, lean: number,
) {
  if (f >= POP_FRAMES) return;
  const s = popSprite(color, f);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  blitPixels(ctx, s, KNOT_X, KNOT_Y, scale / ART_PPM);
  ctx.restore();
}

/** How long the whole pop animation runs, so the sim knows when to drop the balloon. */
export const POP_TIME = POP_FRAMES / POP_FPS;
export const popFrameAt = (elapsed: number) => Math.floor(elapsed * POP_FPS);

/**
 * The string, drawn as pixels rather than as a stroked path.
 *
 * A `lineTo` at world scale gives a smooth one-device-pixel hair that reads as a
 * different art set the moment it sits next to a chunky outlined balloon. Stepping
 * along the curve and stamping `ART_PPM`-sized squares keeps the string on the same
 * grid as everything else in the frame, which is rule 6 doing its job.
 */
export function drawString(
  ctx: Ctx, x0: number, y0: number, x1: number, y1: number, scale: number, sag: number,
) {
  const px = scale / ART_PPM;
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / px));
  ctx.fillStyle = INK;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // One control point pulled sideways gives the slack a real curve; a straight
    // string reads as a stick and a balloon on a stick is a lollipop.
    const bend = Math.sin(t * Math.PI) * sag;
    const x = x0 + (x1 - x0) * t + bend;
    const y = y0 + (y1 - y0) * t;
    ctx.fillRect(Math.round(x / px) * px, Math.round(y / px) * px, px, px);
  }
}
