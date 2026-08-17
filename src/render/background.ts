import type { Camera } from "../core/camera";
import { hash01, TAU } from "../core/math";
import type { Ctx } from "./draw";
import type { Theme } from "./theme";

interface Cloud {
  x: number;
  y: number;
  s: number;
  speed: number;
}

/**
 * Parallax backdrop drawn in screen space before the camera transform, so each layer
 * can scroll at its own rate without fighting the world projection.
 *
 * Everything is driven by the active `Theme` — swapping worlds is a palette change,
 * not a new code path. Layers are painted far to near: sky, bodies, stars, clouds,
 * skyline silhouette, far hills, near hills.
 */
export class Background {
  private clouds: Cloud[] = [];
  private t = 0;
  private sky: CanvasGradient | null = null;
  private skyKey = "";

  constructor() {
    for (let i = 0; i < 20; i++) {
      this.clouds.push({
        x: hash01(i * 3.1) * 400 - 60,
        y: hash01(i * 7.7) * 26 + 12,
        s: hash01(i * 13.3) * 2.4 + 1.4,
        speed: hash01(i * 5.5) * 0.5 + 0.25,
      });
    }
  }

  update(dt: number) {
    this.t += dt;
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > 420) c.x = -80;
    }
  }

  draw(ctx: Ctx, cam: Camera, w: number, h: number, th: Theme) {
    // Rebuilt only when the viewport height or the world changes, not per frame.
    const key = `${th.id}:${h}`;
    if (!this.sky || this.skyKey !== key) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, th.sky[0]);
      g.addColorStop(0.42, th.sky[1]);
      g.addColorStop(0.78, th.sky[2]);
      g.addColorStop(1, th.sky[3]);
      this.sky = g;
      this.skyKey = key;
    }
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, w, h);

    const z = cam.effectiveZoom;
    // Horizon is where world Y = 0 lands on screen, so backdrop and terrain agree.
    const horizon = h / 2 + cam.pos.y * z;

    if (th.stars > 0) this.drawStars(ctx, cam, w, horizon, th);
    if (th.sun) this.drawBody(ctx, w, horizon, th.sun);
    if (th.moon) this.drawMoon(ctx, w, horizon, th.moon);
    this.drawClouds(ctx, cam, w, horizon, z, th);
    this.drawSkyline(ctx, cam, w, horizon, z, th);
    this.drawHills(ctx, cam, w, h, horizon, z, th);
  }

  /** Fixed to the sky, with a whisper of parallax so it doesn't feel pasted on. */
  private drawStars(ctx: Ctx, cam: Camera, w: number, horizon: number, th: Theme) {
    const off = cam.pos.x * cam.effectiveZoom * 0.02;
    ctx.fillStyle = th.starColor;
    for (let i = 0; i < th.stars; i++) {
      const sx = ((hash01(i * 1.7) * (w + 400) - off) % (w + 400) + w + 400) % (w + 400) - 200;
      const sy = hash01(i * 4.3) * Math.max(80, horizon - 60);
      if (sy > horizon - 20) continue;
      // Slow twinkle, offset per star so they don't pulse in unison.
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(this.t * 0.7 + i));
      ctx.globalAlpha = tw * (0.35 + hash01(i * 9.1) * 0.65);
      const r = hash01(i * 2.9) * 1.3 + 0.5;
      ctx.fillRect(sx, sy, r, r);
    }
    ctx.globalAlpha = 1;
  }

  private drawBody(ctx: Ctx, w: number, horizon: number, s: NonNullable<Theme["sun"]>) {
    const x = w * s.xFrac;
    const y = horizon - s.yOffset;
    const g = ctx.createRadialGradient(x, y, 10, x, y, s.radius);
    g.addColorStop(0, `rgba(${s.color},0.85)`);
    g.addColorStop(0.25, `rgba(${s.color},0.22)`);
    g.addColorStop(1, `rgba(${s.color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - s.radius, y - s.radius, s.radius * 2, s.radius * 2);
  }

  /** A hard disc with a soft halo, so it reads as a moon rather than a sun. */
  private drawMoon(ctx: Ctx, w: number, horizon: number, m: NonNullable<Theme["moon"]>) {
    const x = w * m.xFrac;
    const y = horizon - m.yOffset;
    const halo = ctx.createRadialGradient(x, y, m.radius * 0.6, x, y, m.radius * 3.4);
    halo.addColorStop(0, `rgba(${m.color},0.3)`);
    halo.addColorStop(1, `rgba(${m.color},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(x - m.radius * 3.4, y - m.radius * 3.4, m.radius * 6.8, m.radius * 6.8);

    ctx.fillStyle = `rgba(${m.color},0.95)`;
    ctx.beginPath();
    ctx.arc(x, y, m.radius, 0, TAU);
    ctx.fill();
    // Craters.
    ctx.fillStyle = `rgba(0,0,0,0.09)`;
    for (const [cx, cy, cr] of [[-0.3, 0.2, 0.22], [0.25, -0.15, 0.16], [0.05, 0.42, 0.12]] as const) {
      ctx.beginPath();
      ctx.arc(x + cx * m.radius, y + cy * m.radius, cr * m.radius, 0, TAU);
      ctx.fill();
    }
  }

  private drawClouds(ctx: Ctx, cam: Camera, w: number, horizon: number, z: number, th: Theme) {
    const px = -cam.pos.x * z * 0.08;
    ctx.fillStyle = `rgba(${th.cloudColor},${th.cloudAlpha})`;
    for (let i = 0; i < Math.min(th.cloudCount, this.clouds.length); i++) {
      const c = this.clouds[i];
      const sx = ((c.x * z * 0.5 + px) % (w + 700)) - 200;
      const sy = horizon - c.y * z * 0.5 - 40;
      if (sy < -200 || sy > horizon + 50) continue;
      const r = c.s * z * 0.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * 2.2, r * 0.72, 0, 0, TAU);
      ctx.ellipse(sx - r * 1.1, sy + r * 0.16, r * 1.2, r * 0.5, 0, 0, TAU);
      ctx.ellipse(sx + r * 1.2, sy + r * 0.2, r * 1.0, r * 0.44, 0, 0, TAU);
      ctx.fill();
    }
  }

  private drawHills(ctx: Ctx, cam: Camera, w: number, h: number, horizon: number, z: number, th: Theme) {
    const layers = [
      { depth: 0.22, color: th.hillFar, amp: 4.6, freq: 0.05, lift: 3.0 },
      { depth: 0.36, color: th.hillNear, amp: 3.0, freq: 0.085, lift: 1.2 },
    ];
    for (const layer of layers) {
      const off = cam.pos.x * z * layer.depth;
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(-10, h + 10);
      for (let sx = -10; sx <= w + 10; sx += 12) {
        const wx = (sx + off) / z;
        const y =
          horizon -
          (layer.lift + layer.amp * (0.6 + 0.4 * Math.sin(wx * layer.freq)) * (0.7 + 0.3 * Math.sin(wx * layer.freq * 2.7))) * z;
        ctx.lineTo(sx, y);
      }
      ctx.lineTo(w + 10, h + 10);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Distant silhouette. Deterministic from world position so it never flickers as you
   * scroll, and shaped per world: a city, a castle ridge, alien spires, or Martian mesas.
   */
  private drawSkyline(ctx: Ctx, cam: Camera, w: number, horizon: number, z: number, th: Theme) {
    if (th.skyline === "none") return;
    const depth = 0.12;
    const off = cam.pos.x * z * depth;
    const step = th.skyline === "spires" ? 24 : 30;
    ctx.fillStyle = th.skylineColor;

    for (let sx = -step; sx <= w + step; sx += step) {
      const idx = Math.floor((sx + off) / step);
      const bx = sx - (((off % step) + step) % step);
      const seed = hash01(idx * 2.7);
      const bw = step * (0.6 + hash01(idx * 5.1) * 0.35);

      switch (th.skyline) {
        case "city": {
          const hh = (0.3 + seed * 1.1) * z * 1.9;
          ctx.fillRect(bx, horizon - hh, bw, hh);
          this.skylineWindows(ctx, th, idx, bx, horizon - hh, bw, hh);
          break;
        }
        case "castle": {
          // A wall run punctuated by the occasional tower, with crenellations on top.
          const isTower = hash01(idx * 11.3) > 0.68;
          const hh = (isTower ? 1.1 + seed * 0.9 : 0.45 + seed * 0.3) * z * 1.7;
          const cw = isTower ? bw * 0.72 : bw;
          ctx.fillRect(bx, horizon - hh, cw, hh);
          const merlon = cw / 5;
          for (let m = 0; m < 5; m += 2) {
            ctx.fillRect(bx + m * merlon, horizon - hh - merlon * 0.9, merlon, merlon * 0.9);
          }
          if (isTower) {
            ctx.beginPath();
            ctx.moveTo(bx - cw * 0.12, horizon - hh - merlon);
            ctx.lineTo(bx + cw * 0.5, horizon - hh - merlon - cw * 0.75);
            ctx.lineTo(bx + cw * 1.12, horizon - hh - merlon);
            ctx.closePath();
            ctx.fill();
            this.skylineWindows(ctx, th, idx, bx, horizon - hh, cw, hh);
          }
          break;
        }
        case "spires": {
          // Organic tapering needles, some leaning.
          const hh = (0.5 + seed * 1.8) * z * 1.9;
          const lean = (hash01(idx * 7.7) - 0.5) * bw * 0.9;
          ctx.beginPath();
          ctx.moveTo(bx, horizon);
          ctx.quadraticCurveTo(bx + bw * 0.1, horizon - hh * 0.6, bx + bw * 0.5 + lean, horizon - hh);
          ctx.quadraticCurveTo(bx + bw * 0.85, horizon - hh * 0.55, bx + bw, horizon);
          ctx.closePath();
          ctx.fill();
          this.skylineWindows(ctx, th, idx, bx + bw * 0.2, horizon - hh * 0.55, bw * 0.6, hh * 0.55);
          break;
        }
        case "mesa": {
          // Flat-topped bluffs with sloped shoulders.
          const hh = (0.25 + seed * 0.75) * z * 1.5;
          ctx.beginPath();
          ctx.moveTo(bx - bw * 0.2, horizon);
          ctx.lineTo(bx + bw * 0.12, horizon - hh);
          ctx.lineTo(bx + bw * 0.88, horizon - hh);
          ctx.lineTo(bx + bw * 1.2, horizon);
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
      ctx.fillStyle = th.skylineColor;
    }
  }

  private skylineWindows(ctx: Ctx, th: Theme, idx: number, x: number, y: number, bw: number, hh: number) {
    if (th.windowColor.endsWith("0)")) return;
    ctx.fillStyle = th.windowColor;
    const cols = Math.max(1, Math.floor(bw / 9));
    const rows = Math.max(1, Math.floor(hh / 12));
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (hash01(idx * 31 + cx * 7 + cy * 3) < 0.62) continue;
        ctx.fillRect(x + 4 + cx * 9, y + 6 + cy * 12, 3, 5);
      }
    }
  }

  /** Ground haze plus the world's ambient wash, drawn after the world. */
  drawHaze(ctx: Ctx, w: number, h: number, th: Theme) {
    const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
    g.addColorStop(0, `rgba(${th.haze},0)`);
    g.addColorStop(1, `rgba(${th.haze},0.16)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);

    if (th.ambient && th.ambientAlpha) {
      // Tints the whole frame, which is what sells "night" or "under a green sun".
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = th.ambientAlpha;
      ctx.fillStyle = th.ambient;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
}
