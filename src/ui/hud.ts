import { AMMO } from "../weapons/ammo";
import { iconBitmap } from "../render/props";
import { clamp, damp, lerp, TAU } from "../core/math";
import type { Ctx } from "../render/draw";
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

  private drawTopRight(ctx: Ctx, w: number, k: number, s: HudState) {
    const x = w - 22 * k;
    const y = 22 * k;
    panel(ctx, x - 210 * k, y - 8 * k, 218 * k, 62 * k, k);

    text(ctx, `${s.enemiesTotal - s.enemiesLeft}/${s.enemiesTotal}`, x - 10 * k, y + 20 * k, 24 * k, CREAM, "right", "alphabetic", 900, "rgba(0,0,0,0.6)");
    text(ctx, "STICKMEN DOWN", x - 10 * k, y + 36 * k, 11 * k, "rgba(244,241,232,0.55)", "right", "alphabetic", 800);
    text(ctx, `${s.blocksDestroyed} BLOCKS SMASHED`, x - 10 * k, y + 52 * k, 11 * k, "rgba(255,210,63,0.8)", "right", "alphabetic", 800);
    text(ctx, s.levelName.toUpperCase(), x - 10 * k, y + 70 * k, 10 * k, "rgba(244,241,232,0.35)", "right", "alphabetic", 800);
  }

  /** Bottom strip: every round, current one lifted and lit. */
  private drawAmmoBar(ctx: Ctx, w: number, h: number, k: number, s: HudState, dt: number) {
    const cell = 58 * k;
    const gap = 8 * k;
    const n = AMMO.length;
    const cx = w / 2;
    const baseY = h - 74 * k;

    this.ammoScroll = damp(this.ammoScroll, s.weapon.index, 14, dt);

    const a = s.weapon.ammo;
    text(ctx, a.name.toUpperCase(), cx, h - 128 * k, 22 * k, CREAM, "center", "alphabetic", 900, "rgba(0,0,0,0.65)");
    text(ctx, a.tagline, cx, h - 110 * k, 12 * k, "rgba(244,241,232,0.6)", "center", "alphabetic", 700);

    const rounds = s.weapon.rounds();
    if (rounds !== Infinity) {
      text(ctx, `${rounds} LEFT`, cx, h - 146 * k, 13 * k, rounds > 0 ? GOLD : "#e8433a", "center", "alphabetic", 900, "rgba(0,0,0,0.65)");
    }

    for (let i = 0; i < n; i++) {
      const offset = i - this.ammoScroll;
      const px = cx + offset * (cell + gap);
      if (px < -cell || px > w + cell) continue;

      const sel = 1 - clamp(Math.abs(offset), 0, 1);
      const size = cell * (0.72 + sel * 0.42);
      const py = baseY - sel * 12 * k;
      const def = AMMO[i];

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

      if (i < 9) {
        text(ctx, `${i + 1}`, px, py + size / 2 + 13 * k, 10 * k, "rgba(244,241,232,0.45)", "center", "alphabetic", 800);
      }
    }
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
      ["1-9 / Q E / WHEEL", "swap ammo"],
      ["R", "go limp"],
      ["G", "god mode"],
      ["F", "restart"],
      ["ESC", "pause / menu"],
    ];
    const bw = 250 * k;
    const bh = (lines.length * 22 + 44) * k;
    const x = w / 2 - bw / 2;
    const y = h / 2 - bh / 2 - 40 * k;
    panel(ctx, x, y, bw, bh, k, 0.72);
    text(ctx, "CONTROLS", x + bw / 2, y + 26 * k, 15 * k, GOLD, "center", "alphabetic", 900);
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
    ctx.lineWidth = size * 0.2;
    ctx.lineJoin = "round";
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
