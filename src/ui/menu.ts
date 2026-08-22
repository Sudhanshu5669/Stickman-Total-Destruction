import { ARENAS } from "../levels";
import type { LevelDef } from "../levels/types";
import { clamp, TAU } from "../core/math";
import type { Ctx } from "../render/draw";
import { THEMES } from "../render/theme";
import { settings, SHAKE_LABELS } from "./settings";
import { quality, TIER_LABELS } from "./quality";
import { progress } from "./progress";
import { AMMO_BY_ID } from "../weapons/ammo";
import { notchedPanel, INK, CREAM, GOLD, PANEL, PANEL_LIT, PANEL_DIM, MUTED } from "./chrome";

/**
 * The front end.
 *
 * One screen: pick an arena, play. The build this replaced had four pages, a result
 * card, a revive offer, a medal shelf and a daily countdown, all of which advertised
 * modes that no longer exist.
 *
 * ## Why it looks like this
 *
 * The brief was "an actual game, not a website UI, no gradients". Those are the same
 * instruction stated twice, because the thing that makes canvas UI read as a web page
 * is almost always the *rendering*, not the layout: soft gradients, rounded corners,
 * drop shadows and thin grey hairlines. A game menu is built out of the opposite —
 * flat fills, hard edges, notched corners, a small palette used decisively, and type
 * heavy enough to be read at a glance from across a room.
 *
 * The rendering rules — no gradient, no rounded corner, no drop shadow — now live in
 * `ui/chrome.ts`, because the HUD is drawn to the same ones and two copies of a visual
 * language is how the two halves of an interface drift apart. What is left here is what
 * is specific to the front end:
 *
 * 1. **The arena previews are painted from the arenas' own themes and shapes**, so a
 *    card shows the place rather than a coloured rectangle with a name on it.
 * 2. **One accent per arena**, taken from the level definition, so the seven read as
 *    seven places rather than seven rows of a list.
 */



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
  private sel = 0;
  private optionsOpen = false;
  private t = 0;
  private hot = -1;
  private regions: Region[] = [];

  readonly lastMouse = { x: -1, y: -1 };

  get previewLevel(): LevelDef {
    return ARENAS[this.sel] ?? ARENAS[0];
  }

  update(dt: number) {
    this.t += dt;
  }

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

  back(): boolean {
    return this.closeOptions();
  }

  closeOptions(): boolean {
    if (!this.optionsOpen) return false;
    this.optionsOpen = false;
    return true;
  }

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

    // A flat scrim, not a gradient. The attract-mode world plays behind it and has to
    // be visible enough to be an advert for itself and quiet enough to lose to the type.
    ctx.fillStyle = "rgba(10,12,18,0.72)";
    ctx.fillRect(0, 0, w, h);

    this.drawTitle(ctx, w, k);
    const cardsBottom = this.drawArenaRow(ctx, w, h, k);
    this.drawDetail(ctx, w, h, k, cardsBottom);
    this.drawGearButton(ctx, w, k);
    if (this.optionsOpen) this.drawOptions(ctx, w, h, k);

    this.hover(this.lastMouse.x, this.lastMouse.y);
  }

  /**
   * The wordmark.
   *
   * Two passes offset by a pixel — ink under cream — rather than a shadow. A blurred
   * shadow is the single most web-looking thing a canvas title can do; a hard offset is
   * what a sprite-based title would look like, and it costs the same.
   */
  private drawTitle(ctx: Ctx, w: number, k: number) {
    const size = 42 * k;
    const y = 52 * k;
    text(ctx, "STICKMAN ASCENSION", w / 2 + 3 * k, y + 3 * k, size, INK, "center", "middle", 900);
    text(ctx, "STICKMAN ASCENSION", w / 2, y, size, CREAM, "center", "middle", 900);
    // A rule either side of the subtitle, which reads as chrome rather than as text.
    const sub = "PICK SOMETHING TO BREAK";
    const subW = measure(ctx, sub, 12 * k, 800);
    text(ctx, sub, w / 2, y + 28 * k, 12 * k, GOLD, "center", "middle", 800);
    ctx.fillStyle = "rgba(255,210,63,0.45)";
    ctx.fillRect(w / 2 - subW / 2 - 34 * k, y + 27 * k, 24 * k, 2 * k);
    ctx.fillRect(w / 2 + subW / 2 + 10 * k, y + 27 * k, 24 * k, 2 * k);
  }

  /**
   * The seven arena cards.
   *
   * One row on a desktop frame, two on a phone. The break is decided by the card width
   * a single row would produce rather than by a viewport breakpoint: seven across a
   * 390 px portrait phone is a 47 px card, which is smaller than a fingertip and far
   * too small to read a name in. Below the threshold the row splits 4 + 3 — the only
   * balanced split of seven — because a wrap that leaves one orphan card on its own
   * line reads as a bug rather than as a grid.
   *
   * @returns the Y the cards end at, so the detail block can sit under them.
   */
  private drawArenaRow(ctx: Ctx, w: number, h: number, k: number): number {
    const n = ARENAS.length;
    const gap = 10 * k;
    const maxW = 168 * k;
    /** Card width if all seven shared one row. */
    const flat = Math.min(maxW, (w - 48 * k - gap * (n - 1)) / n);
    const split = flat < 110 * k;
    const perRow = split ? 4 : n;
    const cardW = split
      ? Math.min(maxW, (w - 48 * k - gap * (perRow - 1)) / perRow)
      : flat;
    const cardH = cardW * 1.0;
    const y = h * (split ? 0.16 : 0.2);

    /** Rows are centred one at a time, so the short last row sits under the middle. */
    const rowOf = (i: number) => Math.floor(i / perRow);
    const countIn = (row: number) => Math.min(perRow, n - row * perRow);
    const originOf = (row: number) => {
      const c = countIn(row);
      return w / 2 - (c * cardW + (c - 1) * gap) / 2;
    };

    ARENAS.forEach((def, i) => {
      const chosen = i === this.sel;
      const row = rowOf(i);
      const x = originOf(row) + (i - row * perRow) * (cardW + gap);
      const lift = chosen ? 6 * k : 0;
      const cy = y + row * (cardH + gap) - lift;
      const hot = this.isHot(x, cy, cardW, cardH);

      // Frame first, then the preview inset into it.
      // Chosen cards get an accent *frame*, not an accent fill. Filling the card meant
      // its own name had to sit on top of a saturated colour, which is the one place
      // this palette cannot hold contrast.
      if (chosen) {
        const o = Math.round(3 * k);
        notchedPanel(ctx, x - o, cy - o, cardW + o * 2, cardH + o * 2, k, def.accent);
      }
      notchedPanel(ctx, x, cy, cardW, cardH, k, hot || chosen ? PANEL_LIT : PANEL);

      const pad = 4 * k;
      const previewH = cardH * 0.56;
      const thumb = arenaThumb(def);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(thumb, x + pad, cy + pad, cardW - pad * 2, previewH);
      ctx.restore();
      // Ink line under the preview, so the art and the label do not bleed together.
      ctx.fillStyle = INK;
      ctx.fillRect(x + pad, cy + pad + previewH, cardW - pad * 2, 2 * k);

      fitText(ctx, def.name.toUpperCase(), x + cardW / 2, cy + previewH + 22 * k,
        15 * k, cardW - 12 * k, chosen ? CREAM : "rgba(244,241,232,0.72)", 900);

      // The accent bar is the card's identity, and it is solid for the chosen one and
      // a stub for the rest — a difference you can see without reading anything.
      ctx.fillStyle = def.accent;
      const barW = chosen ? cardW - 20 * k : 18 * k;
      ctx.fillRect(x + cardW / 2 - barW / 2, cy + cardH - 10 * k, barW, 3 * k);

      this.regions.push({ x, y: cy, w: cardW, h: cardH, action: { kind: "select", level: def } });
    });

    const rows = Math.ceil(n / perRow);
    return y + rows * cardH + (rows - 1) * gap;
  }

  /** Name, tagline, tags and the PLAY button for whichever arena is selected. */
  private drawDetail(ctx: Ctx, w: number, h: number, k: number, top: number) {
    const def = this.previewLevel;
    let y = top + 34 * k;

    text(ctx, def.name.toUpperCase(), w / 2, y, 26 * k, CREAM, "center", "middle", 900);
    y += 24 * k;
    text(ctx, def.tagline, w / 2, y, 13 * k, MUTED, "center", "middle", 700);
    y += 24 * k;

    // Tags as hard-edged chips in the arena's accent.
    const chipH = 18 * k;
    const chipPad = 9 * k;
    const widths = def.tags.map((t) => measure(ctx, t, 10 * k, 800) + chipPad * 2);
    const chipGap = 6 * k;
    let cx = w / 2 - (widths.reduce((a, b) => a + b, 0) + chipGap * (def.tags.length - 1)) / 2;
    def.tags.forEach((tag, i) => {
      ctx.fillStyle = INK;
      ctx.fillRect(cx, y - chipH / 2, widths[i], chipH);
      ctx.fillStyle = def.accent;
      ctx.fillRect(cx, y - chipH / 2, widths[i], 2 * k);
      text(ctx, tag, cx + widths[i] / 2, y + 1 * k, 10 * k, def.accent, "center", "middle", 800);
      cx += widths[i] + chipGap;
    });
    y += 34 * k;

    // PLAY.
    const bw = Math.min(260 * k, w - 80 * k);
    const bh = 46 * k;
    const bx = w / 2 - bw / 2;
    const hot = this.isHot(bx, y, bw, bh);
    notchedPanel(ctx, bx, y, bw, bh, k, hot ? "#ffdf6a" : GOLD, INK);
    text(ctx, "PLAY", w / 2, y + bh / 2, 22 * k, INK, "center", "middle", 900);
    this.regions.push({ x: bx, y, w: bw, h: bh, action: { kind: "play", level: def } });
    y += bh + 12 * k;

    text(ctx, "← →  CHOOSE      ENTER  PLAY", w / 2, y + 6 * k, 10 * k, MUTED, "center", "middle", 800);

    this.drawUnlockBar(ctx, w, h, k);
  }

  /**
   * The whole progression, in one bar at the bottom of the screen.
   *
   * Measured from the previous rung rather than from zero — at six million for the last
   * round, a bar measured from zero barely twitches over a session and reads as "this is
   * hopeless" rather than "nearly there". See `progress.nextUnlock`.
   */
  private drawUnlockBar(ctx: Ctx, w: number, h: number, k: number) {
    const next = progress.nextUnlock();
    const bw = Math.min(420 * k, w - 60 * k);
    const bx = w / 2 - bw / 2;
    const by = h - 54 * k;

    if (!next) {
      text(ctx, `${progress.carnage.toLocaleString("en-US")} CARNAGE · EVERY ROUND UNLOCKED`,
        w / 2, by + 14 * k, 12 * k, GOLD, "center", "middle", 800);
      return;
    }

    const name = (AMMO_BY_ID.get(next.id)?.name ?? next.id).toUpperCase();
    text(ctx, `NEXT ROUND · ${name}`, bx, by, 11 * k, MUTED, "left", "middle", 800);
    text(ctx, `${Math.max(0, next.cost - next.have).toLocaleString("en-US")} TO GO`,
      bx + bw, by, 11 * k, GOLD, "right", "middle", 800);

    const trackH = 10 * k;
    const ty = by + 12 * k;
    ctx.fillStyle = INK;
    ctx.fillRect(bx, ty, bw, trackH);
    ctx.fillStyle = PANEL_DIM;
    ctx.fillRect(bx + 1 * k, ty + 1 * k, bw - 2 * k, trackH - 2 * k);
    // Filled in whole segments rather than a smooth sliver: a bar built out of cells
    // reads as a game meter, where a continuous one reads as a loading indicator.
    const cells = 40;
    const filled = Math.round(clamp(next.frac, 0, 1) * cells);
    const cellW = (bw - 2 * k) / cells;
    for (let i = 0; i < filled; i++) {
      ctx.fillStyle = i === filled - 1 ? "#fff0a8" : GOLD;
      ctx.fillRect(bx + 1 * k + i * cellW, ty + 1 * k, Math.max(1, cellW - 1 * k), trackH - 2 * k);
    }
  }

  /** Carnage total, top right, next to the cog. */
  private drawGearButton(ctx: Ctx, w: number, k: number) {
    const total = `${progress.carnage.toLocaleString("en-US")}`;
    text(ctx, total, w - 62 * k, 30 * k, 15 * k, GOLD, "right", "middle", 900);
    text(ctx, "CARNAGE", w - 62 * k, 44 * k, 9 * k, MUTED, "right", "middle", 800);

    const r = 17 * k;
    const cx = w - 32 * k;
    const cy = 34 * k;
    const hot = this.isHot(cx - r, cy - r, r * 2, r * 2);
    drawGear(ctx, cx, cy, r * 0.62, hot);
    this.regions.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, action: { kind: "ui", ui: "options" } });
  }

  /**
   * Options. Three controls, and no more than three.
   *
   * EFFECTS first because it is the one that decides whether the game runs at all on a
   * slow machine, and it says what it costs rather than hiding behind a number. Screen
   * shake next, because it is an accessibility control rather than a preference —
   * motion sickness is not a matter of taste. Tips last, so a returning player can
   * switch off a tutorial they have already had.
   */
  private drawOptions(ctx: Ctx, w: number, h: number, k: number) {
    // The panel is modal, so it owns every click on the screen. Dropping the regions
    // the menu underneath already registered is what makes it modal: `hover` resolves
    // by *first* match, and the options rows are pushed last, so without this the
    // controls that happen to sit over the PLAY button hand their clicks to PLAY —
    // CONTROL TIPS lands exactly on it at a 900-tall frame, and starts the game.
    this.regions.length = 0;

    ctx.fillStyle = "rgba(8,10,14,0.88)";
    ctx.fillRect(0, 0, w, h);

    const pw = Math.min(430 * k, w - 40 * k);
    const ph = 300 * k;
    const px = w / 2 - pw / 2;
    const py = h / 2 - ph / 2;
    notchedPanel(ctx, px, py, pw, ph, k, PANEL);

    text(ctx, "OPTIONS", w / 2, py + 30 * k, 20 * k, CREAM, "center", "middle", 900);
    ctx.fillStyle = GOLD;
    ctx.fillRect(px + 20 * k, py + 44 * k, pw - 40 * k, 2 * k);

    const rowX = px + 22 * k;
    const rowW = pw - 44 * k;
    let ry = py + 70 * k;

    ry = this.drawSteps(ctx, rowX, ry, rowW, k, "EFFECTS",
      TIER_LABELS, quality.step, (i) => ({ kind: "ui", ui: "quality", step: i }));
    text(ctx, "Fewer particles and effects. Turn down if the game stutters.",
      rowX, ry - 11 * k, 10 * k, MUTED, "left", "middle", 700);
    ry += 8 * k;

    ry = this.drawSteps(ctx, rowX, ry, rowW, k, "SCREEN SHAKE",
      SHAKE_LABELS, settings.shakeStep, (i) => ({ kind: "ui", ui: "shake", step: i }));
    ry = this.drawToggle(ctx, rowX, ry, rowW, k, "CONTROL TIPS", settings.tips,
      { kind: "ui", ui: "tips" });
    void ry;

    const bh = 40 * k;
    const by = py + ph - bh - 20 * k;
    const hot = this.isHot(rowX, by, rowW, bh);
    notchedPanel(ctx, rowX, by, rowW, bh, k, hot ? "#ffdf6a" : GOLD, INK);
    text(ctx, "CLOSE", w / 2, by + bh / 2, 15 * k, INK, "center", "middle", 900);
    this.regions.push({ x: rowX, y: by, w: rowW, h: bh, action: { kind: "ui", ui: "close" } });
  }

  private drawSteps(
    ctx: Ctx, x: number, y: number, w: number, k: number,
    label: string, labels: readonly string[], current: number,
    action: (i: number) => MenuAction,
  ): number {
    text(ctx, label, x, y, 11 * k, MUTED, "left", "middle", 800);
    const n = labels.length;
    const gap = 5 * k;
    const bw = (w - gap * (n - 1)) / n;
    const bh = 28 * k;
    const by = y + 15 * k;
    for (let i = 0; i < n; i++) {
      const bx = x + i * (bw + gap);
      const on = i === current;
      const hot = this.isHot(bx, by, bw, bh);
      notchedPanel(ctx, bx, by, bw, bh, k, on ? GOLD : (hot ? PANEL_LIT : PANEL_DIM));
      text(ctx, labels[i], bx + bw / 2, by + bh / 2, 10 * k,
        on ? INK : "rgba(244,241,232,0.72)", "center", "middle", 800);
      this.regions.push({ x: bx, y: by, w: bw, h: bh, action: action(i) });
    }
    return by + bh + 22 * k;
  }

  private drawToggle(
    ctx: Ctx, x: number, y: number, w: number, k: number,
    label: string, on: boolean, action: MenuAction,
  ): number {
    const bh = 32 * k;
    const hot = this.isHot(x, y, w, bh);
    notchedPanel(ctx, x, y, w, bh, k, hot ? PANEL_LIT : PANEL_DIM);
    text(ctx, label, x + 12 * k, y + bh / 2, 11 * k, "rgba(244,241,232,0.8)", "left", "middle", 800);
    text(ctx, on ? "ON" : "OFF", x + w - 12 * k, y + bh / 2, 11 * k,
      on ? GOLD : MUTED, "right", "middle", 900);
    this.regions.push({ x, y, w, h: bh, action });
    return y + bh + 16 * k;
  }

  /** The pause overlay, drawn over the live world, which keeps settling behind it. */
  drawPause(ctx: Ctx, w: number, h: number, levelName: string) {
    this.regions = [];
    const k = clamp(Math.min(w, h) / 780, 0.55, 1.5);

    ctx.fillStyle = "rgba(8,10,14,0.76)";
    ctx.fillRect(0, 0, w, h);

    if (this.optionsOpen) {
      this.drawOptions(ctx, w, h, k);
      this.hover(this.lastMouse.x, this.lastMouse.y);
      return;
    }

    text(ctx, "PAUSED", w / 2 + 3 * k, h * 0.28 + 3 * k, 38 * k, INK, "center", "middle", 900);
    text(ctx, "PAUSED", w / 2, h * 0.28, 38 * k, CREAM, "center", "middle", 900);
    text(ctx, levelName.toUpperCase(), w / 2, h * 0.28 + 28 * k, 11 * k, GOLD, "center", "middle", 800);

    const buttons: [string, MenuAction, boolean][] = [
      ["RESUME", { kind: "resume" }, true],
      ["RESTART ARENA", { kind: "restart" }, false],
      ["OPTIONS", { kind: "ui", ui: "options" }, false],
      ["LEAVE", { kind: "quit" }, false],
    ];
    const bw = Math.min(250 * k, w - 60 * k);
    const bh = 40 * k;
    let by = h * 0.42;
    for (const [label, action, primary] of buttons) {
      const bx = w / 2 - bw / 2;
      const hot = this.isHot(bx, by, bw, bh);
      notchedPanel(ctx, bx, by, bw, bh, k,
        primary ? (hot ? "#ffdf6a" : GOLD) : (hot ? PANEL_LIT : PANEL), primary ? INK : undefined);
      text(ctx, label, w / 2, by + bh / 2, 14 * k, primary ? INK : CREAM, "center", "middle", 900);
      this.regions.push({ x: bx, y: by, w: bw, h: bh, action });
      by += bh + 8 * k;
    }

    this.hover(this.lastMouse.x, this.lastMouse.y);
  }

  private isHot(x: number, y: number, w: number, h: number) {
    const m = this.lastMouse;
    return m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
  }
}

// ------------------------------------------------------------------ previews

const THUMB_W = 240;
const THUMB_H = 132;
const thumbs = new Map<string, HTMLCanvasElement>();

/**
 * A painted preview of an arena, built from that arena's own theme and its `shape`.
 *
 * Flat bands — sky, two ridges — then the arena's silhouette drawn out of ground slabs
 * and accent-coloured structures, and a black stickman for scale. No gradients, so it
 * matches the rest of the frame; and because the colours come from the same theme the
 * level loads, an arena that is repainted repaints its own card.
 *
 * Cached forever: seven small canvases, built once on the first frame of the menu.
 */
function arenaThumb(def: LevelDef): HTMLCanvasElement {
  const hit = thumbs.get(def.id);
  if (hit) return hit;

  const c = document.createElement("canvas");
  c.width = THUMB_W;
  c.height = THUMB_H;
  const g = c.getContext("2d")!;
  const th = THEMES[def.theme] ?? THEMES.day;

  // Sky. A painted backdrop names its own flat colour; otherwise take the middle stop
  // of the gradient, which is the one the horizon actually sits against.
  g.fillStyle = th.sprites?.sky ?? th.sky[1];
  g.fillRect(0, 0, THUMB_W, THUMB_H);
  g.fillStyle = th.hillFar;
  g.fillRect(0, THUMB_H * 0.42, THUMB_W, THUMB_H);
  g.fillStyle = th.hillNear;
  g.fillRect(0, THUMB_H * 0.56, THUMB_W, THUMB_H);

  const base = Math.round(THUMB_H * 0.78);
  const solid = th.groundTop;
  const deep = th.ground;

  /** A block of ground, with its lit top surface. Every shape is made of these. */
  const slab = (x: number, y: number, w: number, h: number) => {
    g.fillStyle = deep;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    g.fillStyle = solid;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), 4);
  };
  /** A structure standing on the ground, in the arena's accent. */
  const build_ = (x: number, y: number, w: number, h: number, tint = def.accent) => {
    g.fillStyle = INK;
    g.fillRect(Math.round(x) - 1, Math.round(y - h) - 1, Math.round(w) + 2, Math.round(h) + 2);
    g.fillStyle = tint;
    g.fillRect(Math.round(x), Math.round(y - h), Math.round(w), Math.round(h));
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.fillRect(Math.round(x), Math.round(y - h), Math.round(w), 3);
  };

  // The silhouette. This is the whole point of the card: seven arenas that mostly share
  // a tileset are told apart by the shape of their ground, not by their scenery.
  switch (def.shape) {
    case "tower":
      slab(0, base, THUMB_W, THUMB_H - base);
      build_(THUMB_W * 0.42, base, 34, 84);
      build_(THUMB_W * 0.66, base, 24, 44);
      build_(THUMB_W * 0.18, base, 18, 22);
      break;

    case "bowl": {
      // Rims, then three terraces a side stepping down to a floor.
      slab(0, base - 34, THUMB_W * 0.2, THUMB_H);
      slab(THUMB_W * 0.8, base - 34, THUMB_W * 0.2, THUMB_H);
      for (let i = 0; i < 3; i++) {
        const y = base - 24 + i * 8;
        const inset = THUMB_W * (0.2 + i * 0.045);
        slab(inset, y, THUMB_W * 0.055, THUMB_H);
        slab(THUMB_W - inset - THUMB_W * 0.055, y, THUMB_W * 0.055, THUMB_H);
      }
      slab(THUMB_W * 0.335, base, THUMB_W * 0.33, THUMB_H - base);
      build_(THUMB_W * 0.46, base, 20, 18);
      break;
    }

    case "islands": {
      // A chain climbing to the right, over nothing.
      const xs = [0.04, 0.26, 0.47, 0.68, 0.88];
      xs.forEach((fx, i) => {
        const w = THUMB_W * 0.16;
        const y = base - i * 9;
        slab(THUMB_W * fx, y, w, 11);
        if (i % 2 === 1) build_(THUMB_W * fx + w * 0.3, y, 12, 20);
      });
      break;
    }

    case "city": {
      slab(0, base, THUMB_W, THUMB_H - base);
      const hs = [46, 70, 54, 88, 62, 40];
      hs.forEach((hh, i) => {
        const w = 26;
        const x = 12 + i * (w + 8);
        build_(x, base, w, hh);
        // Lit windows, which is the one thing that says "city" instantly.
        g.fillStyle = "rgba(255,214,140,0.85)";
        for (let r = 0; r < Math.floor(hh / 14); r++) {
          g.fillRect(x + 5, base - hh + 8 + r * 14, 5, 5);
          g.fillRect(x + 15, base - hh + 8 + r * 14, 5, 5);
        }
      });
      break;
    }

    case "layered": {
      // Three plateaus rising to a keep, each with its wall.
      slab(0, base, THUMB_W * 0.42, THUMB_H - base);
      slab(THUMB_W * 0.38, base - 18, THUMB_W * 0.3, THUMB_H);
      slab(THUMB_W * 0.64, base - 36, THUMB_W * 0.36, THUMB_H);
      build_(THUMB_W * 0.2, base, 16, 30);
      build_(THUMB_W * 0.46, base - 18, 18, 38);
      build_(THUMB_W * 0.74, base - 36, 30, 52);
      break;
    }

    default: {
      // Flat: a long ground line with a spread of structures along it, which is exactly
      // what those arenas are.
      slab(0, base, THUMB_W, THUMB_H - base);
      build_(THUMB_W * 0.1, base, 20, 26);
      build_(THUMB_W * 0.34, base, 28, 40);
      build_(THUMB_W * 0.56, base, 16, 20);
      build_(THUMB_W * 0.76, base, 32, 52);
      break;
    }
  }

  // The cast, for scale. Two pixels wide and unmistakable.
  g.fillStyle = "#0a0c11";
  const sx = Math.round(THUMB_W * 0.06);
  const sy = def.shape === "bowl" ? base - 34 : base;
  g.fillRect(sx - 2, sy - 14, 5, 5);
  g.fillRect(sx - 1, sy - 9, 3, 6);
  g.fillRect(sx - 3, sy - 3, 3, 4);
  g.fillRect(sx + 1, sy - 3, 3, 4);

  // Vignette by value, in flat bands — no gradient.
  g.fillStyle = "rgba(10,12,18,0.18)";
  g.fillRect(0, 0, THUMB_W, 5);
  g.fillRect(0, THUMB_H - 5, THUMB_W, 5);

  thumbs.set(def.id, c);
  return c;
}

// ------------------------------------------------------------------ helpers

const fontOf = (size: number, weight: number) =>
  `${weight} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;

function measure(ctx: Ctx, str: string, size: number, weight: number) {
  ctx.font = fontOf(size, weight);
  return ctx.measureText(str).width;
}

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
  ctx.lineWidth = r * 0.28;
  ctx.lineCap = "butt";
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
