import type { Ctx } from "../render/draw";

/**
 * The one visual language the whole interface is drawn in.
 *
 * System 10 built the menu out of these rules and the front end stopped looking like a
 * website. The HUD was still speaking the old dialect — `roundRect`, translucent
 * plates, `shadowBlur` — so the game had two interfaces that disagreed with each other
 * the moment you pressed PLAY. Extracting the rules here rather than copying them is
 * the point: there is now exactly one implementation of what a panel is, and a change
 * to it moves the menu and the HUD together.
 *
 * The rules, unchanged from the menu:
 *
 * 1. **No gradient on a panel.** Depth is *value* — one lit row along the top, one dark
 *    row along the bottom — the same trick the weapon sprites use (`render/gunart.ts`),
 *    so the interface and the guns are lit from the same imaginary light.
 * 2. **No rounded corners.** The corner pixel is cut out instead. That single detail is
 *    most of what separates a pixel-art frame from a CSS card.
 * 3. **No drop shadows.** Separation is a one-pixel ink outline.
 */

export const INK = "#12151c";
export const CREAM = "#f4f1e8";
export const GOLD = "#ffd23f";
export const PANEL = "#1b2029";
export const PANEL_LIT = "#2b3340";
export const PANEL_DIM = "#0e1116";
export const MUTED = "rgba(244,241,232,0.42)";

/**
 * A hard-edged panel with its corners notched out and its top edge lit.
 *
 * `roundRect` + a shadow reads as a card; a notched rectangle with a one-pixel ink
 * border and a lighter top edge reads as a sprite. Both are four lines of code.
 *
 * `alpha` exists for the HUD only. The menu draws its panels solid, but a HUD panel
 * sits on top of the thing the player is actually aiming at, so the status blocks are
 * allowed to let the world through. It scales the *panel*, never the ink outline —
 * the outline is what keeps the block legible over a pale sky, and fading it is how the
 * old HUD lost its edges over the Test Range's ground.
 */
export function notchedPanel(
  ctx: Ctx, x: number, y: number, w: number, h: number, k: number,
  fill: string, inkOverride?: string, alpha = 1,
) {
  const n = Math.max(2, Math.round(3 * k)); // notch size, in whole pixels
  const ink = inkOverride ?? INK;

  ctx.fillStyle = ink;
  ctx.fillRect(x + n, y, w - n * 2, h);
  ctx.fillRect(x, y + n, w, h - n * 2);

  const i = Math.max(1, Math.round(k));
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = fill;
  ctx.fillRect(x + n + i, y + i, w - n * 2 - i * 2, h - i * 2);
  ctx.fillRect(x + i, y + n + i, w - i * 2, h - n * 2 - i * 2);

  // Value, not gradient: one lit row along the top, one dark row along the bottom.
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(x + n + i, y + i, w - n * 2 - i * 2, i);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(x + n + i, y + h - i * 2, w - n * 2 - i * 2, i);
  ctx.restore();
}

/**
 * A meter drawn as discrete cells rather than a continuous sliver.
 *
 * Same reasoning as the menu's unlock bar: a bar built out of cells reads as a game
 * meter, a smooth one reads as a loading indicator. It also makes small changes
 * visible — a continuous health bar losing 4% moves by a pixel nobody sees, where a
 * cell either is or is not lit.
 */
export function cellBar(
  ctx: Ctx, x: number, y: number, w: number, h: number, k: number,
  frac: number, fill: string, cells = 16,
) {
  const i = Math.max(1, Math.round(k));
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PANEL_DIM;
  ctx.fillRect(x + i, y + i, w - i * 2, h - i * 2);

  const lit = Math.round(Math.max(0, Math.min(1, frac)) * cells);
  const cw = (w - i * 2) / cells;
  ctx.fillStyle = fill;
  for (let c = 0; c < lit; c++) {
    ctx.fillRect(x + i + c * cw, y + i, Math.max(1, cw - i), h - i * 2);
  }
}
