/**
 * The pixel-art engine, shared by everything in the game that is authored pixel by
 * pixel: the guns in `gunart.ts` and the rounds they fire in `ammoart.ts`.
 *
 * It used to live inside `gunart.ts`, private to the arsenal. That was fine while the
 * guns were the only pixel art in the frame, and wrong the moment the payloads joined
 * them: a chunky outlined rocket launcher firing a smooth vector rocket is two art
 * styles in one screenshot, and the eye reads the seam long before it reads either
 * object. Guns and ammo now share one buffer class, one outline colour, one set of
 * material ramps and one light direction, which is the entire reason they look like
 * they belong to the same game.
 *
 * ## The rules the art follows
 *
 * 1. **Silhouette first.** At forty pixels across, shape is the only thing that reads.
 * 2. **One-pixel outline, always the same near-black** (`INK`). It is what separates a
 *    prop from a busy tileset behind it, and one shared outline colour is most of what
 *    makes mixed subjects look like one art set.
 * 3. **Light from the top-left.** Highlight along the top of a cylinder, shadow along
 *    the bottom; a sphere lit from the upper left. Applied by `tube`, `pillar` and
 *    `ball` rather than by hand so it cannot drift between objects.
 * 4. **Three values per material, no more.** Ramps are defined once in `RAMPS`, or
 *    derived from one base colour by `ramp()`. More values at this size reads as noise.
 * 5. **Emissive things are not outlined.** Flame, screens and event horizons are drawn
 *    *after* `outline()` via `soft()`, so light spills over the ink instead of being
 *    fenced in by it. Everything solid is outlined, without exception.
 * 6. **One pixel size for the whole game** (`ART_PPM`). A jetliner gets a sprite that is
 *    three hundred pixels long rather than a small sprite with big pixels — mixed pixel
 *    densities are the one mistake that instantly reads as "assets from two places".
 */

/**
 * Source pixels per world metre, for every pixel-art sprite in the game.
 *
 * 32 is chosen against the camera, which sits near 34 screen pixels per metre: art
 * authored at 32 displays at roughly 1:1 in normal play, so the pixels stay pixels
 * instead of dissolving into a resample.
 */
export const ART_PPM = 32;

/** The one outline colour in the game. See rule 2. */
export const INK = "#141821";

/**
 * Three-value material ramps: [dark, mid, light].
 *
 * Named after what they are rather than what colour they are, so a sprite asks for
 * "wood" and stays right if the wood ramp is ever retuned.
 */
export const RAMPS = {
  steel: ["#232a36", "#586477", "#b3bccd"],
  gunmetal: ["#181b23", "#333a48", "#616b7f"],
  wood: ["#341e10", "#70472a", "#ad7947"],
  brass: ["#5c4109", "#c2921f", "#ffe08a"],
  plastic: ["#1e222b", "#4a5265", "#8b95ab"],
  rust: ["#3a1a10", "#853f1f", "#c47a42"],
} as const;

export type RampName = keyof typeof RAMPS;
export type Ramp3 = readonly [string, string, string];
export type Shade = RampName | Ramp3;

/** Lightens (t>0) or darkens (t<0) a hex colour, staying in 6-digit hex. */
export function shadeHex(hex: string, t: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))));
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, "0")}`;
}

/**
 * A three-value ramp built from one base colour.
 *
 * Payloads are recognisable by colour — the barrel is *that* red, the fridge is *that*
 * white — so most of them supply a base rather than picking a named material. Deriving
 * the shadow and the highlight by fixed ratios keeps every derived ramp as contrasty as
 * the hand-tuned ones in `RAMPS`.
 */
export function ramp(base: string, dark = -0.42, light = 0.3): Ramp3 {
  return [shadeHex(base, dark), base, shadeHex(base, light)];
}

const res = (s: Shade): Ramp3 => (typeof s === "string" ? RAMPS[s] : s);

/**
 * A tiny indexed pixel buffer.
 *
 * Deliberately not a canvas: `outline()` has to ask "is this pixel empty" of its
 * neighbours tens of thousands of times, and doing that through `getImageData` on a
 * real canvas is both slower and far more code. The canvas is produced once at the end.
 *
 * Cells hold `#rrggbb` or `#rrggbbaa`; the alpha form exists for rule 5's emissive
 * passes and nothing else.
 */
export class Px {
  readonly cells: (string | null)[];

  constructor(readonly w: number, readonly h: number) {
    this.cells = new Array(w * h).fill(null);
  }

  set(x: number, y: number, c: string | null) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.cells[y * this.w + x] = c;
  }

  get(x: number, y: number): string | null {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.cells[y * this.w + x];
  }

  /** Paints only where nothing has been painted yet — the emissive pass of rule 5. */
  soft(x: number, y: number, c: string) {
    if (this.get(x, y) === null) this.set(x, y, c);
  }

  rect(x: number, y: number, w: number, h: number, c: string | null) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Horizontal run. The most common primitive by far — most of a prop is a slab. */
  row(x: number, y: number, w: number, c: string) {
    for (let i = 0; i < w; i++) this.set(x + i, y, c);
  }

  col(x: number, y: number, h: number, c: string) {
    for (let j = 0; j < h; j++) this.set(x, y + j, c);
  }

  /** A right-pointing wedge, for muzzle brakes, funnels and fins. */
  wedge(x: number, y: number, w: number, hStart: number, hEnd: number, c: string) {
    for (let i = 0; i < w; i++) {
      const h = Math.round(hStart + ((hEnd - hStart) * i) / Math.max(1, w - 1));
      this.rect(x + i, y - (h >> 1), 1, h, c);
    }
  }

  /** `wedge`, shaded — a nose cone lit the same way the barrel behind it is. */
  cone(x: number, y: number, w: number, hStart: number, hEnd: number, s: Shade, dir: 1 | -1 = 1) {
    const [dark, mid, light] = res(s);
    for (let i = 0; i < w; i++) {
      const h = Math.round(hStart + ((hEnd - hStart) * i) / Math.max(1, w - 1));
      if (h <= 0) continue;
      const cx = x + i * dir;
      const top = Math.round(y - h / 2);
      this.rect(cx, top, 1, h, mid);
      this.set(cx, top, light);
      if (h >= 3) this.set(cx, top + h - 1, dark);
    }
  }

  /**
   * A horizontal body with its top row lightened and its bottom row darkened.
   *
   * This one call is rule 3, and it is why every barrel, fuselage and chassis in the
   * game agrees about where the light is coming from.
   */
  tube(x: number, y: number, w: number, h: number, s: Shade, band = 1) {
    const [dark, mid, light] = res(s);
    this.rect(x, y, w, h, mid);
    const b = Math.min(band, (h - 1) >> 1);
    for (let i = 0; i < b; i++) if (h >= 2) this.row(x, y + i, w, light);
    for (let i = 0; i < b; i++) if (h >= 3) this.row(x, y + h - 1 - i, w, dark);
  }

  /**
   * `tube` stood on end: a vertical cylinder, lit down its left side.
   *
   * `band` widens the lit and shadowed edges. One pixel is right for a gun barrel and
   * far too thin on a two-metre fridge, where a single lit column reads as a scratch
   * rather than as a curved surface.
   */
  pillar(x: number, y: number, w: number, h: number, s: Shade, band = 1) {
    const [dark, mid, light] = res(s);
    this.rect(x, y, w, h, mid);
    const b = Math.min(band, (w - 1) >> 1);
    for (let i = 0; i < b; i++) if (w >= 2) this.col(x + i, y, h, light);
    for (let i = 0; i < b; i++) if (w >= 3) this.col(x + w - 1 - i, y, h, dark);
  }

  disc(cx: number, cy: number, r: number, c: string) {
    this.ellipse(cx, cy, r, r, c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }

  /**
   * A lit sphere — bowling balls, watermelons, grenades, heads.
   *
   * Shaded off the real surface normal rather than off a flat diagonal, because a ball
   * is the one shape where a fake gradient is obvious: the terminator has to curve.
   */
  ball(cx: number, cy: number, r: number, s: Shade) {
    const [dark, mid, light] = res(s);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
        const q = dx * dx + dy * dy;
        if (q > 1) continue;
        // Light at the upper left and slightly in front of the surface.
        const d = -0.5 * dx - 0.5 * dy + 0.7 * Math.sqrt(1 - q);
        this.set(x, y, d > 0.85 ? light : d < 0.45 ? dark : mid);
      }
    }
  }

  /** Filled triangle, by half-plane test on pixel centres. Wings, fins, wedges. */
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: string) {
    const x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx));
    const y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const sgn = area > 0 ? 1 : -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * sgn;
        const w1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * sgn;
        const w2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * sgn;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) this.set(x, y, c);
      }
    }
  }

  /** Convex quad as two triangles — swept wings, propped piano lids, windscreens. */
  quad(pts: readonly (readonly [number, number])[], c: string) {
    this.tri(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], c);
    this.tri(pts[0][0], pts[0][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1], c);
  }

  /** A straight run of pixels `thick` wide. Antennae, wires, stick-figure limbs. */
  stroke(x0: number, y0: number, x1: number, y1: number, c: string, thick = 1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2);
    const o = (thick - 1) / 2;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      this.rect(Math.round(x - o), Math.round(y - o), thick, thick, c);
    }
  }

  /** An annular sector. Accretion discs, hoops seen at an angle, rims. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, thick: number, c: string) {
    const rOut = r + thick / 2, rIn = r - thick / 2;
    for (let y = Math.floor(cy - rOut); y <= Math.ceil(cy + rOut); y++) {
      for (let x = Math.floor(cx - rOut); x <= Math.ceil(cx + rOut); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const q = Math.hypot(dx, dy);
        if (q < rIn || q > rOut) continue;
        let a = Math.atan2(dy, dx);
        while (a < a0) a += Math.PI * 2;
        if (a <= a1) this.set(x, y, c);
      }
    }
  }

  /** Draws `INK` around everything non-empty. Run last, after all solid shapes. */
  outline() {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== null) continue;
        if (
          this.get(x - 1, y) !== null || this.get(x + 1, y) !== null ||
          this.get(x, y - 1) !== null || this.get(x, y + 1) !== null
        ) add.push(y * this.w + x);
      }
    }
    for (const i of add) this.cells[i] = INK;
  }

  /** Tight box around the painted pixels, for fitting a sprite into an icon slot. */
  bounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.cells[y * this.w + x] === null) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w: this.w, h: this.h };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext("2d")!;
    const img = g.createImageData(this.w, this.h);
    // Colours repeat thousands of times per sprite; parsing each one once keeps a
    // 350-pixel jetliner a sub-millisecond bake instead of 60,000 parseInt calls.
    const seen = new Map<string, [number, number, number, number]>();
    for (let i = 0; i < this.w * this.h; i++) {
      const hex = this.cells[i];
      if (!hex) continue;
      let rgba = seen.get(hex);
      if (!rgba) {
        const n = parseInt(hex.slice(1, 7), 16);
        rgba = [
          (n >> 16) & 255, (n >> 8) & 255, n & 255,
          hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255,
        ];
        seen.set(hex, rgba);
      }
      img.data[i * 4] = rgba[0];
      img.data[i * 4 + 1] = rgba[1];
      img.data[i * 4 + 2] = rgba[2];
      img.data[i * 4 + 3] = rgba[3];
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}

/**
 * Blits a sprite into the world with its `(ox, oy)` pixel landing on the local origin.
 *
 * The world transform ends in `scale(z, -z)` (see `Camera.apply`), so a naive
 * `drawImage` renders every sprite upside down; the local flip here undoes it. Callers
 * stay in metres — `mpp` is metres per art pixel, normally `1 / ART_PPM`.
 */
export function blitPixels(
  ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement,
  ox: number, oy: number, mpp: number,
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(1, -1);
  ctx.drawImage(sprite, -ox * mpp, -oy * mpp, sprite.width * mpp, sprite.height * mpp);
  ctx.restore();
}
