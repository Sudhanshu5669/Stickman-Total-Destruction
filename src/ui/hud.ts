import { iconBitmap } from "../render/props";
import { clamp, damp, lerp, TAU } from "../core/math";
import { rgba, type Ctx } from "../render/draw";
import type { Weapon } from "../weapons/weapon";
import { keyLabel } from "../core/keylabel";
import { notchedPanel, cellBar, PANEL_DIM, PANEL } from "./chrome";

export interface HudState {
  hp: number;
  maxHp: number;
  /** Jetpack tank, 0..1. */
  /** Jetpack charge 0..1, or -1 when the player has no pack yet and there is no gauge. */
  fuel: number;
  /** Jetpack throttle, 0..1 — makes the gauge glow while burning. */
  jetThrottle: number;
  score: number;
  displayScore: number;
  combo: number;
  comboTimer: number;
  comboMax: number;
  enemiesLeft: number;
  enemiesTotal: number;
  blocksDestroyed: number;
  weapon: Weapon;
  down: boolean;
  respawnIn: number;
  time: number;
  fps: number;
  /** God mode on — the health bar becomes an invincibility badge. */
  god: boolean;
  showDebug: boolean;
  bodies: number;
  particles: number;
  muted: boolean;
  paused: boolean;
  /**
   * 0..1, fades the mission briefing out once the player starts playing.
   *
   * This used to fade a nine-line CONTROLS card. Controls are taught in-game now, one
   * at a time, by `ui/coach.ts` — all that is left on this channel is the one line of
   * mission text a campaign brief carries.
   */
  hintAlpha: number;
  levelName: string;
  /**
   * On-screen controls are live. Optional so the game can adopt it when convenient:
   * the HUD moves out from under the touch pause button and keeps the ammo strip clear
   * of the swap buttons when it is set.
   */
  touch?: boolean;

  /** Hostiles put down this session. */
  kills: number;
}

const CREAM = "#f4f1e8";
const GOLD = "#ffd23f";

/**
 * All HUD drawing happens in raw screen pixels, after the world transform is popped.
 * Sizes derive from `scale` so the layout holds up from phone to ultrawide.
 */
export class Hud {
  private ammoScroll = 0;
  private hurtPulse = 0;
  private lastHp = 1;
  /**
   * Weapon-banner animation. `swapPop` fires on every ammo change and decays; the
   * banner lives at the top of the screen because the bottom of the frame is exactly
   * where the ammo strip lifts over it mid-swap and eats the description.
   */
  private swapPop = 0;
  private lastAmmoId = "";
  /** Last score seen, so a gain can flash the counter without the game telling us. */
  private lastScore = 0;
  private scorePop = 0;

  /**
   * Everything on screen, in one pass, in priority order.
   *
   * The hierarchy is deliberate and it is the thing that was missing: score and combo
   * are the game telling you that what you just did was worth doing, so they are the
   * loudest and they move; health and fuel are status you glance at, so they are small
   * and still; the ammo strip and the mission readout are reference, so they sit
   * quietly until you look for them. Before this pass all four corners shouted equally
   * and the reward feedback — the only part that makes the next run feel worth
   * starting — was the smallest text on the screen.
   */
  draw(ctx: Ctx, w: number, h: number, s: HudState, dt: number) {
    const scale = clamp(Math.min(w, h) / 780, 0.62, 1.35);
    // Portrait phones cannot hold three top-anchored panels side by side. Below this
    // the layout drops the weapon banner and narrows the status block instead of
    // overlapping them and hoping.
    const narrow = w < 640;
    const touch = s.touch === true;

    if (s.hp < this.lastHp) this.hurtPulse = 1;
    this.lastHp = s.hp;
    this.hurtPulse = Math.max(0, this.hurtPulse - dt * 2.2);

    if (s.score > this.lastScore) this.scorePop = 1;
    this.lastScore = s.score;
    this.scorePop = Math.max(0, this.scorePop - dt * 2.4);

    if (!s.god && (this.hurtPulse > 0.01 || s.hp < s.maxHp * 0.3)) {
      this.drawDamageVignette(ctx, w, h, s);
    }

    this.drawTopLeft(ctx, scale, s, narrow, touch);
    this.drawTopRight(ctx, w, scale, s, narrow);
    if (!narrow) this.drawWeaponBanner(ctx, w, scale, s, dt);
    this.drawAmmoBar(ctx, w, h, scale, s, dt, narrow, touch);
    this.drawCombo(ctx, w, h, scale, s, narrow);
    if (s.down && !s.paused) this.drawDownBanner(ctx, w, h, scale, s);
    // The pause overlay belongs to Menu — it owns the clickable buttons.
    if (s.showDebug) this.drawDebug(ctx, w, h, scale, s);
  }

  // ------------------------------------------------------------------ pieces

  private drawDamageVignette(ctx: Ctx, w: number, h: number, s: HudState) {
    const lowHp = 1 - clamp(s.hp / (s.maxHp * 0.3), 0, 1);
    const a = clamp(this.hurtPulse * 0.45 + lowHp * 0.3, 0, 0.7);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(200,20,30,0)");
    g.addColorStop(1, `rgba(190,20,32,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Score first, status second.
   *
   * The old block put two bars above a small score. That is backwards: the bars only
   * matter in the second you are about to die, and the score matters every second you
   * are playing — it is the number the whole arsenal is bought with. So the score is
   * the headline, it is drawn with a stroke heavy enough to read over a Mars sky, and
   * it flashes gold the moment it moves. The bars keep their information and lose
   * their volume.
   */
  private drawTopLeft(ctx: Ctx, k: number, s: HudState, narrow: boolean, touch: boolean) {
    // On a phone the on-screen pause button owns the top-left corner, so start clear
    // of it rather than drawing the health bar underneath a button.
    const x = (touch ? 78 : 22) * k;
    const y = 20 * k;
    const bw = (narrow ? 150 : 220) * k;
    const barH = 16 * k;
    // Before the jetpack is earned there is no gauge and no space reserved for one.
    // A permanently empty bar would read as a broken jetpack rather than as no jetpack.
    const hasPack = s.fuel >= 0;
    const fuelH = hasPack ? 9 * k : 0;

    const scoreSize = (narrow ? 32 : 40) * k;
    const scoreStr = s.displayScore.toLocaleString("en-US");
    const scoreW = measure(ctx, scoreStr, scoreSize, 900);

    panel(ctx, x - 10 * k, y - 8 * k,
      Math.max(bw, scoreW + 70 * k) + 20 * k, scoreSize + barH + fuelH + 30 * k, k, 0.34);

    // Score. `scorePop` is derived here rather than passed in, so the flash lands on
    // the frame the points arrive even though `displayScore` is still catching up.
    const pop = this.scorePop * this.scorePop;
    const scoreY = y + scoreSize * 0.78;
    ctx.save();
    ctx.translate(x, scoreY);
    ctx.scale(1 + pop * 0.06, 1 + pop * 0.06);
    text(ctx, scoreStr, 0, 0, scoreSize,
      pop > 0.05 ? GOLD : CREAM, "left", "alphabetic", 900, "rgba(0,0,0,0.7)");
    ctx.restore();
    text(ctx, "SCORE", x + scoreW + 8 * k, scoreY, 11 * k, "rgba(244,241,232,0.45)", "left", "alphabetic", 800);

    // Health, as cells rather than a sliver — see `chrome.cellBar`. A continuous bar
    // losing four percent moves by a pixel nobody notices; a cell going dark is a
    // discrete event, which is what taking a hit actually is.
    const hy = scoreY + 12 * k;
    const f = s.god ? 1 : clamp(s.hp / s.maxHp, 0, 1);
    // God mode pulses so it never reads as an ordinary full health bar.
    const hpFill = s.god
      ? `rgba(255,${200 + Math.round(Math.sin(s.time * 4) * 25)},63,1)`
      : f > 0.5 ? "#6ddc7a" : f > 0.25 ? GOLD : "#e8433a";
    cellBar(ctx, x, hy, bw, barH, k, f, hpFill, 16);
    // Right-aligned to the bar's end, cream over an ink stroke. It used to be dark text
    // sitting on the left of a solid fill, which worked while the fill was solid — the
    // cell gaps now cut straight through a glyph and chop the number into pieces.
    text(ctx, s.god ? "GOD MODE" : `${Math.ceil(s.hp)}`, x + bw - 6 * k, hy + barH / 2 + 0.5 * k,
      10 * k, CREAM, "right", "middle", 900, "rgba(0,0,0,0.85)");

    // Jetpack fuel, directly under health so the two read as one status block.
    if (!hasPack) return;
    const fy = hy + barH + 4 * k;
    const fuel = clamp(s.fuel, 0, 1);
    // Glows hot while burning, dims to amber when nearly dry.
    const fuelFill = s.jetThrottle > 0.05
      ? `rgba(255,${190 + Math.round(s.jetThrottle * 50)},120,1)`
      : fuel > 0.25 ? "#5ec8ff" : "#e8433a";
    // Twice the cells of the health bar: the tank drains continuously while you hold
    // the jet, so it needs finer resolution to read as draining rather than stepping.
    cellBar(ctx, x, fy, bw, fuelH, k, fuel, fuelFill, 32);
  }

  /**
   * Mission readout. Each mode leads with the number that actually matters in it.
   *
   * The panel is measured from its own contents rather than assuming a width. Level
   * names, mode labels and the pip row all vary in length, and a fixed box either
   * clipped the longest of them or left a slab of empty panel next to the shortest.
   */
  private drawTopRight(ctx: Ctx, w: number, k: number, s: HudState, narrow: boolean) {
    const right = w - 14 * k;
    const y = 20 * k;
    const pad = 12 * k;
    const rowGap = 15 * k;

    // Each row: text, size, weight, colour, outline.
    const rows: [string, number, number, string, string?][] = [];
    rows.push([`${s.enemiesTotal - s.enemiesLeft}/${s.enemiesTotal}`, 22 * k, 900, CREAM, "rgba(0,0,0,0.6)"]);
    rows.push(["STICKMEN DOWN", 10 * k, 800, "rgba(244,241,232,0.5)"]);
    rows.push([`${s.blocksDestroyed} BLOCKS SMASHED`, 10 * k, 800, "rgba(255,210,63,0.72)"]);
    // The level name is the least useful thing in the panel and the first to go when
    // there is no room for it.
    if (!narrow) rows.push([s.levelName.toUpperCase(), 10 * k, 800, "rgba(244,241,232,0.32)"]);

    let content = 0;
    for (const [str, size, weight] of rows) content = Math.max(content, measure(ctx, str, size, weight));

    const bw = content + pad * 2;
    const bh = rows.length * rowGap + 22 * k;
    const left = right - bw;
    panel(ctx, left, y - 8 * k, bw, bh, k, 0.34);

    const tx = right - pad;
    // Baseline of the first row sits low enough for the 24px headline's cap height.
    let ty = y + 20 * k;
    for (const [str, size, weight, color, stroke] of rows) {
      text(ctx, str, tx, ty, size, color, "right", "alphabetic", weight, stroke);
      ty += rowGap;
    }

  }

  /**
   * The weapon card, pinned to the top-centre of the screen.
   *
   * Sits above the action rather than under it: the ammo strip at the bottom scales
   * its selected cell up during a swap, which used to cover the name and tagline for
   * exactly the second you most want to read them.
   */
  private drawWeaponBanner(ctx: Ctx, w: number, k: number, s: HudState, dt: number) {
    const a = s.weapon.ammo;
    if (a.id !== this.lastAmmoId) {
      this.lastAmmoId = a.id;
      this.swapPop = 1;
    }
    this.swapPop = Math.max(0, this.swapPop - dt * 1.6);

    const pop = this.swapPop;
    const cx = w / 2;
    const y = 20 * k;
    const bh = 62 * k;

    // The card is measured from the round it is describing, not assumed. Taglines run
    // from "Physics does the rest." to a full sentence, and a fixed 320px box ran the
    // long ones straight out the side of the panel.
    const glyphW = 34 * k;
    const padL = 16 * k;
    const gap = 10 * k;
    const rounds = s.weapon.rounds();
    const countW = rounds === Infinity
      ? measure(ctx, "∞", 22 * k, 900)
      : Math.max(measure(ctx, `${rounds}`, 20 * k, 900), measure(ctx, "LEFT", 9 * k, 800));
    const padR = 14 * k + countW + 14 * k;

    const nameW = measure(ctx, a.name.toUpperCase(), 18 * k, 900);
    // The tagline is the part that overflows, so it is the part allowed to shrink.
    let tagSize = 12 * k;
    const budget = w - 32 * k - (padL + glyphW + gap + padR);
    while (tagSize > 8.5 * k && measure(ctx, a.tagline, tagSize, 700) > budget) tagSize -= 0.5 * k;

    const textW = Math.max(nameW, measure(ctx, a.tagline, tagSize, 700));
    const bw = Math.min(w - 32 * k, Math.max(320 * k, padL + glyphW + gap + textW + padR));
    const x = cx - bw / 2;

    ctx.save();
    // A gentle drop-in on swap, so the change is legible without being a cutscene.
    ctx.translate(cx, y);
    const scale = 1 + pop * pop * 0.06;
    ctx.scale(scale, scale);
    ctx.translate(-cx, -y - pop * pop * 6 * k);

    // On a swap the ink edge is replaced by the round's own colour, which is a louder
    // signal than the old widening hairline and costs nothing: the border is already
    // being drawn, so the change is which colour it is, not how thick.
    notchedPanel(ctx, x, y, bw, bh, k, PANEL_DIM,
      pop > 0.02 ? rgba(a.tint, 0.35 + pop * 0.65) : undefined, 0.84 + pop * 0.16);

    // Accent bar in the round's own colour, so the card is identifiable at a glance.
    ctx.fillStyle = a.tint;
    ctx.fillRect(x + 6 * k, y + 10 * k, 4 * k, bh - 20 * k);

    const glyph = iconBitmap(a.id);
    ctx.drawImage(glyph, x + padL, y + bh / 2 - glyphW / 2, glyphW, glyphW);

    const tx = x + padL + glyphW + gap;
    text(ctx, a.name.toUpperCase(), tx, y + 26 * k, 18 * k, CREAM, "left", "middle", 900, "rgba(0,0,0,0.6)");
    text(ctx, a.tagline, tx, y + 44 * k, tagSize, "rgba(244,241,232,0.62)", "left", "middle", 700);

    if (rounds !== Infinity) {
      text(ctx, `${rounds}`, x + bw - 14 * k, y + 28 * k, 20 * k, rounds > 0 ? GOLD : "#e8433a", "right", "middle", 900);
      text(ctx, "LEFT", x + bw - 14 * k, y + 44 * k, 9 * k, "rgba(244,241,232,0.45)", "right", "middle", 800);
    } else {
      text(ctx, "∞", x + bw - 14 * k, y + 30 * k, 22 * k, "rgba(244,241,232,0.45)", "right", "middle", 900);
    }
    ctx.restore();
  }

  /**
   * Bottom strip: every round, current one lifted and lit, on a backing plate.
   *
   * The plate is the fix for the one thing that was actually broken here — the strip
   * used to be drawn straight onto the world, and over the Test Range's pale ground
   * or a Mars sky the dark cells and their dark glyphs disappeared entirely. It also
   * gives the strip a hard edge to fade against, so a long arsenal scrolls out of
   * frame instead of being clipped mid-glyph, and a boundary the on-screen swap
   * buttons can be kept clear of.
   */
  private drawAmmoBar(
    ctx: Ctx, w: number, h: number, k: number, s: HudState, dt: number,
    narrow: boolean, touch: boolean,
  ) {
    const list = s.weapon.list;
    const cell = (narrow ? 46 : 56) * k;
    const gap = (narrow ? 6 : 8) * k;
    const n = list.length;

    // Room reserved on the right for the on-screen swap buttons, and the plate shifted
    // left by half of it so the strip stays optically centred in what is left.
    const reserve = touch ? 156 * k : 0;
    const plateW = Math.min(w - 28 * k - reserve, n * (cell + gap) + gap + 26 * k);
    const plateH = cell * 1.24;
    const cx = (w - reserve) / 2;
    const baseY = h - plateH / 2 - (narrow ? 14 : 20) * k;
    const px0 = cx - plateW / 2;
    const py0 = baseY - plateH / 2;

    // The blurred drop shadow this used to carry was the last one in the game. An ink
    // edge does the same job — separating the strip from whatever it is over — without
    // the cost of a 14px blur redrawn every frame.
    notchedPanel(ctx, px0, py0, plateW, plateH, k, PANEL_DIM, undefined, 0.88);

    this.ammoScroll = damp(this.ammoScroll, s.weapon.index, 14, dt);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px0, py0, plateW, plateH);
    ctx.clip();

    for (let i = 0; i < n; i++) {
      const offset = i - this.ammoScroll;
      const cxi = cx + offset * (cell + gap);
      if (cxi < px0 - cell || cxi > px0 + plateW + cell) continue;

      const sel = 1 - clamp(Math.abs(offset), 0, 1);
      const size = cell * (0.7 + sel * 0.34);
      const py = baseY - sel * 4 * k;
      const def = list[i];

      ctx.save();
      ctx.globalAlpha = 0.4 + sel * 0.6;
      // The selected cell takes the round's colour as its edge; the rest stay ink. On
      // the old strip every cell had a pale hairline and the selected one was picked
      // out only by being fractionally brighter, which is not a difference you can see
      // at a glance mid-fight.
      notchedPanel(ctx, cxi - size / 2, py - size / 2, size, size, k,
        sel > 0.5 ? PANEL : PANEL_DIM, sel > 0.5 ? def.tint : undefined);

      const gs = size * 0.7;
      ctx.drawImage(iconBitmap(def.id), cxi - gs / 2, py - gs / 2, gs, gs);

      if (sel > 0.5) {
        const cd = s.weapon.cooldownFrac;
        if (cd > 0) {
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 3 * k;
          ctx.beginPath();
          ctx.arc(cxi, py, size * 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - cd));
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Fade the ends so a long arsenal reads as continuing rather than as clipped — but
    // in stepped bands, not a gradient, to stay inside the same rules as everything
    // else. Four bands is enough to read as a fade at this width.
    const bands = 4;
    const bandW = 7 * k;
    for (const side of [0, 1]) {
      for (let b = 0; b < bands; b++) {
        ctx.fillStyle = `rgba(10,12,18,${0.9 - b * 0.22})`;
        const bx = side
          ? px0 + plateW - (b + 1) * bandW
          : px0 + b * bandW;
        ctx.fillRect(bx, py0, bandW, plateH);
      }
    }
    ctx.restore();

    // On a phone the weapon banner is gone, so the plate carries the round's name.
    if (narrow) {
      text(ctx, s.weapon.ammo.name.toUpperCase(), cx, py0 - 10 * k, 12 * k, CREAM,
        "center", "middle", 900, "rgba(0,0,0,0.7)");
    } else if (!touch) {
      // The cells are not numbered, so the strip has to say how to walk it.
      // Layout-aware: on AZERTY the key we bind as `Digit1` is printed "&", and a
      // strip that insists on "1" sends that player hunting. See `core/keylabel`.
      const key = "rgba(244,241,232,0.42)";
      text(ctx, `${keyLabel("Digit1")} ‹`, px0 - 10 * k, baseY + 1 * k, 14 * k, key, "right", "middle", 900);
      text(ctx, `› ${keyLabel("Digit3")}`, px0 + plateW + 10 * k, baseY + 1 * k, 14 * k, key, "left", "middle", 900);
    }
  }

  /**
   * The combo counter — the loudest thing on the screen, by design.
   *
   * This is the only readout that says "that was better than the last one", and it is
   * the feeling the whole scoring loop is built to produce. It gets a ring that drains
   * rather than a bar off to one side, so the thing you are racing is the thing you
   * are looking at.
   */
  private drawCombo(ctx: Ctx, w: number, h: number, k: number, s: HudState, narrow: boolean) {
    if (s.combo < 2) return;
    const t = clamp(s.comboTimer, 0, 1);
    const pop = 1 + clamp(s.comboTimer - 0.85, 0, 0.15) * 3.2;
    const cx = narrow ? w / 2 : w - 138 * k;
    const cy = narrow ? h * 0.24 : h * 0.32;
    const r = (narrow ? 44 : 54) * k;

    // Drain ring.
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 5 * k;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    text(ctx, `x${s.combo}`, 0, -2 * k, (narrow ? 38 : 46) * k, GOLD, "center", "middle", 900, "rgba(0,0,0,0.75)");
    text(ctx, "CHAIN", 0, 24 * k, 11 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.75)");
    ctx.restore();
  }

  private drawDownBanner(ctx: Ctx, w: number, h: number, k: number, s: HudState) {
    ctx.fillStyle = "rgba(10,12,18,0.45)";
    ctx.fillRect(0, 0, w, h);
    text(ctx, "OOF", w / 2, h / 2 - 10 * k, 72 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.7)");
    text(ctx, `getting back up in ${Math.max(0, s.respawnIn).toFixed(1)}s`, w / 2, h / 2 + 44 * k, 16 * k, "rgba(244,241,232,0.7)", "center", "middle", 700);
  }

  private drawDebug(ctx: Ctx, w: number, h: number, k: number, s: HudState) {
    const lines = [
      `fps ${s.fps.toFixed(0)}`,
      `bodies ${s.bodies}`,
      `particles ${s.particles}`,
      `time ${s.time.toFixed(1)}s`,
    ];
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(10 * k, h - 96 * k, 130 * k, 84 * k);
    lines.forEach((l, i) => {
      text(ctx, l, 18 * k, h - 74 * k + i * 18 * k, 12 * k, "#8ef58e", "left", "alphabetic", 700);
    });
    void w;
  }

  /** Crosshair; drawn last so nothing covers it. */
  drawCrosshair(ctx: Ctx, x: number, y: number, k: number, tint: string, charging: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = tint;
    ctx.lineWidth = 2 * k;
    ctx.lineCap = "round";
    const gap = lerp(5, 12, charging) * k;
    const len = 8 * k;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate((i * TAU) / 4);
      ctx.beginPath();
      ctx.moveTo(gap, 0);
      ctx.lineTo(gap + len, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(0, 0, 1.6 * k, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- primitives

/**
 * A HUD status plate, in the same language as the menu. See `ui/chrome.ts`.
 *
 * The old one was a translucent `roundRect` with a hairline stroke, which is the exact
 * CSS-card look System 10 spent a whole pass removing from the front end — and it read
 * as a different game the moment you pressed PLAY. The panel keeps its transparency
 * because it sits over the thing the player is aiming at; it loses its corner radius
 * and its hairline, and gains an ink edge that holds up over a pale sky.
 */
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, k: number, alpha = 0.42) {
  notchedPanel(ctx, x, y, w, h, k, PANEL_DIM, undefined, alpha + 0.34);
}

/** The one font string every HUD label uses, so measuring and drawing always agree. */
const font = (size: number, weight: number) =>
  `${weight} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;

/** Width of a label in pixels. Panels size themselves off this rather than guessing. */
function measure(ctx: Ctx, str: string, size: number, weight: number) {
  ctx.font = font(size, weight);
  return ctx.measureText(str).width;
}

function text(
  ctx: Ctx, str: string, x: number, y: number, size: number, color: string,
  align: CanvasTextAlign = "left", baseline: CanvasTextBaseline = "alphabetic",
  weight = 700, stroke?: string,
) {
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = size * 0.2;
    ctx.lineJoin = "round";
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
