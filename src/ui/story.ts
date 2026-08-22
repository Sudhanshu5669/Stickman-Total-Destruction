import { clamp, TAU } from "../core/math";
import type { Ctx } from "../render/draw";
import { blitTiles, sheet } from "../render/sprites";

/**
 * The opening cutscene.
 *
 * A man whose entire job is knocking buildings down gets a stack of rebar dropped on
 * him, and is offered work by something that does not explain itself. That is the whole
 * premise, and it exists to do one mechanical thing: make the gun a *gift* rather than
 * a menu item. Everything the player is later handed — the jetpack at the end of the
 * first contract, every round after that — inherits its weight from this scene.
 *
 * ## Rules it follows
 *
 * **Skippable from the first frame.** A returning player must never be made to sit
 * through this, and a portal player who wants to shoot something should be allowed to.
 * The skip control is on screen the entire time and `progress.contract` means it is
 * only ever offered unprompted once.
 *
 * **Pictures first, words second.** Four of the twelve beats have no text at all — the
 * site, the impact, the dark, and waking up. The dialogue does not start until the
 * player has already seen what happened, so the words confirm rather than explain.
 *
 * **Nothing here blocks.** The scenes are drawn from the same tileset as the first
 * contract, and if a sheet has not decoded the scene degrades to its silhouettes rather
 * than to a blank screen.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const BG = `${PACK}/GandalfHardcore Background layers/Normal BG`;
const HOUSE = `${PACK}/House Tiles.png`;
const FLOOR = `${PACK}/Floor Tiles1.png`;
const FURNACE = `${PACK}/Pixel Art Furnace and Sawmill.png`;

/** Sheets the cutscene wants decoded. Folded into the first contract's asset list. */
export const STORY_ASSETS: readonly string[] = [
  HOUSE, FLOOR, FURNACE,
  ...[1, 2, 3, 4, 5].map((n) => `${BG}/GandalfHardcore Background layers_layer ${n}.png`),
];

type SceneId = "site" | "impact" | "black" | "void" | "gift";
type Speaker = "you" | "figure";

interface Beat {
  scene: SceneId;
  speaker?: Speaker;
  text?: string;
  /** Seconds a wordless beat sits on screen before moving itself along. */
  hold?: number;
}

/**
 * The script.
 *
 * Kept deliberately short. Every line here is a line a player has to read before they
 * are allowed to play, and the exchange only needs to establish three things: he
 * demolishes buildings, he died, and he took the job.
 */
const BEATS: Beat[] = [
  { scene: "site", hold: 2.6 },
  { scene: "site", speaker: "you", text: "Third one this week. Clear the floor, drop it inward, home by six." },
  { scene: "impact", hold: 1.7 },
  { scene: "black", hold: 1.9 },
  { scene: "void", hold: 1.6 },
  { scene: "void", speaker: "figure", text: "You weren't supposed to die today." },
  { scene: "void", speaker: "figure", text: "You have a great many buildings left standing." },
  { scene: "void", speaker: "figure", text: "So. Hell — for leaving the work unfinished. Or you demolish for me." },
  { scene: "void", speaker: "you", text: "Obviously. Who wants to go to hell?" },
  { scene: "void", speaker: "figure", text: "Good. Nothing that stands is doing more than borrowing the ground." },
  { scene: "gift", speaker: "figure", text: "You'll want this." },
  { scene: "gift", speaker: "figure", text: "One round, to start. Learn to throw before you learn to fly." },
];

/** Characters per second the dialogue reveals at. Fast enough not to be a wait. */
const CPS = 46;

const CREAM = "#f4f1e8";
const GOLD = "#ffd23f";

export class Story {
  private idx = 0;
  /** Seconds the current beat has been on screen. */
  private beatT = 0;
  private t = 0;
  /** 0..1 fade to black over the final beat, handed to the game to cross into the level. */
  private outro = 0;
  private finished = false;
  /** Screen rect of the skip control, rebuilt every draw. */
  private skipBox = { x: 0, y: 0, w: 0, h: 0 };

  get done() {
    return this.finished;
  }

  /** How far the closing fade has run, so the level can be revealed underneath it. */
  get fade() {
    return this.outro;
  }

  private get beat() {
    return BEATS[Math.min(this.idx, BEATS.length - 1)];
  }

  /** Characters of the current line that have been revealed. */
  private get shown() {
    const txt = this.beat.text;
    return txt ? Math.floor(this.beatT * CPS) : 0;
  }

  private get lineComplete() {
    const txt = this.beat.text;
    return !txt || this.shown >= txt.length;
  }

  /**
   * Advances the script.
   *
   * `advance` is any confirm input this frame. On a partially-revealed line it
   * completes the line rather than skipping it — the standard contract for typewriter
   * text, and the thing players reach for without being told.
   */
  update(dt: number, advance: boolean) {
    this.t += dt;
    this.beatT += dt;
    if (this.finished) {
      this.outro = Math.min(1, this.outro + dt * 2.2);
      return;
    }

    if (advance) {
      if (!this.lineComplete) {
        // Snap the reveal to the end of the line.
        this.beatT = (this.beat.text!.length + 1) / CPS;
        return;
      }
      this.next();
      return;
    }

    // Wordless beats keep themselves moving; spoken ones wait to be read.
    if (!this.beat.text && this.beatT >= (this.beat.hold ?? 1.5)) this.next();
  }

  private next() {
    this.idx++;
    this.beatT = 0;
    if (this.idx >= BEATS.length) this.finished = true;
  }

  /** Jumps straight to the fade. Wired to the skip control and to the pause key. */
  skip() {
    this.idx = BEATS.length;
    this.finished = true;
  }

  /** Screen-space hit test for the skip control. */
  hitSkip(mx: number, my: number) {
    const b = this.skipBox;
    return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: Ctx, w: number, h: number) {
    const k = clamp(Math.min(w / 1280, h / 760), 0.55, 1.3);
    const scene = this.beat.scene;

    switch (scene) {
      case "site": this.drawSite(ctx, w, h, k, 0); break;
      case "impact": this.drawSite(ctx, w, h, k, clamp(this.beatT / 0.85, 0, 1)); break;
      case "black": this.drawBlack(ctx, w, h); break;
      default: this.drawVoid(ctx, w, h, k, scene === "gift"); break;
    }

    if (!this.finished) {
      if (scene === "site" && this.idx === 0) this.drawCaption(ctx, w, h, k);
      this.drawDialogue(ctx, w, h, k);
      this.drawSkip(ctx, w, k);
    }

    if (this.outro > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.outro})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /**
   * The demolition site, and the moment it goes wrong.
   *
   * `flash` runs 0..1 across the impact beat and does three jobs at once: whites the
   * screen out, shakes the frame, and drops the rebar. One parameter rather than a
   * second scene, because the two beats are the same picture a second apart.
   */
  private drawSite(ctx: Ctx, w: number, h: number, k: number, flash: number) {
    const ground = h * 0.8;
    const ppm = h / 22;

    ctx.save();
    if (flash > 0) {
      // Camera kick, decaying — it settles as the white takes over.
      const s = (1 - flash) * 9 * k;
      ctx.translate(Math.sin(this.t * 61) * s, Math.cos(this.t * 47) * s * 0.6);
    }

    // Sky and the pack's own distance, same plates the contract itself uses.
    ctx.fillStyle = "#8ecdd8";
    ctx.fillRect(-40, -40, w + 80, h + 80);
    ctx.imageSmoothingEnabled = false;
    for (const [n, depth] of [[5, 34], [4, 15], [3, 15], [2, 15], [1, 15]] as const) {
      const s = sheet(`${BG}/GandalfHardcore Background layers_layer ${n}.png`);
      if (!s.ready) continue;
      const hpx = depth * ppm;
      const wpx = hpx * (s.w / s.h);
      const y = ground + ppm - hpx;
      for (let x = -40; x < w + 40; x += wpx) ctx.drawImage(s.img, x, y, wpx + 1, hpx);
    }

    // Ground.
    const floor = sheet(FLOOR);
    ctx.fillStyle = "#2b1f16";
    ctx.fillRect(-40, ground, w + 80, h - ground + 40);
    if (floor.ready) {
      ctx.save();
      ctx.translate(0, ground);
      ctx.scale(1, -1);
      for (let x = -1; x < w / ppm + 1; x++) {
        blitTiles(ctx, floor, 1, 0, 1, 1, x * ppm, 0, ppm);
        blitTiles(ctx, floor, 1, 1, 1, 1, x * ppm, -ppm, ppm);
      }
      ctx.restore();
    }

    // The mill: the tileset house, twice the usual size so it reads as industrial.
    const house = sheet(HOUSE);
    if (house.ready) {
      ctx.save();
      ctx.translate(0, ground);
      ctx.scale(1, -1);
      blitTiles(ctx, house, 1, 0, 5, 7, w * 0.52, 0, ppm * 1.35);
      ctx.restore();
    }
    // A furnace beside it, mid-burn, on the sheet's own six-frame loop.
    const furnace = sheet(FURNACE);
    if (furnace.ready) {
      ctx.save();
      ctx.translate(0, ground);
      ctx.scale(1, -1);
      const f = Math.floor(this.t * 8) % 6;
      blitTiles(ctx, furnace, f * 2, 0, 2, 2, w * 0.8, 0, ppm * 1.1);
      ctx.restore();
    }

    this.drawScaffold(ctx, w * 0.5, ground, ppm, k);

    // Our man, on the job, small against the building he is about to be killed by —
    // but not so small he has to be looked for. The hard hat is the only warm colour
    // on this side of the frame, which is what makes him the thing you find first.
    stick(ctx, w * 0.28, ground, ppm * 2.3, { hat: "hard", lean: 0.05 });

    // The rebar. Above frame until the impact beat, then straight down onto him.
    if (flash > 0) {
      const drop = flash * flash;
      ctx.strokeStyle = "#6a5b46";
      ctx.lineWidth = 3.4 * k;
      ctx.lineCap = "round";
      for (let i = 0; i < 9; i++) {
        const ox = (i - 4) * 11 * k;
        const y0 = -h * 0.5 + drop * (ground - h * 0.1) + i * 7 * k;
        ctx.save();
        ctx.translate(w * 0.3 + ox, y0);
        ctx.rotate(0.25 + i * 0.06 + drop * 1.1);
        ctx.beginPath();
        ctx.moveTo(0, -34 * k);
        ctx.lineTo(0, 34 * k);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.pow(flash, 2.4)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** Site hoarding and a lift tower — the visual shorthand for "this is a job". */
  private drawScaffold(ctx: Ctx, x: number, ground: number, ppm: number, k: number) {
    ctx.strokeStyle = "#5d6470";
    ctx.lineWidth = 2.6 * k;
    const top = ground - ppm * 7.4;
    for (const dx of [-ppm * 0.5, ppm * 0.5]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, ground);
      ctx.lineTo(x + dx, top);
      ctx.stroke();
    }
    for (let y = top; y < ground; y += ppm * 1.2) {
      ctx.beginPath();
      ctx.moveTo(x - ppm * 0.5, y);
      ctx.lineTo(x + ppm * 0.5, y);
      ctx.stroke();
    }
    // Hazard tape along the front.
    ctx.lineWidth = 4 * k;
    ctx.strokeStyle = "#e8b33a";
    ctx.beginPath();
    ctx.moveTo(x - ppm * 4, ground - ppm * 0.85);
    ctx.lineTo(x + ppm * 5.5, ground - ppm * 0.85);
    ctx.stroke();
  }

  private drawBlack(ctx: Ctx, w: number, h: number) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    // One slow pulse of almost nothing, so the beat does not read as a frozen frame.
    const p = 0.5 + 0.5 * Math.sin(this.beatT * 2.4);
    ctx.fillStyle = `rgba(60,20,20,${0.05 + p * 0.05})`;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Wherever this is. Deliberately drawn in nothing but light and silhouette — the one
   * place in the game with no tileset, no palette and no ground.
   */
  private drawVoid(ctx: Ctx, w: number, h: number, k: number, gift: boolean) {
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);

    // Both of them inside one pool of light, close enough to read as a conversation.
    // Staged wide apart the scene became two separate silhouettes in unrelated darkness.
    const cx = w * 0.5;
    const ground = h * 0.78;

    // A single cold shaft from above, which is all the staging this scene gets.
    const g = ctx.createRadialGradient(cx, ground - h * 0.32, 10, cx, ground - h * 0.32, h * 0.62);
    g.addColorStop(0, "rgba(120,150,190,0.30)");
    g.addColorStop(1, "rgba(120,150,190,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Floor that is not a floor: a reflection line, no texture.
    const fl = ctx.createLinearGradient(0, ground - 4, 0, ground + h * 0.12);
    fl.addColorStop(0, "rgba(140,170,210,0.16)");
    fl.addColorStop(1, "rgba(140,170,210,0)");
    ctx.fillStyle = fl;
    ctx.fillRect(0, ground - 4, w, h * 0.12 + 4);

    // Him: flat on his back for the first beat, upright after.
    //
    // Drawn a shade off black rather than in the game's usual ink. He is a black stick
    // figure in a black room, and the one place in the game where the silhouette that
    // normally guarantees he reads is the exact thing that would lose him.
    const risen = clamp((this.idx - 4) / 1.4, 0, 1);
    stick(ctx, w * 0.36, ground, h * 0.2, { down: 1 - risen, hat: "none", ink: "#1c2434" });

    // The figure. Tall, coated, brimmed, and never given a face.
    this.drawFigure(ctx, w * 0.63, ground, h * 0.34, k);

    if (gift) this.drawGift(ctx, w, ground, k);
  }

  private drawFigure(ctx: Ctx, x: number, ground: number, height: number, k: number) {
    const sway = Math.sin(this.t * 0.8) * 0.012;
    ctx.save();
    ctx.translate(x, ground);
    ctx.rotate(sway);

    const bodyW = height * 0.3;
    ctx.fillStyle = "#03040a";
    // Coat: a tall wedge that never quite meets the ground.
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.42, 0);
    ctx.lineTo(-bodyW * 0.5, -height * 0.62);
    ctx.lineTo(bodyW * 0.5, -height * 0.62);
    ctx.lineTo(bodyW * 0.42, 0);
    ctx.closePath();
    ctx.fill();
    // Shoulders and neck.
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.62, -height * 0.6);
    ctx.lineTo(bodyW * 0.62, -height * 0.6);
    ctx.lineTo(bodyW * 0.24, -height * 0.78);
    ctx.lineTo(-bodyW * 0.24, -height * 0.78);
    ctx.closePath();
    ctx.fill();
    // Head and a very wide brim.
    ctx.beginPath();
    ctx.arc(0, -height * 0.85, height * 0.075, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -height * 0.9, bodyW * 0.95, height * 0.028, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(-height * 0.055, -height * 0.99, height * 0.11, height * 0.1);

    // Two points of light where a face would be. The only warm thing in the scene.
    const glow = 0.55 + 0.45 * Math.sin(this.t * 1.7);
    ctx.fillStyle = `rgba(255,196,90,${0.55 + glow * 0.45})`;
    for (const dx of [-height * 0.028, height * 0.028]) {
      ctx.beginPath();
      ctx.arc(dx, -height * 0.862, height * 0.011, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    void k;
  }

  /** The gun, hanging in the light between them. */
  private drawGift(ctx: Ctx, w: number, ground: number, k: number) {
    const x = w * 0.5;
    const y = ground - 150 * k + Math.sin(this.t * 1.6) * 5 * k;
    const spin = 0.16 + Math.sin(this.t * 0.9) * 0.1;
    const halo = 0.5 + 0.5 * Math.sin(this.t * 2.6);

    const g = ctx.createRadialGradient(x, y, 4, x, y, 130 * k);
    g.addColorStop(0, `rgba(255,210,63,${0.30 + halo * 0.2})`);
    g.addColorStop(1, "rgba(255,210,63,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 130 * k, y - 130 * k, 260 * k, 260 * k);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-spin);
    const s = k * 1.5;
    // Receiver, barrel, hopper, grip — the gun's own silhouette, not a generic rifle.
    ctx.fillStyle = "#2b303c";
    ctx.beginPath();
    ctx.roundRect(-34 * s, -8 * s, 62 * s, 17 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "#3b4250";
    ctx.beginPath();
    ctx.roundRect(20 * s, -6 * s, 30 * s, 12 * s, 3 * s);
    ctx.fill();
    ctx.fillStyle = "#8f9aa8";
    ctx.beginPath();
    ctx.roundRect(-16 * s, -22 * s, 26 * s, 15 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = "#2b303c";
    ctx.beginPath();
    ctx.roundRect(-24 * s, 8 * s, 12 * s, 20 * s, 3 * s);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.fillRect(-30 * s, -4 * s, 8 * s, 9 * s);
    ctx.restore();
  }

  // ------------------------------------------------------------------ overlay

  private drawCaption(ctx: Ctx, w: number, h: number, k: number) {
    const a = clamp(this.beatT / 0.5, 0, 1) * clamp((2.6 - this.beatT) / 0.5, 0, 1);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    label(ctx, "RIVERSIDE MILL · CONTRACT #4471", w / 2, h * 0.16, 22 * k, CREAM, 900, 0.16);
    label(ctx, "SCHEDULED DEMOLITION", w / 2, h * 0.16 + 26 * k, 12 * k, "rgba(244,241,232,0.6)", 800, 0.3);
    ctx.globalAlpha = 1;
  }

  /**
   * The dialogue plate.
   *
   * Anchored to the bottom of the screen at a fixed height rather than growing with the
   * line, so the picture above it never jumps between beats.
   */
  private drawDialogue(ctx: Ctx, w: number, h: number, k: number) {
    const beat = this.beat;
    if (!beat.text) return;

    const plateH = 96 * k;
    const y = h - plateH - 26 * k;
    const x = Math.max(24 * k, w / 2 - 430 * k);
    const pw = Math.min(w - x * 2, 860 * k);

    ctx.fillStyle = "rgba(8,10,16,0.86)";
    roundRect(ctx, x, y, pw, plateH, 12 * k);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();

    const you = beat.speaker === "you";
    ctx.fillStyle = you ? GOLD : "#8fa7d8";
    ctx.fillRect(x, y + 14 * k, 3 * k, plateH - 28 * k);
    label(ctx, you ? "YOU" : "???", x + 18 * k, y + 24 * k,
      12 * k, you ? GOLD : "#8fa7d8", 900, 0.22, "left");

    const line = beat.text.slice(0, this.shown);
    wrap(ctx, line, x + 18 * k, y + 50 * k, pw - 36 * k, 17 * k, 22 * k, CREAM);

    // Advance prompt, only once there is nothing left to reveal.
    if (this.lineComplete) {
      const p = 0.4 + 0.6 * Math.abs(Math.sin(this.t * 3));
      label(ctx, "CLICK  ·  SPACE", x + pw - 18 * k, y + plateH - 16 * k,
        10 * k, `rgba(244,241,232,${0.25 + p * 0.35})`, 800, 0.24, "right");
    }
  }

  private drawSkip(ctx: Ctx, w: number, k: number) {
    const bw = 96 * k;
    const bh = 30 * k;
    const x = w - bw - 20 * k;
    const y = 20 * k;
    this.skipBox = { x, y, w: bw, h: bh };
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, x, y, bw, bh, 7 * k);
    ctx.fill();
    label(ctx, "SKIP ▸", x + bw / 2, y + bh / 2, 11 * k, "rgba(244,241,232,0.6)", 900, 0.16);
  }
}

// ---------------------------------------------------------------------------
// drawing helpers — local, because the cutscene is the only screen that needs them
// ---------------------------------------------------------------------------

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function label(
  ctx: Ctx, str: string, x: number, y: number, size: number,
  color: string, weight: number, tracking: number, align: CanvasTextAlign = "center",
) {
  ctx.font = `${weight} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  // Canvas2D has no letter-spacing everywhere, so tracked text is laid out by hand.
  const gap = size * tracking;
  const chars = [...str];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width + gap;
  total -= gap;
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + gap;
  }
}

function wrap(
  ctx: Ctx, str: string, x: number, y: number, maxW: number,
  size: number, lineH: number, color: string,
) {
  ctx.font = `700 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  let line = "";
  let ly = y;
  for (const word of str.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, ly);
      ly += lineH;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, ly);
}

/**
 * The protagonist, in screen space.
 *
 * Drawn here rather than borrowed from the ragdoll renderer because the cutscene has no
 * physics to pose one with, and because it needs poses — flat on his back, sitting up —
 * that the in-game biped has no concept of.
 */
function stick(
  ctx: Ctx, x: number, ground: number, h: number,
  o: { down?: number; hat?: "hard" | "none"; lean?: number; ink?: string } = {},
) {
  const down = clamp(o.down ?? 0, 0, 1);
  ctx.save();
  ctx.translate(x, ground);
  // Rotating the whole figure onto its back is what "unconscious" is here.
  ctx.rotate(down * -1.42);
  ctx.rotate(o.lean ?? 0);
  ctx.translate(0, -h * 0.02 * (1 - down));

  const ink = o.ink ?? "#0d1017";
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = h * 0.075;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const hip = -h * 0.46;
  const sh = -h * 0.78;
  ctx.beginPath();
  // Legs run from two feet on the ground up to one hip, not from one point on the
  // ground up to two hips — which is the same four numbers arranged into a wishbone.
  ctx.moveTo(-h * 0.13, 0);
  ctx.lineTo(0, hip);
  ctx.moveTo(h * 0.15, 0);
  ctx.lineTo(0, hip);
  ctx.moveTo(0, hip);
  ctx.lineTo(0, sh);
  ctx.moveTo(0, sh);
  ctx.lineTo(-h * 0.17, sh + h * 0.22);
  ctx.moveTo(0, sh);
  ctx.lineTo(h * 0.19, sh + h * 0.2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, sh - h * 0.11, h * 0.1, 0, TAU);
  ctx.fill();

  if (o.hat === "hard") {
    ctx.fillStyle = "#e8b33a";
    ctx.beginPath();
    ctx.arc(0, sh - h * 0.13, h * 0.115, Math.PI, TAU);
    ctx.fill();
    ctx.fillRect(-h * 0.16, sh - h * 0.14, h * 0.32, h * 0.028);
  }
  ctx.restore();
}
