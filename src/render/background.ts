import type { Camera } from "../core/camera";
import { hash01, TAU } from "../core/math";
import type { Ctx } from "./draw";

interface Cloud {
  x: number;
  y: number;
  s: number;
  speed: number;
}

/**
 * Parallax backdrop drawn in screen space before the camera transform, so the layers
 * can scroll at their own rates without fighting the world projection.
 */
export class Background {
  private clouds: Cloud[] = [];
  private t = 0;

  constructor() {
    for (let i = 0; i < 16; i++) {
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

  private sky: CanvasGradient | null = null;
  private skyH = -1;

  draw(ctx: Ctx, cam: Camera, w: number, h: number) {
    // The gradient only depends on viewport height, so rebuild it on resize, not per frame.
    if (!this.sky || this.skyH !== h) {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#243a63");
      sky.addColorStop(0.42, "#4a7bb0");
      sky.addColorStop(0.78, "#8fb8d6");
      sky.addColorStop(1, "#d9d2b6");
      this.sky = sky;
      this.skyH = h;
    }
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, w, h);

    const z = cam.effectiveZoom;
    // Horizon is where world Y = 0 lands on screen, so terrain and backdrop agree.
    const horizon = h / 2 + cam.pos.y * z;

    this.drawSun(ctx, w, horizon);
    this.drawClouds(ctx, cam, w, horizon, z);
    // Painter's order, far to near. The skyline is the most distant layer, so it must
    // scroll the least and be occluded by both hill ridges.
    this.drawSkyline(ctx, cam, w, horizon, z);
    this.drawHills(ctx, cam, w, h, horizon, z);
  }

  private drawSun(ctx: Ctx, w: number, horizon: number) {
    const x = w * 0.78;
    const y = horizon - 300;
    const g = ctx.createRadialGradient(x, y, 10, x, y, 260);
    g.addColorStop(0, "rgba(255,240,190,0.85)");
    g.addColorStop(0.25, "rgba(255,225,150,0.22)");
    g.addColorStop(1, "rgba(255,220,140,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 300, y - 300, 600, 600);
  }

  private drawClouds(ctx: Ctx, cam: Camera, w: number, horizon: number, z: number) {
    const px = -cam.pos.x * z * 0.08;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    for (const c of this.clouds) {
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

  private drawHills(ctx: Ctx, cam: Camera, w: number, h: number, horizon: number, z: number) {
    for (const layer of [
      { depth: 0.22, color: "#6d90a8", amp: 4.6, freq: 0.05, lift: 3.0 },
      { depth: 0.36, color: "#4e6b82", amp: 3.0, freq: 0.085, lift: 1.2 },
    ]) {
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

  /** Distant city silhouette; deterministic so it never flickers as you scroll. */
  private drawSkyline(ctx: Ctx, cam: Camera, w: number, horizon: number, z: number) {
    const depth = 0.12;
    const off = cam.pos.x * z * depth;
    // Hazy and low-contrast so it never competes with the destructible foreground.
    const body = "#5c7690";
    ctx.fillStyle = body;
    const step = 30;
    for (let sx = -step; sx <= w + step; sx += step) {
      const idx = Math.floor((sx + off) / step);
      const hh = (0.3 + hash01(idx * 2.7) * 1.1) * z * 1.9;
      const bw = step * (0.6 + hash01(idx * 5.1) * 0.35);
      const bx = sx - (((off % step) + step) % step);
      ctx.fillRect(bx, horizon - hh, bw, hh);

      // Lit windows.
      ctx.fillStyle = "rgba(255,214,120,0.25)";
      const cols = Math.max(1, Math.floor(bw / 9));
      const rows = Math.max(1, Math.floor(hh / 12));
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          if (hash01(idx * 31 + cx * 7 + cy * 3) < 0.62) continue;
          ctx.fillRect(bx + 4 + cx * 9, horizon - hh + 6 + cy * 12, 3, 5);
        }
      }
      ctx.fillStyle = body;
    }
  }

  /** Warm ground haze drawn after the world for depth. */
  drawHaze(ctx: Ctx, w: number, h: number) {
    const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
    g.addColorStop(0, "rgba(210,200,170,0)");
    g.addColorStop(1, "rgba(210,200,170,0.16)");
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
  }
}
