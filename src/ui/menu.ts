import { CAMPAIGN, DAILY, ENDLESS, PLAYGROUND } from "../levels";
import type { LevelDef } from "../levels/types";
import { THEMES } from "../render/theme";
import { clamp, hash01, TAU } from "../core/math";
import type { Ctx } from "../render/draw";
import { ARSENAL, previousCost, progress } from "./progress";
import { SHAKE_LABELS, settings } from "./settings";
import { AMMO_BY_ID } from "../weapons/ammo";
import { secondsUntilRollover } from "../core/rng";
import { iconBitmap } from "../render/props";

const CREAM = "#f4f1e8";
const GOLD = "#ffd23f";

/** Which page of the front end is on screen. */
export type Screen = "root" | "playground" | "campaign" | "endless";

/**
 * Things the menu handles entirely by itself.
 *
 * Options are settings, not navigation: nothing outside this file needs to know that
 * the shake slider was dragged, and routing them through the game would mean four new
 * cases in three different input handlers for state the menu already owns. `click()`
 * applies them and reports `none`, so every existing call site keeps working.
 */
type UiAction =
  | { ui: "options" }
  | { ui: "close" }
  | { ui: "shake"; step: number }
  | { ui: "tips" };

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
  | { kind: "revive" }
  | { kind: "mute" }
  | ({ kind: "ui" } & UiAction);

interface Region {
  x: number; y: number; w: number; h: number;
  action: MenuAction;
  /** Drawn dimmed and un-clickable — a campaign mission you haven't unlocked. */
  locked?: boolean;
}

/** Everything the end-of-run overlay needs. Built by the game, drawn here. */
export interface ResultCard {
  won: boolean;
  title: string;
  subtitle: string;
  stats: [string, string][];
  hasNext: boolean;
  retryLabel: string;
  /** Carnage banked by this run, and the lifetime total after banking it. */
  earned: number;
  carnage: number;
  /** Rounds this run pushed over the line. Drives the unlock banner. */
  unlocked: string[];
  /** Progress toward the next round, or null once the arsenal is complete. */
  next: { id: string; remaining: number; frac: number } | null;
  /** Portal leaderboard placing, if it arrived in time. */
  rank: number | null;
  /** Whether the revive offer should be shown. */
  canRevive: boolean;
  /**
   * A record this run broke, e.g. `NEW FURTHEST RUN`. Optional: the card falls back to
   * the subtitle, so leaving it unset costs nothing.
   */
  record?: string;
  /** Name of the mission the NEXT button leads to, so the button can say where it goes. */
  nextLabel?: string;
  /** Medals this run earned, if any. Their bonus is already folded into `earned`. */
  medals?: { name: string; detail: string; fresh: boolean }[];
  /** The daily streak, if this run was the first of a new day. */
  streak?: { days: number; bonus: number } | null;
}

/**
 * The three things the front page offers beyond the PLAY button.
 *
 * Each one is a *shortcut* first and a menu second: the body of the card launches the
 * obvious thing — the next mission, an endless run — and the strip along its bottom
 * opens the picker for players who want to choose. A returning player reaches the mode
 * they came back for in one click; a browsing player reaches the full list in one more.
 */
interface ModeCard {
  screen: Screen;
  title: string;
  accent: string;
  /** Second line: whatever number tells this player where they are in this mode. */
  status(): string;
  /** The picker strip's label, or null when the card only ever opens a list. */
  browse: string | null;
  /** What the card body launches, or null when the body opens the picker instead. */
  quick(): LevelDef | null;
}

/** The next mission the player has not cleared, or the last one once they all are. */
function nextMission(): LevelDef {
  const done = progress.cleared;
  return CAMPAIGN[clamp(done, 0, CAMPAIGN.length - 1)];
}

const MODES: ModeCard[] = [
  {
    screen: "campaign",
    title: "CAMPAIGN",
    accent: "#e8433a",
    status: () => {
      const m = nextMission();
      return progress.cleared >= CAMPAIGN.length ? "ALL CLEAR" : `MISSION ${m.order} · ${m.name.toUpperCase()}`;
    },
    browse: "ALL MISSIONS",
    quick: nextMission,
  },
  {
    screen: "endless",
    title: "ENDLESS",
    accent: "#8a5cff",
    status: () => {
      const best = Math.floor(progress.bestDistance);
      return best > 0 ? `BEST ${best}m` : "RUN UNTIL IT KILLS YOU";
    },
    browse: "DAILY CHALLENGE",
    quick: () => ENDLESS,
  },
  {
    screen: "playground",
    title: "WORLDS",
    accent: "#5ec8ff",
    status: () => `${PLAYGROUND.length} SANDBOXES · NOTHING SHOOTS BACK`,
    browse: null,
    quick: () => null,
  },
];

/** What the PLAY button drops you into. The one world built to teach the arsenal. */
const QUICK_PLAY = PLAYGROUND[0];

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
  /** The options panel, drawn over whatever is underneath and swallowing its clicks. */
  private optionsOpen = false;

  lastMouse = { x: -1, y: -1 };

  // ------------------------------------------------------------------ state

  /** The list of things the current screen selects between. */
  private get options(): readonly LevelDef[] {
    switch (this.screen) {
      case "playground": return PLAYGROUND;
      case "campaign": return CAMPAIGN;
      case "endless": return [ENDLESS, DAILY];
      default: return PLAYGROUND;
    }
  }

  /** Root holds PLAY plus one card per mode; every other screen holds its own list. */
  private get count() {
    return this.screen === "root" ? MODES.length + 1 : this.options.length;
  }

  get selected() {
    return clamp(this.sel[this.screen], 0, Math.max(0, this.count - 1));
  }

  /** The level to launch — and the world the attract demo shows behind the menu. */
  get level(): LevelDef {
    if (this.screen === "root") {
      const i = this.selected;
      if (i === 0) return QUICK_PLAY;
      // Arrowing across the front page tours the worlds behind it: each card previews
      // whatever it would drop you into.
      return MODES[i - 1].quick() ?? PLAYGROUND[clamp(this.sel.playground, 0, PLAYGROUND.length - 1)];
    }
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

  /** Escape / back: options close first, then a sub-screen returns to the front page. */
  back(): boolean {
    if (this.optionsOpen) {
      this.optionsOpen = false;
      return true;
    }
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

  /**
   * What ENTER does on the current screen.
   *
   * On the front page it always *plays* — PLAY, the next mission, an endless run.
   * Nothing on that screen is a door into another menu, because the one requirement
   * the portal states outright is that a new player lands in gameplay immediately.
   */
  confirm(): MenuAction {
    if (this.optionsOpen) {
      this.optionsOpen = false;
      return { kind: "none" };
    }
    if (this.screen === "root") {
      const i = this.selected;
      const quick = i === 0 ? QUICK_PLAY : MODES[i - 1].quick();
      if (quick) return { kind: "play", level: quick };
      return { kind: "screen", screen: MODES[i - 1].screen };
    }
    const level = this.level;
    if (this.screen === "campaign" && !this.missionUnlocked(level)) return { kind: "none" };
    return { kind: "play", level };
  }

  /**
   * The "show me the list instead" key on the front page — bound to the down arrow.
   *
   * Separate from `confirm` so the primary key never opens a menu. Returns `none`
   * anywhere it has nothing to expand, which makes it safe to call unconditionally.
   */
  expand(): MenuAction {
    if (this.screen !== "root" || this.optionsOpen) return { kind: "none" };
    const i = this.selected;
    if (i === 0) return { kind: "screen", screen: "playground" };
    return { kind: "screen", screen: MODES[i - 1].screen };
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

    if (a.kind === "ui") {
      this.applyUi(a);
      return { kind: "none" };
    }

    if (a.kind === "select") {
      const idx = this.options.indexOf(a.level);
      // Second click on the already-selected card launches it.
      if (idx === this.selected) return this.confirm();
      this.sel[this.screen] = idx;
      return a;
    }
    return a;
  }

  private applyUi(a: { ui: string; step?: number }) {
    switch (a.ui) {
      case "options": this.optionsOpen = true; break;
      case "close": this.optionsOpen = false; break;
      case "shake": settings.setShakeStep(a.step ?? 0); break;
      case "tips": settings.setTips(!settings.tips); break;
    }
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Scale factor for the front end.
   *
   * Landscape measures against both axes, which is right when the limit is usually the
   * height. Portrait cannot: `min(w/1280, h/760)` on a 390x844 phone is driven entirely
   * by the width and bottoms out at the floor, which produced 8px card titles. A
   * portrait phone is measured against its width alone, against a much narrower
   * reference, so type comes out at a size a thumb-length away from a face.
   */
  private scaleFor(w: number, h: number) {
    if (w < 640) return clamp(w / 620, 0.62, 1.05);
    return clamp(Math.min(w / 1280, h / 760), 0.5, 1.25);
  }

  draw(ctx: Ctx, w: number, h: number, muted: boolean) {
    this.regions = [];
    const k = this.scaleFor(w, h);

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

    // Sound and options, top right, on every screen.
    const sy = 34 * k;
    const sx = w - 54 * k;
    this.regions.push({ x: sx - 20 * k, y: sy - 20 * k, w: 40 * k, h: 40 * k, action: { kind: "mute" } });
    this.drawSpeaker(ctx, sx, sy, 15 * k, muted);

    const gx = sx - 46 * k;
    this.regions.push({ x: gx - 20 * k, y: sy - 20 * k, w: 40 * k, h: 40 * k, action: { kind: "ui", ui: "options" } });
    drawGear(ctx, gx, sy, 14 * k, this.regionHovered(gx - 20 * k, sy - 20 * k, 40 * k, 40 * k));

    // Options sit on top of whatever is underneath and take every click on the way
    // past, so the panel cannot be clicked through into a level launch.
    if (this.optionsOpen) {
      this.regions = [];
      this.drawOptions(ctx, w, h, k, muted);
    }
  }

  // ---------------------------------------------------------------- options

  /**
   * Sound, screen shake and tips.
   *
   * Screen shake is here because it is an accessibility control, not a preference:
   * this game shakes the camera on every impact and a meaningful number of players
   * cannot tolerate that for sixty seconds. OFF is a true zero.
   */
  private drawOptions(ctx: Ctx, w: number, h: number, k: number, muted: boolean) {
    ctx.fillStyle = "rgba(8,10,16,0.86)";
    ctx.fillRect(0, 0, w, h);

    const pw = Math.min(420 * k, w - 40 * k);
    const ph = 306 * k;
    const px = w / 2 - pw / 2;
    const py = h / 2 - ph / 2;

    ctx.fillStyle = "rgba(18,21,29,0.98)";
    roundRect(ctx, px, py, pw, ph, 16 * k);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();

    text(ctx, "OPTIONS", w / 2, py + 34 * k, 24 * k, CREAM, "center", "middle", 900);

    const rowX = px + 24 * k;
    const rowW = pw - 48 * k;
    let ry = py + 76 * k;

    // Screen shake, as four labelled stops rather than a drag track — a segmented
    // control is hittable with a thumb and a mouse alike, and each stop is a word.
    text(ctx, "SCREEN SHAKE", rowX, ry, 12 * k, "rgba(244,241,232,0.6)", "left", "middle", 800);
    ry += 22 * k;
    const segW = rowW / SHAKE_LABELS.length;
    const segH = 34 * k;
    SHAKE_LABELS.forEach((label, i) => {
      const sxx = rowX + i * segW;
      const on = settings.shakeStep === i;
      const hot = this.regionHovered(sxx, ry, segW, segH);
      this.regions.push({ x: sxx, y: ry, w: segW, h: segH, action: { kind: "ui", ui: "shake", step: i } });
      ctx.fillStyle = on ? GOLD : hot ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)";
      roundRect(ctx, sxx + 2 * k, ry, segW - 4 * k, segH, 7 * k);
      ctx.fill();
      text(ctx, label, sxx + segW / 2, ry + segH / 2 + 1 * k, 11 * k, on ? "#141820" : CREAM, "center", "middle", 900);
    });
    ry += segH + 30 * k;

    ry = this.drawToggle(ctx, rowX, ry, rowW, k, "SOUND", !muted, { kind: "mute" });
    ry = this.drawToggle(ctx, rowX, ry, rowW, k, "CONTROL TIPS", settings.tips, { kind: "ui", ui: "tips" });

    const bw = rowW;
    const bh = 44 * k;
    const by = py + ph - bh - 22 * k;
    const hot = this.regionHovered(rowX, by, bw, bh);
    this.regions.push({ x: rowX, y: by, w: bw, h: bh, action: { kind: "ui", ui: "close" } });
    ctx.fillStyle = hot ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.1)";
    roundRect(ctx, rowX, by, bw, bh, 10 * k);
    ctx.fill();
    text(ctx, "DONE", w / 2, by + bh / 2 + 1 * k, 16 * k, CREAM, "center", "middle", 900);
  }

  /** One labelled on/off row. Returns the Y to carry on drawing from. */
  private drawToggle(
    ctx: Ctx, x: number, y: number, w: number, k: number,
    label: string, on: boolean, action: MenuAction,
  ) {
    const tw = 62 * k;
    const th = 30 * k;
    const tx = x + w - tw;
    this.regions.push({ x: tx, y, w: tw, h: th, action });
    text(ctx, label, x, y + th / 2, 12 * k, "rgba(244,241,232,0.6)", "left", "middle", 800);
    ctx.fillStyle = on ? GOLD : "rgba(255,255,255,0.1)";
    roundRect(ctx, tx, y, tw, th, th / 2);
    ctx.fill();
    ctx.fillStyle = on ? "#141820" : "rgba(244,241,232,0.5)";
    ctx.beginPath();
    ctx.arc(on ? tx + tw - th / 2 : tx + th / 2, y + th / 2, th * 0.34, 0, TAU);
    ctx.fill();
    text(ctx, on ? "ON" : "OFF", on ? tx + th * 0.5 : tx + tw - th * 0.5, y + th / 2 + 1 * k, 10 * k,
      on ? "#141820" : "rgba(244,241,232,0.6)", "center", "middle", 900);
    return y + th + 20 * k;
  }

  // ---------------------------------------------------------------- root

  /**
   * The front page.
   *
   * One decision, and it is already made for you: a PLAY button large enough that no
   * player can leave this screen without noticing it, wired straight into a world
   * rather than into another menu. Everything else on the page is optional — the mode
   * cards are shortcuts for people who came back for something specific, and the
   * arsenal strip is the reason to come back at all.
   *
   * The old page opened on three equal cards, which made choosing a mode the first
   * thing the game asked of somebody who had not yet seen it move.
   */
  private drawRoot(ctx: Ctx, w: number, h: number, k: number) {
    const narrow = w < 640;
    const titleY = h * 0.13;
    const titleW = w - 56 * k;

    // The name is the pitch. It is set in two weights so "TOTAL DESTRUCTION" is the
    // half that carries, and auto-fitted because it is the one string on the page
    // long enough to run off a phone.
    fitText(ctx, "STICKMAN", w / 2, titleY, 46 * k, titleW, CREAM, 900, "rgba(0,0,0,0.75)");
    fitText(ctx, "TOTAL DESTRUCTION", w / 2, titleY + 46 * k, 62 * k, titleW, GOLD, 900, "rgba(0,0,0,0.75)");
    fitText(ctx, "LOAD A PIANO. AIM AT A BUILDING. PULL.", w / 2, titleY + 84 * k, 14 * k, titleW,
      "rgba(244,241,232,0.6)", 800);

    // ------------------------------------------------------------------ play
    const playW = Math.min(460 * k, w - 56 * k);
    const playH = (narrow ? 80 : 92) * k;
    const playX = w / 2 - playW / 2;
    const playLift = this.lift[0] ?? 0;
    const playY = h * 0.36 - playLift * 4 * k;
    this.regions.push({ x: playX, y: playY, w: playW, h: playH, action: { kind: "play", level: QUICK_PLAY } });
    if (this.regionHovered(playX, playY, playW, playH)) this.hovered = 0;
    this.drawPlayHero(ctx, playX, playY, playW, playH, k, this.selected === 0 || playLift > 0.4);

    text(ctx, `NO MENUS. STRAIGHT INTO ${QUICK_PLAY.name.toUpperCase()}.`, w / 2, playY + playH + 18 * k,
      12 * k, "rgba(244,241,232,0.45)", "center", "middle", 800);

    // ------------------------------------------------------------------ modes
    const gap = 14 * k;
    const cardW = Math.min(230 * k, (w - 48 * k - gap * (MODES.length - 1)) / MODES.length);
    const cardH = (narrow ? 88 : 78) * k;
    const totalW = MODES.length * cardW + (MODES.length - 1) * gap;
    const startX = (w - totalW) / 2;
    const cardY = playY + playH + 40 * k;

    MODES.forEach((m, i) => {
      const idx = i + 1;
      const x = startX + i * (cardW + gap);
      const lift = this.lift[idx] ?? 0;
      const y = cardY - lift * 5 * k;
      const quick = m.quick();
      // Wide: the card body launches the obvious thing and the strip along its bottom
      // opens the picker. Narrow: there is no room to make two targets out of one card
      // that a thumb could tell apart, and a mis-tap that launches mission 4 is a worse
      // outcome than one that opens a list — so the whole card opens the picker.
      const stripH = !narrow && m.browse ? 22 * k : 0;
      const bodyH = cardH - stripH;
      this.regions.push({
        x, y, w: cardW, h: bodyH,
        action: quick && !narrow ? { kind: "play", level: quick } : { kind: "screen", screen: m.screen },
      });
      if (stripH > 0) {
        this.regions.push({ x, y: y + bodyH, w: cardW, h: stripH, action: { kind: "screen", screen: m.screen } });
      }
      if (this.regionHovered(x, y, cardW, cardH)) this.hovered = idx;
      this.drawModeCard(ctx, m, x, y, cardW, bodyH, stripH, k, lift, idx === this.selected, narrow);
    });

    // ------------------------------------------------------------------ arsenal
    this.drawArsenalBar(ctx, w, h - (narrow ? 108 : 116) * k, k);

    text(ctx, narrow ? "TAP PLAY" : "ENTER  play     ↓  browse     ←  →  choose     M  sound",
      w / 2, h - 20 * k, 12 * k, "rgba(244,241,232,0.38)", "center", "middle", 700);
  }

  /**
   * The gold slab both hero buttons are built on — the front page's PLAY and the
   * results card's continue.
   *
   * A halo that breathes, because on a portal the page is a grid of thumbnails and the
   * player's eye arrives somewhere arbitrary; motion is what routes it here.
   */
  private goldSlab(ctx: Ctx, x: number, y: number, w: number, h: number, k: number, hot: boolean) {
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.6);
    ctx.save();
    ctx.shadowColor = `rgba(255,210,63,${0.3 + pulse * 0.35})`;
    ctx.shadowBlur = (26 + pulse * 22) * k;
    ctx.fillStyle = hot ? "#ffdf6a" : GOLD;
    roundRect(ctx, x, y, w, h, 16 * k);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 2.5 * k;
    roundRect(ctx, x, y, w, h, 16 * k);
    ctx.stroke();
  }

  /** The one button the whole front end exists to get pressed. */
  private drawPlayHero(ctx: Ctx, x: number, y: number, w: number, h: number, k: number, hot: boolean) {
    this.goldSlab(ctx, x, y, w, h, k, hot);

    const cx = x + w / 2;
    const size = Math.min(44 * k, w * 0.16);
    const tw = measure(ctx, "PLAY", size, 900);
    const tri = size * 0.5;
    const groupW = tw + tri + 18 * k;
    const gx = cx - groupW / 2;

    ctx.fillStyle = "#141820";
    ctx.beginPath();
    ctx.moveTo(gx, y + h / 2 - tri * 0.62);
    ctx.lineTo(gx + tri * 0.86, y + h / 2);
    ctx.lineTo(gx, y + h / 2 + tri * 0.62);
    ctx.closePath();
    ctx.fill();
    text(ctx, "PLAY", gx + tri + 18 * k, y + h / 2 + 2 * k, size, "#141820", "left", "middle", 900);
  }

  /**
   * The arsenal ladder, framed as what is coming rather than what is missing.
   *
   * This is the answer to "why would I press play again", so it has to be on screen
   * before the player has decided — but the old version answered it by showing
   * fourteen padlocks next to four unlocked rounds, and a wall of padlocks is a list
   * of things you do not have. Same data, inverted: what you own reads as a
   * collection, and exactly two locked rounds are shown, near enough to want.
   *
   * Everything is derived from `ARSENAL` and `progress` at draw time. No counts and no
   * costs are written down here, so re-tuning the economy needs no change in this file.
   */
  private drawArsenalBar(ctx: Ctx, w: number, y: number, k: number) {
    const carnage = progress.carnage;
    const owned = ARSENAL.filter(([, cost]) => carnage >= cost).map(([id]) => id);
    const locked = ARSENAL.filter(([, cost]) => carnage < cost);
    const next = progress.nextUnlock();

    text(ctx, `ARSENAL   ${owned.length} / ${ARSENAL.length}`, w / 2, y, 11 * k,
      "rgba(244,241,232,0.42)", "center", "middle", 800);

    // Owned rounds, bright and close together so they read as a rack rather than a
    // list. A long collection is truncated from the front — the newest toys are the
    // ones worth showing off.
    const cell = Math.min(28 * k, (w - 60 * k) / Math.max(8, owned.length));
    const shown = owned.slice(-Math.max(1, Math.floor((w - 60 * k) / cell)));
    const rowY = y + 22 * k;
    const rowW = shown.length * cell;
    const x0 = w / 2 - rowW / 2;
    shown.forEach((id, i) => {
      const gs = cell * 0.92;
      ctx.drawImage(iconBitmap(id), x0 + i * cell + (cell - gs) / 2, rowY - gs / 2, gs, gs);
    });
    if (shown.length < owned.length) {
      text(ctx, `+${owned.length - shown.length}`, x0 - 6 * k, rowY, 11 * k,
        "rgba(244,241,232,0.5)", "right", "middle", 900);
    }

    if (!next) {
      text(ctx, "ARSENAL COMPLETE", w / 2, rowY + 26 * k, 13 * k, GOLD, "center", "middle", 900);
      return;
    }

    // The next rung: named, pictured and measured from the rung below it, so the bar
    // moves a visible amount every run instead of creeping against a 280k ceiling.
    const prev = previousCost(next.cost);
    const frac = clamp((carnage - prev) / Math.max(1, next.cost - prev), 0, 1);
    const bw = Math.min(320 * k, w - 120 * k);
    const bx = w / 2 - bw / 2;
    const by = rowY + 24 * k;

    const gs = 24 * k;
    ctx.drawImage(iconBitmap(next.id), bx - gs - 8 * k, by - gs / 2 + 2 * k, gs, gs);
    text(ctx, `NEXT: ${weaponName(next.id)}`, bx, by - 4 * k, 12 * k, GOLD, "left", "middle", 900);
    text(ctx, `${(next.cost - carnage).toLocaleString("en-US")} CARNAGE`, bx + bw, by - 4 * k, 11 * k,
      "rgba(244,241,232,0.55)", "right", "middle", 800);

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, bx, by + 6 * k, bw, 7 * k, 3.5 * k);
    ctx.fill();
    ctx.fillStyle = GOLD;
    roundRect(ctx, bx, by + 6 * k, bw * frac, 7 * k, 3.5 * k);
    ctx.fill();

    // And a glimpse of the one after, so the ladder never looks like it ends here.
    const after = locked[1];
    if (after) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      const as = 18 * k;
      ctx.drawImage(iconBitmap(after[0]), bx + bw + 8 * k, by - as / 2 + 2 * k, as, as);
      ctx.restore();
      text(ctx, `THEN ${weaponName(after[0])}`, bx + bw + as + 14 * k, by + 2 * k, 10 * k,
        "rgba(244,241,232,0.35)", "left", "middle", 800);
    }
  }

  /**
   * A mode shortcut: a coloured strip, the mode's name, where this player is in it,
   * and — for the two modes with something to choose between — a picker strip.
   */
  private drawModeCard(
    ctx: Ctx, m: ModeCard, x: number, y: number, w: number, bodyH: number, stripH: number,
    k: number, lift: number, selected: boolean, narrow = false,
  ) {
    const h = bodyH + stripH;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = (8 + lift * 16) * k;
    ctx.shadowOffsetY = (3 + lift * 4) * k;
    ctx.fillStyle = "rgba(18,21,29,0.94)";
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, w, h, 12 * k);
    ctx.clip();
    const grad = ctx.createLinearGradient(x, y, x + w * 0.8, y);
    grad.addColorStop(0, `${m.accent}55`);
    grad.addColorStop(1, "rgba(18,21,29,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, bodyH);

    if (stripH > 0) {
      const hot = this.regionHovered(x, y + bodyH, w, stripH);
      ctx.fillStyle = hot ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.35)";
      ctx.fillRect(x, y + bodyH, w, stripH);
      text(ctx, `${m.browse}  ›`, x + w / 2, y + bodyH + stripH / 2 + 1 * k, 10 * k,
        hot ? CREAM : "rgba(244,241,232,0.55)", "center", "middle", 800);
    }
    ctx.restore();

    if (narrow) {
      // Stacked: a big glyph over the name. The status line is the first thing cut —
      // at this width it would be four points of shrunken type nobody can read.
      const gr = bodyH * 0.3;
      drawModeGlyph(ctx, m.screen, x + w / 2, y + bodyH * 0.36, gr, m.accent);
      fitText(ctx, m.title, x + w / 2, y + bodyH * 0.8, 13 * k, w - 10 * k, CREAM, 900, "rgba(0,0,0,0.6)");
    } else {
      const gr = bodyH * 0.26;
      drawModeGlyph(ctx, m.screen, x + 12 * k + gr, y + bodyH * 0.5, gr, m.accent);

      const tx = x + 12 * k + gr * 2 + 10 * k;
      text(ctx, m.title, tx, y + bodyH * 0.4, 17 * k, CREAM, "left", "middle", 900, "rgba(0,0,0,0.6)");
      fitText(ctx, m.status(), tx, y + bodyH * 0.68, 10 * k, x + w - 10 * k - tx,
        "rgba(244,241,232,0.55)", 800, undefined, "left");
    }

    ctx.strokeStyle = selected ? m.accent : `rgba(255,255,255,${0.08 + lift * 0.2})`;
    ctx.lineWidth = (selected ? 2.5 : 1.5) * k;
    roundRect(ctx, x, y, w, h, 12 * k);
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
      "Run until it kills you — or take today's world, the same one everybody gets.");

    const list = this.options;
    const cardW = Math.min(340 * k, (w - 100 * k) / 2 - 14 * k);
    const cardH = cardW * 0.56;
    const gap = 22 * k;
    const startX = (w - (list.length * cardW + (list.length - 1) * gap)) / 2;
    const y = h * 0.3;

    list.forEach((def, i) => {
      const x = startX + i * (cardW + gap);
      const lift = this.lift[i] ?? 0;
      const cy = y - lift * 8 * k;
      this.regions.push({ x, y: cy, w: cardW, h: cardH, action: { kind: "select", level: def } });
      if (this.regionHovered(x, cy, cardW, cardH)) this.hovered = i;
      this.drawLevelCard(ctx, def, x, cy, cardW, cardH, k, lift, i === this.selected);

      // Each card carries its own record underneath it.
      const sy = cy + cardH + 30 * k;
      if (def === DAILY) {
        const today = progress.daily;
        text(ctx, today ? today.score.toLocaleString("en-US") : "NOT PLAYED",
          x + cardW / 2, sy, today ? 30 * k : 18 * k, today ? GOLD : "rgba(244,241,232,0.4)",
          "center", "middle", 900, "rgba(0,0,0,0.7)");
        text(ctx, today ? "TODAY'S SCORE" : "ONE WORLD, EVERYONE, TODAY",
          x + cardW / 2, sy + 24 * k, 11 * k, "rgba(244,241,232,0.5)", "center", "middle", 800);
        text(ctx, `RESETS IN ${countdown(secondsUntilRollover())}`,
          x + cardW / 2, sy + 42 * k, 11 * k, "rgba(255,210,63,0.7)", "center", "middle", 800);
      } else {
        const best = Math.floor(progress.bestDistance);
        text(ctx, best > 0 ? `${best}m` : "—", x + cardW / 2, sy, 30 * k, GOLD, "center", "middle", 900, "rgba(0,0,0,0.7)");
        text(ctx, "FURTHEST RUN", x + cardW / 2, sy + 24 * k, 11 * k, "rgba(244,241,232,0.5)", "center", "middle", 800);
      }
    });

    this.drawPlayButton(ctx, w, y + cardH + 96 * k, k,
      this.level === DAILY ? "PLAY TODAY'S RUN" : "START RUN", this.level);
    this.drawFooter(ctx, w, h, k, "← →  choose     ENTER  start     ESC  back");
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

  /**
   * One line of navigation help and nothing else.
   *
   * The control list that used to live here was the same manual the HUD showed over
   * the first frame of play. Controls are taught in the game now, by the coach, when
   * they are about to be needed — see `ui/coach.ts`.
   */
  private drawFooter(ctx: Ctx, w: number, h: number, k: number, hint: string) {
    text(ctx, hint, w / 2, h - 24 * k, 12 * k, "rgba(244,241,232,0.4)", "center", "middle", 700);
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

  drawPause(ctx: Ctx, w: number, h: number, levelName: string, muted = false) {
    this.regions = [];
    const k = this.scaleFor(w, h);

    ctx.fillStyle = "rgba(8,10,16,0.72)";
    ctx.fillRect(0, 0, w, h);

    if (this.optionsOpen) {
      this.drawOptions(ctx, w, h, k, muted);
      return;
    }

    text(ctx, "PAUSED", w / 2, h * 0.26, 56 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.7)");
    text(ctx, levelName.toUpperCase(), w / 2, h * 0.26 + 42 * k, 14 * k, "rgba(244,241,232,0.5)", "center", "middle", 800);

    const top = h * 0.4;
    this.drawButtonStack(ctx, w, top, k, [
      { label: "RESUME", action: { kind: "resume" }, primary: true },
      { label: "RESTART LEVEL", action: { kind: "restart" } },
      { label: "OPTIONS", action: { kind: "ui", ui: "options" } },
      { label: "MAIN MENU", action: { kind: "quit" } },
    ]);
    text(ctx, "ESC to resume", w / 2, top + 4 * 64 * k + 6 * k, 12 * k, "rgba(244,241,232,0.35)", "center", "middle", 700);
  }

  // ------------------------------------------------------------------ results

  /**
   * End-of-run overlay. One screen serves mission complete, mission failed and the
   * end of an endless run — they differ only in the headline and which buttons make
   * sense afterwards.
   */
  drawResult(ctx: Ctx, w: number, h: number, r: ResultCard) {
    this.regions = [];
    const k = this.scaleFor(w, h);
    const narrow = w < 640;

    ctx.fillStyle = r.won ? "rgba(8,16,12,0.92)" : "rgba(20,8,10,0.92)";
    ctx.fillRect(0, 0, w, h);

    // ------------------------------------------------------------ the big button
    // Laid out first, from the bottom, because it is the only thing on this screen
    // that has to be reachable without reading anything. Everything above it gets
    // whatever room is left over rather than pushing it off a short viewport.
    const primaryH = (narrow ? 78 : 88) * k;
    const primaryW = Math.min(460 * k, w - 48 * k);
    const primaryY = h - primaryH - (narrow ? 74 : 86) * k;

    // Whichever action carries the run forward is the big one, and it is the same
    // action SPACE takes — a visual default that disagrees with the keyboard default
    // is a trap, so the order here mirrors `handleResultInput`.
    const primary: { label: string; sub: string; action: MenuAction } = r.canRevive
      ? { label: "CONTINUE RUN", sub: "WATCH AN AD · KEEP YOUR SCORE", action: { kind: "revive" } }
      : r.hasNext
        ? { label: "NEXT MISSION", sub: (r.nextLabel ?? "").toUpperCase(), action: { kind: "next" } }
        : { label: r.retryLabel.toUpperCase(), sub: "SPACE", action: { kind: "restart" } };

    this.regions.push({ x: w / 2 - primaryW / 2, y: primaryY, w: primaryW, h: primaryH, action: primary.action });
    this.goldSlab(ctx, w / 2 - primaryW / 2, primaryY, primaryW, primaryH, k,
      this.regionHovered(w / 2 - primaryW / 2, primaryY, primaryW, primaryH));
    text(ctx, primary.label, w / 2, primaryY + primaryH / 2 + 2 * k, Math.min(34 * k, primaryW * 0.11),
      "#141820", "center", "middle", 900);
    if (primary.sub) {
      text(ctx, primary.sub, w / 2, primaryY + primaryH + 16 * k, 11 * k,
        "rgba(244,241,232,0.45)", "center", "middle", 800);
    }

    // Secondaries live in the bottom corners, as far from the primary as the screen
    // allows: a mis-tap on this card costs a session.
    const sw = 116 * k;
    const sh = 34 * k;
    const sy = h - sh - 16 * k;
    this.ghostButton(ctx, 16 * k, sy, sw, sh, k, "‹ MENU", { kind: "quit" });
    if (r.canRevive || r.hasNext) {
      this.ghostButton(ctx, w - sw - 16 * k, sy, sw, sh, k, r.retryLabel.toUpperCase(), { kind: "restart" });
    }

    // ------------------------------------------------------------ the reward
    const top = h * 0.11;
    text(ctx, r.title, w / 2, top, (narrow ? 32 : 42) * k, r.won ? "#6ddc7a" : "#e8433a",
      "center", "middle", 900, "rgba(0,0,0,0.75)");
    if (r.subtitle) {
      text(ctx, r.subtitle, w / 2, top + (narrow ? 22 : 26) * k, 13 * k,
        "rgba(244,241,232,0.62)", "center", "middle", 700);
    }

    // What they earned leads, not whether they won. A loss that paid out 9,000 carnage
    // is a good run, and the number is the reason to press the button below.
    let y = top + 46 * k;
    const pop = 1 + 0.04 * Math.sin(this.t * 4);
    ctx.save();
    ctx.translate(w / 2, y + 18 * k);
    ctx.scale(pop, pop);
    text(ctx, `+${r.earned.toLocaleString("en-US")}`, 0, 0, (narrow ? 46 : 62) * k, GOLD,
      "center", "middle", 900, "rgba(0,0,0,0.6)");
    ctx.restore();
    text(ctx, "CARNAGE EARNED", w / 2, y + 48 * k, 12 * k, "rgba(244,241,232,0.55)", "center", "middle", 800);
    y += 70 * k;

    if (r.record) {
      text(ctx, r.record.toUpperCase(), w / 2, y, 15 * k, "#6ddc7a", "center", "middle", 900, "rgba(0,0,0,0.6)");
      y += 26 * k;
    } else if (r.rank) {
      text(ctx, `WORLD RANK  #${r.rank.toLocaleString("en-US")}`, w / 2, y, 15 * k, GOLD,
        "center", "middle", 900, "rgba(0,0,0,0.6)");
      y += 26 * k;
    }

    if (r.medals?.length) {
      const names = r.medals.map((m) => m.name).join("   ·   ");
      text(ctx, names, w / 2, y, 14 * k, GOLD, "center", "middle", 900, "rgba(0,0,0,0.6)");
      y += 20 * k;
      text(ctx, r.medals[0].detail, w / 2, y, 11 * k, "rgba(244,241,232,0.55)", "center", "middle", 700);
      y += 24 * k;
    }
    if (r.streak && r.streak.days > 1) {
      text(ctx, `${r.streak.days}-DAY STREAK  ·  +${r.streak.bonus.toLocaleString("en-US")}`,
        w / 2, y, 12 * k, "rgba(244,241,232,0.7)", "center", "middle", 800);
      y += 22 * k;
    }

    if (r.unlocked.length) y = this.drawUnlocks(ctx, w, y, k, r.unlocked);

    // ------------------------------------------------------------ the near miss
    y = this.drawNextUp(ctx, w, y + 6 * k, k, r);

    // Stats last and small: they are the receipt, not the offer. A single row of
    // chips rather than a table, because nobody reads four labelled rows twice.
    const room = primaryY - 26 * k - y;
    if (room > 34 * k) this.drawStatChips(ctx, w, y + 6 * k, k, r.stats, narrow);
  }

  private ghostButton(
    ctx: Ctx, x: number, y: number, w: number, h: number, k: number,
    label: string, action: MenuAction,
  ) {
    const hot = this.regionHovered(x, y, w, h);
    this.regions.push({ x, y, w, h, action });
    ctx.fillStyle = hot ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
    roundRect(ctx, x, y, w, h, 8 * k);
    ctx.fill();
    text(ctx, label, x + w / 2, y + h / 2 + 1 * k, 11 * k,
      hot ? CREAM : "rgba(244,241,232,0.55)", "center", "middle", 900);
  }

  /** The "you earned something" banner. Returns the Y to carry on drawing from. */
  private drawUnlocks(ctx: Ctx, w: number, y: number, k: number, ids: string[]) {
    const pulse = 0.55 + 0.45 * Math.sin(this.t * 5);
    const gs = 38 * k;
    const gap = 10 * k;
    const totalW = ids.length * gs + (ids.length - 1) * gap;
    const bw = Math.min(w - 48 * k, totalW + 60 * k);
    const bh = gs + 48 * k;
    const bx = w / 2 - bw / 2;

    ctx.fillStyle = "rgba(255,210,63,0.12)";
    roundRect(ctx, bx, y, bw, bh, 12 * k);
    ctx.fill();
    ctx.strokeStyle = rgbaHex(GOLD, 0.35 + pulse * 0.5);
    ctx.lineWidth = 2 * k;
    ctx.stroke();

    text(ctx, ids.length > 1 ? `${ids.length} NEW ROUNDS UNLOCKED` : "NEW ROUND UNLOCKED",
      w / 2, y + 16 * k, 13 * k, GOLD, "center", "middle", 900);

    const x0 = w / 2 - totalW / 2;
    ids.forEach((id, i) => {
      ctx.drawImage(iconBitmap(id), x0 + i * (gs + gap), y + 26 * k, gs, gs);
    });
    text(ctx, ids.map(weaponName).join("   ·   "), w / 2, y + bh - 12 * k,
      12 * k, CREAM, "center", "middle", 900);
    return y + bh + 14 * k;
  }

  /**
   * How close the next round is.
   *
   * Deliberately the largest thing on the card after the earnings, and deliberately
   * phrased as a distance rather than a total: "820 away" is a run, "3,000 of 6,000"
   * is arithmetic. When the bar is most of the way across it says so out loud, because
   * a player who is nearly there and knows it will press the button underneath.
   */
  private drawNextUp(ctx: Ctx, w: number, y: number, k: number, r: ResultCard) {
    const bw = Math.min(400 * k, w - 48 * k);
    const bx = w / 2 - bw / 2;

    if (!r.next) {
      text(ctx, "ARSENAL COMPLETE", w / 2, y + 12 * k, 14 * k, GOLD, "center", "middle", 900);
      return y + 30 * k;
    }

    const frac = clamp(r.next.frac, 0, 1);
    const gs = 34 * k;
    ctx.drawImage(iconBitmap(r.next.id), bx, y, gs, gs);
    text(ctx, `NEXT: ${weaponName(r.next.id)}`, bx + gs + 10 * k, y + 11 * k, 14 * k, GOLD, "left", "middle", 900);
    text(ctx, `${r.next.remaining.toLocaleString("en-US")} AWAY`, bx + bw, y + 11 * k, 13 * k,
      CREAM, "right", "middle", 900);

    const by = y + gs + 4 * k;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(ctx, bx, by, bw, 12 * k, 6 * k);
    ctx.fill();
    ctx.fillStyle = GOLD;
    roundRect(ctx, bx, by, bw * frac, 12 * k, 6 * k);
    ctx.fill();
    // A moving highlight on the filled part, so the bar looks charged rather than dead.
    ctx.save();
    roundRect(ctx, bx, by, bw * frac, 12 * k, 6 * k);
    ctx.clip();
    ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.12 * Math.sin(this.t * 3)})`;
    ctx.fillRect(bx, by, bw * frac, 5 * k);
    ctx.restore();

    if (frac > 0.65) {
      text(ctx, "ONE GOOD RUN AWAY", w / 2, by + 26 * k, 12 * k, "#6ddc7a", "center", "middle", 900);
      return by + 40 * k;
    }
    text(ctx, `${r.carnage.toLocaleString("en-US")} TOTAL CARNAGE`, w / 2, by + 24 * k, 11 * k,
      "rgba(244,241,232,0.4)", "center", "middle", 800);
    return by + 38 * k;
  }

  /** The run's numbers, as a single row of chips. */
  private drawStatChips(ctx: Ctx, w: number, y: number, k: number, stats: [string, string][], narrow: boolean) {
    const list = stats.slice(0, narrow ? 3 : 4);
    if (!list.length) return;
    const gap = 8 * k;
    const cw = Math.min(120 * k, (w - 48 * k - gap * (list.length - 1)) / list.length);
    const ch = 42 * k;
    const x0 = w / 2 - (list.length * cw + (list.length - 1) * gap) / 2;
    list.forEach(([label, value], i) => {
      const x = x0 + i * (cw + gap);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(ctx, x, y, cw, ch, 8 * k);
      ctx.fill();
      fitText(ctx, value, x + cw / 2, y + 16 * k, 16 * k, cw - 10 * k, CREAM, 900);
      fitText(ctx, label, x + cw / 2, y + 32 * k, 9 * k, cw - 8 * k, "rgba(244,241,232,0.45)", 800);
    });
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

/** Display name for an ammo id, straight off the arsenal definition. */
function weaponName(id: string): string {
  return AMMO_BY_ID.get(id)?.name.toUpperCase() ?? id.toUpperCase();
}

/** `H:MM:SS` for the daily rollover clock. */
function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${hh}h ${String(mm).padStart(2, "0")}m`;
}

/** `#rrggbb` + alpha, for the few places that animate a stroke colour. */
function rgbaHex(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

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

/**
 * Text that shrinks rather than overflowing.
 *
 * The front page has to hold a seventeen-character title and a mission name on a
 * 390px phone. Wrapping either one would break the shape of the page, and clipping
 * them looks broken, so the size gives way instead.
 */
function fitText(
  ctx: Ctx, str: string, x: number, y: number, size: number, maxW: number,
  color: string, weight = 800, stroke?: string, align: CanvasTextAlign = "center",
) {
  let s = size;
  while (s > 6 && measure(ctx, str, s, weight) > maxW) s -= 0.5;
  text(ctx, str, x, y, s, color, align, "middle", weight, stroke);
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
