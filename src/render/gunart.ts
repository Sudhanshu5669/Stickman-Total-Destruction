/**
 * The arsenal, drawn as pixel art.
 *
 * The guns used to be assembled at runtime from rounded rectangles scaled by a `heft`
 * number, which meant every round shared one silhouette at twenty sizes. You could
 * not tell the chicken cannon from the nuke launcher without reading the HUD, and the
 * one object on screen the player looks at constantly was the least characterful thing
 * in the frame.
 *
 * ## Why this is code and not PNGs
 *
 * It is authored at the pixel level — every gun below is placed in a 64x24 grid, one
 * pixel at a time — but it lives in a source file so that a palette change propagates
 * across all of them, and so a gun can be recoloured per-round from `AmmoDef.tint`
 * without shipping twenty near-identical images. Rasterised once at boot into an
 * offscreen canvas each, then blitted; the per-frame cost is one `drawImage`.
 *
 * If hand-drawn sprites arrive later, `sprite()` is the only thing that has to change:
 * everything downstream already takes an `HTMLCanvasElement` and knows nothing about
 * where the pixels came from.
 *
 * ## The rules the art follows
 *
 * The six that every pixel sprite in the game obeys — silhouette first, one ink colour,
 * light from the top-left, three values per material, no outline on emissive things,
 * one pixel size everywhere — are stated once in `render/pixel.ts`, which is also where
 * the buffer and the material ramps live. The guns add one rule of their own:
 *
 * 7. **The accent is the payload.** Each gun carries a patch of its round's own tint,
 *    so the thing in your hands tells you what is about to come out of it — and the
 *    round it fires, drawn from the same ramps in `render/ammoart.ts`, matches it.
 */

import type { Ctx } from "./draw";
import { ART_PPM, INK, Px, RAMPS, shadeHex, type RampName } from "./pixel";
import { paintBalloon, partyRamp } from "./balloonart";

/** Source pixels per world metre. A 48-pixel gun is 1.5 m long. */
export const GUN_PPM = ART_PPM;

const W = 64;
const H = 24;

/** Vertical centre of the grid. Guns are drawn about this line and pivot on the grip. */
const MID = 12;

/**
 * Shared furniture, so every gun agrees about what a grip and a stock look like.
 * A set of weapons that share their fittings reads as an armoury; one where every
 * weapon invents its own reads as a pile of unrelated props.
 */
function grip(p: Px, x: number) {
  // Raked back a pixel per two rows. A vertical block reads as a peg; a raked one reads
  // as something a hand goes around, which at this size is the whole difference.
  for (let j = 0; j < 8; j++) {
    const dx = j >> 1;
    p.rect(x - dx, MID + 3 + j, 4, 1, RAMPS.gunmetal[1]);
    p.set(x - dx, MID + 3 + j, RAMPS.gunmetal[2]);
    p.set(x - dx + 3, MID + 3 + j, RAMPS.gunmetal[0]);
  }
  // Trigger guard: the loop is what makes a shape read as a gun rather than as a pipe.
  p.row(x + 4, MID + 3, 5, RAMPS.gunmetal[2]);
  p.row(x + 5, MID + 7, 4, RAMPS.gunmetal[1]);
  p.col(x + 8, MID + 3, 5, RAMPS.gunmetal[1]);
  p.rect(x + 5, MID + 4, 1, 2, RAMPS.brass[1]);   // trigger
}

function stock(p: Px, x: number, w: number, ramp: RampName = "wood") {
  p.tube(x, MID - 1, w, 6, ramp);
  p.rect(x, MID + 5, w - 2, 1, RAMPS[ramp][0]);
}

/**
 * A row of vents or cooling slots. Two pixels of dark with a lit pixel above reads as a
 * cut into the metal; without something like this a twenty-pixel barrel is a blank bar.
 */
function vents(p: Px, x: number, y: number, n: number, step: number, h: number) {
  for (let i = 0; i < n; i++) {
    p.col(x + i * step, y, h, RAMPS.gunmetal[0]);
    p.set(x + i * step, y - 1, RAMPS.steel[2]);
  }
}

/** A single raised bolt. Two pixels: one lit, one dark. */
function bolt(p: Px, x: number, y: number) {
  p.set(x, y, RAMPS.steel[2]);
  p.set(x, y + 1, RAMPS.steel[0]);
}

/** The band every barrel ends in, so the whole arsenal agrees what a muzzle looks like. */
function muzzleRing(p: Px, x: number, y: number, h: number) {
  p.col(x, y, h, RAMPS.steel[2]);
  p.col(x + 1, y, h, RAMPS.steel[0]);
}

/** A patch of the round's own colour, so the gun tells you what it fires. */
function accentPatch(p: Px, x: number, y: number, w: number, h: number, tint: string) {
  p.rect(x, y, w, h, tint);
  p.row(x, y, w, shadeHex(tint, 0.3));
}

type Draw = (p: Px, tint: string) => void;

/**
 * The arsenal. Each is a silhouette first — see rule 1 — and the comment on each says
 * what shape it is trying to be, because that is the part that has to survive being
 * forty pixels wide.
 */
const GUNS: Record<string, Draw> = {
  /** A wide-mouthed funnel on a stubby body. Reads as "things go in the top". */
  chicken: (p, tint) => {
    stock(p, 4, 12);
    grip(p, 16);
    p.tube(14, MID - 3, 22, 7, "steel");
    accentPatch(p, 18, MID - 1, 6, 3, tint);
    // The hopper, above the receiver.
    p.tube(20, MID - 8, 10, 5, "plastic");
    bolt(p, 21, MID - 7); bolt(p, 28, MID - 7);
    p.wedge(30, MID, 14, 8, 16, RAMPS.steel[1]);
    // Rim of the funnel, lit on the near edge.
    p.col(43, MID - 8, 17, RAMPS.steel[2]);
    p.col(44, MID - 8, 17, RAMPS.steel[0]);
  },

  /** Fat tube, four fins, open back. The only gun with a visible warhead. */
  rocket: (p, tint) => {
    grip(p, 14);
    p.tube(8, MID - 4, 34, 9, "gunmetal");
    // Blast cone at the rear — it is a launcher, not a rifle.
    p.wedge(4, MID, 6, 14, 9, RAMPS.gunmetal[0]);
    accentPatch(p, 20, MID - 2, 8, 5, tint);
    vents(p, 12, MID - 3, 4, 3, 7);
    p.tube(42, MID - 3, 10, 7, "steel");
    // Warhead nose.
    p.wedge(52, MID, 6, 7, 2, tint);
    // Sight.
    p.rect(26, MID - 8, 2, 4, RAMPS.steel[2]);
    p.set(27, MID - 8, RAMPS.steel[0]);
  },

  /** A flatbed crane arm. Nothing else in the set has a lattice. */
  car: (p, tint) => {
    stock(p, 2, 10);
    grip(p, 14);
    p.tube(10, MID - 2, 16, 6, "rust");
    accentPatch(p, 14, MID, 6, 3, tint);
    // Lattice jib: alternating uprights read as a truss at this size.
    p.tube(26, MID - 5, 30, 3, "steel");
    p.tube(26, MID + 3, 30, 3, "steel");
    for (let i = 0; i < 8; i++) p.col(28 + i * 3, MID - 3, 6, RAMPS.steel[0]);
    bolt(p, 12, MID - 1); bolt(p, 23, MID - 1);
    // Hook and pulley at the jib head.
    p.rect(54, MID - 9, 3, 5, RAMPS.brass[1]);
    p.set(55, MID - 9, RAMPS.brass[2]);
    p.col(55, MID - 4, 3, RAMPS.steel[2]);
  },

  /** Twin booms with a tail fin — an aircraft catapult. */
  plane: (p, tint) => {
    grip(p, 12);
    p.tube(6, MID - 2, 18, 6, "steel");
    accentPatch(p, 10, MID, 5, 3, tint);
    p.tube(24, MID - 6, 28, 3, "plastic");
    p.tube(24, MID + 4, 28, 3, "plastic");
    p.wedge(52, MID, 8, 12, 3, tint);
    p.rect(30, MID - 10, 2, 5, RAMPS.steel[2]);
  },

  /** A vast bell mouth. The widest silhouette in the game, because it fires an elephant. */
  elephant: (p, tint) => {
    stock(p, 2, 12, "wood");
    grip(p, 16);
    p.tube(12, MID - 5, 20, 11, "brass");
    accentPatch(p, 17, MID - 2, 8, 5, tint);
    p.wedge(32, MID, 20, 12, 22, RAMPS.brass[1]);
    // Bell rim: lit outer edge, dark inner, so the mouth reads as open.
    p.col(52, MID - 11, 22, RAMPS.brass[2]);
    p.col(51, MID - 10, 20, RAMPS.brass[0]);
    p.rect(24, MID - 9, 3, 4, RAMPS.gunmetal[2]);
    bolt(p, 14, MID - 4); bolt(p, 29, MID - 4);
  },

  /** A person-shaped hole in a frame. Unmistakably a launcher for people. */
  stickman: (p, tint) => {
    grip(p, 12);
    p.tube(6, MID - 3, 16, 7, "steel");
    accentPatch(p, 10, MID - 1, 5, 3, tint);
    // Open cradle: two rails and a back plate.
    p.tube(22, MID - 8, 30, 3, "gunmetal");
    p.tube(22, MID + 6, 30, 3, "gunmetal");
    p.col(50, MID - 6, 12, RAMPS.gunmetal[1]);
    // The occupant.
    p.rect(34, MID - 4, 2, 2, INK);
    p.col(35, MID - 2, 5, INK);
    p.row(33, MID - 1, 5, INK);
  },

  /** Squat block with a heavy dropped weight. Top-heavy on purpose. */
  anvil: (p, tint) => {
    stock(p, 2, 10);
    grip(p, 14);
    p.tube(10, MID - 2, 24, 7, "gunmetal");
    accentPatch(p, 15, MID, 6, 3, tint);
    // The anvil itself, carried on top.
    p.rect(24, MID - 9, 18, 5, RAMPS.steel[1]);
    p.row(24, MID - 9, 18, RAMPS.steel[2]);
    p.rect(28, MID - 4, 10, 2, RAMPS.steel[0]);
    p.tube(34, MID - 1, 14, 5, "steel");
  },

  /** A brass horn with keys. The only curved-and-fluted shape in the set. */
  piano: (p, tint) => {
    stock(p, 2, 12, "wood");
    grip(p, 16);
    p.tube(12, MID - 4, 20, 9, "wood");
    accentPatch(p, 16, MID - 1, 7, 3, tint);
    // Keyboard, along the top.
    p.rect(14, MID - 8, 18, 4, "#e8e4d8");
    for (let i = 0; i < 6; i++) p.rect(16 + i * 3, MID - 8, 1, 3, INK);
    p.wedge(32, MID, 18, 10, 18, RAMPS.brass[1]);
    p.col(50, MID - 9, 18, RAMPS.brass[2]);
  },

  /** A boxy white cabinet with a door seam. Reads as an appliance, not a weapon. */
  fridge: (p, tint) => {
    grip(p, 12);
    p.tube(6, MID - 3, 16, 7, "steel");
    accentPatch(p, 9, MID - 1, 5, 3, tint);
    p.rect(22, MID - 10, 26, 20, "#dfe4ea");
    p.row(22, MID - 10, 26, "#f2f5f8");
    p.row(22, MID + 9, 26, "#a8b0bb");
    p.col(36, MID - 10, 20, "#a8b0bb");
    p.rect(32, MID - 5, 2, 6, RAMPS.steel[0]);
    p.rect(38, MID - 5, 2, 6, RAMPS.steel[0]);
  },

  /** A short wide-bore mortar. Squat, front-heavy, three finger holes. */
  bowling: (p, tint) => {
    stock(p, 4, 10);
    grip(p, 16);
    p.tube(14, MID - 4, 18, 9, "plastic");
    accentPatch(p, 18, MID - 1, 6, 3, tint);
    p.tube(32, MID - 7, 20, 15, "gunmetal");
    muzzleRing(p, 51, MID - 7, 15);
    // Finger holes, so the payload is obvious.
    p.rect(38, MID - 4, 3, 3, INK);
    p.rect(44, MID - 4, 3, 3, INK);
    p.rect(41, MID + 1, 3, 3, INK);
  },

  /** A slim green tube with a leaf-shaped tip. */
  watermelon: (p, tint) => {
    stock(p, 2, 10);
    grip(p, 14);
    p.tube(10, MID - 3, 22, 7, "wood");
    accentPatch(p, 14, MID - 1, 6, 3, tint);
    p.tube(32, MID - 5, 18, 11, "steel");
    // Rind stripes at the muzzle.
    for (let i = 0; i < 4; i++) p.col(36 + i * 4, MID - 5, 11, shadeHex(tint, -0.3));
    muzzleRing(p, 49, MID - 5, 11);
  },

  /** A slot with teeth showing. The only gun where the payload is visible and sharp. */
  sawblade: (p, tint) => {
    grip(p, 12);
    p.tube(6, MID - 3, 22, 7, "gunmetal");
    accentPatch(p, 10, MID - 1, 6, 3, tint);
    // Blade housing, blade protruding above it.
    p.rect(26, MID - 4, 22, 9, RAMPS.steel[0]);
    p.tube(26, MID - 4, 22, 3, "steel");
    for (let i = 0; i < 9; i++) {
      p.col(28 + i * 2, MID - 9, 5, RAMPS.steel[2]);
      p.set(28 + i * 2, MID - 10, RAMPS.steel[2]);
    }
    p.rect(46, MID - 2, 6, 5, RAMPS.steel[1]);
  },

  /** A boxy launcher with a lit screen — the only gun that emits light. */
  tv: (p, tint) => {
    grip(p, 12);
    p.tube(6, MID - 3, 18, 7, "plastic");
    accentPatch(p, 9, MID - 1, 5, 3, tint);
    p.rect(24, MID - 9, 24, 18, RAMPS.plastic[0]);
    p.row(24, MID - 9, 24, RAMPS.plastic[2]);
    // Screen, glowing.
    p.rect(27, MID - 6, 18, 12, "#7fd4e8");
    p.rect(28, MID - 5, 8, 5, "#c9f0fa");
    p.rect(46, MID - 4, 3, 8, RAMPS.plastic[1]);
  },

  /** A drum-fed tube with a hazard band. */
  barrel: (p, tint) => {
    stock(p, 2, 10);
    grip(p, 14);
    p.tube(10, MID - 3, 20, 7, "rust");
    accentPatch(p, 14, MID - 1, 6, 3, tint);
    p.tube(30, MID - 6, 22, 13, "rust");
    bolt(p, 12, MID - 2);
    // Hoops, which is what makes a barrel a barrel.
    p.col(34, MID - 6, 13, RAMPS.rust[0]);
    p.col(41, MID - 6, 13, RAMPS.rust[0]);
    p.col(48, MID - 6, 13, RAMPS.rust[0]);
    p.rect(30, MID - 1, 22, 2, "#e8c53a");
  },

  /** Stubby, finned, hazard-striped. Short because it is not about range. */
  nuke: (p, tint) => {
    grip(p, 14);
    p.tube(8, MID - 5, 22, 11, "gunmetal");
    accentPatch(p, 13, MID - 2, 7, 5, tint);
    p.tube(30, MID - 8, 20, 17, "steel");
    // Hazard stripes.
    for (let i = 0; i < 5; i++) p.col(32 + i * 4, MID - 8, 17, "#e8c53a");
    // Fins, top and bottom.
    p.wedge(50, MID - 8, 6, 6, 2, RAMPS.steel[0]);
    p.wedge(50, MID + 8, 6, 6, 2, RAMPS.steel[0]);
    muzzleRing(p, 49, MID - 6, 13);
    vents(p, 11, MID - 5, 3, 4, 11);
  },

  /** Concentric rings around an empty middle. Nothing else has a hole in it. */
  blackhole: (p, tint) => {
    grip(p, 12);
    p.tube(6, MID - 3, 20, 7, "gunmetal");
    accentPatch(p, 10, MID - 1, 5, 3, tint);
    // Three emitter rings, thinning outward.
    for (const [x, h] of [[28, 18], [38, 14], [46, 10]] as const) {
      p.col(x, MID - (h >> 1), h, RAMPS.plastic[2]);
      p.col(x + 1, MID - (h >> 1), h, RAMPS.plastic[0]);
    }
    p.tube(29, MID - 2, 20, 4, "gunmetal");
    // The void itself.
    p.rect(50, MID - 4, 8, 8, INK);
    p.rect(52, MID - 2, 4, 4, tint);
  },

  /** A hose off a tank. Soft shapes, no muzzle brake. */
  water: (p, tint) => {
    // Tank first, grip clear of it — a grip buried under the reservoir is a gun with
    // no visible way to hold it, which every version of this before it was.
    p.rect(4, MID + 3, 15, 9, shadeHex(tint, -0.2));
    p.row(4, MID + 3, 15, tint);
    p.col(4, MID + 3, 9, shadeHex(tint, 0.25));
    p.tube(4, MID - 4, 20, 8, "plastic");
    grip(p, 24);
    p.tube(24, MID - 3, 18, 6, "steel");
    // Flared nozzle.
    p.wedge(42, MID, 12, 6, 14, RAMPS.steel[1]);
    p.col(54, MID - 7, 14, tint);
  },

  /** Twin tanks and a pilot light. Reads as dangerous to hold. */
  flamethrower: (p, tint) => {
    p.rect(4, MID + 3, 9, 10, RAMPS.rust[1]);
    p.rect(14, MID + 3, 9, 10, RAMPS.rust[1]);
    p.row(4, MID + 3, 9, RAMPS.rust[2]);
    p.row(14, MID + 3, 9, RAMPS.rust[2]);
    p.col(4, MID + 3, 10, RAMPS.rust[2]);
    p.col(14, MID + 3, 10, RAMPS.rust[2]);
    p.tube(4, MID - 4, 22, 8, "rust");
    grip(p, 26);
    p.tube(26, MID - 2, 22, 5, "gunmetal");
    p.wedge(48, MID, 7, 5, 10, RAMPS.gunmetal[2]);
    // Pilot flame.
    p.rect(56, MID - 3, 2, 6, tint);
    p.rect(58, MID - 1, 2, 2, "#fff2c2");
  },

  /**
   * A bell-mouthed mortar with a helium tank sitting on its back.
   *
   * Two features and nothing else, because the version before this one had five and
   * read as a grey ruler. The tank on top is the silhouette — no other gun in the
   * arsenal has anything above the barrel line — and the bell is the promise: a mouth
   * that wide is obviously not firing a bullet.
   *
   * Rule 7 is taken literally here. Every other gun wears a patch of its round's tint;
   * this one cannot, because its round is five colours at once, so the payload itself
   * sits in the mouth instead.
   */
  balloon: (p, tint) => {
    // Helium tank, valve forward, strapped over the receiver.
    p.tube(10, MID - 11, 21, 8, "steel", 2);
    p.col(10, MID - 11, 8, RAMPS.steel[2]);
    p.col(30, MID - 11, 8, RAMPS.steel[0]);
    accentPatch(p, 15, MID - 8, 9, 3, tint);
    p.rect(31, MID - 9, 3, 4, RAMPS.brass[1]);    // valve block
    p.row(31, MID - 9, 3, RAMPS.brass[2]);
    p.rect(26, MID - 12, 2, 2, RAMPS.brass[1]);   // pressure gauge
    // Feed line down into the breech, so the tank is plumbed rather than taped on.
    p.stroke(33, MID - 6, 36, MID - 2, RAMPS.gunmetal[1], 2);

    stock(p, 2, 9);
    grip(p, 19);
    p.tube(8, MID - 4, 30, 9, "gunmetal");
    bolt(p, 12, MID - 2);
    bolt(p, 34, MID - 2);

    // The bell. Flares hard over twelve pixels — a gentle taper reads as a blunderbuss,
    // a hard one reads as a thing that lobs something soft.
    p.cone(38, MID, 13, 11, 20, RAMPS.steel, 1);
    muzzleRing(p, 51, MID - 10, 20);
    // One balloon, filling the mouth and just clearing the rim.
    paintBalloon(p, 47, MID - 9, 5, 14, partyRamp(0));
  },

  /** A stubby tube with a fat round payload sitting in it. */
  grenade: (p, tint) => {
    stock(p, 2, 10);
    grip(p, 14);
    p.tube(10, MID - 3, 20, 7, "wood");
    accentPatch(p, 14, MID - 1, 6, 3, tint);
    p.tube(30, MID - 6, 16, 13, "gunmetal");
    muzzleRing(p, 45, MID - 6, 13);
    // Grenade in the mouth, pin uppermost.
    p.rect(36, MID - 4, 8, 9, shadeHex(tint, -0.15));
    p.row(36, MID - 4, 8, tint);
    p.rect(39, MID - 7, 2, 3, RAMPS.brass[2]);
  },
};

/** Rasterised guns, keyed by `${ammoId}`. Built on first use, never rebuilt. */
const cache = new Map<string, HTMLCanvasElement | null>();

/**
 * The sprite for an ammo id, or null when there is no art for it.
 *
 * Null is a supported answer, not a failure: `Weapon.draw` keeps a procedural fallback
 * so a round added without art still has something in the player's hands.
 */
export function gunSprite(id: string, tint: string): HTMLCanvasElement | null {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const draw = GUNS[id];
  if (!draw) {
    cache.set(id, null);
    return null;
  }
  const p = new Px(W, H);
  draw(p, tint);
  p.outline();
  const canvas = p.toCanvas();
  cache.set(id, canvas);
  return canvas;
}

/**
 * Blits a gun into the world, pivoted at the hand and Y-flip undone.
 *
 * The world transform ends in `scale(z, -z)` (see `Camera.apply`), so a naive
 * `drawImage` renders the gun upside down; the local flip here is the same trick
 * `render/sprites.ts` uses, kept separate because guns pivot on the grip rather than
 * standing on the ground.
 */
export function drawGunSprite(
  ctx: Ctx, sprite: HTMLCanvasElement, gripX: number, scale: number,
) {
  const w = W / GUN_PPM * scale;
  const h = H / GUN_PPM * scale;
  const x = -gripX / GUN_PPM * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, h / 2);
  ctx.scale(1, -1);
  ctx.drawImage(sprite, 0, 0, w, h);
  ctx.restore();
}

/** Where the muzzle sits, in metres from the grip, for flashes and smoke. */
export const MUZZLE_X = (scale: number) => (W - 6) / GUN_PPM * scale;
