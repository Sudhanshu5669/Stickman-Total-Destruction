import { LEVELS } from "../levels";
import type { LevelDef } from "../levels/types";
import { THEMES } from "../render/theme";
import { clamp, hash01, TAU } from "../core/math";
import type { Ctx } from "../render/draw";

const CREAM = "#f4f1e8";
const GOLD = "#ffd23f";

export type MenuAction =
  | { kind: "none" }
  | { kind: "select"; level: LevelDef }
  | { kind: "play"; level: LevelDef }
  | { kind: "resume" }
  | { kind: "restart" }
  | { kind: "quit" }
  | { kind: "mute" };

interface Region {
  x: number; y: number; w: number; h: number;
  action: MenuAction;
}

/**
 * Start menu and pause overlay.
 *
 * Both are drawn straight onto the game canvas over the live simulation — the demo
 * keeps playing behind the menu, which is the whole point of the attract mode. Layout
 * is recomputed each frame from the viewport so it holds up from phone to ultrawide,
 * and hit regions are rebuilt alongside it so clicks always match what was drawn.
 */
export class Menu {
  selected = 0;
  private regions: Region[] = [];
  private hovered = -1;
  private t = 0;
  /** Per-card hover/selection lift, smoothed. */
  private lift: number[] = LEVELS.map(() => 0);

  get level(): LevelDef {
    return LEVELS[clamp(this.selected, 0, LEVELS.length - 1)];
  }

  update(dt: number) {
    this.t += dt;
    for (let i = 0; i < this.lift.length; i++) {
      const want = i === this.selected ? 1 : i === this.hovered ? 0.5 : 0;
      this.lift[i] += (want - this.lift[i]) * (1 - Math.exp(-12 * dt));
    }
  }

  /** Keyboard navigation, so the menu works without a mouse. */
  moveSelection(delta: number) {
    this.selected = (this.selected + delta + LEVELS.length) % LEVELS.length;
  }

  hover(mx: number, my: number) {
    this.hovered = -1;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        if (r.action.kind === "select") this.hovered = LEVELS.indexOf(r.action.level);
        return r.action;
      }
    }
    return null;
  }

  click(mx: number, my: number): MenuAction {
    const a = this.hover(mx, my);
    if (!a) return { kind: "none" };
    if (a.kind === "select") {
      const idx = LEVELS.indexOf(a.level);
      // Second click on the already-selected card launches it.
      if (idx === this.selected) return { kind: "play", level: a.level };
      this.selected = idx;
      return a;
    }
    return a;
  }

  // ------------------------------------------------------------------ main menu

  draw(ctx: Ctx, w: number, h: number, muted: boolean) {
    this.regions = [];
    const k = clamp(Math.min(w / 1280, h / 760), 0.5, 1.25);

    // Scrim: dark behind the title and footer, thin across the middle so the demo
    // playing underneath stays legible — it is the reason the attract mode exists.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(8,10,16,0.88)");
    g.addColorStop(0.3, "rgba(8,10,16,0.42)");
    g.addColorStop(0.62, "rgba(8,10,16,0.3)");
    g.addColorStop(1, "rgba(8,10,16,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // --- title --------------------------------------------------------------
    const titleY = h * 0.155;
    text(ctx, "STICKMAN", w / 2, titleY, 74 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.75)");
    text(ctx, "ASCENSION", w / 2, titleY + 62 * k, 74 * k, GOLD, "center", "middle", 900, "rgba(0,0,0,0.75)");
    text(ctx, "a ragdoll destruction sandbox", w / 2, titleY + 108 * k, 15 * k, "rgba(244,241,232,0.55)", "center", "middle", 700);

    // --- level cards --------------------------------------------------------
    const cardW = Math.min(268 * k, (w - 80 * k) / LEVELS.length - 16 * k);
    const cardH = cardW * 0.82;
    const gap = 18 * k;
    const totalW = LEVELS.length * cardW + (LEVELS.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const cardY = h * 0.42;

    for (let i = 0; i < LEVELS.length; i++) {
      const def = LEVELS[i];
      const x = startX + i * (cardW + gap);
      const lift = this.lift[i];
      const y = cardY - lift * 10 * k;
      this.regions.push({ x, y, w: cardW, h: cardH, action: { kind: "select", level: def } });
      this.drawCard(ctx, def, x, y, cardW, cardH, k, lift, i === this.selected);
    }

    // --- play button --------------------------------------------------------
    const btnW = 300 * k;
    const btnH = 62 * k;
    const btnX = w / 2 - btnW / 2;
    const btnY = cardY + cardH + 42 * k;
    const playHover = this.regionHovered(btnX, btnY, btnW, btnH);
    this.regions.push({ x: btnX, y: btnY, w: btnW, h: btnH, action: { kind: "play", level: this.level } });

    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
    ctx.fillStyle = playHover ? GOLD : `rgba(255,210,63,${0.86 + pulse * 0.14})`;
    roundRect(ctx, btnX, btnY, btnW, btnH, 12 * k);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2 * k;
    ctx.stroke();
    text(ctx, "PLAY", w / 2, btnY + btnH / 2 + 2 * k, 30 * k, "#141820", "center", "middle", 900);

    // --- footer -------------------------------------------------------------
    const footY = h - 30 * k;
    text(ctx, "← →  choose world     ENTER  play     M  sound", w / 2, footY - 20 * k,
      13 * k, "rgba(244,241,232,0.42)", "center", "middle", 700);
    text(ctx, "A/D move   SPACE jump   MOUSE aim   CLICK fire   1-9 swap ammo   R go limp",
      w / 2, footY, 13 * k, "rgba(244,241,232,0.3)", "center", "middle", 700);

    // Sound toggle, top right.
    const sx = w - 54 * k;
    const sy = 34 * k;
    this.regions.push({ x: sx - 20 * k, y: sy - 20 * k, w: 40 * k, h: 40 * k, action: { kind: "mute" } });
    this.drawSpeaker(ctx, sx, sy, 15 * k, muted);
  }

  private drawCard(
    ctx: Ctx, def: LevelDef, x: number, y: number, w: number, h: number,
    k: number, lift: number, selected: boolean,
  ) {
    const thumbH = h * 0.56;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = (10 + lift * 22) * k;
    ctx.shadowOffsetY = (4 + lift * 6) * k;
    ctx.fillStyle = "rgba(18,21,29,0.96)";
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.fill();
    ctx.restore();

    // Thumbnail, clipped to the card's rounded top.
    ctx.save();
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.clip();
    ctx.drawImage(thumbnail(def), x, y, w, thumbH);
    const fade = ctx.createLinearGradient(0, y + thumbH * 0.5, 0, y + thumbH);
    fade.addColorStop(0, "rgba(18,21,29,0)");
    fade.addColorStop(1, "rgba(18,21,29,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(x, y + thumbH * 0.5, w, thumbH * 0.5 + 1);
    ctx.restore();

    // Text block.
    const tx = x + 14 * k;
    text(ctx, def.name.toUpperCase(), tx, y + thumbH + 20 * k, 18 * k, CREAM, "left", "middle", 900);
    wrapText(ctx, def.tagline, tx, y + thumbH + 42 * k, w - 28 * k, 14 * k, 12 * k, "rgba(244,241,232,0.5)");

    // Modifier tags.
    let tagX = tx;
    const tagY = y + h - 20 * k;
    ctx.font = `800 ${9 * k}px "Trebuchet MS", system-ui, sans-serif`;
    for (const tag of def.tags) {
      const tw = ctx.measureText(tag).width + 12 * k;
      if (tagX + tw > x + w - 10 * k) break;
      ctx.fillStyle = `${def.accent}22`;
      roundRect(ctx, tagX, tagY - 8 * k, tw, 16 * k, 4 * k);
      ctx.fill();
      ctx.strokeStyle = `${def.accent}55`;
      ctx.lineWidth = 1 * k;
      ctx.stroke();
      text(ctx, tag, tagX + tw / 2, tagY, 9 * k, def.accent, "center", "middle", 800);
      tagX += tw + 6 * k;
    }

    // Selection ring.
    ctx.strokeStyle = selected ? def.accent : `rgba(255,255,255,${0.08 + lift * 0.2})`;
    ctx.lineWidth = (selected ? 3 : 1.5) * k;
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.stroke();
  }

  private drawSpeaker(ctx: Ctx, x: number, y: number, r: number, muted: boolean) {
    ctx.fillStyle = muted ? "rgba(244,241,232,0.35)" : CREAM;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.7, y - r * 0.3);
    ctx.lineTo(x - r * 0.3, y - r * 0.3);
    ctx.lineTo(x + r * 0.1, y - r * 0.75);
    ctx.lineTo(x + r * 0.1, y + r * 0.75);
    ctx.lineTo(x - r * 0.3, y + r * 0.3);
    ctx.lineTo(x - r * 0.7, y + r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = "round";
    if (muted) {
      ctx.beginPath();
      ctx.moveTo(x + r * 0.35, y - r * 0.35);
      ctx.lineTo(x + r * 0.9, y + r * 0.35);
      ctx.moveTo(x + r * 0.9, y - r * 0.35);
      ctx.lineTo(x + r * 0.35, y + r * 0.35);
      ctx.stroke();
    } else {
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(x + r * 0.1, y, r * (0.35 + i * 0.3), -0.9, 0.9);
        ctx.stroke();
      }
    }
  }

  private regionHovered(x: number, y: number, w: number, h: number) {
    return this.lastMouse.x >= x && this.lastMouse.x <= x + w && this.lastMouse.y >= y && this.lastMouse.y <= y + h;
  }

  lastMouse = { x: -1, y: -1 };

  // ------------------------------------------------------------------ pause menu

  drawPause(ctx: Ctx, w: number, h: number, levelName: string) {
    this.regions = [];
    const k = clamp(Math.min(w / 1280, h / 760), 0.5, 1.25);

    ctx.fillStyle = "rgba(8,10,16,0.72)";
    ctx.fillRect(0, 0, w, h);

    text(ctx, "PAUSED", w / 2, h * 0.3, 56 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.7)");
    text(ctx, levelName.toUpperCase(), w / 2, h * 0.3 + 42 * k, 14 * k, "rgba(244,241,232,0.5)", "center", "middle", 800);

    const bw = 280 * k;
    const bh = 52 * k;
    const bx = w / 2 - bw / 2;
    let by = h * 0.44;
    const buttons: { label: string; action: MenuAction; primary?: boolean }[] = [
      { label: "RESUME", action: { kind: "resume" }, primary: true },
      { label: "RESTART LEVEL", action: { kind: "restart" } },
      { label: "MAIN MENU", action: { kind: "quit" } },
    ];
    for (const b of buttons) {
      const hovered = this.regionHovered(bx, by, bw, bh);
      this.regions.push({ x: bx, y: by, w: bw, h: bh, action: b.action });
      ctx.fillStyle = b.primary
        ? (hovered ? GOLD : "rgba(255,210,63,0.9)")
        : (hovered ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)");
      roundRect(ctx, bx, by, bw, bh, 10 * k);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1.5 * k;
      ctx.stroke();
      text(ctx, b.label, w / 2, by + bh / 2 + 1 * k, 18 * k, b.primary ? "#141820" : CREAM, "center", "middle", 900);
      by += bh + 12 * k;
    }
    text(ctx, "ESC to resume", w / 2, by + 18 * k, 12 * k, "rgba(244,241,232,0.35)", "center", "middle", 700);
  }
}

// ------------------------------------------------------------------ thumbnails

const THUMB_W = 420;
const THUMB_H = 240;
const thumbCache = new Map<string, HTMLCanvasElement>();

/**
 * A miniature of each world, painted once from its theme.
 *
 * Rendering four of these live every frame would cost more than the game behind them,
 * and they never change, so they are baked into offscreen canvases on first use.
 */
function thumbnail(def: LevelDef): HTMLCanvasElement {
  let c = thumbCache.get(def.id);
  if (c) return c;

  c = document.createElement("canvas");
  c.width = THUMB_W;
  c.height = THUMB_H;
  const g = c.getContext("2d")!;
  const th = THEMES[def.theme] ?? THEMES.day;
  const horizon = THUMB_H * 0.74;

  const sky = g.createLinearGradient(0, 0, 0, THUMB_H);
  sky.addColorStop(0, th.sky[0]);
  sky.addColorStop(0.42, th.sky[1]);
  sky.addColorStop(0.78, th.sky[2]);
  sky.addColorStop(1, th.sky[3]);
  g.fillStyle = sky;
  g.fillRect(0, 0, THUMB_W, THUMB_H);

  if (th.stars > 0) {
    g.fillStyle = th.starColor;
    for (let i = 0; i < 60; i++) {
      const sx = hash01(i * 1.7) * THUMB_W;
      const sy = hash01(i * 4.3) * horizon * 0.8;
      g.globalAlpha = 0.3 + hash01(i * 9.1) * 0.7;
      g.fillRect(sx, sy, 1.4, 1.4);
    }
    g.globalAlpha = 1;
  }
  if (th.sun) {
    const sx = THUMB_W * th.sun.xFrac;
    const sy = horizon - 110;
    const rg = g.createRadialGradient(sx, sy, 4, sx, sy, 110);
    rg.addColorStop(0, `rgba(${th.sun.color},0.85)`);
    rg.addColorStop(1, `rgba(${th.sun.color},0)`);
    g.fillStyle = rg;
    g.fillRect(sx - 110, sy - 110, 220, 220);
  }
  if (th.moon) {
    g.fillStyle = `rgba(${th.moon.color},0.95)`;
    g.beginPath();
    g.arc(THUMB_W * th.moon.xFrac, horizon - 130, 20, 0, TAU);
    g.fill();
  }

  // Distant hills.
  for (const [depth, color] of [[0.55, th.hillFar], [0.3, th.hillNear]] as const) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, THUMB_H);
    for (let x = 0; x <= THUMB_W; x += 14) {
      g.lineTo(x, horizon - 26 * depth - Math.sin(x * 0.017 + depth * 5) * 16 * depth);
    }
    g.lineTo(THUMB_W, THUMB_H);
    g.closePath();
    g.fill();
  }

  // A representative structure per world, so the cards read at a glance.
  g.fillStyle = "rgba(0,0,0,0.55)";
  switch (def.id) {
    case "castle":
      for (const [bx, bw, bh] of [[110, 46, 96], [180, 60, 68], [252, 46, 110]] as const) {
        g.fillRect(bx, horizon - bh, bw, bh);
        for (let m = 0; m < 5; m += 2) g.fillRect(bx + (m * bw) / 5, horizon - bh - 9, bw / 5, 9);
      }
      break;
    case "alien":
      for (const [bx, bh, lean] of [[120, 120, 10], [176, 92, -8], [232, 140, 6], [280, 76, 4]] as const) {
        g.beginPath();
        g.moveTo(bx - 15, horizon);
        g.quadraticCurveTo(bx - 6, horizon - bh * 0.6, bx + lean, horizon - bh);
        g.quadraticCurveTo(bx + 8, horizon - bh * 0.5, bx + 15, horizon);
        g.closePath();
        g.fill();
      }
      // Acid streaks.
      g.strokeStyle = "rgba(157,255,106,0.5)";
      g.lineWidth = 1.6;
      for (let i = 0; i < 60; i++) {
        const rx = hash01(i * 3.3) * THUMB_W;
        const ry = hash01(i * 6.1) * horizon;
        g.beginPath();
        g.moveTo(rx, ry);
        g.lineTo(rx - 2, ry + 13);
        g.stroke();
      }
      break;
    case "mars":
      g.beginPath();
      g.arc(150, horizon, 42, Math.PI, 0);
      g.fill();
      g.fillRect(228, horizon - 128, 24, 128);
      g.fillRect(268, horizon - 92, 20, 92);
      g.strokeStyle = "rgba(0,0,0,0.55)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(310, horizon);
      g.lineTo(310, horizon - 74);
      g.moveTo(298, horizon - 62);
      g.lineTo(322, horizon - 62);
      g.stroke();
      break;
    default:
      for (const [bx, bw, bh] of [[120, 40, 118], [172, 46, 150], [232, 38, 92], [280, 44, 130]] as const) {
        g.fillRect(bx, horizon - bh, bw, bh);
      }
      break;
  }

  // Ground band.
  g.fillStyle = th.ground;
  g.fillRect(0, horizon, THUMB_W, THUMB_H - horizon);
  g.fillStyle = th.groundTop;
  g.fillRect(0, horizon, THUMB_W, 7);

  // A little stickman with a gun, for scale and identity.
  drawMiniStickman(g, 62, horizon, 1.5);

  thumbCache.set(def.id, c);
  return c;
}

function drawMiniStickman(g: Ctx, x: number, groundY: number, s: number) {
  g.strokeStyle = "#14171f";
  g.lineWidth = 3.2 * s;
  g.lineCap = "round";
  const hip = groundY - 17 * s;
  g.beginPath();
  g.moveTo(x, hip);
  g.lineTo(x, hip - 13 * s);
  g.moveTo(x, hip);
  g.lineTo(x - 6 * s, groundY);
  g.moveTo(x, hip);
  g.lineTo(x + 6 * s, groundY);
  g.moveTo(x, hip - 10 * s);
  g.lineTo(x + 9 * s, hip - 13 * s);
  g.stroke();
  g.fillStyle = "#14171f";
  g.beginPath();
  g.arc(x, hip - 18 * s, 5 * s, 0, TAU);
  g.fill();
  // Gun.
  g.fillStyle = "#3a4250";
  g.fillRect(x + 8 * s, hip - 15.5 * s, 13 * s, 5 * s);
  g.fillStyle = "#e04b3a";
  g.fillRect(x + 20 * s, hip - 17 * s, 4 * s, 8 * s);
}

// ------------------------------------------------------------------ primitives

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
}

function text(
  ctx: Ctx, str: string, x: number, y: number, size: number, color: string,
  align: CanvasTextAlign = "left", baseline: CanvasTextBaseline = "alphabetic",
  weight = 700, stroke?: string,
) {
  ctx.font = `${weight} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = size * 0.18;
    ctx.lineJoin = "round";
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function wrapText(
  ctx: Ctx, str: string, x: number, y: number, maxW: number,
  size: number, lineH: number, color: string,
) {
  ctx.font = `700 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  const words = str.split(" ");
  let line = "";
  let ly = y;
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, ly);
      line = word;
      ly += lineH;
      if (++lines >= 2) return;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, ly);
}
