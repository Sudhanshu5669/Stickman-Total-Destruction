import { iconBitmap } from "../render/props";
import { clamp, damp, lerp, TAU } from "../core/math";
import { rgba, type Ctx } from "../render/draw";
import type { Weapon } from "../weapons/weapon";

export interface HudState {
  hp: number;
  maxHp: number;
  /** Jetpack tank, 0..1. */
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
  /** 0..1, fades the intro control card out once the player starts playing. */
  hintAlpha: number;
  levelName: string;

  // ------------------------------------------------------------- run mode
  mode: "playground" | "campaign" | "endless";
  /** Campaign: knockouts left before the mission fails. */
  lives: number;
  /** Campaign: the mission's one-line brief, shown while the intro card is up. */
  briefing: string;
  /** Endless: metres travelled from the start. */
  distance: number;
  /** Endless: best distance this session. */
  bestDistance: number;
  /** Endless: enemies killed this run. */
  kills: number;
}

const INK = "#0e1017";
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

  draw(ctx: Ctx, w: number, h: number, s: HudState, dt: number) {
    const scale = clamp(Math.min(w, h) / 780, 0.62, 1.35);

    if (s.hp < this.lastHp) this.hurtPulse = 1;
    this.lastHp = s.hp;
    this.hurtPulse = Math.max(0, this.hurtPulse - dt * 2.2);

    if (!s.god && (this.hurtPulse > 0.01 || s.hp < s.maxHp * 0.3)) {
      this.drawDamageVignette(ctx, w, h, s);
    }

    this.drawTopLeft(ctx, scale, s);
    this.drawTopRight(ctx, w, scale, s);
    this.drawWeaponBanner(ctx, w, scale, s, dt);
    this.drawAmmoBar(ctx, w, h, scale, s, dt);
    this.drawCombo(ctx, w, h, scale, s);
    if (s.hintAlpha > 0.01) this.drawHints(ctx, w, h, scale, s);
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

  private drawTopLeft(ctx: Ctx, k: number, s: HudState) {
    const x = 22 * k;
    const y = 22 * k;
    const bw = 260 * k;
    const bh = 26 * k;

    const fuelH = 12 * k;
    panel(ctx, x - 8 * k, y - 8 * k, bw + 16 * k, bh + fuelH + 62 * k, k);

    // Health.
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, x, y, bw, bh, 6 * k);
    ctx.fill();
    const f = s.god ? 1 : clamp(s.hp / s.maxHp, 0, 1);
    // God mode pulses so it never reads as an ordinary full health bar.
    ctx.fillStyle = s.god
      ? `rgba(255,${200 + Math.round(Math.sin(s.time * 4) * 25)},63,1)`
      : f > 0.5 ? "#6ddc7a" : f > 0.25 ? GOLD : "#e8433a";
    roundRect(ctx, x + 2 * k, y + 2 * k, (bw - 4 * k) * f, bh - 4 * k, 5 * k);
    ctx.fill();

    text(ctx, s.god ? "∞" : `${Math.ceil(s.hp)}`, x + 10 * k, y + bh / 2, 14 * k, INK, "left", "middle", 900);
    text(ctx, s.god ? "GOD MODE" : "HP", x + bw - 10 * k, y + bh / 2, 12 * k, "rgba(0,0,0,0.5)", "right", "middle", 900);

    // Jetpack fuel, directly under health so the two read as one status block.
    const fy = y + bh + 5 * k;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, x, fy, bw, fuelH, 4 * k);
    ctx.fill();
    const fuel = clamp(s.fuel, 0, 1);
    // Glows hot while burning, dims to amber when nearly dry.
    ctx.fillStyle = s.jetThrottle > 0.05
      ? `rgba(255,${190 + Math.round(s.jetThrottle * 50)},120,1)`
      : fuel > 0.25 ? "#5ec8ff" : "#e8433a";
    roundRect(ctx, x + 2 * k, fy + 2 * k, (bw - 4 * k) * fuel, fuelH - 4 * k, 3 * k);
    ctx.fill();
    text(ctx, "JETPACK", x + bw - 8 * k, fy + fuelH / 2 + 0.5 * k, 8 * k, "rgba(0,0,0,0.55)", "right", "middle", 900);

    // Score, counting up so big hits feel like they land.
    const scoreY = fy + fuelH + 32 * k;
    text(ctx, s.displayScore.toLocaleString("en-US"), x, scoreY, 30 * k, CREAM, "left", "alphabetic", 900, "rgba(0,0,0,0.6)");
    text(ctx, "SCORE", x + 4 * k + ctx.measureText(s.displayScore.toLocaleString("en-US")).width, scoreY, 12 * k, "rgba(244,241,232,0.5)", "left", "alphabetic", 800);
  }

  /**
   * Mission readout. Each mode leads with the number that actually matters in it.
   *
   * The panel is measured from its own contents rather than assuming a width. Level
   * names, mode labels and the pip row all vary in length, and a fixed box either
   * clipped the longest of them or left a slab of empty panel next to the shortest.
   */
  private drawTopRight(ctx: Ctx, w: number, k: number, s: HudState) {
    const right = w - 14 * k;
    const y = 22 * k;
    const pad = 14 * k;
    const rowGap = 16 * k;

    // Each row: text, size, weight, colour, outline.
    const rows: [string, number, number, string, string?][] = [];
    if (s.mode === "endless") {
      rows.push([`${Math.floor(s.distance)}m`, 24 * k, 900, CREAM, "rgba(0,0,0,0.6)"]);
      rows.push([`BEST ${Math.floor(s.bestDistance)}m`, 11 * k, 800, "rgba(244,241,232,0.55)"]);
      rows.push([`${s.kills} DOWN · ${s.blocksDestroyed} SMASHED`, 11 * k, 800, "rgba(255,210,63,0.8)"]);
    } else {
      rows.push([`${s.enemiesTotal - s.enemiesLeft}/${s.enemiesTotal}`, 24 * k, 900, CREAM, "rgba(0,0,0,0.6)"]);
      rows.push([s.mode === "campaign" ? "HOSTILES DOWN" : "STICKMEN DOWN", 11 * k, 800, "rgba(244,241,232,0.55)"]);
      rows.push([`${s.blocksDestroyed} BLOCKS SMASHED`, 11 * k, 800, "rgba(255,210,63,0.8)"]);
    }
    rows.push([s.levelName.toUpperCase(), 10 * k, 800, "rgba(244,241,232,0.35)"]);

    const pipR = 5 * k;
    const pipStep = pipR * 2.8;
    // Five pips plus the LIVES label; the row is often the widest thing in the panel.
    const pipsW = s.mode === "campaign" ? 5 * pipStep + measure(ctx, "LIVES", 10 * k, 800) + 8 * k : 0;

    let content = pipsW;
    for (const [str, size, weight] of rows) content = Math.max(content, measure(ctx, str, size, weight));

    const bw = content + pad * 2;
    const bh = rows.length * rowGap + (s.mode === "campaign" ? 26 * k : 0) + 22 * k;
    const left = right - bw;
    panel(ctx, left, y - 8 * k, bw, bh, k);

    const tx = right - pad;
    // Baseline of the first row sits low enough for the 24px headline's cap height.
    let ty = y + 20 * k;
    for (const [str, size, weight, color, stroke] of rows) {
      text(ctx, str, tx, ty, size, color, "right", "alphabetic", weight, stroke);
      ty += rowGap;
    }

    // Lives, as pips under the readout. Campaign only — nothing else can be failed.
    if (s.mode === "campaign") {
      const py = ty + 2 * k;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i < s.lives ? "#e8433a" : "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.arc(tx - pipR - i * pipStep, py, pipR, 0, TAU);
        ctx.fill();
      }
      text(ctx, "LIVES", tx - 5 * pipStep - 6 * k, py + 3.5 * k, 10 * k, "rgba(244,241,232,0.45)", "right", "alphabetic", 800);
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

    ctx.fillStyle = `rgba(14,16,23,${0.5 + pop * 0.3})`;
    roundRect(ctx, x, y, bw, bh, 10 * k);
    ctx.fill();
    ctx.strokeStyle = pop > 0.02 ? rgba(a.tint, 0.35 + pop * 0.65) : "rgba(255,255,255,0.1)";
    ctx.lineWidth = (1 + pop * 2) * k;
    ctx.stroke();

    // Accent bar in the round's own colour, so the card is identifiable at a glance.
    ctx.fillStyle = a.tint;
    roundRect(ctx, x + 6 * k, y + 10 * k, 4 * k, bh - 20 * k, 2 * k);
    ctx.fill();

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

  /** Bottom strip: every round, current one lifted and lit. */
  private drawAmmoBar(ctx: Ctx, w: number, h: number, k: number, s: HudState, dt: number) {
    const list = s.weapon.list;
    const cell = 58 * k;
    const gap = 8 * k;
    const n = list.length;
    const cx = w / 2;
    const baseY = h - 74 * k;

    this.ammoScroll = damp(this.ammoScroll, s.weapon.index, 14, dt);

    for (let i = 0; i < n; i++) {
      const offset = i - this.ammoScroll;
      const px = cx + offset * (cell + gap);
      if (px < -cell || px > w + cell) continue;

      const sel = 1 - clamp(Math.abs(offset), 0, 1);
      const size = cell * (0.72 + sel * 0.42);
      const py = baseY - sel * 12 * k;
      const def = list[i];

      ctx.save();
      ctx.globalAlpha = 0.35 + sel * 0.65;
      ctx.fillStyle = sel > 0.5 ? "rgba(20,23,31,0.92)" : "rgba(20,23,31,0.6)";
      roundRect(ctx, px - size / 2, py - size / 2, size, size, 10 * k);
      ctx.fill();
      ctx.strokeStyle = sel > 0.5 ? def.tint : "rgba(255,255,255,0.16)";
      ctx.lineWidth = (1.5 + sel * 2) * k;
      ctx.stroke();

      const glyph = iconBitmap(def.id);
      const gs = size * 0.7;
      ctx.drawImage(glyph, px - gs / 2, py - gs / 2, gs, gs);

      if (sel > 0.5) {
        const cd = s.weapon.cooldownFrac;
        if (cd > 0) {
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 3 * k;
          ctx.beginPath();
          ctx.arc(px, py, size * 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - cd));
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // The cells are no longer numbered, so the strip has to say how to walk it.
    const edge = cell * 0.57 + 18 * k;
    const key = "rgba(244,241,232,0.5)";
    text(ctx, "1 ‹", cx - edge, baseY + 5 * k, 15 * k, key, "right", "middle", 900);
    text(ctx, "› 3", cx + edge, baseY + 5 * k, 15 * k, key, "left", "middle", 900);
  }

  private drawCombo(ctx: Ctx, w: number, h: number, k: number, s: HudState) {
    if (s.combo < 2) return;
    const t = clamp(s.comboTimer, 0, 1);
    const pop = 1 + clamp(s.comboTimer - 0.85, 0, 0.15) * 2.4;
    const y = h * 0.3;
    ctx.save();
    ctx.translate(w - 130 * k, y);
    ctx.scale(pop, pop);
    text(ctx, `x${s.combo}`, 0, 0, 46 * k, GOLD, "center", "middle", 900, "rgba(0,0,0,0.7)");
    text(ctx, "COMBO", 0, 26 * k, 12 * k, CREAM, "center", "middle", 900, "rgba(0,0,0,0.7)");
    ctx.restore();

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(ctx, w - 190 * k, y + 40 * k, 120 * k, 6 * k, 3 * k);
    ctx.fill();
    ctx.fillStyle = GOLD;
    roundRect(ctx, w - 190 * k, y + 40 * k, 120 * k * t, 6 * k, 3 * k);
    ctx.fill();
  }

  private drawHints(ctx: Ctx, w: number, h: number, k: number, s: HudState) {
    ctx.save();
    ctx.globalAlpha = s.hintAlpha;
    const lines = [
      ["A / D", "move"],
      ["SPACE", "jump · hold to fly"],
      ["MOUSE", "aim"],
      ["CLICK", "fire"],
      ["1 / 3 · Q E · WHEEL", "swap ammo"],
      ["R", "go limp"],
      ...(s.mode === "campaign" ? [] : [["G", "god mode"]]),
      ["F", "restart"],
      ["ESC", "pause / menu"],
    ];
    const bw = 250 * k;
    const bh = (lines.length * 22 + 44) * k;
    const x = w / 2 - bw / 2;
    const y = h / 2 - bh / 2 - 40 * k;
    panel(ctx, x, y, bw, bh, k, 0.72);
    text(ctx, "CONTROLS", x + bw / 2, y + 26 * k, 15 * k, GOLD, "center", "alphabetic", 900);
    if (s.briefing) {
      text(ctx, s.briefing, w / 2, y - 18 * k, 15 * k, CREAM, "center", "alphabetic", 800, "rgba(0,0,0,0.7)");
    }
    lines.forEach((l, i) => {
      const ly = y + 50 * k + i * 22 * k;
      text(ctx, l[0], x + 16 * k, ly, 13 * k, CREAM, "left", "alphabetic", 900);
      text(ctx, l[1], x + bw - 16 * k, ly, 13 * k, "rgba(244,241,232,0.6)", "right", "alphabetic", 700);
    });
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

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
}

function panel(ctx: Ctx, x: number, y: number, w: number, h: number, k: number, alpha = 0.42) {
  ctx.fillStyle = `rgba(14,16,23,${alpha})`;
  roundRect(ctx, x, y, w, h, 10 * k);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1 * k;
  ctx.stroke();
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
