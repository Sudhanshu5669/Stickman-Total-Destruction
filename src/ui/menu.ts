import { CAMPAIGN, ENDLESS, PLAYGROUND } from "../levels";
import type { LevelDef } from "../levels/types";
import { THEMES } from "../render/theme";
import { clamp, hash01, TAU } from "../core/math";
import type { Ctx } from "../render/draw";
import { progress } from "./progress";

const CREAM = "#f4f1e8";
const GOLD = "#ffd23f";

/** Which page of the front end is on screen. */
export type Screen = "root" | "playground" | "campaign" | "endless";

export type MenuAction =
  | { kind: "none" }
  | { kind: "screen"; screen: Screen }
  | { kind: "back" }
  | { kind: "select"; level: LevelDef }
  | { kind: "play"; level: LevelDef }
  | { kind: "resume" }
  | { kind: "restart" }
  | { kind: "quit" }
  | { kind: "next" }
  | { kind: "mute" };

interface Region {
  x: number; y: number; w: number; h: number;
  action: MenuAction;
  /** Drawn dimmed and un-clickable — a campaign mission you haven't unlocked. */
  locked?: boolean;
}

interface ModeCard {
  screen: Screen;
  title: string;
  blurb: string;
  accent: string;
}

const MODES: ModeCard[] = [
  {
    screen: "playground",
    title: "PLAYGROUND",
    blurb: "Four worlds, the whole arsenal, nothing shooting back. Break everything.",
    accent: "#ffd23f",
  },
  {
    screen: "campaign",
    title: "CAMPAIGN",
    blurb: "Six missions of armed stickmen. Fixed loadout, limited lives, no god mode.",
    accent: "#e8433a",
  },
  {
    screen: "endless",
    title: "ENDLESS",
    blurb: "A world dealt from hundreds of set-pieces. Walk until it kills you.",
    accent: "#8a5cff",
  },
];

/**
 * The front end: mode select, its three sub-screens, and the pause overlay.
 *
 * All of it is drawn straight onto the game canvas over the live simulation — the
 * demo keeps playing behind the menu, which is the whole point of the attract mode.
 * Layout is recomputed each frame from the viewport so it holds up from phone to
 * ultrawide, and hit regions are rebuilt alongside it so clicks always match what
 * was drawn.
 */
export class Menu {
  screen: Screen = "root";
  /** Selection within the current screen. Each screen keeps its own. */
  private sel: Record<Screen, number> = { root: 0, playground: 0, campaign: 0, endless: 0 };

  private regions: Region[] = [];
  private hovered = -1;
  private t = 0;
  /** Per-card hover/selection lift, smoothed. Indexed by position on the current screen. */
  private lift: number[] = [];

  lastMouse = { x: -1, y: -1 };

  // ------------------------------------------------------------------ state

  /** The list of things the current screen selects between. */
  private get options(): readonly LevelDef[] {
    switch (this.screen) {
      case "playground": return PLAYGROUND;
      case "campaign": return CAMPAIGN;
      case "endless": return [ENDLESS];
      default: return PLAYGROUND;
    }
  }

  private get count() {
    return this.screen === "root" ? MODES.length : this.options.length;
  }

  get selected() {
    return clamp(this.sel[this.screen], 0, Math.max(0, this.count - 1));
  }

  /** The level to launch — and the world the attract demo shows behind the menu. */
  get level(): LevelDef {
    if (this.screen === "root") return PLAYGROUND[clamp(this.sel.root, 0, PLAYGROUND.length - 1)];
    const list = this.options;
    return list[clamp(this.sel[this.screen], 0, list.length - 1)];
  }

  /**
   * The level the attract mode should run. Campaign and endless are unplayable as a
   * demo (armed enemies would shoot the demo driver, and endless streams forever),
   * so those screens preview a matching playground world instead.
   */
  get previewLevel(): LevelDef {
    const l = this.level;
    if (!l.kind || l.kind === "playground") return l;
    return PLAYGROUND.find((p) => p.theme === l.theme) ?? PLAYGROUND[0];
  }

  goTo(screen: Screen) {
    this.screen = screen;
    this.hovered = -1;
    this.lift = [];
  }

  /** Escape / back: a sub-screen returns to mode select. */
  back(): boolean {
    if (this.screen === "root") return false;
    this.goTo("root");
    return true;
  }

  update(dt: number) {
    this.t += dt;
    while (this.lift.length < this.count) this.lift.push(0);
    for (let i = 0; i < this.lift.length; i++) {
      const want = i === this.selected ? 1 : i === this.hovered ? 0.5 : 0;
      this.lift[i] += (want - this.lift[i]) * (1 - Math.exp(-12 * dt));
    }
  }

  /** Keyboard navigation, so the menu works without a mouse. */
  moveSelection(delta: number) {
    const n = this.count;
    if (n <= 1) return;
    this.sel[this.screen] = (this.selected + delta + n) % n;
  }

  /** What ENTER does on the current screen. */
  confirm(): MenuAction {
    if (this.screen === "root") return { kind: "screen", screen: MODES[this.selected].screen };
    const level = this.level;
    if (this.screen === "campaign" && !this.missionUnlocked(level)) return { kind: "none" };
    return { kind: "play", level };
  }

  private missionUnlocked(def: LevelDef) {
    return def.kind !== "campaign" || progress.unlocked(def.order ?? 1);
  }

  // ------------------------------------------------------------------ input

  hover(mx: number, my: number) {
    this.hovered = -1;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        // Root-screen hover is resolved during layout instead — see `drawRoot`.
        if (r.action.kind === "select") this.hovered = this.options.indexOf(r.action.level);
        return r;
      }
    }
    return null;
  }

  click(mx: number, my: number): MenuAction {
    const r = this.hover(mx, my);
    if (!r || r.locked) return { kind: "none" };
    const a = r.action;

    if (a.kind === "select") {
      const idx = this.options.indexOf(a.level);
      // Second click on the already-selected card launches it.
      if (idx === this.selected) return this.confirm();
      this.sel[this.screen] = idx;
      return a;
    }
    return a;
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: Ctx, w: number, h: number, muted: boolean) {
    this.regions = [];
    const k = clamp(Math.min(w / 1280, h / 760), 0.5, 1.25);

    // Scrim: dark behind the title and footer, thin across the middle so the demo
    // playing underneath stays legible — it is the reason the attract mode exists.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(8,10,16,0.88)");
    g.addColorStop(0.3, "rgba(8,10,16,0.44)");
    g.addColorStop(0.62, "rgba(8,10,16,0.34)");
    g.addColorStop(1, "rgba(8,10,16,0.92)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (this.screen === "root") this.drawRoot(ctx, w, h, k);
    else if (this.screen === "playground") this.drawPlayground(ctx, w, h, k);
    else if (this.screen === "campaign") this.drawCampaign(ctx, w, h, k);
    else this.drawEndless(ctx, w, h, k);

    // Sound toggle, top right, on every screen.
    const sx = w - 54 * k;
    const sy = 34 * k;
    this.regions.push({ x: sx - 20 * k, y: sy - 20 * k, w: 40 * k, h: 40 * k, action: { kind: "mute" } });
    this.drawSpeaker(ctx, sx, sy, 15 * k, muted);
  }

  // ---------------------------------------------------------------- root

  private drawRoot(ctx: Ctx, w: number, h: number, k: number) {
    const titleY = h * 0.16;
    text(ctx, "STICKMAN", w / 2, titleY, 74 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.75)");
    text(ctx, "ASCENSION", w / 2, titleY + 62 * k, 74 * k, GOLD, "center", "middle", 900, "rgba(0,0,0,0.75)");
    text(ctx, "a ragdoll destruction sandbox", w / 2, titleY + 108 * k, 15 * k, "rgba(244,241,232,0.55)", "center", "middle", 700);

    const cardW = Math.min(300 * k, (w - 90 * k) / MODES.length - 18 * k);
    const cardH = cardW * 0.78;
    const gap = 22 * k;
    const totalW = MODES.length * cardW + (MODES.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const cardY = h * 0.44;

    MODES.forEach((m, i) => {
      const x = startX + i * (cardW + gap);
      const lift = this.lift[i] ?? 0;
      const y = cardY - lift * 10 * k;
      this.regions.push({ x, y, w: cardW, h: cardH, action: { kind: "screen", screen: m.screen } });
      if (this.regionHovered(x, y, cardW, cardH)) this.hovered = i;
      this.drawModeCard(ctx, m, x, y, cardW, cardH, k, lift, i === this.selected);
    });

    const footY = h - 30 * k;
    text(ctx, "← →  choose mode     ENTER  open     M  sound", w / 2, footY - 20 * k,
      13 * k, "rgba(244,241,232,0.42)", "center", "middle", 700);
    const done = progress.cleared;
    const best = Math.floor(progress.bestDistance);
    text(ctx, `campaign ${done}/${CAMPAIGN.length} cleared     endless best ${best}m`,
      w / 2, footY, 13 * k, "rgba(244,241,232,0.3)", "center", "middle", 700);
  }

  private drawModeCard(
    ctx: Ctx, m: ModeCard, x: number, y: number, w: number, h: number,
    k: number, lift: number, selected: boolean,
  ) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = (10 + lift * 22) * k;
    ctx.shadowOffsetY = (4 + lift * 6) * k;
    ctx.fillStyle = "rgba(18,21,29,0.94)";
    roundRect(ctx, x, y, w, h, 14 * k);
    ctx.fill();
    ctx.restore();

    // A big flat wash of the mode's colour, with its glyph sitting in it.
    const bandH = h * 0.5;
    ctx.save();
    roundRect(ctx, x, y, w, h, 14 * k);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, y, 0, y + bandH);
    grad.addColorStop(0, `${m.accent}44`);
    grad.addColorStop(1, "rgba(18,21,29,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, bandH);
    ctx.restore();

    drawModeGlyph(ctx, m.screen, x + w / 2, y + bandH * 0.52, bandH * 0.34, m.accent);

    text(ctx, m.title, x + w / 2, y + bandH + 16 * k, 22 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.6)");
    wrapText(ctx, m.blurb, x + 18 * k, y + bandH + 42 * k, w - 36 * k, 13 * k, 17 * k, "rgba(244,241,232,0.55)", 3, "center", x + w / 2);

    ctx.strokeStyle = selected ? m.accent : `rgba(255,255,255,${0.08 + lift * 0.2})`;
    ctx.lineWidth = (selected ? 3 : 1.5) * k;
    roundRect(ctx, x, y, w, h, 14 * k);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- playground

  private drawPlayground(ctx: Ctx, w: number, h: number, k: number) {
    this.drawHeader(ctx, w, h, k, "PLAYGROUND", "Free play. Everything unlocked, nothing shooting back.");

    const cardW = Math.min(268 * k, (w - 80 * k) / PLAYGROUND.length - 16 * k);
    const cardH = cardW * 0.82;
    const gap = 18 * k;
    const totalW = PLAYGROUND.length * cardW + (PLAYGROUND.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const cardY = h * 0.34;

    PLAYGROUND.forEach((def, i) => {
      const x = startX + i * (cardW + gap);
      const lift = this.lift[i] ?? 0;
      const y = cardY - lift * 10 * k;
      this.regions.push({ x, y, w: cardW, h: cardH, action: { kind: "select", level: def } });
      this.drawLevelCard(ctx, def, x, y, cardW, cardH, k, lift, i === this.selected);
    });

    this.drawPlayButton(ctx, w, cardY + cardH + 40 * k, k, "PLAY", this.level);
    this.drawFooter(ctx, w, h, k, "← →  choose world     ENTER  play     ESC  back");
  }

  // ---------------------------------------------------------------- campaign

  private drawCampaign(ctx: Ctx, w: number, h: number, k: number) {
    const cleared = progress.cleared;
    this.drawHeader(ctx, w, h, k, "CAMPAIGN",
      `Clear every hostile. ${cleared}/${CAMPAIGN.length} missions complete.`);

    const cardW = Math.min(200 * k, (w - 70 * k) / CAMPAIGN.length - 12 * k);
    const cardH = cardW * 1.12;
    const gap = 12 * k;
    const totalW = CAMPAIGN.length * cardW + (CAMPAIGN.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const cardY = h * 0.32;

    CAMPAIGN.forEach((def, i) => {
      const x = startX + i * (cardW + gap);
      const lift = this.lift[i] ?? 0;
      const y = cardY - lift * 8 * k;
      const unlocked = progress.unlocked(def.order ?? i + 1);
      this.regions.push({
        x, y, w: cardW, h: cardH,
        action: { kind: "select", level: def },
        locked: !unlocked,
      });
      this.drawMissionCard(ctx, def, x, y, cardW, cardH, k, lift, i === this.selected, unlocked, i < cleared);
    });

    const sel = this.level;
    const unlocked = progress.unlocked(sel.order ?? 1);
    const by = cardY + cardH + 34 * k;
    if (unlocked) {
      text(ctx, sel.briefing ?? sel.tagline, w / 2, by - 12 * k, 14 * k, "rgba(244,241,232,0.65)", "center", "middle", 700);
      this.drawPlayButton(ctx, w, by + 4 * k, k, `MISSION ${sel.order}`, sel);
    } else {
      text(ctx, `Clear mission ${(sel.order ?? 1) - 1} to unlock this one.`, w / 2, by + 30 * k,
        15 * k, "rgba(244,241,232,0.45)", "center", "middle", 800);
    }
    this.drawFooter(ctx, w, h, k, "← →  choose mission     ENTER  deploy     ESC  back");
  }

  private drawMissionCard(
    ctx: Ctx, def: LevelDef, x: number, y: number, w: number, h: number,
    k: number, lift: number, selected: boolean, unlocked: boolean, cleared: boolean,
  ) {
    const thumbH = h * 0.46;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = (8 + lift * 18) * k;
    ctx.shadowOffsetY = (3 + lift * 5) * k;
    ctx.fillStyle = "rgba(18,21,29,0.96)";
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.clip();
    ctx.globalAlpha = unlocked ? 1 : 0.25;
    ctx.drawImage(thumbnail(def), x, y, w, thumbH);
    ctx.globalAlpha = 1;
    const fade = ctx.createLinearGradient(0, y + thumbH * 0.4, 0, y + thumbH);
    fade.addColorStop(0, "rgba(18,21,29,0)");
    fade.addColorStop(1, "rgba(18,21,29,1)");
    ctx.fillStyle = fade;
    ctx.fillRect(x, y + thumbH * 0.4, w, thumbH * 0.6 + 1);
    ctx.restore();

    // Mission number badge.
    ctx.fillStyle = cleared ? "#6ddc7a" : unlocked ? def.accent : "rgba(255,255,255,0.2)";
    roundRect(ctx, x + 10 * k, y + 10 * k, 26 * k, 22 * k, 6 * k);
    ctx.fill();
    text(ctx, `${def.order}`, x + 23 * k, y + 22 * k, 14 * k, "#141820", "center", "middle", 900);

    const tx = x + 12 * k;
    ctx.save();
    ctx.globalAlpha = unlocked ? 1 : 0.4;
    text(ctx, def.name.toUpperCase(), tx, y + thumbH + 16 * k, 14 * k, CREAM, "left", "middle", 900);
    wrapText(ctx, def.tagline, tx, y + thumbH + 34 * k, w - 24 * k, 11 * k, 13 * k, "rgba(244,241,232,0.5)", 2);

    // Loadout dots: how many rounds this mission issues, in their own colours.
    const dy = y + h - 30 * k;
    text(ctx, `${def.loadout?.length ?? 0} ROUNDS · ${def.lives ?? 3} ${(def.lives ?? 3) === 1 ? "LIFE" : "LIVES"}`,
      tx, dy, 9 * k, "rgba(244,241,232,0.45)", "left", "middle", 800);
    ctx.restore();

    if (cleared) {
      text(ctx, "CLEARED", x + w - 12 * k, y + 22 * k, 10 * k, "#6ddc7a", "right", "middle", 900);
    } else if (!unlocked) {
      drawPadlock(ctx, x + w / 2, y + thumbH * 0.5, 15 * k);
    }

    ctx.strokeStyle = selected ? (unlocked ? def.accent : "rgba(255,255,255,0.3)") : `rgba(255,255,255,${0.08 + lift * 0.18})`;
    ctx.lineWidth = (selected ? 3 : 1.5) * k;
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- endless

  private drawEndless(ctx: Ctx, w: number, h: number, k: number) {
    this.drawHeader(ctx, w, h, k, "ENDLESS",
      "Hundreds of authored set-pieces, dealt at random. It does not stop.");

    const cardW = Math.min(420 * k, w - 120 * k);
    const cardH = cardW * 0.5;
    const x = w / 2 - cardW / 2;
    const y = h * 0.34;
    this.regions.push({ x, y, w: cardW, h: cardH, action: { kind: "select", level: ENDLESS } });
    this.drawLevelCard(ctx, ENDLESS, x, y, cardW, cardH, k, this.lift[0] ?? 1, true);

    const best = Math.floor(progress.bestDistance);
    text(ctx, best > 0 ? `${best}m` : "—", w / 2, y + cardH + 42 * k, 40 * k, GOLD, "center", "middle", 900, "rgba(0,0,0,0.7)");
    text(ctx, "FURTHEST RUN", w / 2, y + cardH + 72 * k, 12 * k, "rgba(244,241,232,0.5)", "center", "middle", 800);

    this.drawPlayButton(ctx, w, y + cardH + 92 * k, k, "START RUN", ENDLESS);
    this.drawFooter(ctx, w, h, k, "ENTER  start     ESC  back");
  }

  // ---------------------------------------------------------------- shared bits

  private drawHeader(ctx: Ctx, w: number, h: number, k: number, title: string, sub: string) {
    text(ctx, title, w / 2, h * 0.13, 42 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.75)");
    text(ctx, sub, w / 2, h * 0.13 + 32 * k, 14 * k, "rgba(244,241,232,0.55)", "center", "middle", 700);

    // Back button, top left.
    const bw = 92 * k;
    const bh = 34 * k;
    const bx = 26 * k;
    const by = 24 * k;
    const hovered = this.regionHovered(bx, by, bw, bh);
    this.regions.push({ x: bx, y: by, w: bw, h: bh, action: { kind: "back" } });
    ctx.fillStyle = hovered ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)";
    roundRect(ctx, bx, by, bw, bh, 8 * k);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
    text(ctx, "‹  BACK", bx + bw / 2, by + bh / 2 + 1 * k, 13 * k, CREAM, "center", "middle", 900);
  }

  private drawPlayButton(ctx: Ctx, w: number, y: number, k: number, label: string, level: LevelDef) {
    const bw = 300 * k;
    const bh = 60 * k;
    const x = w / 2 - bw / 2;
    const hovered = this.regionHovered(x, y, bw, bh);
    this.regions.push({ x, y, w: bw, h: bh, action: { kind: "play", level } });

    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
    ctx.fillStyle = hovered ? GOLD : `rgba(255,210,63,${0.86 + pulse * 0.14})`;
    roundRect(ctx, x, y, bw, bh, 12 * k);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2 * k;
    ctx.stroke();
    text(ctx, label, w / 2, y + bh / 2 + 2 * k, 28 * k, "#141820", "center", "middle", 900);
  }

  private drawFooter(ctx: Ctx, w: number, h: number, k: number, hint: string) {
    const footY = h - 30 * k;
    text(ctx, hint, w / 2, footY - 20 * k, 13 * k, "rgba(244,241,232,0.42)", "center", "middle", 700);
    text(ctx, "A/D move   SPACE jump · hold to fly   MOUSE aim   CLICK fire   1/3 swap ammo   R go limp",
      w / 2, footY, 13 * k, "rgba(244,241,232,0.3)", "center", "middle", 700);
  }

  private drawLevelCard(
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

    const tx = x + 14 * k;
    text(ctx, def.name.toUpperCase(), tx, y + thumbH + 20 * k, 18 * k, CREAM, "left", "middle", 900);
    wrapText(ctx, def.tagline, tx, y + thumbH + 42 * k, w - 28 * k, 14 * k, 12 * k, "rgba(244,241,232,0.5)", 2);

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

  // ------------------------------------------------------------------ pause menu

  drawPause(ctx: Ctx, w: number, h: number, levelName: string) {
    this.regions = [];
    const k = clamp(Math.min(w / 1280, h / 760), 0.5, 1.25);

    ctx.fillStyle = "rgba(8,10,16,0.72)";
    ctx.fillRect(0, 0, w, h);

    text(ctx, "PAUSED", w / 2, h * 0.3, 56 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.7)");
    text(ctx, levelName.toUpperCase(), w / 2, h * 0.3 + 42 * k, 14 * k, "rgba(244,241,232,0.5)", "center", "middle", 800);

    this.drawButtonStack(ctx, w, h * 0.44, k, [
      { label: "RESUME", action: { kind: "resume" }, primary: true },
      { label: "RESTART LEVEL", action: { kind: "restart" } },
      { label: "MAIN MENU", action: { kind: "quit" } },
    ]);
    text(ctx, "ESC to resume", w / 2, h * 0.44 + 3 * 64 * k + 18 * k, 12 * k, "rgba(244,241,232,0.35)", "center", "middle", 700);
  }

  // ------------------------------------------------------------------ results

  /**
   * End-of-run overlay. One screen serves mission complete, mission failed and the
   * end of an endless run — they differ only in the headline and which buttons make
   * sense afterwards.
   */
  drawResult(
    ctx: Ctx, w: number, h: number,
    r: {
      won: boolean; title: string; subtitle: string;
      stats: [string, string][]; hasNext: boolean; retryLabel: string;
    },
  ) {
    this.regions = [];
    const k = clamp(Math.min(w / 1280, h / 760), 0.5, 1.25);

    ctx.fillStyle = r.won ? "rgba(8,16,12,0.82)" : "rgba(20,8,10,0.82)";
    ctx.fillRect(0, 0, w, h);

    const top = h * 0.2;
    text(ctx, r.title, w / 2, top, 58 * k, r.won ? "#6ddc7a" : "#e8433a", "center", "middle", 900, "rgba(0,0,0,0.75)");
    text(ctx, r.subtitle, w / 2, top + 44 * k, 16 * k, "rgba(244,241,232,0.7)", "center", "middle", 700);

    // Stat rows.
    let sy = top + 84 * k;
    const sw = 320 * k;
    for (const [label, value] of r.stats) {
      text(ctx, label, w / 2 - sw / 2, sy, 14 * k, "rgba(244,241,232,0.55)", "left", "middle", 700);
      text(ctx, value, w / 2 + sw / 2, sy, 16 * k, CREAM, "right", "middle", 900);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(w / 2 - sw / 2, sy + 12 * k, sw, 1 * k);
      sy += 28 * k;
    }

    const buttons: { label: string; action: MenuAction; primary?: boolean }[] = [];
    if (r.hasNext) buttons.push({ label: "NEXT MISSION", action: { kind: "next" }, primary: true });
    buttons.push({ label: r.retryLabel, action: { kind: "restart" }, primary: !r.hasNext });
    buttons.push({ label: "MAIN MENU", action: { kind: "quit" } });
    this.drawButtonStack(ctx, w, sy + 16 * k, k, buttons);
  }

  private drawButtonStack(
    ctx: Ctx, w: number, top: number, k: number,
    buttons: { label: string; action: MenuAction; primary?: boolean }[],
  ) {
    const bw = 300 * k;
    const bh = 52 * k;
    const bx = w / 2 - bw / 2;
    let by = top;
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
  }
}

// ------------------------------------------------------------------ glyphs

function drawModeGlyph(ctx: Ctx, screen: Screen, cx: number, cy: number, r: number, accent: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = r * 0.14;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (screen === "playground") {
    // A stack of crates, mid-collapse.
    const s = r * 0.52;
    for (const [dx, dy, rot] of [[-1, 0.55, 0], [0, 0.55, 0], [1, 0.55, 0], [-0.5, -0.45, 0.15], [0.5, -0.45, -0.12]] as const) {
      ctx.save();
      ctx.translate(dx * s * 1.05, dy * s * 1.05);
      ctx.rotate(rot);
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
  } else if (screen === "campaign") {
    // Crosshair over a target silhouette.
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (const a of [0, TAU / 4, TAU / 2, (TAU * 3) / 4]) {
      ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
      ctx.lineTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, 0, TAU);
    ctx.fill();
  } else {
    // An arrow running off the right edge, over a receding horizon.
    ctx.beginPath();
    ctx.moveTo(-r, r * 0.62);
    ctx.lineTo(r, r * 0.62);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      ctx.globalAlpha = 0.3 + t * 0.7;
      ctx.beginPath();
      ctx.moveTo(-r * 0.9 + i * r * 0.7, -r * 0.5);
      ctx.lineTo(-r * 0.4 + i * r * 0.7, 0);
      ctx.lineTo(-r * 0.9 + i * r * 0.7, r * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawPadlock(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(244,241,232,0.7)";
  ctx.fillStyle = "rgba(244,241,232,0.7)";
  ctx.lineWidth = r * 0.2;
  ctx.beginPath();
  ctx.arc(0, -r * 0.32, r * 0.46, Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-r * 0.72, -r * 0.32, r * 1.44, r * 1.1, r * 0.18);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------------ thumbnails

const THUMB_W = 420;
const THUMB_H = 240;
const thumbCache = new Map<string, HTMLCanvasElement>();

/** Which skyline sketch a level gets. Campaign missions inherit theirs from the theme. */
function sketchFor(def: LevelDef): "castle" | "alien" | "mars" | "city" {
  if (def.theme === "night") return "castle";
  if (def.theme === "alien") return "alien";
  if (def.theme === "mars") return "mars";
  return "city";
}

/**
 * A miniature of each world, painted once from its theme.
 *
 * Rendering a dozen of these live every frame would cost more than the game behind
 * them, and they never change, so they are baked into offscreen canvases on first use.
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
  switch (sketchFor(def)) {
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
  size: number, lineH: number, color: string, maxLines = 2,
  align: CanvasTextAlign = "left", centerX = x,
) {
  ctx.font = `700 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  const px = align === "center" ? centerX : x;
  const words = str.split(" ");
  let line = "";
  let ly = y;
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, px, ly);
      line = word;
      ly += lineH;
      if (++lines >= maxLines) return;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, px, ly);
}
