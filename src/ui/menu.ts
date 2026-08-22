import { ARENAS } from "../levels";
import type { LevelDef } from "../levels/types";
import { clamp, TAU } from "../core/math";
import type { Ctx } from "../render/draw";
import { settings, SHAKE_LABELS } from "./settings";
import { quality, TIER_LABELS } from "./quality";
import { progress } from "./progress";

/**
 * The front end.
 *
 * One screen. The build this replaced had four — a mode select, a playground grid, a
 * campaign mission ladder and an endless page — plus a result card with a revive offer,
 * a medal shelf and a daily countdown. All of it is gone with the modes it advertised.
 *
 * What is left is the only decision the game actually asks the player to make: which
 * arena. Everything else the front end has to do — pause, options — is a small overlay
 * on top of the world, not a page you navigate to.
 *
 * This is the *functional* version. The visual pass (pixel framing, arena previews
 * painted from the tilesets, a hard palette and chunky type instead of these plain
 * panels) is System 10 in `SYSTEMS.md`, deliberately scheduled last so the menu
 * advertises the six arenas that will exist by then rather than the one that does now.
 */

const CREAM = "#f4f1e8";
const GOLD = "#ffd23f";
const INK = "#0e1017";

/** Things the menu handles by itself. `click()` applies them and reports `none`. */
type UiAction =
  | { ui: "options" }
  | { ui: "close" }
  | { ui: "shake"; step: number }
  | { ui: "quality"; step: number }
  | { ui: "tips" };

export type MenuAction =
  | { kind: "none" }
  | { kind: "select"; level: LevelDef }
  | { kind: "play"; level: LevelDef }
  | { kind: "resume" }
  | { kind: "restart" }
  | { kind: "quit" }
  | ({ kind: "ui" } & UiAction);

interface Region {
  x: number; y: number; w: number; h: number;
  action: MenuAction;
}

export class Menu {
  /** Index into `ARENAS`. The selected arena is the one playing itself behind the menu. */
  private sel = 0;
  private optionsOpen = false;
  private t = 0;
  private hot = -1;

  /** Hit regions, rebuilt every frame by `draw` and consumed by `click`/`hover`. */
  private regions: Region[] = [];

  /** Latest cursor position, written by the game so `draw` can light up what is under it. */
  readonly lastMouse = { x: -1, y: -1 };

  /** The arena the attract mode should be playing. */
  get previewLevel(): LevelDef {
    return ARENAS[this.sel] ?? ARENAS[0];
  }

  update(dt: number) {
    this.t += dt;
  }

  /** Keyboard selection. Wraps, because a list of six should not have dead ends. */
  moveSelection(dir: number) {
    const n = ARENAS.length;
    this.sel = (this.sel + Math.sign(dir) + n) % n;
  }

  confirm(): MenuAction {
    if (this.optionsOpen) {
      this.optionsOpen = false;
      return { kind: "none" };
    }
    return { kind: "play", level: this.previewLevel };
  }

  /** @returns true when there was something to back out of. */
  back(): boolean {
    return this.closeOptions();
  }

  closeOptions(): boolean {
    if (!this.optionsOpen) return false;
    this.optionsOpen = false;
    return true;
  }

  /** No-op, kept so `game.ts` can keep its single navigation path while screens are gone. */
  goTo(_screen: string) {}

  hover(x: number, y: number) {
    this.hot = this.regions.findIndex(
      (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
    );
  }

  click(x: number, y: number): MenuAction {
    this.hover(x, y);
    const r = this.regions[this.hot];
    if (!r) return { kind: "none" };
    if (r.action.kind === "ui") {
      this.applyUi(r.action);
      return { kind: "none" };
    }
    if (r.action.kind === "select") {
      this.sel = Math.max(0, ARENAS.indexOf(r.action.level));
    }
    return r.action;
  }

  private applyUi(a: { kind: "ui" } & UiAction) {
    switch (a.ui) {
      case "options": this.optionsOpen = true; break;
      case "close": this.optionsOpen = false; break;
      case "shake": settings.setShakeStep(a.step); break;
      case "quality": quality.setStep(a.step); break;
      case "tips": settings.setTips(!settings.tips); break;
    }
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: Ctx, w: number, h: number, _muted = false) {
    this.regions = [];
    const k = clamp(Math.min(w, h) / 780, 0.55, 1.5);

    // The world is already drawn behind this; the scrim is what stops the attract-mode
    // demo competing with the type for attention.
    ctx.fillStyle = "rgba(10,12,18,0.62)";
    ctx.fillRect(0, 0, w, h);

    text(ctx, "STICKMAN ASCENSION", w / 2, h * 0.16, 46 * k, CREAM,
      "center", "middle", 900, "rgba(0,0,0,0.65)");
    text(ctx, "PICK SOMETHING TO BREAK", w / 2, h * 0.16 + 34 * k, 13 * k,
      "rgba(244,241,232,0.5)", "center", "middle", 800);

    this.drawArenaRow(ctx, w, h, k);
    this.drawGearButton(ctx, w, k);
    if (this.optionsOpen) this.drawOptions(ctx, w, h, k);

    this.hover(this.lastMouse.x, this.lastMouse.y);
  }

  /** The arena strip. One card per arena, the selected one raised and playing behind. */
  private drawArenaRow(ctx: Ctx, w: number, h: number, k: number) {
    const n = ARENAS.length;
    const cardW = Math.min(240 * k, (w - 40 * k) / Math.max(1, n) - 12 * k);
    const cardH = cardW * 0.62;
    const gap = 12 * k;
    const totalW = n * cardW + (n - 1) * gap;
    const x0 = w / 2 - totalW / 2;
    const y = h * 0.44;

    ARENAS.forEach((def, i) => {
      const x = x0 + i * (cardW + gap);
      const chosen = i === this.sel;
      const cy = y - (chosen ? 8 * k : 0);

      ctx.fillStyle = chosen ? "rgba(20,24,34,0.94)" : "rgba(14,16,23,0.82)";
      roundRect(ctx, x, cy, cardW, cardH, 6 * k);
      ctx.fill();

      ctx.strokeStyle = chosen ? def.accent : "rgba(244,241,232,0.16)";
      ctx.lineWidth = chosen ? 2.5 * k : 1.2 * k;
      roundRect(ctx, x, cy, cardW, cardH, 6 * k);
      ctx.stroke();

      // A band of the arena's own accent, so the six read as six places, not six rows.
      ctx.fillStyle = def.accent;
      ctx.fillRect(x + 10 * k, cy + cardH - 16 * k, cardW - 20 * k, 3 * k);

      fitText(ctx, def.name.toUpperCase(), x + cardW / 2, cy + cardH * 0.4,
        20 * k, cardW - 24 * k, chosen ? CREAM : "rgba(244,241,232,0.72)", 900);
      fitText(ctx, def.tagline, x + cardW / 2, cy + cardH * 0.62,
        11 * k, cardW - 24 * k, "rgba(244,241,232,0.45)", 700);

      this.regions.push({ x, y: cy, w: cardW, h: cardH, action: { kind: "select", level: def } });
    });

    // One PLAY button under the strip. The card selects, the button commits — two
    // separate gestures, so a mis-click on a card never drops you into an arena.
    const bw = Math.min(300 * k, w - 60 * k);
    const bh = 52 * k;
    const bx = w / 2 - bw / 2;
    const by = y + cardH + 30 * k;
    const hot = this.isHot(bx, by, bw, bh);

    ctx.fillStyle = hot ? GOLD : "rgba(255,210,63,0.86)";
    roundRect(ctx, bx, by, bw, bh, 5 * k);
    ctx.fill();
    text(ctx, "PLAY", w / 2, by + bh / 2, 24 * k, INK, "center", "middle", 900);
    this.regions.push({ x: bx, y: by, w: bw, h: bh, action: { kind: "play", level: this.previewLevel } });

    // Carnage, and what it is buying next. The whole progression, in one line.
    const next = progress.nextUnlock();
    const line = next
      ? `${progress.carnage.toLocaleString("en-US")} CARNAGE · ${Math.max(0, next.cost - next.have).toLocaleString("en-US")} TO NEXT ROUND`
      : `${progress.carnage.toLocaleString("en-US")} CARNAGE · EVERY ROUND UNLOCKED`;
    text(ctx, line, w / 2, by + bh + 26 * k, 12 * k, "rgba(255,210,63,0.7)", "center", "middle", 800);
  }

  private drawGearButton(ctx: Ctx, w: number, k: number) {
    const r = 20 * k;
    const cx = w - 30 * k;
    const cy = 30 * k;
    const hot = this.isHot(cx - r, cy - r, r * 2, r * 2);
    drawGear(ctx, cx, cy, r * 0.62, hot);
    this.regions.push({
      x: cx - r, y: cy - r, w: r * 2, h: r * 2,
      action: { kind: "ui", ui: "options" },
    });
  }

  /**
   * Options.
   *
   * Three controls, and no more than three.
   *
   * EFFECTS is the one that decides whether the game runs at all on a slow machine, so
   * it goes first and it says what it costs rather than hiding behind a number. Screen
   * shake is next because it is an accessibility control rather than a preference —
   * motion sickness is not a matter of taste. Control tips last, so a returning player
   * can switch off a tutorial they have already had.
   *
   * The volume and mute rows that used to sit in the middle are gone with the audio
   * (see `fx/audio.ts`).
   */
  private drawOptions(ctx: Ctx, w: number, h: number, k: number) {
    ctx.fillStyle = "rgba(10,12,18,0.82)";
    ctx.fillRect(0, 0, w, h);

    const pw = Math.min(420 * k, w - 40 * k);
    const ph = 320 * k;
    const px = w / 2 - pw / 2;
    const py = h / 2 - ph / 2;

    ctx.fillStyle = "rgba(18,21,30,0.98)";
    roundRect(ctx, px, py, pw, ph, 8 * k);
    ctx.fill();
    ctx.strokeStyle = "rgba(244,241,232,0.18)";
    ctx.lineWidth = 1.4 * k;
    roundRect(ctx, px, py, pw, ph, 8 * k);
    ctx.stroke();

    text(ctx, "OPTIONS", w / 2, py + 32 * k, 22 * k, CREAM, "center", "middle", 900);

    const rowX = px + 24 * k;
    const rowW = pw - 48 * k;
    let ry = py + 68 * k;

    ry = this.drawSteps(ctx, rowX, ry, rowW, k, "EFFECTS",
      TIER_LABELS, quality.step, (i) => ({ kind: "ui", ui: "quality", step: i }));
    // Said plainly, because the tier names alone do not tell a player on a slow laptop
    // that this is the control that will fix their frame rate.
    text(ctx, "Fewer particles and effects. Turn down if the game stutters.",
      rowX, ry - 12 * k, 10 * k, "rgba(244,241,232,0.38)", "left", "middle", 700);
    ry += 6 * k;

    ry = this.drawSteps(ctx, rowX, ry, rowW, k, "SCREEN SHAKE",
      SHAKE_LABELS, settings.shakeStep, (i) => ({ kind: "ui", ui: "shake", step: i }));
    ry = this.drawToggle(ctx, rowX, ry, rowW, k, "CONTROL TIPS", settings.tips,
      { kind: "ui", ui: "tips" });
    void ry;

    const bh = 42 * k;
    const by = py + ph - bh - 20 * k;
    const hot = this.isHot(rowX, by, rowW, bh);
    ctx.fillStyle = hot ? GOLD : "rgba(255,210,63,0.8)";
    roundRect(ctx, rowX, by, rowW, bh, 5 * k);
    ctx.fill();
    text(ctx, "CLOSE", w / 2, by + bh / 2, 16 * k, INK, "center", "middle", 900);
    this.regions.push({ x: rowX, y: by, w: rowW, h: bh, action: { kind: "ui", ui: "close" } });
  }

  /** A labelled row of discrete stops. Returns the Y the next row should start at. */
  private drawSteps(
    ctx: Ctx, x: number, y: number, w: number, k: number,
    label: string, labels: readonly string[], current: number,
    action: (i: number) => MenuAction,
  ): number {
    text(ctx, label, x, y, 12 * k, "rgba(244,241,232,0.6)", "left", "middle", 800);
    const n = labels.length;
    const gap = 6 * k;
    const bw = (w - gap * (n - 1)) / n;
    const bh = 30 * k;
    const by = y + 16 * k;
    for (let i = 0; i < n; i++) {
      const bx = x + i * (bw + gap);
      const on = i === current;
      ctx.fillStyle = on ? GOLD : "rgba(244,241,232,0.1)";
      roundRect(ctx, bx, by, bw, bh, 4 * k);
      ctx.fill();
      text(ctx, labels[i], bx + bw / 2, by + bh / 2, 11 * k,
        on ? INK : "rgba(244,241,232,0.7)", "center", "middle", 800);
      this.regions.push({ x: bx, y: by, w: bw, h: bh, action: action(i) });
    }
    return by + bh + 22 * k;
  }

  private drawToggle(
    ctx: Ctx, x: number, y: number, w: number, k: number,
    label: string, on: boolean, action: MenuAction,
  ): number {
    const bh = 34 * k;
    ctx.fillStyle = "rgba(244,241,232,0.06)";
    roundRect(ctx, x, y, w, bh, 4 * k);
    ctx.fill();
    text(ctx, label, x + 12 * k, y + bh / 2, 12 * k, "rgba(244,241,232,0.75)", "left", "middle", 800);
    text(ctx, on ? "ON" : "OFF", x + w - 12 * k, y + bh / 2, 12 * k,
      on ? GOLD : "rgba(244,241,232,0.4)", "right", "middle", 900);
    this.regions.push({ x, y, w, h: bh, action });
    return y + bh + 16 * k;
  }

  /** The pause overlay. Drawn over the live world, which keeps settling behind it. */
  drawPause(ctx: Ctx, w: number, h: number, levelName: string) {
    this.regions = [];
    const k = clamp(Math.min(w, h) / 780, 0.55, 1.5);

    ctx.fillStyle = "rgba(10,12,18,0.72)";
    ctx.fillRect(0, 0, w, h);

    if (this.optionsOpen) {
      this.drawOptions(ctx, w, h, k);
      this.hover(this.lastMouse.x, this.lastMouse.y);
      return;
    }

    text(ctx, "PAUSED", w / 2, h * 0.3, 40 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.6)");
    text(ctx, levelName.toUpperCase(), w / 2, h * 0.3 + 30 * k, 12 * k,
      "rgba(244,241,232,0.45)", "center", "middle", 800);

    const buttons: [string, MenuAction, boolean][] = [
      ["RESUME", { kind: "resume" }, true],
      ["RESTART ARENA", { kind: "restart" }, false],
      ["OPTIONS", { kind: "ui", ui: "options" }, false],
      ["LEAVE", { kind: "quit" }, false],
    ];
    const bw = Math.min(280 * k, w - 60 * k);
    const bh = 44 * k;
    let by = h * 0.44;
    for (const [label, action, primary] of buttons) {
      const bx = w / 2 - bw / 2;
      const hot = this.isHot(bx, by, bw, bh);
      ctx.fillStyle = primary
        ? (hot ? GOLD : "rgba(255,210,63,0.86)")
        : (hot ? "rgba(244,241,232,0.18)" : "rgba(244,241,232,0.08)");
      roundRect(ctx, bx, by, bw, bh, 5 * k);
      ctx.fill();
      text(ctx, label, w / 2, by + bh / 2, 15 * k, primary ? INK : CREAM, "center", "middle", 900);
      this.regions.push({ x: bx, y: by, w: bw, h: bh, action });
      by += bh + 10 * k;
    }

    this.hover(this.lastMouse.x, this.lastMouse.y);
  }

  /** True when the cursor is inside this rect. Read *before* the region is pushed. */
  private isHot(x: number, y: number, w: number, h: number) {
    const m = this.lastMouse;
    return m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
  }
}

// ------------------------------------------------------------------ helpers

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
}

const fontOf = (size: number, weight: number) =>
  `${weight} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;

function measure(ctx: Ctx, str: string, size: number, weight: number) {
  ctx.font = fontOf(size, weight);
  return ctx.measureText(str).width;
}

/** Text that shrinks rather than overflowing. */
function fitText(
  ctx: Ctx, str: string, x: number, y: number, size: number, maxW: number,
  color: string, weight = 800,
) {
  let s = size;
  while (s > 6 && measure(ctx, str, s, weight) > maxW) s -= 0.5;
  text(ctx, str, x, y, s, color, "center", "middle", weight);
}

/** Options cog. Six teeth is enough to read as one at any size this is drawn at. */
function drawGear(ctx: Ctx, cx: number, cy: number, r: number, hot: boolean) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = hot ? CREAM : "rgba(244,241,232,0.6)";
  ctx.lineWidth = r * 0.26;
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66);
    ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function text(
  ctx: Ctx, str: string, x: number, y: number, size: number, color: string,
  align: CanvasTextAlign = "left", baseline: CanvasTextBaseline = "alphabetic",
  weight = 700, stroke?: string,
) {
  ctx.font = fontOf(size, weight);
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
