import { ARENAS } from "../levels";
import type { LevelDef } from "../levels/types";
import { clamp, TAU } from "../core/math";
import type { Ctx } from "../render/draw";
import { settings, SHAKE_LABELS, VOLUME_LABELS } from "./settings";
import { quality, TIER_LABELS } from "./quality";
import { progress } from "./progress";
import { AMMO_BY_ID } from "../weapons/ammo";
import { gunSprite } from "../render/gunart";
import { ammoSprite } from "../render/ammoart";
import { sfx } from "../fx/audio";
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
 * ### The arena is the poster
 *
 * The first version of this screen laid a flat 72% scrim over the whole viewport and
 * floated a row of painted thumbnails on top of it. That got two things wrong at once.
 *
 * The scrim wasted the best asset the menu has. Selecting an arena rebuilds the world
 * behind this screen and plays it — a real fight, in the real arena, with the real
 * arsenal — and it was being muted to near-black so that nothing showed through but a
 * grey wash. Two thirds of a 1600x900 frame was that wash with nothing drawn on it.
 *
 * And the thumbnails were competing with the thing they were previews *of*. A 168-pixel
 * painting of an arena is never going to beat the arena itself running at full size
 * directly behind it, so the card no longer tries: it is a name plate.
 *
 * So the screen is now built as **two solid bands and a window**. An ink band across
 * the top carries the wordmark; an ink band across the bottom carries the picker, the
 * blurb and PLAY. Between them the world plays almost unscrimmed. Nothing floats, there
 * is no dead middle, and what sells the game is the game.
 *
 * ### The cast is on the box
 *
 * A menu for a game about a stickman with a chicken cannon had no stickman and no
 * chicken on it. Every pixel of it was type. `drawMascot` puts the character on his own
 * title screen, drawn in the same black vector language the game draws him in and
 * holding a real sprite out of `render/gunart.ts` — not an illustration of the game,
 * the actual thing, which is the only kind of mascot worth having.
 */


/** Things the menu handles by itself. `click()` applies them and reports `none`. */
type UiAction =
  | { ui: "options" }
  | { ui: "close" }
  | { ui: "shake"; step: number }
  | { ui: "quality"; step: number }
  | { ui: "music"; step: number }
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
      case "music": settings.setVolumeStep(a.step); sfx.setVolumeStep(a.step); break;
      case "tips": settings.setTips(!settings.tips); break;
    }
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: Ctx, w: number, h: number, _muted = false) {
    this.regions = [];
    const k = clamp(Math.min(w, h) / 780, 0.55, 1.5);

    // Two solid bands and a window between them. See the note at the top of the file:
    // the world playing behind this screen is the best thing on it, and the previous
    // full-screen scrim spent two thirds of the frame hiding it.
    const topH = Math.round(Math.min(h * 0.17, 104 * k));
    // Measured from the content, not taken as a fraction of the viewport. A band sized
    // by fraction is a band with a hole in the bottom of it at some window shapes, and
    // every pixel it takes that the picker does not need is a pixel of arena hidden.
    const layout = this.pickerLayout(w, h, k);
    const botY = h - layout.height;

    // A light wash over the live world, only across the window. Enough to sit the arena
    // one step behind the interface; nowhere near enough to lose it.
    ctx.fillStyle = "rgba(10,12,18,0.26)";
    ctx.fillRect(0, topH, w, botY - topH);

    this.drawBand(ctx, 0, w, topH, k, "bottom");
    this.drawBand(ctx, botY, w, layout.height, k, "top");

    this.drawTitle(ctx, w, topH, k);
    this.drawGearButton(ctx, w, topH, k);
    this.drawMascot(ctx, w, botY, k);
    this.drawPicker(ctx, w, botY, layout, k);

    if (this.optionsOpen) this.drawOptions(ctx, w, h, k);

    this.hover(this.lastMouse.x, this.lastMouse.y);
  }

  /**
   * One of the two solid bands, with a notched inner edge and an accent rule on it.
   *
   * The notches face the window rather than the screen edge: they are what makes a band
   * read as a piece of chrome laid over the world instead of as a letterbox bar, and a
   * notch on an edge that runs off the screen is invisible anyway.
   */
  private drawBand(
    ctx: Ctx, y: number, w: number, h: number, k: number, edge: "top" | "bottom",
  ) {
    const accent = this.previewLevel.accent;
    ctx.fillStyle = INK;
    ctx.fillRect(0, y, w, h);

    const rule = Math.max(2, Math.round(3 * k));
    const notch = Math.max(3, Math.round(4 * k));
    const inner = edge === "top" ? y : y + h - rule;
    ctx.fillStyle = accent;
    ctx.fillRect(0, inner, w, rule);

    ctx.fillStyle = PANEL_DIM;
    const ny = edge === "top" ? y + rule : y + h - rule - notch;
    for (let nx = 0; nx < w; nx += notch * 5) ctx.fillRect(nx, ny, notch * 2, notch);
  }

  /**
   * The wordmark.
   *
   * Two passes offset by a pixel - ink under cream - rather than a shadow. A blurred
   * shadow is the single most web-looking thing a canvas title can do; a hard offset is
   * what a sprite-based title would look like, and it costs the same.
   *
   * The second word takes the selected arena's accent, so picking a different arena
   * repaints the game's own name. It is the cheapest way there is to make a static
   * screen answer back to what the player is doing.
   */
  private drawTitle(ctx: Ctx, w: number, bandH: number, k: number) {
    const a = "STICKMAN ";
    const b = "ASCENSION";
    const accent = this.previewLevel.accent;
    const y = bandH * 0.4;

    // Shrunk to fit rather than clipped. The carnage readout and the cog own the right
    // end of this band, so the title gets what is left of the width, not all of it.
    let size = Math.min(44 * k, bandH * 0.44);
    const room = w - 200 * k;
    while (size > 10 && measure(ctx, a + b, size, 900) > room) size -= 0.5;

    const aw = measure(ctx, a, size, 900);
    const bw = measure(ctx, b, size, 900);
    const x0 = w / 2 - (aw + bw) / 2;

    const o = Math.max(2, Math.round(3 * k));
    text(ctx, a, x0 + o, y + o, size, "#000000", "left", "middle", 900);
    text(ctx, b, x0 + aw + o, y + o, size, "#000000", "left", "middle", 900);
    text(ctx, a, x0, y, size, CREAM, "left", "middle", 900);
    text(ctx, b, x0 + aw, y, size, accent, "left", "middle", 900);

    // A rule either side of the subtitle, which reads as chrome rather than as text.
    const sub = "PICK SOMETHING TO BREAK";
    const sy = y + size * 0.68;
    const subW = measure(ctx, sub, 12 * k, 800);
    text(ctx, sub, w / 2, sy, 12 * k, MUTED, "center", "middle", 800);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(w / 2 - subW / 2 - 34 * k, sy - 1 * k, 24 * k, 2 * k);
    ctx.fillRect(w / 2 + subW / 2 + 10 * k, sy - 1 * k, 24 * k, 2 * k);
    ctx.globalAlpha = 1;
  }

  /**
   * The stickman, standing on the lower band with the chicken cannon.
   *
   * Drawn rather than sprited, in the same pure-black vector the game draws him in.
   * `GAME_SPEC` calls that contrast the game's identity - the one thing you control is
   * the one thing drawn in a different language - and a menu that rendered him any
   * other way would be advertising a different game. The gun is the real sprite out of
   * `render/gunart.ts`, the one he will be holding sixty seconds from now.
   *
   * He idles: a slow bob, and the barrel drifts. A still figure on a screen where the
   * world behind him is moving reads as a decal stuck on the glass.
   */
  private drawMascot(ctx: Ctx, w: number, groundY: number, k: number) {
    const s = 74 * k;
    const x = w - Math.max(120 * k, w * 0.135);
    const y = groundY + Math.sin(this.t * 1.7) * 1.6 * k;

    ctx.save();
    ctx.translate(x, y);

    const lw = Math.max(2, s * 0.11);
    ctx.strokeStyle = "#0a0c11";
    ctx.fillStyle = "#0a0c11";
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const hipY = -s * 0.46;
    const shoY = -s * 0.84;

    // Legs braced apart and a straight spine: what somebody firing something far too
    // heavy for them actually stands like.
    ctx.beginPath();
    ctx.moveTo(0, hipY); ctx.lineTo(-s * 0.22, 0);
    ctx.moveTo(0, hipY); ctx.lineTo(s * 0.24, -s * 0.01);
    ctx.moveTo(0, hipY); ctx.lineTo(0, shoY);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, shoY - s * 0.14, s * 0.145, 0, TAU);
    ctx.fill();

    // The gun, held level and drifting, as though tracking something off-screen that
    // has not noticed him yet.
    ctx.save();
    ctx.translate(0, shoY + s * 0.08);
    ctx.rotate(Math.sin(this.t * 0.8) * 0.08 - 0.04);
    const gun = gunSprite("chicken", "#39404e");
    if (gun) {
      const gw = s * 1.2;
      const gh = (gun.height / gun.width) * gw;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(gun, -gw * 0.2, -gh / 2, gw, gh);
      // Arms last, so the hands read as being on the gun rather than behind it.
      ctx.strokeStyle = "#0a0c11";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(gw * 0.46, gh * 0.04);
      ctx.moveTo(0, 0); ctx.lineTo(gw * 0.14, gh * 0.2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    // And the payload, waiting its turn by his boot. This is the joke the entire game
    // is built on and there was not one anywhere on the front end.
    const chick = ammoSprite("chicken", this.t);
    if (chick) {
      const cw = s * 0.46;
      const ch = (chick.height / chick.width) * cw;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(chick, x - s * 1.15, groundY - ch, cw, ch);
      ctx.restore();
    }
  }

  /**
   * The lower band: the arena strip, the blurb for whatever is selected, and PLAY.
   *
   * The cards are name plates rather than paintings. See the note at the top of the
   * file - the arena is playing directly behind this band at full size, and a 168-pixel
   * painting was never going to preview it better than that.
   */
  /**
   * How tall the lower band has to be, and the card grid that decides it.
   *
   * Split out from the drawing so `draw` can size the band before anything is painted
   * into it. The alternative - guessing a fraction of the viewport and hoping - is what
   * left seventy pixels of empty ink under the progress bar at 1600x900 and clipped the
   * keyboard hint on a short window.
   */
  private pickerLayout(w: number, h: number, k: number) {
    const n = ARENAS.length;
    const pad = Math.max(16 * k, w * 0.02);
    const gap = 8 * k;
    const avail = w - pad * 2;
    const flat = (avail - gap * (n - 1)) / n;
    // Below the width a name still fits in, the row splits 4 + 3 - the only balanced
    // split of seven. A wrap that leaves one orphan card reads as a bug, not a grid.
    //
    // The threshold is the width the *longest* name needs, not an arbitrary minimum.
    // At 92 the row stayed unsplit down to 64-pixel plates, and `fitText` dutifully
    // shrank "PROVING GROUND" to about seven pixels tall rather than wrapping — a row
    // of seven cards nobody could read, which is worse than two rows of readable ones.
    const longest = ARENAS.reduce((m, d) => Math.max(m, d.name.length), 0);
    const perRow = flat < (longest * 8 + 26) * k ? 4 : n;
    const cardW = Math.min(190 * k, (avail - gap * (perRow - 1)) / perRow);
    const cardH = Math.round(clamp(h * 0.062, 34 * k, 52 * k));
    const rows = Math.ceil(n / perRow);
    const playH = Math.round(clamp(h * 0.055, 34 * k, 48 * k));

    // The running total below is the band, item by item, in the order it is drawn.
    const height = Math.round(
      18 * k                                   // pad under the accent rule
      + rows * cardH + (rows - 1) * gap        // the strip
      + 26 * k + 20 * k + 20 * k               // name, tagline, tag chips
      + 24 * k + playH                         // PLAY
      + 22 * k                                 // the keyboard hint
      + 34 * k                                 // the carnage line (see drawUnlockBar)
      + 20 * k,                                // pad above the screen edge
    );
    return { perRow, cardW, cardH, rows, gap, playH, height };
  }

  private drawPicker(
    ctx: Ctx, w: number, y0: number,
    L: ReturnType<Menu["pickerLayout"]>, k: number,
  ) {
    const def = this.previewLevel;
    const n = ARENAS.length;
    const { perRow, cardW, cardH, rows, gap } = L;
    const stripY = y0 + Math.round(18 * k);

    ARENAS.forEach((d, i) => {
      const row = Math.floor(i / perRow);
      const count = Math.min(perRow, n - row * perRow);
      const ox = w / 2 - (count * cardW + (count - 1) * gap) / 2;
      const x = ox + (i - row * perRow) * (cardW + gap);
      const cy = stripY + row * (cardH + gap);
      const chosen = i === this.sel;
      const hot = this.isHot(x, cy, cardW, cardH);

      notchedPanel(ctx, x, cy, cardW, cardH, k,
        chosen ? d.accent : (hot ? PANEL_LIT : PANEL));
      // The chosen plate is *filled* with its accent and the rest carry it as a spine
      // down the left edge - a difference you can see without reading anything.
      if (!chosen) {
        ctx.fillStyle = d.accent;
        ctx.fillRect(x + 3 * k, cy + 4 * k, 3 * k, cardH - 8 * k);
      }
      fitText(ctx, d.name.toUpperCase(), x + cardW / 2, cy + cardH / 2,
        13 * k, cardW - 20 * k, chosen ? INK : CREAM, 900);

      this.regions.push({ x, y: cy, w: cardW, h: cardH, action: { kind: "select", level: d } });
    });

    let y = stripY + rows * cardH + (rows - 1) * gap + Math.round(26 * k);
    text(ctx, def.name.toUpperCase(), w / 2, y, 24 * k, CREAM, "center", "middle", 900);
    y += 20 * k;
    text(ctx, def.tagline, w / 2, y, 13 * k, MUTED, "center", "middle", 700);
    y += 20 * k;

    // Tags as hard-edged chips in the arena's accent.
    const chipH = 17 * k;
    const chipPad = 9 * k;
    const widths = def.tags.map((t) => measure(ctx, t, 10 * k, 800) + chipPad * 2);
    const chipGap = 6 * k;
    let cx = w / 2 - (widths.reduce((a, b) => a + b, 0) + chipGap * (def.tags.length - 1)) / 2;
    def.tags.forEach((tag, i) => {
      ctx.fillStyle = PANEL;
      ctx.fillRect(cx, y - chipH / 2, widths[i], chipH);
      ctx.fillStyle = def.accent;
      ctx.fillRect(cx, y - chipH / 2, widths[i], 2 * k);
      text(ctx, tag, cx + widths[i] / 2, y + 1 * k, 10 * k, def.accent, "center", "middle", 800);
      cx += widths[i] + chipGap;
    });
    y += 24 * k;

    const bw = Math.min(280 * k, w - 80 * k);
    const bh = L.playH;
    const bx = w / 2 - bw / 2;
    const hot = this.isHot(bx, y, bw, bh);
    notchedPanel(ctx, bx, y, bw, bh, k, hot ? "#ffdf6a" : GOLD, INK);
    text(ctx, "PLAY", w / 2, y + bh / 2, 22 * k, INK, "center", "middle", 900);
    this.regions.push({ x: bx, y, w: bw, h: bh, action: { kind: "play", level: def } });

    text(ctx, "\u2190 \u2192  CHOOSE      ENTER  PLAY", w / 2, (y += bh) + 12 * k,
      10 * k, MUTED, "center", "middle", 800);

    this.drawUnlockBar(ctx, w, y + 42 * k, k);
  }

  /**
   * The carnage line at the bottom of the screen.
   *
   * Every round is free now (see `progress.ARSENAL`), so `nextUnlock` is always null and
   * this always draws the one-line complete state: the lifetime total, and a reminder
   * that the whole arsenal is already in hand.
   *
   * The bar itself is kept for the day a round is priced again. It measures from the
   * previous rung rather than from zero — at six million for the last round, a bar
   * measured from zero barely twitches over a session and reads as "this is hopeless"
   * rather than "nearly there". See `progress.nextUnlock`.
   */
  private drawUnlockBar(ctx: Ctx, w: number, by: number, k: number) {
    const next = progress.nextUnlock();
    const bw = Math.min(420 * k, w - 60 * k);
    const bx = w / 2 - bw / 2;

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
  private drawGearButton(ctx: Ctx, w: number, bandH: number, k: number) {
    const mid = bandH * 0.44;
    const total = `${progress.carnage.toLocaleString("en-US")}`;
    text(ctx, total, w - 62 * k, mid - 7 * k, 15 * k, GOLD, "right", "middle", 900);
    text(ctx, "CARNAGE", w - 62 * k, mid + 7 * k, 9 * k, MUTED, "right", "middle", 800);

    const r = 17 * k;
    const cx = w - 32 * k;
    const cy = mid;
    const hot = this.isHot(cx - r, cy - r, r * 2, r * 2);
    drawGear(ctx, cx, cy, r * 0.62, hot);
    this.regions.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2, action: { kind: "ui", ui: "options" } });
  }

  /**
   * Options. Four controls, and no more than four.
   *
   * EFFECTS first because it is the one that decides whether the game runs at all on a
   * slow machine, and it says what it costs rather than hiding behind a number. Screen
   * shake next, because it is an accessibility control rather than a preference —
   * motion sickness is not a matter of taste. MUSIC third: it is the loudest thing the
   * game does to a room, the first setting anyone hunts for when they are playing
   * somewhere they should not be, and it is a real OFF rather than a quiet. Tips last,
   * so a returning player can switch off a tutorial they have already had.
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
    // 300 held three rows; MUSIC adds one `drawSteps` row — 15 lead, 28 buttons, 22 gap
    // — plus a little over, because CLOSE hangs off the *bottom* edge and at exactly
    // 365 it ended up six pixels under CONTROL TIPS, reading as part of the same row.
    const ph = 385 * k;
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
    ry = this.drawSteps(ctx, rowX, ry, rowW, k, "MUSIC",
      VOLUME_LABELS, settings.volumeStep, (i) => ({ kind: "ui", ui: "music", step: i }));
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
