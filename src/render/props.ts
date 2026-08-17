import { TAU } from "../core/math";
import { disc, poly, polyPath, rgba, roundBox, shade, type Ctx } from "./draw";

/**
 * Every prop draws centred on the origin, filling roughly `w` x `h` metres, facing +X.
 * Keeping them pure vector art means zero asset loading and crisp visuals at any zoom.
 */
export type PropDraw = (ctx: Ctx, w: number, h: number, t: number) => void;

const OUT = "rgba(0,0,0,0.42)";

export const drawCar: PropDraw = (ctx, w, h) => {
  const body = "#e04b3a";
  // Lower body.
  roundBox(ctx, w, h * 0.52, h * 0.16, body, shade(body, -0.45), 0.05);
  // Cabin.
  ctx.save();
  ctx.translate(-w * 0.03, h * 0.32);
  poly(ctx, [
    [-w * 0.3, -h * 0.06], [-w * 0.2, h * 0.34],
    [w * 0.2, h * 0.34], [w * 0.32, -h * 0.06],
  ], shade(body, -0.12), shade(body, -0.45), 0.05);
  // Windows.
  poly(ctx, [
    [-w * 0.25, 0], [-w * 0.17, h * 0.26],
    [-w * 0.02, h * 0.26], [-w * 0.02, 0],
  ], "#a9dcef", null);
  poly(ctx, [
    [w * 0.02, 0], [w * 0.02, h * 0.26],
    [w * 0.16, h * 0.26], [w * 0.26, 0],
  ], "#a9dcef", null);
  ctx.restore();
  // Wheels.
  for (const sx of [-0.29, 0.3]) {
    disc(ctx, w * sx, -h * 0.28, h * 0.22, "#1b1e26", null);
    disc(ctx, w * sx, -h * 0.28, h * 0.1, "#8d95a3", null);
  }
  // Lights.
  disc(ctx, w * 0.47, h * 0.02, h * 0.08, "#ffe9a8", null);
  disc(ctx, -w * 0.47, h * 0.02, h * 0.07, "#ff6b5a", null);
};

export const drawPlane: PropDraw = (ctx, w, h) => {
  const body = "#eef2f8";
  // Fuselage.
  ctx.beginPath();
  ctx.moveTo(w * 0.5, 0);
  ctx.quadraticCurveTo(w * 0.34, h * 0.42, -w * 0.14, h * 0.4);
  ctx.lineTo(-w * 0.46, h * 0.34);
  ctx.lineTo(-w * 0.46, -h * 0.22);
  ctx.quadraticCurveTo(0, -h * 0.44, w * 0.5, 0);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 0.05;
  ctx.stroke();

  // Tail fin.
  poly(ctx, [
    [-w * 0.44, h * 0.3], [-w * 0.5, h * 1.0],
    [-w * 0.22, h * 0.98], [-w * 0.2, h * 0.36],
  ], "#2f6fd0", OUT, 0.05);

  // Swept wing.
  poly(ctx, [
    [w * 0.02, -h * 0.08], [-w * 0.22, -h * 0.95],
    [-w * 0.02, -h * 0.95], [w * 0.2, -h * 0.1],
  ], shade(body, -0.15), OUT, 0.05);

  // Engine pod.
  roundBox(ctx, w * 0.2, h * 0.3, h * 0.1, "#98a2b3", OUT, 0.04);

  // Livery stripe + windows.
  ctx.fillStyle = "#2f6fd0";
  ctx.fillRect(-w * 0.46, -h * 0.08, w * 0.92, h * 0.08);
  ctx.fillStyle = "#3a4250";
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc(-w * 0.36 + i * w * 0.085, h * 0.14, h * 0.045, 0, TAU);
    ctx.fill();
  }
  // Cockpit glass.
  poly(ctx, [[w * 0.46, h * 0.02], [w * 0.3, h * 0.22], [w * 0.22, h * 0.06]], "#26303f", null);
};

export const drawRocket: PropDraw = (ctx, w, h, t) => {
  const body = "#e8eef7";
  ctx.save();
  ctx.rotate(-Math.PI / 2); // art authored nose-up, physics fires it nose-forward
  roundBox(ctx, h, w * 0.62, h * 0.2, body, OUT, 0.04);
  // Nose cone.
  poly(ctx, [[-h * 0.5, w * 0.31], [-h * 0.5, -w * 0.31], [-h * 0.95, 0]], "#e8433a", OUT, 0.04);
  // Fins.
  poly(ctx, [[h * 0.4, w * 0.31], [h * 0.72, w * 0.62], [h * 0.62, w * 0.28]], "#e8433a", OUT, 0.04);
  poly(ctx, [[h * 0.4, -w * 0.31], [h * 0.72, -w * 0.62], [h * 0.62, -w * 0.28]], "#e8433a", OUT, 0.04);
  ctx.fillStyle = "#2f3846";
  ctx.fillRect(-h * 0.15, -w * 0.31, h * 0.14, w * 0.62);
  // Flicker on the nozzle flame.
  const f = 0.6 + Math.sin(t * 60) * 0.25;
  poly(ctx, [
    [h * 0.5, w * 0.22], [h * 0.5, -w * 0.22], [h * (0.5 + 0.7 * f), 0],
  ], "#ffb03a", null);
  ctx.restore();
};

export const drawAnvil: PropDraw = (ctx, w, h) => {
  poly(ctx, [
    [-w * 0.5, h * 0.5], [w * 0.32, h * 0.5], [w * 0.5, h * 0.28],
    [w * 0.3, h * 0.14], [w * 0.18, h * 0.14], [w * 0.14, -h * 0.16],
    [w * 0.3, -h * 0.5], [-w * 0.34, -h * 0.5], [-w * 0.2, -h * 0.16],
    [-w * 0.26, h * 0.14], [-w * 0.5, h * 0.16],
  ], "#4a515c", "#22262e", 0.05);
  ctx.fillStyle = rgba("#ffffff", 0.18);
  ctx.fillRect(-w * 0.45, h * 0.36, w * 0.75, h * 0.1);
};

export const drawPiano: PropDraw = (ctx, w, h) => {
  roundBox(ctx, w, h * 0.72, h * 0.1, "#1d2027", "#0c0e12", 0.05);
  // Lid, propped open.
  poly(ctx, [
    [-w * 0.5, h * 0.36], [-w * 0.16, h * 0.98],
    [w * 0.42, h * 0.92], [w * 0.5, h * 0.36],
  ], "#2a2f38", "#0c0e12", 0.05);
  // Keys.
  ctx.fillStyle = "#f6f3ec";
  ctx.fillRect(-w * 0.46, -h * 0.1, w * 0.92, h * 0.2);
  ctx.fillStyle = "#12141a";
  const keys = 13;
  for (let i = 1; i < keys; i++) {
    if (i % 7 === 3 || i % 7 === 0) continue;
    ctx.fillRect(-w * 0.46 + (i * w * 0.92) / keys - w * 0.012, -h * 0.02, w * 0.024, h * 0.12);
  }
  for (const sx of [-0.34, 0.34]) {
    ctx.fillStyle = "#15181e";
    ctx.fillRect(w * sx - w * 0.03, -h * 0.5, w * 0.06, h * 0.4);
  }
};

export const drawFridge: PropDraw = (ctx, w, h) => {
  roundBox(ctx, w, h, Math.min(w, h) * 0.12, "#dfe4ea", "#8d95a3", 0.05);
  ctx.strokeStyle = "#a8b0bb";
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, h * 0.16);
  ctx.lineTo(w * 0.5, h * 0.16);
  ctx.stroke();
  ctx.fillStyle = "#8d95a3";
  ctx.fillRect(w * 0.26, h * 0.22, w * 0.07, h * 0.2);
  ctx.fillRect(w * 0.26, -h * 0.4, w * 0.07, h * 0.36);
  // Magnets, because of course.
  ctx.fillStyle = "#e8433a";
  ctx.fillRect(-w * 0.28, -h * 0.12, w * 0.1, h * 0.06);
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(-w * 0.12, -h * 0.22, w * 0.08, h * 0.06);
};

export const drawBowling: PropDraw = (ctx, _w, h) => {
  const r = h * 0.5;
  disc(ctx, 0, 0, r, "#241f3d", "#12101f", 0.05);
  ctx.fillStyle = rgba("#ffffff", 0.22);
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, r * 0.35, r * 0.3, r * 0.18, -0.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#0b0a14";
  for (const [hx, hy] of [[0.28, 0.2], [0.44, -0.02], [0.26, -0.22]] as const) {
    ctx.beginPath();
    ctx.arc(r * hx, r * hy, r * 0.11, 0, TAU);
    ctx.fill();
  }
};

export const drawWatermelon: PropDraw = (ctx, w, h) => {
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, TAU);
  ctx.fillStyle = "#3f8f3a";
  ctx.fill();
  ctx.strokeStyle = "#255a24";
  ctx.lineWidth = 0.05;
  ctx.stroke();
  ctx.strokeStyle = "#2b6b2a";
  ctx.lineWidth = w * 0.07;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.5 * (1 - Math.abs(i) * 0.12), h * 0.5, 0, 0, TAU);
    ctx.save();
    ctx.rotate(i * 0.3);
    ctx.beginPath();
    ctx.moveTo(i * w * 0.14, -h * 0.5);
    ctx.quadraticCurveTo(i * w * 0.2, 0, i * w * 0.14, h * 0.5);
    ctx.stroke();
    ctx.restore();
  }
};

export const drawSawblade: PropDraw = (ctx, _w, h) => {
  const r = h * 0.5;
  const teeth = 12;
  const pts: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * TAU;
    const a1 = ((i + 0.45) / teeth) * TAU;
    pts.push([Math.cos(a0) * r, Math.sin(a0) * r]);
    pts.push([Math.cos(a1) * r * 0.76, Math.sin(a1) * r * 0.76]);
  }
  poly(ctx, pts, "#c9d2de", "#5c6675", 0.045);
  disc(ctx, 0, 0, r * 0.3, "#e8433a", "#5c6675", 0.04);
  disc(ctx, 0, 0, r * 0.1, "#2f3846", null);
};

export const drawToilet: PropDraw = (ctx, w, h) => {
  // Tank.
  roundBox(ctx, w * 0.42, h * 0.5, 0.05, "#f6f7f9", "#9aa3b0", 0.045);
  ctx.save();
  ctx.translate(-w * 0.28, h * 0.24);
  ctx.restore();
  // Bowl.
  ctx.save();
  ctx.translate(w * 0.14, -h * 0.18);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.34, h * 0.3, 0, 0, TAU);
  ctx.fillStyle = "#f6f7f9";
  ctx.fill();
  ctx.strokeStyle = "#9aa3b0";
  ctx.lineWidth = 0.045;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, h * 0.05, w * 0.22, h * 0.16, 0, 0, TAU);
  ctx.fillStyle = "#8fd8e8";
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#dfe4ea";
  ctx.fillRect(-w * 0.05, -h * 0.5, w * 0.3, h * 0.16);
};

export const drawTv: PropDraw = (ctx, w, h) => {
  roundBox(ctx, w, h, h * 0.1, "#2b303c", "#141820", 0.05);
  ctx.fillStyle = "#7fd0e8";
  ctx.fillRect(-w * 0.4, -h * 0.28, w * 0.8, h * 0.62);
  // Static bars.
  ctx.fillStyle = rgba("#ffffff", 0.35);
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(-w * 0.4, -h * 0.28 + i * h * 0.13, w * 0.8, h * 0.03);
  }
  ctx.strokeStyle = "#9aa3b0";
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(-w * 0.1, h * 0.5);
  ctx.lineTo(-w * 0.3, h * 0.9);
  ctx.moveTo(w * 0.1, h * 0.5);
  ctx.lineTo(w * 0.3, h * 0.88);
  ctx.stroke();
};

export const drawNuke: PropDraw = (ctx, w, h, t) => {
  ctx.save();
  ctx.rotate(-Math.PI / 2);
  roundBox(ctx, h * 0.9, w * 0.72, w * 0.3, "#4c525c", "#22262e", 0.05);
  poly(ctx, [[-h * 0.45, w * 0.36], [-h * 0.45, -w * 0.36], [-h * 0.78, 0]], "#3a4049", "#22262e", 0.05);
  poly(ctx, [[h * 0.36, w * 0.36], [h * 0.62, w * 0.6], [h * 0.62, -w * 0.6], [h * 0.36, -w * 0.36]], "#3a4049", "#22262e", 0.05);
  ctx.restore();
  // Blinking hazard light — the "oh no" cue.
  const blink = Math.sin(t * 22) > 0 ? "#ff3b2e" : "#5c1f1a";
  disc(ctx, 0, 0, h * 0.16, blink, "#1b1e26", 0.04);
  ctx.fillStyle = "#ffd23f";
  ctx.font = `900 ${h * 0.3}px sans-serif`;
};

export const drawBlackhole: PropDraw = (ctx, _w, h, t) => {
  const r = h * 0.5;
  for (let i = 5; i >= 1; i--) {
    ctx.fillStyle = rgba("#8a5cff", 0.06 * i);
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.6 + i * 0.42), 0, TAU);
    ctx.fill();
  }
  // Accretion swirl.
  ctx.strokeStyle = rgba("#c9a8ff", 0.8);
  ctx.lineWidth = r * 0.14;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, r * (0.75 + i * 0.28), t * (3 + i) + i * 2, t * (3 + i) + i * 2 + 2.2);
    ctx.stroke();
  }
  disc(ctx, 0, 0, r * 0.62, "#08060f", null);
};

export const drawBarrel: PropDraw = (ctx, w, h) => {
  roundBox(ctx, w, h, w * 0.12, "#e8433a", "#7d221c", 0.05);
  ctx.strokeStyle = "#7d221c";
  ctx.lineWidth = 0.05;
  for (const y of [-0.26, 0.26]) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, h * y);
    ctx.lineTo(w * 0.5, h * y);
    ctx.stroke();
  }
  ctx.fillStyle = "#1b1e26";
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.16, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#e8433a";
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.09, 0, TAU);
  ctx.fill();
};

export const drawGrandmother: PropDraw = (ctx, w, h) => {
  // Rocking chair granny — pure chaos, zero explanation offered.
  poly(ctx, [
    [-w * 0.5, -h * 0.5], [w * 0.5, -h * 0.5],
    [w * 0.34, h * 0.12], [-w * 0.34, h * 0.12],
  ], "#7b4a2d", "#43281a", 0.05);
  disc(ctx, 0, h * 0.34, h * 0.2, "#f0c9a4", "#43281a", 0.04);
  ctx.fillStyle = "#c8cdd6";
  ctx.beginPath();
  ctx.arc(0, h * 0.42, h * 0.19, Math.PI * 0.9, Math.PI * 2.1);
  ctx.fill();
  ctx.strokeStyle = "#43281a";
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, -h * 0.5);
  ctx.quadraticCurveTo(0, -h * 0.82, w * 0.5, -h * 0.5);
  ctx.stroke();
};

/**
 * Rasterised ammo glyphs for the HUD.
 *
 * The wheel shows every round at once, and re-running nineteen full vector drawings
 * (cars, jetliners, grand pianos) on every frame cost more than the entire world
 * render. Each icon is baked once into a small offscreen canvas and blitted after.
 * The Y flip is baked in too, since the HUD draws in screen space.
 */
const ICON_PX = 128;
const iconCache = new Map<string, HTMLCanvasElement>();

export function iconBitmap(id: string): HTMLCanvasElement {
  let c = iconCache.get(id);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = ICON_PX;
  const g = c.getContext("2d")!;
  g.translate(ICON_PX / 2, ICON_PX / 2);
  g.scale(1, -1); // icons are authored +Y up, like the world
  g.lineJoin = "round";
  drawIcon(g, id, ICON_PX * 0.9, 0);
  iconCache.set(id, c);
  return c;
}

/** Small vector glyphs for the ammo wheel, drawn in a -0.5..0.5 box. */
export function drawIcon(ctx: Ctx, id: string, size: number, t: number) {
  ctx.save();
  ctx.scale(size, size);
  switch (id) {
    case "chicken":
      disc(ctx, -0.05, -0.05, 0.26, "#fdfbf2", "#0004", 0.05);
      disc(ctx, 0.2, 0.18, 0.15, "#fdfbf2", "#0004", 0.05);
      poly(ctx, [[0.32, 0.2], [0.5, 0.15], [0.32, 0.1]], "#f0a63c", null);
      poly(ctx, [[0.12, 0.3], [0.2, 0.44], [0.28, 0.3]], "#e0402f", null);
      break;
    case "rocket": drawRocket(ctx, 0.44, 0.9, t); break;
    case "car": drawCar(ctx, 0.95, 0.5, t); break;
    case "plane": drawPlane(ctx, 0.95, 0.42, t); break;
    case "elephant":
      disc(ctx, -0.1, 0, 0.32, "#8d8f99", "#0004", 0.05);
      disc(ctx, 0.26, 0.1, 0.19, "#8d8f99", "#0004", 0.05);
      ctx.strokeStyle = "#8d8f99";
      ctx.lineWidth = 0.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0.4, 0.02);
      ctx.quadraticCurveTo(0.5, -0.2, 0.36, -0.34);
      ctx.stroke();
      break;
    case "stickman":
      ctx.strokeStyle = "#1b1e26";
      ctx.lineWidth = 0.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, 0.18); ctx.lineTo(0, -0.14);
      ctx.moveTo(-0.22, 0.02); ctx.lineTo(0.22, 0.02);
      ctx.moveTo(0, -0.14); ctx.lineTo(-0.18, -0.44);
      ctx.moveTo(0, -0.14); ctx.lineTo(0.18, -0.44);
      ctx.stroke();
      disc(ctx, 0, 0.34, 0.16, "#1b1e26", null);
      break;
    case "anvil": drawAnvil(ctx, 0.9, 0.7, t); break;
    case "piano": drawPiano(ctx, 0.9, 0.5, t); break;
    case "fridge": drawFridge(ctx, 0.5, 0.9, t); break;
    case "bowling": drawBowling(ctx, 0.8, 0.8, t); break;
    case "watermelon": drawWatermelon(ctx, 0.8, 0.7, t); break;
    case "cow":
      disc(ctx, -0.08, 0, 0.32, "#f2f2f2", "#0004", 0.05);
      ctx.fillStyle = "#22242b";
      ctx.beginPath(); ctx.ellipse(-0.16, 0.06, 0.13, 0.1, 0.4, 0, TAU); ctx.fill();
      disc(ctx, 0.28, 0.1, 0.18, "#f2f2f2", "#0004", 0.05);
      break;
    case "sawblade": drawSawblade(ctx, 0.9, 0.9, t); break;
    case "toilet": drawToilet(ctx, 0.75, 0.8, t); break;
    case "tv": drawTv(ctx, 0.8, 0.6, t); break;
    case "nuke": drawNuke(ctx, 0.45, 0.9, t); break;
    case "blackhole": drawBlackhole(ctx, 0.9, 0.9, t); break;
    case "barrel": drawBarrel(ctx, 0.55, 0.85, t); break;
    case "granny": drawGrandmother(ctx, 0.8, 0.7, t); break;
    default:
      polyPath(ctx, [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]]);
      ctx.fillStyle = "#888";
      ctx.fill();
  }
  ctx.restore();
}
