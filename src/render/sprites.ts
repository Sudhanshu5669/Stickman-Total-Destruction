import type { Ctx } from "./draw";

/**
 * Pixel-art sprite sheets, and the one place that knows how to put one on the screen.
 *
 * Everything else in this renderer is drawn from code — that is the house style, and it
 * is why the game ships without an art pipeline. This module is the exception, added so
 * one level can be built out of a bought tileset without the other four learning that
 * bitmaps exist. Nothing here is on any hot path a spriteless level touches: no sheet is
 * fetched unless something asks for it, and every draw is a no-op until it arrives.
 *
 * ## The two things that are easy to get wrong
 *
 * **The world is Y-up; canvas is Y-down.** `Camera.apply` ends with `scale(z, -z)`, so a
 * naive `drawImage` inside the world transform renders every sprite upside down. `blit`
 * undoes the flip locally, which is why it takes the sprite's *top* edge rather than its
 * centre — a prop is placed by where it stands, and standing is a bottom-edge idea.
 *
 * **Pixel art must not be interpolated.** The camera zoom is continuous and arbitrary, so
 * every sprite lands on fractional pixels; with smoothing on, a 32px tile turns to mush
 * at exactly the moment the player leans in to look at it. `imageSmoothingEnabled` is
 * part of the canvas state, so setting it inside a `save()/restore()` pair is both
 * correct and free.
 */

/**
 * Every PNG under `src/Assets`, as a URL Vite has hashed and emitted.
 *
 * A glob rather than a list of imports: the packs are third-party and arrive as whole
 * folders, so anything that requires editing a manifest to use one more rock is a
 * manifest that will be wrong within a week. Vite resolves this at build time, so
 * unreferenced sheets still cost nothing but a string in the bundle.
 */
const URLS = import.meta.glob("../Assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Source-pixels per world metre. The packs are drawn on a 32px grid, so a tile is 1m. */
export const PPM = 32;

/** How much of a cell must be opaque before `covered()` calls it worth building. */
const COVER_MIN = 0.18;

export class Sheet {
  readonly img = new Image();
  /** False until the bitmap is decoded. Every draw checks it; none of them wait. */
  ready = false;
  failed = false;

  /** Per-cell opaque fraction, computed once on demand. Keyed by cell size. */
  private cover = new Map<number, Float32Array>();
  private coverCols = 0;

  constructor(readonly path: string, url: string) {
    this.img.onload = () => { this.ready = true; };
    this.img.onerror = () => {
      this.failed = true;
      console.warn(`[sprites] missing sheet ${path}`);
    };
    this.img.src = url;
  }

  get w() { return this.img.naturalWidth; }
  get h() { return this.img.naturalHeight; }

  /**
   * Fraction of cell (tx, ty) that is not transparent.
   *
   * This is what lets a structure be built straight from its own artwork: lay a grid of
   * blocks over a house sprite, ask each cell whether there is any house in it, and the
   * roof's diagonal comes out of the tileset instead of out of a hand-written table of
   * which tiles to skip. Reading the pixels back is a one-off cost per sheet, and it
   * cannot be done before `ready` — callers get 1 until then, which is the safe answer.
   */
  coverage(tx: number, ty: number, cell = PPM): number {
    if (!this.ready) return 1;
    let grid = this.cover.get(cell);
    if (!grid) {
      grid = this.bakeCoverage(cell);
      this.cover.set(cell, grid);
    }
    if (tx < 0 || ty < 0 || tx >= this.coverCols) return 0;
    const i = ty * this.coverCols + tx;
    return i < grid.length ? grid[i] : 0;
  }

  /** True when a cell holds enough art to be worth a rigid body. */
  covered(tx: number, ty: number, cell = PPM): boolean {
    return this.coverage(tx, ty, cell) >= COVER_MIN;
  }

  private bakeCoverage(cell: number): Float32Array {
    const cols = Math.max(1, Math.floor(this.w / cell));
    const rows = Math.max(1, Math.floor(this.h / cell));
    this.coverCols = cols;
    const out = new Float32Array(cols * rows);
    try {
      const c = document.createElement("canvas");
      c.width = this.w;
      c.height = this.h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(this.img, 0, 0);
      const data = g.getImageData(0, 0, this.w, this.h).data;
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          let hit = 0;
          for (let y = 0; y < cell; y++) {
            let p = ((ty * cell + y) * this.w + tx * cell) * 4 + 3;
            for (let x = 0; x < cell; x++, p += 4) if (data[p] > 24) hit++;
          }
          out[ty * cols + tx] = hit / (cell * cell);
        }
      }
    } catch {
      // A tainted canvas would only happen if a sheet came from another origin, which
      // Vite's bundling rules out. Treat every cell as solid rather than build nothing.
      out.fill(1);
    }
    return out;
  }
}

const sheets = new Map<string, Sheet>();

/**
 * Resolves a short name to a sheet, loading it on first use.
 *
 * `name` is the path under `src/Assets` — e.g.
 * `"GandalfHardcore FREE Platformer Assets/Decor.png"`. Returns a `Sheet` either way;
 * one that never loads simply never draws.
 */
export function sheet(name: string): Sheet {
  const found = sheets.get(name);
  if (found) return found;
  const key = `../Assets/${name}`;
  const url = URLS[key];
  if (!url) console.warn(`[sprites] no such sheet: ${name}`);
  const s = new Sheet(name, url ?? "");
  sheets.set(name, s);
  return s;
}

/**
 * Warms a set of sheets and resolves once they have all settled.
 *
 * Resolves on failure as well as success, and on a timeout: a level that cannot fetch
 * its tileset must still be enterable, just plainer. Boot calls this alongside the
 * physics download, where it costs nothing wall-clock.
 */
export function preload(names: readonly string[], timeoutMs = 8000): Promise<void> {
  const pending = names.map((n) => {
    const s = sheet(n);
    if (s.ready || s.failed) return Promise.resolve();
    return new Promise<void>((res) => {
      s.img.addEventListener("load", () => res(), { once: true });
      s.img.addEventListener("error", () => res(), { once: true });
    });
  });
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    Promise.all(pending).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Draws a source rect of `s` into the world, Y-flip undone.
 *
 * `x` is the left edge and `yTop` the *top* edge, both in world metres, both in the
 * coordinate space that is already on the context — so this works unchanged inside a
 * `Block`'s local transform as well as at world scale.
 */
export function blit(
  ctx: Ctx, s: Sheet,
  sx: number, sy: number, sw: number, sh: number,
  x: number, yTop: number, w: number, h: number,
  flip = false, alpha = 1,
) {
  if (!s.ready || sw <= 0 || sh <= 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.translate(x + (flip ? w : 0), yTop);
  ctx.scale(flip ? -1 : 1, -1);
  ctx.drawImage(s.img, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
}

/**
 * `blit` in tile units: source measured in `PPM`-sized cells, destination in metres.
 * Placed by its **bottom** edge, because props stand on things.
 */
export function blitTiles(
  ctx: Ctx, s: Sheet,
  tx: number, ty: number, tw: number, th: number,
  x: number, yBottom: number, scale = 1,
  flip = false, alpha = 1,
) {
  blit(
    ctx, s, tx * PPM, ty * PPM, tw * PPM, th * PPM,
    x, yBottom + th * scale, tw * scale, th * scale, flip, alpha,
  );
}
