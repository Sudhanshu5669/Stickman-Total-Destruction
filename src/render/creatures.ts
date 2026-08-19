import type { Bone, Ragdoll } from "../entities/ragdoll";
import { TAU } from "../core/math";
import { at, disc, polyPath, rgba, shade, type Ctx } from "./draw";

export interface SkinStyle {
  /** Limb/torso stroke colour. */
  ink: string;
  /** Head fill; limbs inherit `ink`. */
  fill?: string;
  accent?: string;
  /** Thickness multiplier — bump it for beefy enemies. */
  weight?: number;
  outline?: string;
}

const DEFAULT: Required<SkinStyle> = {
  ink: "#1b1e26",
  fill: "#1b1e26",
  accent: "#ffd23f",
  weight: 1,
  outline: "rgba(0,0,0,0.35)",
};

/** Draws one bone as a thick capsule stroke from end to end of its local Y axis. */
function limb(ctx: Ctx, b: Bone | undefined, color: string, weight: number, gore = "#7d0e1c") {
  if (!b) return;
  const t = b.body.translation();
  const r = b.body.rotation();
  at(ctx, t.x, t.y, r, () => {
    const half = b.shape === "ball" ? 0 : b.hh - (b.shape === "capsule" ? b.hw : 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = b.thick * weight;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.stroke();
    // Torn end. A bone is jointed to its parent at its proximal (+Y) end, so that is
    // where the cut is; the wet stump is what sells the limb as *torn off* rather
    // than merely detached.
    if (b.severed) {
      ctx.fillStyle = gore;
      ctx.beginPath();
      ctx.arc(0, half, b.thick * weight * 0.56, 0, TAU);
      ctx.fill();
    }
  });
}

/**
 * Stick-figure renderer driven straight off the simulated bones, so what you see is
 * exactly what the physics is doing — the flop is never faked.
 */
/** Flash-frozen bodies are rendered in rime instead of their own colours. */
const FROST: SkinStyle = { ink: "#9fd8f0", fill: "#d6f2ff", accent: "#ffffff", outline: "rgba(80,140,180,0.6)" };

export function drawBiped(ctx: Ctx, r: Ragdoll, style: SkinStyle = DEFAULT) {
  const s = { ...DEFAULT, ...style, ...(r.frozen ? FROST : {}) };
  const w = s.weight;
  const lite = r.has("armBack");

  // Charring darkens the whole figure while it is alight, so a burning stickman
  // reads as a silhouette in a fire rather than an unchanged one standing in it.
  if (r.burning > 0.01) {
    const c = shade(s.ink, -0.45 * r.burning);
    s.ink = c;
    s.fill = shade(s.fill, -0.45 * r.burning);
  }

  // Back-facing limbs used to be drawn lighter for depth; the figure now reads as one
  // solid silhouette, so every bone shares the body colour.
  const back = s.ink;
  if (lite) {
    limb(ctx, r.bones.get("legBack"), back, w);
    limb(ctx, r.bones.get("armBack"), back, w);
  } else {
    limb(ctx, r.bones.get("thighBack"), back, w);
    limb(ctx, r.bones.get("shinBack"), back, w);
    limb(ctx, r.bones.get("footBack"), back, w * 0.95);
    limb(ctx, r.bones.get("armBackUp"), back, w);
    limb(ctx, r.bones.get("armBackLo"), back, w);
  }

  limb(ctx, r.bones.get("pelvis"), s.ink, w);
  limb(ctx, r.bones.get("torso"), s.ink, w);

  if (lite) {
    limb(ctx, r.bones.get("legFront"), s.ink, w);
    limb(ctx, r.bones.get("armFront"), s.ink, w);
  } else {
    limb(ctx, r.bones.get("thighFront"), s.ink, w);
    limb(ctx, r.bones.get("shinFront"), s.ink, w);
    limb(ctx, r.bones.get("footFront"), s.ink, w * 0.95);
    limb(ctx, r.bones.get("armFrontUp"), s.ink, w);
    limb(ctx, r.bones.get("armFrontLo"), s.ink, w);
  }

  drawHead(ctx, r, s);
}

function drawHead(ctx: Ctx, r: Ragdoll, s: Required<SkinStyle>) {
  const head = r.bones.get("head");
  if (!head) return;
  const t = head.body.translation();
  const rot = head.body.rotation();
  const rad = head.hw;

  at(ctx, t.x, t.y, rot, () => {
    disc(ctx, 0, 0, rad, s.fill, s.outline, rad * 0.1);
    // Ragged neck on a head that has come off, drawn under the face.
    if (head.severed) {
      ctx.fillStyle = "#7d0e1c";
      ctx.beginPath();
      ctx.arc(0, -rad * 0.82, rad * 0.42, 0, TAU);
      ctx.fill();
    }

    const eyeY = rad * 0.16;
    const eyeX = rad * 0.34;
    ctx.lineCap = "round";
    if (r.dead) {
      // X eyes: the single clearest "this one is done" signal at any zoom.
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = rad * 0.14;
      for (const sx of [-1, 1]) {
        const cx = sx * eyeX;
        ctx.beginPath();
        ctx.moveTo(cx - rad * 0.13, eyeY - rad * 0.13);
        ctx.lineTo(cx + rad * 0.13, eyeY + rad * 0.13);
        ctx.moveTo(cx + rad * 0.13, eyeY - rad * 0.13);
        ctx.lineTo(cx - rad * 0.13, eyeY + rad * 0.13);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "#fff";
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(sx * eyeX, eyeY, rad * 0.17, rad * 0.21, 0, 0, TAU);
        ctx.fill();
      }
      // Panic face once hurt: wide mouth, tiny pupils.
      const panicked = r.hp < r.maxHp * 0.55;
      ctx.fillStyle = "#111";
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * eyeX, eyeY, rad * (panicked ? 0.07 : 0.1), 0, TAU);
        ctx.fill();
      }
      if (panicked) {
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.ellipse(0, -rad * 0.38, rad * 0.2, rad * 0.26, 0, 0, TAU);
        ctx.fill();
      }
    }
  });
}

/** Elephant. */
export function drawQuadruped(
  ctx: Ctx,
  r: Ragdoll,
  opts: { body: string; dark: string },
) {
  const legs = ["legBL", "legBR", "legFL", "legFR"];
  for (const n of legs.slice(0, 2)) limb(ctx, r.bones.get(n), opts.dark, 1);
  limb(ctx, r.bones.get("tail"), opts.dark, 1);

  const body = r.bones.get("body");
  if (body) {
    const t = body.body.translation();
    at(ctx, t.x, t.y, body.body.rotation(), () => {
      ctx.beginPath();
      ctx.ellipse(0, 0, body.hw * 1.04, body.hh * 1.05, 0, 0, TAU);
      ctx.fillStyle = opts.body;
      ctx.fill();
      ctx.strokeStyle = rgba("#000000", 0.35);
      ctx.lineWidth = 0.05;
      ctx.stroke();

      ctx.fillStyle = rgba("#000000", 0.12);
      ctx.beginPath();
      ctx.ellipse(-body.hw * 0.5, 0, body.hw * 0.42, body.hh * 0.75, 0, 0, TAU);
      ctx.fill();
    });
  }

  for (const n of legs.slice(2)) limb(ctx, r.bones.get(n), opts.body, 1);

  const head = r.bones.get("head");
  if (head) {
    const t = head.body.translation();
    at(ctx, t.x, t.y, head.body.rotation(), () => {
      ctx.beginPath();
      ctx.ellipse(0, 0, head.hw * 1.02, head.hh * 1.02, 0, 0, TAU);
      ctx.fillStyle = opts.body;
      ctx.fill();
      ctx.strokeStyle = rgba("#000000", 0.35);
      ctx.lineWidth = 0.05;
      ctx.stroke();

      // Ear: a big flapping fan is the whole read at a glance.
      ctx.fillStyle = shade(opts.body, -0.12);
      ctx.beginPath();
      ctx.ellipse(-head.hw * 0.45, head.hh * 0.1, head.hw * 0.72, head.hh * 0.95, -0.25, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba("#000000", 0.25);
      ctx.lineWidth = 0.04;
      ctx.stroke();
      // Tusks.
      ctx.strokeStyle = "#f4efe2";
      ctx.lineWidth = head.hw * 0.16;
      ctx.lineCap = "round";
      for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(head.hw * 0.5, -head.hh * 0.15 + sy * head.hh * 0.16);
        ctx.lineTo(head.hw * 1.05, -head.hh * 0.55 + sy * head.hh * 0.12);
        ctx.stroke();
      }

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(head.hw * 0.28, head.hh * 0.28, head.hw * 0.15, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(head.hw * 0.31, head.hh * 0.28, head.hw * 0.08, 0, TAU);
      ctx.fill();
    });
  }

  limb(ctx, r.bones.get("trunk"), opts.body, 1);
}

export function drawChicken(ctx: Ctx, r: Ragdoll) {
  limb(ctx, r.bones.get("legL"), "#f0a63c", 1);
  limb(ctx, r.bones.get("legR"), "#f0a63c", 1);

  const body = r.bones.get("body");
  if (body) {
    const t = body.body.translation();
    at(ctx, t.x, t.y, body.body.rotation(), () => {
      ctx.beginPath();
      ctx.ellipse(0, 0, body.hw * 1.15, body.hh * 1.05, 0, 0, TAU);
      ctx.fillStyle = "#fdfbf2";
      ctx.fill();
      ctx.strokeStyle = rgba("#000000", 0.3);
      ctx.lineWidth = 0.03;
      ctx.stroke();
      // Tail feathers.
      ctx.strokeStyle = "#e6ddc6";
      ctx.lineWidth = 0.05;
      ctx.lineCap = "round";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-body.hw * 0.7, 0);
        ctx.lineTo(-body.hw * 1.6, body.hh * 0.6 + i * 0.09);
        ctx.stroke();
      }
    });
  }

  limb(ctx, r.bones.get("wing"), "#efe7d2", 1);

  const head = r.bones.get("head");
  if (head) {
    const t = head.body.translation();
    at(ctx, t.x, t.y, head.body.rotation(), () => {
      disc(ctx, 0, 0, head.hw, "#fdfbf2", rgba("#000000", 0.3), 0.03);
      // Comb.
      ctx.fillStyle = "#e0402f";
      polyPath(ctx, [
        [-head.hw * 0.3, head.hw * 0.7], [-head.hw * 0.05, head.hw * 1.25],
        [head.hw * 0.1, head.hw * 0.75], [head.hw * 0.35, head.hw * 1.15],
        [head.hw * 0.45, head.hw * 0.55],
      ]);
      ctx.fill();
      // Beak.
      ctx.fillStyle = "#f0a63c";
      polyPath(ctx, [[head.hw * 0.6, 0.02], [head.hw * 1.5, -0.03], [head.hw * 0.6, -0.09]]);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(head.hw * 0.3, head.hw * 0.25, head.hw * 0.17, 0, TAU);
      ctx.fill();
    });
  }
}
