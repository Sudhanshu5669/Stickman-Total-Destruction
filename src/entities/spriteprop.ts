import type { Actor, GameCtx } from "../core/types";
import { v, type V } from "../core/math";
import type { Ctx } from "../render/draw";
import { blitTiles, PPM, type Sheet } from "../render/sprites";
import { quality } from "../ui/quality";

export interface SpritePropOptions {
  sheet: Sheet;
  /** Source cell, in tiles. */
  tx: number;
  ty: number;
  /** Source size, in tiles. */
  tw: number;
  th: number;
  /** World position of the prop's **bottom centre** — where it stands. */
  x: number;
  y: number;
  /** Metres per source tile. 1 keeps the art at its drawn size; scale up for hero props. */
  scale?: number;
  flip?: boolean;
  alpha?: number;
  /** Draw order. Below terrain (0) puts a prop behind the level; above 10 puts it in front. */
  z?: number;
  /**
   * Frames laid out left-to-right then top-to-bottom starting at (tx, ty), and how many
   * to show per second. Omit for a still prop.
   */
  frames?: number;
  fps?: number;
  /** Sway amplitude in radians. Trees and reeds; 0 for anything built by people. */
  sway?: number;
}

/**
 * A piece of scenery that is only ever looked at.
 *
 * No rigid body, no damage model, nothing to collide with: this is the layer that makes
 * a level feel like a place rather than a physics test, and it earns that by being
 * cheap enough to use hundreds of. The things the player is *meant* to shoot are blocks
 * with a skin on them — see `Block.skin` — and those are a different object entirely.
 *
 * Anchored by the bottom centre because that is how scenery is actually positioned: you
 * put a tree *on the ground*, and the ground is one number you already have.
 */
export class SpriteProp implements Actor {
  dead = false;
  z: number;
  cullRadius: number;

  private readonly o: Required<Omit<SpritePropOptions, "sheet">> & { sheet: Sheet };
  private t = Math.random() * 10;

  constructor(private readonly game: GameCtx, o: SpritePropOptions) {
    this.o = {
      scale: 1, flip: false, alpha: 1, z: 5, frames: 1, fps: 10, sway: 0,
      ...o,
    } as Required<Omit<SpritePropOptions, "sheet">> & { sheet: Sheet };
    this.z = this.o.z;
    // Half the diagonal, plus slack for sway — a tree that pops in at the screen edge
    // is worse than a tree that costs one extra draw call.
    this.cullRadius = Math.max(this.o.tw, this.o.th) * this.o.scale * 0.9 + 1;
  }

  update(dt: number) {
    // Stills still advance the clock: it is what drives sway, and it is one add.
    this.t += dt;
  }

  cullPos(): V {
    return v(this.o.x, this.o.y + (this.o.th * this.o.scale) / 2);
  }

  draw(ctx: Ctx) {
    const o = this.o;
    if (!o.sheet.ready) return;

    let tx = o.tx;
    let ty = o.ty;
    if (o.frames > 1) {
      // Frames run left to right, then wrap to the next row — the layout every sheet in
      // these packs uses. (tx, ty) names the first frame; the rest are counted from it.
      const cols = Math.max(1, Math.floor(o.sheet.w / (o.tw * PPM)));
      const start = Math.floor(o.ty / o.th) * cols + Math.floor(o.tx / o.tw);
      const idx = start + (Math.floor(this.t * o.fps) % o.frames);
      tx = (idx % cols) * o.tw;
      ty = Math.floor(idx / cols) * o.th;
    }

    const w = o.tw * o.scale;
    const x = o.x - w / 2;

    if (o.sway > 0.0001 && quality.ambientMotion) {
      // Pivot at the base so the crown moves and the trunk does not — the one detail
      // that separates "tree in wind" from "sticker wobbling".
      const a = Math.sin(this.t * 0.9 + o.x * 0.21) * o.sway;
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(a);
      blitTiles(ctx, o.sheet, tx, ty, o.tw, o.th, -w / 2, 0, o.scale, o.flip, o.alpha);
      ctx.restore();
      return;
    }

    blitTiles(ctx, o.sheet, tx, ty, o.tw, o.th, x, o.y, o.scale, o.flip, o.alpha);
  }

  destroy() {
    // Nothing to release: no body, no collider, no listener.
    void this.game;
  }
}
