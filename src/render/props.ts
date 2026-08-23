import { TAU } from "../core/math";
import { drawAmmoIcon, drawAmmoProp, hasAmmoArt } from "./ammoart";
import type { Ctx } from "./draw";

/**
 * The payload props, as the rest of the game sees them.
 *
 * These used to be the art itself — vector cars, quadratic-curve fuselages, stroked
 * piano lids. They are now a thin naming layer over `render/ammoart.ts`, which draws
 * every round as pixel art from the same buffer and the same palette as the guns in
 * `render/gunart.ts`. The seam is worth keeping: `weapons/ammo.ts` names a payload's
 * art as `P.drawCar` rather than as a string, so a typo in a round's art is a compile
 * error rather than a projectile that renders as nothing.
 */
export type PropDraw = (ctx: Ctx, w: number, h: number, t: number) => void;

/**
 * `h` is deliberately dropped: a pixel sprite is scaled off the collider's width
 * alone so its pixels stay square, which is rule 6 of the art. The sprite's own
 * aspect ratio is authored to match the collider it belongs to.
 */
const propFor = (id: string): PropDraw => (ctx, w, _h, t) => drawAmmoProp(ctx, id, w, t);

export const drawCar = propFor("car");
export const drawPlane = propFor("plane");
export const drawRocket = propFor("rocket");
export const drawAnvil = propFor("anvil");
export const drawPiano = propFor("piano");
export const drawFridge = propFor("fridge");
export const drawBowling = propFor("bowling");
export const drawWatermelon = propFor("watermelon");
export const drawSawblade = propFor("sawblade");
export const drawTv = propFor("tv");
export const drawNuke = propFor("nuke");
export const drawBlackhole = propFor("blackhole");
export const drawBarrel = propFor("barrel");
export const drawGrenade = propFor("grenade");

/** Ammo-wheel glyph, drawn centred in a `size`-wide box. */
export function drawIcon(ctx: Ctx, id: string, size: number, t: number) {
  if (!hasAmmoArt(id)) {
    ctx.fillStyle = "#888";
    ctx.fillRect(-size * 0.4, -size * 0.4, size * 0.8, size * 0.8);
    return;
  }
  drawAmmoIcon(ctx, id, size, t);
}

/**
 * Rasterised ammo glyphs for the HUD.
 *
 * The wheel shows every round at once, and re-running every drawing on every frame
 * cost more than the entire world render. Each icon is baked once into a small
 * offscreen canvas and blitted after. The Y flip is baked in too, since the HUD draws
 * in screen space.
 */
const ICON_PX = 128;
const iconCache = new Map<string, HTMLCanvasElement>();

/** Scratch buffers reused by every bake, so a full wheel costs two canvases, not forty. */
let stampA: HTMLCanvasElement | null = null;
let stampB: HTMLCanvasElement | null = null;

/**
 * Grows `src`'s silhouette by `r` pixels and recolours the result.
 *
 * Canvas2D has no outline-a-bitmap primitive, so the shape is stamped in a ring of
 * offset copies to union a fatter version of itself, then `source-in` repaints that
 * union flat. Rings rather than a filled disc because only the *edge* has to be
 * covered — whatever the ring leaves hollow is painted over by the glyph itself.
 */
function dilate(src: HTMLCanvasElement, dst: HTMLCanvasElement, r: number, color: string) {
  const g = dst.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, ICON_PX, ICON_PX);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.drawImage(src, Math.cos(a) * r, Math.sin(a) * r);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4;
    g.drawImage(src, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
  }
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, ICON_PX, ICON_PX);
  g.globalCompositeOperation = "source-over";
}

export function iconBitmap(id: string): HTMLCanvasElement {
  let c = iconCache.get(id);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = ICON_PX;
  const g = c.getContext("2d")!;

  if (!stampA) {
    stampA = document.createElement("canvas");
    stampA.width = stampA.height = ICON_PX;
    stampB = document.createElement("canvas");
    stampB.width = stampB.height = ICON_PX;
  }
  const sa = stampA.getContext("2d")!;
  sa.setTransform(1, 0, 0, 1, 0, 0);
  sa.clearRect(0, 0, ICON_PX, ICON_PX);
  sa.translate(ICON_PX / 2, ICON_PX / 2);
  sa.scale(1, -1); // icons are authored +Y up, like the world
  sa.lineJoin = "round";
  // Slightly under full size: the rim below needs somewhere to go.
  drawIcon(sa, id, ICON_PX * 0.78, 0);

  /*
   * Two rims, and both are load-bearing.
   *
   * These glyphs run the full value range — the stickman and the bowling ball are
   * near-black, the fridge and the jetliner are near-white — and they are blitted onto
   * a dark HUD slot, a pale results card and a level-select thumbnail of any colour.
   * A single rim only ever solves one of those. A dark outer halo carries the light
   * glyphs against light ground, a white keyline inside it carries the dark ones
   * against dark ground, and every glyph ends up reading as a sticker on any backing.
   */
  dilate(stampA, stampB!, 9, "rgba(8,10,16,0.5)");
  g.drawImage(stampB!, 0, 0);
  dilate(stampA, stampB!, 5, "rgba(255,255,255,0.92)");
  g.drawImage(stampB!, 0, 0);
  g.drawImage(stampA, 0, 0);

  iconCache.set(id, c);
  return c;
}
