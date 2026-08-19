import type { Camera } from "../core/camera";
import { clamp, hash01, TAU } from "../core/math";
import { shade, type Ctx } from "./draw";
import type { Theme } from "./theme";

/**
 * Parallax backdrop drawn in screen space before the camera transform, so each layer
 * can scroll at its own rate without fighting the world projection.
 *
 * Everything is driven by the active `Theme` — swapping worlds is a palette change,
 * not a new code path. Layers paint far to near: a sky panel (gradient, stars, horizon
 * glow and the celestial bodies, all in one image), two cloud decks, a hazy far
 * silhouette, the main silhouette, three ridge bands, and the subsurface fill that
 * everything below the ground plane sits on.
 *
 * ## Why almost all of it is baked
 *
 * Canvas2D has no batching: cost tracks the number of draw calls and the number of
 * times each pixel is painted, not how complex the art is. Drawn naively this backdrop
 * is brutal — a city skyline with a window grid on every facade is well over a thousand
 * `fillRect`s per frame on its own, every frame, before the game has drawn anything.
 *
 * So every layer whose *content* is static is rasterised once into an offscreen strip
 * and blitted. Strips are baked at `REF` pixels-per-metre and scaled on blit, so camera
 * zoom costs nothing; they are generated periodically (column seeds wrap at the strip
 * width) so they tile seamlessly and a handful of blits covers any viewport. The whole
 * backdrop is ~30 draw calls per frame regardless of world, viewport or zoom.
 *
 * Depth is cued three ways at once — scroll rate, size, and palette (the theme's far
 * bands are lighter and less saturated than its near ones). Any one of those alone
 * reads as a sticker sliding around; all three read as distance.
 */

/** Pixels-per-metre every strip is baked at. Matches the camera's resting zoom. */
const REF = 34;

/** Scroll rates, far to near. 1.0 would be locked to the world. */
const D_SKYLINE_FAR = 0.06;
const D_SKYLINE = 0.14;
const D_HILL = [0.2, 0.32, 0.46] as const;
/** The near layer moves *faster* than the world — that is what sells it as close. */
const D_FOREGROUND = 1.45;

/** Ridge shape per band: lift and amplitude in metres, wavelength in metres. */
const HILLS = [
  { lift: 5.0, amp: 6.2, wave: 165, wave2: 61 },
  { lift: 2.6, amp: 4.0, wave: 88, wave2: 33 },
  { lift: 0.9, amp: 2.4, wave: 48, wave2: 19 },
] as const;

// `stripH` has to clear the tallest cluster a deck can generate — roughly two radii —
// or big clouds get their tops sheared flat against the edge of their own strip.
const CLOUD_DECKS = [
  // High and far: small, pale, barely moves.
  { lift: 11, drift: 0.35, depth: 0.05, size: 0.95, stripW: 1400, stripH: 150, share: 0.4 },
  // Low and near: big, solid, slides visibly.
  { lift: 4.5, drift: 0.8, depth: 0.1, size: 1.7, stripW: 1700, stripH: 300, share: 0.6 },
] as const;

/** A baked, horizontally tileable layer. `base` is the row that lands on the anchor. */
interface Strip {
  c: HTMLCanvasElement;
  w: number;
  h: number;
  base: number;
}

function makeStrip(w: number, h: number): { s: Strip; g: Ctx } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return { s: { c, w: c.width, h: c.height, base: c.height }, g: c.getContext("2d")! };
}

export class Background {
  private t = 0;
  /**
   * `drawHaze` runs after the world and needs the same camera `draw` just used. Game
   * calls the two back to back every frame, so the near pass borrows it from here
   * rather than forcing a signature change on the caller.
   */
  private cam: Camera | null = null;

  // --- per-theme bakes ---------------------------------------------------------
  private layerKey = "";
  private skylineNear: Strip | null = null;
  private skylineFar: Strip | null = null;
  private decks: Strip[] = [];
  private subsurface: Strip | null = null;
  private fg: Strip | null = null;

  // --- per-viewport bakes ------------------------------------------------------
  private skyKey = "";
  private sky: HTMLCanvasElement | null = null;
  private skyAnchor = 0;
  private postKey = "";
  private post: HTMLCanvasElement | null = null;

  update(dt: number) {
    this.t += dt;
  }

  draw(ctx: Ctx, cam: Camera, w: number, h: number, th: Theme) {
    this.cam = cam;
    if (this.layerKey !== th.id) this.bakeLayers(th);
    if (this.skyKey !== `${th.id}:${w}:${h}`) this.bakeSky(w, h, th);

    const z = cam.effectiveZoom;
    // Horizon is where world Y = 0 lands on screen, so backdrop and terrain agree.
    const horizon = h / 2 + cam.pos.y * z;

    // Sky panel is anchored to the horizon rather than the viewport, so climbing on the
    // jetpack actually flies you up into the darker, more saturated top of the sky.
    const sy = horizon - this.skyAnchor;
    if (sy > 0) {
      ctx.fillStyle = th.sky[0];
      ctx.fillRect(0, 0, w, Math.min(h, sy));
    }
    if (sy < h) ctx.drawImage(this.sky!, 0, sy);

    this.blit(ctx, this.decks[0], cam, w, horizon, z, CLOUD_DECKS[0].depth, CLOUD_DECKS[0].lift, this.t * CLOUD_DECKS[0].drift);
    this.blit(ctx, this.decks[1], cam, w, horizon, z, CLOUD_DECKS[1].depth, CLOUD_DECKS[1].lift, this.t * CLOUD_DECKS[1].drift);
    this.blit(ctx, this.skylineFar, cam, w, horizon, z, D_SKYLINE_FAR, 0, 0);
    this.blit(ctx, this.skylineNear, cam, w, horizon, z, D_SKYLINE, 0, 0);
    this.drawHills(ctx, cam, w, h, horizon, z, th);
    this.drawSubsurface(ctx, w, h, horizon, z, th);
  }

  /**
   * Tiles one baked strip across the viewport. `lift` raises the strip's baseline off
   * the horizon in metres; `drift` slides it along in metres on top of parallax.
   */
  private blit(
    ctx: Ctx, s: Strip | null, cam: Camera, w: number, horizon: number, z: number,
    depth: number, lift: number, drift: number,
  ) {
    if (!s) return;
    const k = z / REF;
    const y = horizon - lift * z - s.base * k;
    const tw = s.w * k;
    const th_ = s.h * k;
    // Deep in a canyon the far layers sit entirely off the top of the frame; skip them
    // rather than issue a screenful of blits nobody will see.
    if (tw < 1 || y > horizon + 4 || y + th_ < 0) return;
    const off = cam.pos.x * z * depth + drift * z;
    for (let x = -(((off % tw) + tw) % tw); x < w; x += tw) {
      ctx.drawImage(s.c, x, y, tw, th_);
    }
  }

  /**
   * Ridges stay live geometry rather than baked strips: at three fills and three
   * strokes they are already cheap in draw calls, and their wavelengths run to 160
   * metres, which would need a five-thousand-pixel strip to bake without repeating.
   */
  private drawHills(ctx: Ctx, cam: Camera, w: number, h: number, horizon: number, z: number, th: Theme) {
    const colors = [th.hillFar, th.hillMid, th.hillNear];
    for (let i = 0; i < 3; i++) {
      const L = HILLS[i];
      const off = cam.pos.x * z * D_HILL[i];
      const f1 = TAU / L.wave;
      const f2 = TAU / L.wave2;
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.moveTo(-10, h + 10);
      for (let sx = -10; sx <= w + 10; sx += 16) {
        const wx = (sx + off) / z;
        const y = horizon - (L.lift + L.amp * (0.6 + 0.4 * Math.sin(wx * f1)) * (0.7 + 0.3 * Math.sin(wx * f2))) * z;
        ctx.lineTo(sx, y);
      }
      ctx.lineTo(w + 10, h + 10);
      ctx.closePath();
      ctx.fill();
      // Lit rim along the crest. Every closing edge of this path is off-screen, so
      // stroking the whole thing only ever paints the ridge itself.
      ctx.strokeStyle = shade(colors[i], 0.26);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  /**
   * Everything below the ground plane, painted before the world so terrain slabs sit
   * on top of it.
   *
   * This is also the fix for the sky-strip seam. The terrain slabs are only six metres
   * deep, so on a tall viewport or a wide zoom the frame ran out of ground and showed
   * backdrop underneath. Filling from the horizon to the bottom of the viewport —
   * starting at exactly `theme.ground` so the join is invisible — means there is no
   * camera position or zoom at which anything can show through, and it doubles as the
   * depth cue that makes a canyon read as a hole rather than a gap in the art.
   */
  private drawSubsurface(ctx: Ctx, w: number, h: number, horizon: number, z: number, th: Theme) {
    if (horizon >= h || !this.subsurface) return;
    const s = this.subsurface;
    const bottom = horizon + s.h * (z / REF);
    // One stretched blit carries the gradient and every stratum. Past the bottom of the
    // strip it is bedrock all the way down, which is a flat fill — so however far the
    // camera drops, the whole subsurface still costs at most two calls.
    if (bottom < h) {
      const from = Math.max(0, bottom);
      ctx.fillStyle = th.underground;
      ctx.fillRect(0, from, w, h - from);
    }
    ctx.drawImage(s.c, 0, 0, s.w, s.h, 0, horizon, w, bottom - horizon);
  }

  /**
   * The near pass, drawn after the world: foreground parallax, the world's ambient
   * wash, and one baked layer carrying both ground haze and vignette.
   *
   * It runs here rather than inside `draw()` because all of it has to sit *over* the
   * action — a foreground layer behind the player is just more background, and a
   * vignette under the world does nothing at all. Haze and vignette are baked together
   * because each full-screen translucent pass costs a full screen of blending, and two
   * of them for one effect is the definition of wasted overdraw.
   */
  drawHaze(ctx: Ctx, w: number, h: number, th: Theme, cam: Camera | null = this.cam) {
    if (cam) this.drawForeground(ctx, cam, w, h, th);

    if (th.ambient && th.ambientAlpha) {
      // Tints the whole frame, which is what sells "night" or "under a green sun".
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = th.ambientAlpha;
      ctx.fillStyle = th.ambient;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    const key = `${th.id}:${w}:${h}`;
    if (this.postKey !== key) this.bakePost(w, h, th);
    ctx.drawImage(this.post!, 0, 0);
  }

  /**
   * Near-camera silhouettes sliding past faster than the world.
   *
   * The hard rule here is that gameplay wins: the strip is anchored to the *bottom
   * edge* of the viewport and scaled so its top can never reach the ground plane, so
   * nothing standing on the ground is ever behind one. It fades out entirely when the
   * camera drops into a canyon and there is no bottom strip left to decorate.
   */
  private drawForeground(ctx: Ctx, cam: Camera, w: number, h: number, th: Theme) {
    const s = this.fg;
    if (!s) return;
    const z = cam.effectiveZoom;
    const horizon = h / 2 + cam.pos.y * z;
    const gap = h - horizon;
    if (gap < 70) return;
    const alpha = clamp((gap - 70) / 110, 0, 1) * 0.92;
    const height = Math.min(gap * 0.72, 3.4 * z);
    if (height < 10) return;

    const k = height / s.h;
    const tw = s.w * k;
    const off = cam.pos.x * z * D_FOREGROUND;
    const y = h - s.base * k;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let x = -(((off % tw) + tw) % tw); x < w; x += tw) {
      ctx.drawImage(s.c, x, y, tw, s.h * k);
    }
    ctx.restore();
  }

  // ================================================================= bakes ======

  /**
   * Sky, stars, horizon glow and both celestial bodies in one image.
   *
   * All four are fixed relative to the horizon, so baking them together turns roughly
   * two hundred draw calls into one, and gets the stars a vertical parallax they never
   * had. The panel carries 1.35 viewports of sky above the horizon; past that the
   * caller flat-fills the top stop, which is the correct colour anyway.
   */
  private bakeSky(w: number, h: number, th: Theme) {
    const anchor = Math.round(h * 1.35);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = anchor + Math.round(h * 0.08);
    const g = c.getContext("2d")!;

    const gradTop = anchor - h * 0.88;
    const sky = g.createLinearGradient(0, gradTop, 0, anchor);
    sky.addColorStop(0, th.sky[0]);
    sky.addColorStop(0.42, th.sky[1]);
    sky.addColorStop(0.78, th.sky[2]);
    sky.addColorStop(1, th.sky[3]);
    g.fillStyle = th.sky[0];
    g.fillRect(0, 0, c.width, gradTop);
    g.fillStyle = sky;
    g.fillRect(0, gradTop, c.width, anchor - gradTop);
    g.fillStyle = th.sky[3];
    g.fillRect(0, anchor, c.width, c.height - anchor);

    if (th.stars > 0) {
      g.fillStyle = th.starColor;
      for (let i = 0; i < th.stars; i++) {
        const sx = hash01(i * 1.7) * c.width;
        const sy = anchor - 40 - hash01(i * 4.3) * (anchor * 0.92);
        g.globalAlpha = 0.3 + hash01(i * 9.1) * 0.7;
        // A handful of bright ones carry the field; the rest are dust behind them.
        const r = hash01(i * 2.9) > 0.93 ? 2.4 : hash01(i * 2.9) * 1.2 + 0.7;
        g.fillRect(sx, sy, r, r);
      }
      g.globalAlpha = 1;
    }

    // Light banked along the horizon. Two things earn its cost: it puts the frame's
    // brightest value exactly where distant silhouettes cross the sky, and it gives the
    // upper sky somewhere to fall away to — the difference between a sunset and a ramp.
    if (th.horizonGlowAlpha > 0) {
      const r = Math.max(c.width, h) * 0.85;
      const cx = c.width * (th.sun ? th.sun.xFrac : 0.5);
      const glow = g.createRadialGradient(cx, anchor, 0, cx, anchor, r);
      glow.addColorStop(0, `rgba(${th.horizonGlow},${th.horizonGlowAlpha})`);
      glow.addColorStop(0.45, `rgba(${th.horizonGlow},${th.horizonGlowAlpha * 0.28})`);
      glow.addColorStop(1, `rgba(${th.horizonGlow},0)`);
      g.fillStyle = glow;
      g.fillRect(0, Math.max(0, anchor - r), c.width, Math.min(c.height, r * 2));
    }

    if (th.sun) this.bakeBody(g, c.width, anchor, th.sun);
    if (th.moon) this.bakeMoon(g, c.width, anchor, th.moon);

    this.sky = c;
    this.skyAnchor = anchor;
    this.skyKey = `${th.id}:${w}:${h}`;
  }

  private bakeBody(g: Ctx, w: number, anchor: number, s: NonNullable<Theme["sun"]>) {
    const x = w * s.xFrac;
    const y = anchor - s.yOffset;
    const rg = g.createRadialGradient(x, y, 10, x, y, s.radius);
    rg.addColorStop(0, `rgba(${s.color},0.85)`);
    rg.addColorStop(0.25, `rgba(${s.color},0.22)`);
    rg.addColorStop(1, `rgba(${s.color},0)`);
    g.fillStyle = rg;
    g.fillRect(x - s.radius, y - s.radius, s.radius * 2, s.radius * 2);
    // A hard core inside the halo. Without it the star is a smudge, and a smudge does
    // not survive being shrunk to thumbnail size.
    g.fillStyle = `rgba(${s.color},0.95)`;
    g.beginPath();
    g.arc(x, y, s.radius * 0.13, 0, TAU);
    g.fill();
  }

  /** A hard disc with a soft halo, so it reads as a moon rather than a sun. */
  private bakeMoon(g: Ctx, w: number, anchor: number, m: NonNullable<Theme["moon"]>) {
    const x = w * m.xFrac;
    const y = anchor - m.yOffset;
    const halo = g.createRadialGradient(x, y, m.radius * 0.6, x, y, m.radius * 3.4);
    halo.addColorStop(0, `rgba(${m.color},0.3)`);
    halo.addColorStop(1, `rgba(${m.color},0)`);
    g.fillStyle = halo;
    g.fillRect(x - m.radius * 3.4, y - m.radius * 3.4, m.radius * 6.8, m.radius * 6.8);

    g.fillStyle = `rgba(${m.color},0.95)`;
    g.beginPath();
    g.arc(x, y, m.radius, 0, TAU);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.09)";
    for (const [cx, cy, cr] of [[-0.3, 0.2, 0.22], [0.25, -0.15, 0.16], [0.05, 0.42, 0.12]] as const) {
      g.beginPath();
      g.arc(x + cx * m.radius, y + cy * m.radius, cr * m.radius, 0, TAU);
      g.fill();
    }
  }

  /** Ground haze and vignette in one image: one blend pass over the frame, not two. */
  private bakePost(w: number, h: number, th: Theme) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const g = c.getContext("2d")!;

    const haze = g.createLinearGradient(0, h * 0.55, 0, h);
    haze.addColorStop(0, `rgba(${th.haze},0)`);
    haze.addColorStop(0.7, `rgba(${th.haze},0.08)`);
    haze.addColorStop(1, `rgba(${th.haze},0.2)`);
    g.fillStyle = haze;
    g.fillRect(0, h * 0.55, c.width, h * 0.45);

    // Corner falloff. It buys back the contrast a bright saturated palette spends at
    // the edges of the frame, and the thumbnail reads tighter for it.
    const vr = Math.hypot(w, h) * 0.62;
    const vg = g.createRadialGradient(w / 2, h * 0.48, vr * 0.42, w / 2, h * 0.48, vr);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.34)");
    g.fillStyle = vg;
    g.fillRect(0, 0, c.width, c.height);

    this.post = c;
    this.postKey = `${th.id}:${w}:${h}`;
  }

  /** Rebuilds every world-dependent strip. Runs once per level load, never per frame. */
  private bakeLayers(th: Theme) {
    this.skylineFar = this.bakeSkyline(th, false);
    this.skylineNear = this.bakeSkyline(th, true);
    this.decks = [this.bakeClouds(th, 0), this.bakeClouds(th, 1)];
    this.subsurface = this.bakeSubsurface(th);
    this.fg = this.bakeForeground(th);
    this.layerKey = th.id;
  }

  private bakeClouds(th: Theme, deck: number): Strip {
    const D = CLOUD_DECKS[deck];
    const { s, g } = makeStrip(D.stripW, D.stripH);
    s.base = s.h; // the strip's bottom edge sits `lift` metres above the horizon
    const n = Math.max(2, Math.round(th.cloudCount * D.share));
    const pitch = s.w / n;

    // Undersides first, then bodies: same picture, two fill styles for the whole deck.
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass === 0
        ? `rgba(0,0,0,${th.cloudAlpha * 0.14})`
        : `rgba(${th.cloudColor},${th.cloudAlpha})`;
      for (let i = 0; i < n; i++) {
        const r = (0.9 + hash01(i * 13.3 + deck) * 1.1) * D.size * REF;
        // Big clouds hug the bottom of the strip; only the slack left over after the
        // cluster is accounted for gets spent on vertical scatter.
        const slack = Math.max(0, s.h - r * 2.4);
        const cy = s.h - r * 1.15 - hash01(i * 7.7 + deck) * slack * 0.6;
        const dy = pass === 0 ? r * 0.2 : 0;
        // Three copies so a cloud straddling the seam matches its own wrap.
        for (const wrap of [-s.w, 0, s.w]) {
          const cx = (i + 0.25 + hash01(i * 3.1 + deck) * 0.5) * pitch + wrap;
          if (cx < -r * 3 || cx > s.w + r * 3) continue;
          g.beginPath();
          g.ellipse(cx, cy + dy, r * 2.2, r * 0.72, 0, 0, TAU);
          g.ellipse(cx - r * 1.1, cy + dy + r * 0.16, r * 1.2, r * 0.5, 0, 0, TAU);
          g.ellipse(cx + r * 1.2, cy + dy + r * 0.2, r * 1.0, r * 0.44, 0, 0, TAU);
          // A second tier of puffs on the low deck, so cumulus has a shape and not
          // just a footprint.
          if (deck === 1) {
            g.ellipse(cx - r * 0.4, cy + dy - r * 0.42, r * 1.0, r * 0.62, 0, 0, TAU);
            g.ellipse(cx + r * 0.7, cy + dy - r * 0.3, r * 0.72, r * 0.46, 0, 0, TAU);
          }
          g.fill();
        }
      }
    }
    return s;
  }

  /**
   * Distant silhouette, shaped per world: a city, a castle ridge, alien spires, or
   * Martian mesas. Baked twice — hazy and small for the far band, full size with lit
   * windows for the near one.
   *
   * Column seeds wrap at the strip edge, so the strip tiles without a visible join;
   * columns are generated one past each end so anything overhanging matches its wrap.
   */
  private bakeSkyline(th: Theme, detail: boolean): Strip | null {
    if (th.skyline === "none") return null;
    // The far band stands in for distant terrain rather than more of the same city,
    // which is why a castle world gets mountains behind it and not smaller castles.
    const kind = !detail && th.skyline === "castle" ? "mesa" : th.skyline;
    const color = detail ? th.skylineColor : th.skylineFar;
    const scale = detail ? 1 : 0.55;
    const step = Math.round((kind === "spires" ? 24 : 30) * (detail ? 1 : 0.72));
    const cols = 48;
    // Tallest column this generator can produce, plus room for the crowns, masts,
    // spires and pennants that sit on top of it. Understate this and the skyline gets
    // its towers guillotined by the edge of its own strip.
    const peak = kind === "spires" ? 2.3 * 1.9
      : kind === "castle" ? 2.0 * 1.7
      : kind === "city" ? 1.4 * 1.9
      : 1.0 * 1.5;
    const tall = Math.ceil(peak * REF * scale + step * 2.2);
    const { s, g } = makeStrip(cols * step, tall + 6);
    s.base = s.h - 4; // the horizon line sits just above the strip's bottom edge
    const horizon = s.base;
    g.fillStyle = color;

    for (let i = -1; i <= cols; i++) {
      const idx = ((i % cols) + cols) % cols;
      const bx = i * step;
      const seed = hash01(idx * 2.7 + (detail ? 0 : 91));
      const bw = step * (0.6 + hash01(idx * 5.1 + (detail ? 0 : 91)) * 0.35);

      switch (kind) {
        case "city": {
          const hh = (0.3 + seed * 1.1) * REF * 1.9 * scale;
          const top = horizon - hh;
          g.fillRect(bx, top, bw, hh);
          if (detail) this.cityDetail(g, th, idx, bx, top, bw, hh, color);
          break;
        }
        case "castle": {
          // A wall run punctuated by the occasional tower, with crenellations on top.
          const isTower = hash01(idx * 11.3) > 0.68;
          const hh = (isTower ? 1.1 + seed * 0.9 : 0.45 + seed * 0.3) * REF * 1.7 * scale;
          const cw = isTower ? bw * 0.72 : bw;
          g.fillRect(bx, horizon - hh, cw, hh);
          const merlon = cw / 5;
          for (let m = 0; m < 5; m += 2) {
            g.fillRect(bx + m * merlon, horizon - hh - merlon * 0.9, merlon, merlon * 0.9);
          }
          if (isTower) {
            g.beginPath();
            g.moveTo(bx - cw * 0.12, horizon - hh - merlon);
            g.lineTo(bx + cw * 0.5, horizon - hh - merlon - cw * 0.75);
            g.lineTo(bx + cw * 1.12, horizon - hh - merlon);
            g.closePath();
            g.fill();
            // Pennant on the spire — a few pixels of flag, and the difference between
            // a keep and a stack of rectangles.
            const py = horizon - hh - merlon - cw * 0.75;
            g.fillRect(bx + cw * 0.48, py - cw * 0.5, Math.max(1, cw * 0.05), cw * 0.5);
            g.beginPath();
            g.moveTo(bx + cw * 0.53, py - cw * 0.5);
            g.lineTo(bx + cw * 1.0, py - cw * 0.36);
            g.lineTo(bx + cw * 0.53, py - cw * 0.22);
            g.closePath();
            g.fill();
            this.windows(g, th, idx, bx, horizon - hh, cw, hh, color);
          }
          break;
        }
        case "spires": {
          // Organic tapering needles, some leaning.
          const hh = (0.5 + seed * 1.8) * REF * 1.9 * scale;
          const lean = (hash01(idx * 7.7) - 0.5) * bw * 0.9;
          g.beginPath();
          g.moveTo(bx, horizon);
          g.quadraticCurveTo(bx + bw * 0.1, horizon - hh * 0.6, bx + bw * 0.5 + lean, horizon - hh);
          g.quadraticCurveTo(bx + bw * 0.85, horizon - hh * 0.55, bx + bw, horizon);
          g.closePath();
          g.fill();
          if (detail) {
            // Seed bulb near the tip, and glowing pods down the shaft.
            g.beginPath();
            g.ellipse(bx + bw * 0.5 + lean * 0.9, horizon - hh * 0.86, bw * 0.34, bw * 0.44, 0, 0, TAU);
            g.fill();
            this.windows(g, th, idx, bx + bw * 0.2, horizon - hh * 0.6, bw * 0.6, hh * 0.6, color);
          }
          break;
        }
        case "mesa": {
          // Flat-topped bluffs with sloped shoulders.
          const hh = (0.25 + seed * 0.75) * REF * 1.5 * scale;
          g.beginPath();
          g.moveTo(bx - bw * 0.2, horizon);
          g.lineTo(bx + bw * 0.12, horizon - hh);
          g.lineTo(bx + bw * 0.88, horizon - hh);
          g.lineTo(bx + bw * 1.2, horizon);
          g.closePath();
          g.fill();
          if (detail) {
            // Bedding planes across the bluff face — the one thing that reads as
            // "sandstone" rather than "brown triangle" at this size.
            g.fillStyle = shade(color, 0.22);
            for (let b = 1; b <= 3; b++) {
              const y = horizon - hh * (b / 4);
              const inset = bw * 0.2 * (1 - b / 4);
              g.fillRect(bx - inset, y, bw * 1.2 + inset * 2, Math.max(1, hh * 0.035));
            }
            g.fillStyle = color;
            // Every few bluffs carries a pressurised dome with the lights on.
            if (hash01(idx * 23.9) > 0.62) this.dome(g, th, idx, bx + bw * 0.5, horizon - hh, bw * 0.5, color);
          }
          break;
        }
      }
      g.fillStyle = color;
    }
    return s;
  }

  /** Setbacks, roof furniture and a window grid — the city's whole read at this size. */
  private cityDetail(
    g: Ctx, th: Theme, idx: number, x: number, y: number, bw: number, hh: number, color: string,
  ) {
    const r = hash01(idx * 19.1);
    if (r > 0.72) {
      // Stepped crown.
      g.fillRect(x + bw * 0.18, y - bw * 0.34, bw * 0.64, bw * 0.34);
      g.fillRect(x + bw * 0.38, y - bw * 0.6, bw * 0.24, bw * 0.26);
    } else if (r > 0.5) {
      // Mast. Tall, thin, and the only vertical accent in a field of boxes.
      g.fillRect(x + bw * 0.46, y - bw * 1.1, Math.max(1, bw * 0.07), bw * 1.1);
    } else if (r > 0.34) {
      // Water tank on legs.
      g.fillRect(x + bw * 0.24, y - bw * 0.42, bw * 0.34, bw * 0.3);
      g.fillRect(x + bw * 0.28, y - bw * 0.12, Math.max(1, bw * 0.05), bw * 0.12);
      g.fillRect(x + bw * 0.5, y - bw * 0.12, Math.max(1, bw * 0.05), bw * 0.12);
    }
    this.windows(g, th, idx, x, y, bw, hh, color);
    // One building in six wears a lit sign. Four pixels of colour, and the thing that
    // makes a skyline look inhabited rather than modelled.
    if (hash01(idx * 41.7) > 0.84 && !th.windowColor.endsWith("0)")) {
      g.fillStyle = th.windowColor;
      g.fillRect(x + bw * 0.2, y + hh * 0.12, bw * 0.6, Math.max(1.5, bw * 0.14));
      g.fillStyle = color;
    }
  }

  /** A pressurised habitat dome with its lights on, for the Martian bluffs. */
  private dome(g: Ctx, th: Theme, idx: number, cx: number, y: number, r: number, color: string) {
    g.beginPath();
    g.arc(cx, y, r, Math.PI, 0);
    g.fill();
    g.fillRect(cx + r * 0.82, y - r * 1.5, Math.max(1, r * 0.09), r * 1.5);
    if (th.windowColor.endsWith("0)")) return;
    g.fillStyle = th.windowColor;
    for (let i = 0; i < 3; i++) {
      if (hash01(idx * 7.3 + i) < 0.3) continue;
      g.fillRect(cx - r * 0.6 + i * r * 0.5, y - r * 0.42, Math.max(1.5, r * 0.2), Math.max(1.5, r * 0.24));
    }
    g.fillStyle = color;
  }

  /**
   * Window grid: every cell as a dark recess, then the lit ones on top. Drawing the
   * unlit ones is what makes a facade look like a facade — a scatter of glowing dots
   * on a flat block reads as fairy lights.
   */
  private windows(
    g: Ctx, th: Theme, idx: number, x: number, y: number, bw: number, hh: number, color: string,
  ) {
    if (th.windowColor.endsWith("0)")) return;
    const cw = 9, ch = 12;
    const cols = Math.floor((bw - 6) / cw);
    const rows = Math.floor((hh - 8) / ch);
    if (cols < 1 || rows < 1) return;

    g.fillStyle = shade(color, -0.4);
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) g.fillRect(x + 4 + cx * cw, y + 6 + cy * ch, 3, 5);
    }
    g.fillStyle = th.windowColor;
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (hash01(idx * 31 + cx * 7 + cy * 3) < 0.62) continue;
        g.fillRect(x + 4 + cx * cw, y + 6 + cy * ch, 3, 5);
      }
    }
    g.fillStyle = color;
  }

  /**
   * A one-column-wide slice of everything under the ground plane, stretched to the
   * full viewport on blit. The content is purely vertical, so the horizontal stretch
   * costs nothing and collapses a gradient plus every stratum into a single call.
   */
  private bakeSubsurface(th: Theme): Strip {
    const depth = Math.round(22 * REF);
    const { s, g } = makeStrip(4, depth);
    s.base = 0;
    // The first stop has to *be* `Theme.ground`, and the fade has to stay gentle for
    // the six metres the terrain slabs occupy, or their bottom edge lands on a visibly
    // darker band and we have simply moved the seam down rather than removed it.
    const grad = g.createLinearGradient(0, 0, 0, depth);
    grad.addColorStop(0, th.ground);
    grad.addColorStop(0.28, shade(th.ground, -0.22));
    grad.addColorStop(1, th.underground);
    g.fillStyle = grad;
    g.fillRect(0, 0, s.w, depth);

    g.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = Math.round(2.6 * REF); y < depth; y += Math.round(2.6 * REF)) {
      g.fillRect(0, y, s.w, Math.max(1, 0.22 * REF));
    }
    // Hard shadow directly under the ground plane: where no terrain slab covers it —
    // over a canyon, past the ends of a level — this is what keeps the ground line a
    // drawn edge instead of a colour change.
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(0, 0, s.w, Math.max(1, 0.22 * REF));
    return s;
  }

  /** Near-camera silhouettes. One strip per world, in the theme's darkest value. */
  private bakeForeground(th: Theme): Strip {
    const cols = 6;
    const step = Math.round(5.5 * REF);
    const nominal = 3.4 * REF;
    const { s, g } = makeStrip(cols * step, nominal * 1.02);
    s.base = s.h;
    g.fillStyle = th.foreground;
    g.strokeStyle = th.foreground;
    g.lineJoin = "round";

    for (let i = -1; i <= cols; i++) {
      const idx = ((i % cols) + cols) % cols;
      const x = i * step + hash01(idx * 6.1) * step * 0.5;
      const size = nominal * (0.58 + hash01(idx * 2.3) * 0.42);
      // Bases sit a touch below the strip so nothing floats on the viewport edge.
      const base = s.h + nominal * 0.02;
      switch (th.foregroundKind) {
        case "grass": this.fgGrass(g, idx, x, base, size); break;
        case "bones": this.fgBones(g, idx, x, base, size); break;
        case "fungal": this.fgFungal(g, idx, x, base, size); break;
        case "rock": this.fgRock(g, idx, x, base, size); break;
      }
    }
    return s;
  }

  private fgGrass(g: Ctx, idx: number, x: number, base: number, s: number) {
    // A bush mass with blades breaking its outline, so the silhouette has teeth.
    g.beginPath();
    g.ellipse(x, base, s * 0.72, s * 0.5, 0, 0, TAU);
    g.fill();
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const bx = x + (i - 3) * s * 0.2;
      const bh = s * (0.5 + hash01(idx * 3.7 + i) * 0.75);
      const lean = (hash01(idx * 9.3 + i) - 0.5) * s * 0.5;
      g.moveTo(bx - s * 0.055, base);
      g.quadraticCurveTo(bx + lean * 0.4, base - bh * 0.6, bx + lean, base - bh);
      g.quadraticCurveTo(bx + lean * 0.3, base - bh * 0.55, bx + s * 0.055, base);
    }
    g.fill();
  }

  private fgBones(g: Ctx, idx: number, x: number, base: number, s: number) {
    if (hash01(idx * 5.9) > 0.55) {
      // Leaning headstone.
      g.save();
      g.translate(x, base);
      g.rotate((hash01(idx * 13.1) - 0.5) * 0.24);
      g.beginPath();
      g.moveTo(-s * 0.3, 0);
      g.lineTo(-s * 0.3, -s * 0.62);
      g.arc(0, -s * 0.62, s * 0.3, Math.PI, 0);
      g.lineTo(s * 0.3, 0);
      g.closePath();
      g.fill();
      g.restore();
      return;
    }
    // Dead bramble: a trunk with bare forks.
    g.lineCap = "round";
    g.lineWidth = Math.max(1.5, s * 0.1);
    g.beginPath();
    g.moveTo(x, base);
    g.lineTo(x + (hash01(idx * 7.7) - 0.5) * s * 0.3, base - s);
    for (let i = 0; i < 3; i++) {
      const fy = base - s * (0.45 + i * 0.2);
      const dir = i % 2 ? 1 : -1;
      g.moveTo(x, fy);
      g.lineTo(x + dir * s * (0.3 + hash01(idx * 11.3 + i) * 0.3), fy - s * 0.3);
    }
    g.stroke();
  }

  private fgFungal(g: Ctx, idx: number, x: number, base: number, s: number) {
    // Stalk plus cap. Caps overlap the frame edge, which is what makes them feel close.
    const capY = base - s * 0.72;
    g.beginPath();
    g.moveTo(x - s * 0.11, base);
    g.quadraticCurveTo(x - s * 0.05, base - s * 0.4, x - s * 0.08, capY);
    g.lineTo(x + s * 0.08, capY);
    g.quadraticCurveTo(x + s * 0.05, base - s * 0.4, x + s * 0.11, base);
    g.closePath();
    g.fill();
    g.beginPath();
    g.ellipse(x, capY, s * (0.38 + hash01(idx * 4.7) * 0.22), s * 0.3, 0, Math.PI, 0);
    g.fill();
    // A drooping tendril off one side.
    g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath();
    g.moveTo(x + s * 0.3, capY + s * 0.05);
    g.quadraticCurveTo(x + s * 0.42, capY + s * 0.4, x + s * 0.34, capY + s * 0.7);
    g.stroke();
  }

  private fgRock(g: Ctx, idx: number, x: number, base: number, s: number) {
    // Angular boulder: vertices off a half-circle, jittered per column.
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (i / 5) * Math.PI;
      const rr = s * (0.4 + hash01(idx * 3.1 + i) * 0.34);
      const px = x + Math.cos(a) * rr * 1.5;
      const py = base + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    if (hash01(idx * 21.7) > 0.7) {
      // Comms mast leaning out of the rubble.
      g.lineWidth = Math.max(1.5, s * 0.06);
      g.beginPath();
      g.moveTo(x, base - s * 0.3);
      g.lineTo(x + s * 0.12, base - s * 1.25);
      g.moveTo(x + s * 0.02, base - s * 0.95);
      g.lineTo(x + s * 0.3, base - s * 1.05);
      g.stroke();
    }
  }
}
