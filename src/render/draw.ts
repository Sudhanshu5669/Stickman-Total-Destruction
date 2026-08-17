import { TAU, type V } from "../core/math";

export type Ctx = CanvasRenderingContext2D;

/** Draws `fn` in a local frame at (x,y) rotated by `angle`. */
export function at(ctx: Ctx, x: number, y: number, angle: number, fn: () => void) {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  fn();
  ctx.restore();
}

export function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function circle(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
}

export function polyPath(ctx: Ctx, pts: readonly (readonly [number, number])[], close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

/** Filled + outlined polygon, the workhorse for every prop in the game. */
export function poly(
  ctx: Ctx,
  pts: readonly (readonly [number, number])[],
  fill?: string | null,
  stroke?: string | null,
  lw = 0.05,
) {
  polyPath(ctx, pts);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function rect(
  ctx: Ctx,
  x: number, y: number, w: number, h: number,
  fill?: string | null, stroke?: string | null, lw = 0.05,
) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);
  }
}

/** Centred rounded box — `r` is clamped so it degrades gracefully on thin shapes. */
export function roundBox(
  ctx: Ctx, w: number, h: number, r: number,
  fill?: string | null, stroke?: string | null, lw = 0.05,
) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, rr);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function disc(ctx: Ctx, x: number, y: number, r: number, fill?: string | null, stroke?: string | null, lw = 0.05) {
  circle(ctx, x, y, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/** Capsule centred on the origin along the Y axis, matching Rapier's capsule collider. */
export function capsuleY(ctx: Ctx, halfHeight: number, radius: number, fill?: string | null, stroke?: string | null, lw = 0.05) {
  ctx.beginPath();
  ctx.moveTo(-radius, -halfHeight);
  ctx.lineTo(-radius, halfHeight);
  ctx.arc(0, halfHeight, radius, Math.PI, 0, true);
  ctx.lineTo(radius, -halfHeight);
  ctx.arc(0, -halfHeight, radius, 0, Math.PI, true);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/**
 * World-space text. The camera transform flips Y, so text has to be un-flipped
 * locally or it renders upside down and mirrored.
 */
export function worldText(
  ctx: Ctx, text: string, x: number, y: number,
  sizeMetres: number, fill: string, align: CanvasTextAlign = "center", stroke?: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.font = `900 ${sizeMetres}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sizeMetres * 0.22;
    ctx.lineJoin = "round";
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function polyline(ctx: Ctx, pts: readonly V[], stroke: string, lw: number, cap: CanvasLineCap = "round") {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.lineCap = cap;
  ctx.stroke();
}

/** `rgba()` string from a hex colour plus alpha, used for fades without per-frame allocation churn. */
const hexCache = new Map<string, [number, number, number]>();
export function rgba(hex: string, alpha: number) {
  let c = hexCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = hex.length === 4
      ? [((n >> 8) & 0xf) * 17, ((n >> 4) & 0xf) * 17, (n & 0xf) * 17]
      : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    hexCache.set(hex, c);
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** Lightens (t>0) or darkens (t<0) a hex colour. Keeps the palette to one source value per material. */
export function shade(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c: number) => Math.round(t > 0 ? c + (255 - c) * t : c * (1 + t));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
