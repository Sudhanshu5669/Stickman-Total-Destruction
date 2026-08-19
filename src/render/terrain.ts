import { hash01 } from "../core/math";
import { rgba, shade, type Ctx } from "./draw";

/**
 * Surface treatment for a ground slab, drawn in world space (+Y up).
 *
 * The lower third of the frame is the largest single area of colour in the game, and
 * as one flat fill it was dead weight — no depth, no scale reference, and nothing to
 * make the bright line at the top read as a *surface* rather than a colour change.
 * This gives that band a structure: topsoil under the crust, strata below it, stones
 * and roots caught in between, and one hard bright edge at the very top.
 *
 * Two rules hold it together. First, everything here is deterministic in world x, so
 * the ground never shimmers or crawls as the camera moves. Second, contrast is spent
 * from the top down — the crust is loud, the topsoil is quiet, the deep strata are
 * nearly invisible — because the playable band has to stay the clearest thing on
 * screen and detail competing with the action is worse than no detail at all.
 */
export interface GroundOptions {
  /** Slab body colour, from `Theme.ground` (or `Theme.rock` for ledges). */
  color: string;
  /** Crust colour, from `Theme.groundTop` (or `Theme.rockTop`). */
  topColor: string;
  /** Dead worlds get no tufts. */
  vegetation: boolean;
  /** Visible world span, so a 300-metre slab only ever decorates what is on screen. */
  fromX: number;
  toX: number;
  /**
   * Skips the left and right edges of the outline. Endless mode lays the ground one
   * slab per chunk, and a boxed outline puts a dark seam at every join.
   */
  seamless?: boolean;
}

/** Crust thickness in metres. Thin, so it reads as a line and not a second slab. */
const CRUST = 0.3;

export function groundSurface(
  ctx: Ctx,
  cx: number, cy: number, w: number, h: number,
  o: GroundOptions,
) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const top = y + h;
  // Nothing scattered is placed outside the visible span, and never outside the slab.
  const from = Math.max(x, o.fromX);
  const to = Math.min(x + w, o.toX);

  ctx.fillStyle = o.color;
  ctx.fillRect(x, y, w, h);

  // --- strata ----------------------------------------------------------------
  // Bands get thinner and darker with depth, which is the whole illusion: parallel
  // lines at an even pitch read as stripes, at an uneven one they read as geology.
  const bands = Math.min(5, Math.max(2, Math.floor(h / 1.1)));
  for (let i = 1; i <= bands; i++) {
    const t = i / (bands + 1);
    const by = top - CRUST - t * (h - CRUST) * 1.05;
    if (by < y) break;
    ctx.fillStyle = rgba("#000000", 0.06 + t * 0.12);
    ctx.fillRect(x, by, w, (0.26 - t * 0.14) * h * 0.4);
  }

  // --- stones ----------------------------------------------------------------
  // One path, one fill. A stone per ~2.4 m of visible ground is enough to give scale
  // without turning the soil into noise.
  if (to > from) {
    ctx.beginPath();
    const step = 2.4;
    for (let gx = Math.ceil(from / step) * step; gx < to; gx += step) {
      const a = hash01(gx * 1.7);
      if (a < 0.35) continue;
      const b = hash01(gx * 5.3);
      const sy = top - CRUST - 0.25 - b * (h - CRUST - 0.4);
      if (sy < y + 0.1) continue;
      const r = 0.07 + a * 0.16;
      ctx.moveTo(gx + r * 1.5, sy);
      ctx.ellipse(gx, sy, r * 1.5, r, (a - 0.5) * 1.2, 0, Math.PI * 2);
    }
    ctx.fillStyle = shade(o.color, 0.16);
    ctx.fill();

    // --- roots ---------------------------------------------------------------
    // Hairlines hanging off the crust. They tie the bright top edge to the mass below
    // it, so the crust stops looking like a stripe laid on top of a rectangle.
    ctx.beginPath();
    const rstep = 3.1;
    for (let gx = Math.ceil(from / rstep) * rstep; gx < to; gx += rstep) {
      const a = hash01(gx * 2.9);
      if (a < 0.4) continue;
      const len = (0.5 + a * 1.3) * Math.min(1, h / 4);
      ctx.moveTo(gx, top - CRUST);
      ctx.lineTo(gx + (hash01(gx * 7.1) - 0.5) * 0.5, top - CRUST - len);
      const fy = top - CRUST - len * 0.55;
      ctx.moveTo(gx, fy);
      ctx.lineTo(gx + (a > 0.7 ? 0.45 : -0.45), fy - 0.3);
    }
    ctx.strokeStyle = rgba("#000000", 0.16);
    ctx.lineWidth = 0.035;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // --- crust -----------------------------------------------------------------
  // Topsoil first: a darker band under the bright edge. Without it the crust sits on
  // the body like a sticker; with it there is a transition and the edge reads as depth.
  ctx.fillStyle = shade(o.topColor, -0.5);
  ctx.fillRect(x, top - CRUST * 1.75, w, CRUST * 0.9);
  ctx.fillStyle = o.topColor;
  ctx.fillRect(x, top - CRUST, w, CRUST);
  // The lit lip. This is the single most important line in the frame — it is what the
  // eye locks onto as "the floor", and what every black silhouette is read against.
  ctx.fillStyle = shade(o.topColor, 0.42);
  ctx.fillRect(x, top - CRUST * 0.3, w, CRUST * 0.3);

  ctx.strokeStyle = rgba("#000000", 0.3);
  ctx.lineWidth = 0.05;
  if (o.seamless) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, w, h);
  }

  if (!o.vegetation || to <= from) return;

  // --- tufts -----------------------------------------------------------------
  // Sparse blades breaking the top line, batched into one stroke. A perfectly straight
  // horizon edge is the thing that made the old ground read as a UI element.
  ctx.beginPath();
  const step = 0.7;
  for (let gx = Math.ceil(from / step) * step; gx < to; gx += step) {
    const a = hash01(gx * 3.1);
    if (a < 0.45) continue;
    ctx.moveTo(gx, top);
    ctx.lineTo(gx + (a - 0.5) * 0.3, top + 0.16 + a * 0.22);
    if (a > 0.8) {
      ctx.moveTo(gx + 0.12, top);
      ctx.lineTo(gx + 0.26, top + 0.14 + a * 0.14);
    }
  }
  ctx.strokeStyle = shade(o.topColor, 0.2);
  ctx.lineWidth = 0.05;
  ctx.lineCap = "round";
  ctx.stroke();
}
