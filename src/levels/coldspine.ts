import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";
import { LANDMARK, SKY_ASSETS } from "./dressing";

/**
 * Coldspine — the winter fortress.
 *
 * Five lines of defence, each higher and harder than the last, climbing thirty metres
 * over three hundred to a citadel on the summit. The only arena in the set with a cold
 * palette and the only one arranged as *layers* rather than as a field, a hole, a chain
 * or a street.
 *
 * **The idea:** it is the one arena that rewards patience. The outer wall can be taken
 * apart from outside its garrison's range; the middle bailey cannot, because the towers
 * on the outer wall overlook it; the keep cannot be touched at all until the towers are
 * down. So the arena has a *correct order*, and finding it is the pleasure — without
 * ever telling anybody there is one, and without failing anyone who ignores it.
 *
 * **Why it keeps going past the keep:** because a fortress with one keep in it is a
 * building, and this is supposed to be a mountain with a garrison on it. Above the keep
 * the ground steps up twice more — onto the ridge, where the dead are kept and the
 * bell tower watches the whole approach, and then onto the summit, where the citadel
 * sits behind a curtain wall and a gate. Each terrace is a full arena's worth of fight
 * that the one below it hides completely, and the light gets thinner the whole way up.
 *
 * **Why snow:** five warm-to-neutral worlds in a row make a whole game feel like one
 * long level, and this is the antidote. It also does something mechanical — against
 * snow the black stickmen are the darkest thing in frame by a wide margin, so a
 * hundred-body brawl stays readable when the same brawl in the Quarry would not.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles2.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const DECOR = `${PACK}/Decor.png`;
const OTHER = `${PACK}/Other Tiles1.png`;
const WINTER = `${PACK}/GandalfHardcore Background layers/Winter BG`;

export const COLDSPINE_ASSETS: readonly string[] = [
  FLOOR, HOUSE, DECOR, OTHER, ...SKY_ASSETS,
  `${PACK}/Large Pine Tree.png`, `${PACK}/Pine Trees.png`, `${PACK}/Christmas tree.png`,
  `${PACK}/Torch.png`, `${PACK}/Angel Statue.png`,
  `${WINTER}/Background Castle  Winter.png`,
  ...[1, 2, 3, 4, 5].map((n) => `${WINTER}/GandalfHardcore Background layers_layer ${n}.png`),
];

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  const floor = b.sheet(FLOOR);
  const house = b.sheet(HOUSE);
  const decor = b.sheet(DECOR);
  const other = b.sheet(OTHER);

  // Three plateaus, rising. The height difference is the defence: each line looks down
  // on the one before it, which is what makes taking them out of order expensive.
  b.skinnedGround(-110, 10, G0, floor);
  b.skinnedGround(8, 56, G0 + 5, floor);
  b.skinnedGround(54, 130, G0 + 12, floor);
  b.skinnedGround(128, 202, G0 + 19, floor);
  b.skinnedGround(200, 306, G0 + 26, floor);

  const pine = (x: number, y: number, s = 1.2, z = 2) =>
    b.prop({ sheet: b.sheet(`${PACK}/Large Pine Tree.png`), tx: 0, ty: 0, tw: 4, th: 5.5,
             x, y, scale: s, z, sway: 0.008 });

  // A flat overcast, sunless. This is the one cold arena and the light has to say so.
  b.sky(-106, 304, G0 + 12, { heaviness: 0.75, sun: null });

  // Snow scrub, thinning as the ground rises — the approach is open country, the
  // bailey is a swept yard, and the bluff is bare rock above the treeline.
  b.dress(-96, 8, G0, { density: 0.6, salt: 1 });
  b.dress(8, 54, G0 + 5, { density: 0.34, salt: 2 });
  b.dress(54, 128, G0 + 12, { density: 0.26, salt: 3 });
  b.dress(128, 200, G0 + 19, { density: 0.2, salt: 6 });
  b.dress(200, 290, G0 + 26, { density: 0.14, salt: 7 });
  b.dress(-44, -30, G0, { kind: "camp", density: 0.6, pitch: 1.8, salt: 4 });
  // A graveyard outside the wall. Somebody has taken this fortress before.
  b.dress(-28, -21, G0, { kind: "graves", density: 0.85, pitch: 2.0, salt: 5 });

  // ---------------------------------------------------------------- the approach
  // Long, cold and empty, with the fortress visible the whole way. A player should be
  // able to plan this arena before they are in range of it.
  pine(-88, G0, 1.5);
  pine(-76, G0, 1.2, -2);
  pine(-62, G0, 1.4);
  pine(-54, G0, 1.1, -2);
  b.crowd(-80, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-70, G0, 6, 3);
  b.prop({ sheet: b.sheet(`${PACK}/Pine Trees.png`), tx: 0, ty: 0, tw: 6, th: 5,
           x: -66, y: G0, scale: 1.2, z: -3, sway: 0.006 });
  b.prop({ sheet: b.sheet(`${PACK}/Christmas tree.png`), tx: 0, ty: 0, tw: 3, th: 4, x: -46, y: G0, z: 2 });
  b.crowd(-40, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-34, G0, 6, 3);

  // ---------------------------------------------------------------- line 1: the wall
  // Reachable from outside the garrison's range — this is the layer you are *supposed*
  // to be able to take apart at leisure, and taking it apart is what teaches the shape
  // of the rest.
  b.wall(-16, G0, 4, 8, "brick");
  b.wall(-8, G0, 4, 8, "brick");
  b.block(-12, G0 + 8.4, 12, 0.8, "concrete");
  b.gunner("grunt", -16, G0 + 9, 1, { behavior: "sentry", gun: "rifle", range: 40 });
  b.gunner("grunt", -8, G0 + 9, 1, { behavior: "sentry", gun: "rifle", range: 40 });
  b.block(-12, G0 + 9.5, 3, 1.1, "concrete");
  b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2, x: -19, y: G0, z: 12, frames: 4, fps: 8 });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: -21, baseY: G0, material: "explosive" });
  b.gunner("guard", -2, G0, -1, { behavior: "patrol", patrol: 4, gun: "shotgun" });

  // ---------------------------------------------------------------- line 2: the bailey
  // On the middle plateau, overlooked by two towers. Rushing this without dealing with
  // the towers first is the mistake the arena is built to let you make.
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 14, baseY: G0 + 5, material: "brick" });
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 30, baseY: G0 + 5, material: "wood" });
  b.crowd(24, G0 + 5, ["guard", "grunt", "guard"], 2, { behavior: "hunter" });
  b.explosiveStack(21, G0 + 5, 5);
  b.explosiveStack(38, G0 + 5, 4);
  b.block(26, G0 + 5.55, 3.6, 1.1, "concrete");

  b.scaffold({
    x: 44, baseY: G0 + 5, floors: 5, width: 5, floorHeight: 3, material: "concrete",
    clad: { sheet: house, tx: 2, ty: 3 },
    guards: ["grunt", "guard"], guardEvery: 2,
    arms: { behavior: "sentry", gun: "sniper", range: 70, interval: 2.4 },
  });
  b.scaffold({
    x: 10, baseY: G0 + 5, floors: 4, width: 5, floorHeight: 3, material: "concrete",
    clad: { sheet: house, tx: 2, ty: 3 },
    guards: ["grunt"], guardEvery: 2,
    arms: { behavior: "sentry", gun: "rifle", range: 50 },
  });

  // Plank walkway between the two towers — the fast route across the bailey, and the
  // first thing a sensible player deletes.
  for (let i = 0; i < 16; i++) {
    b.spriteBlock({ sheet: other, tx: i % 4, ty: 6, x: 12 + i * 2, baseY: G0 + 17, material: "wood", anchored: true });
  }

  // ---------------------------------------------------------------- line 3: the keep
  // On the bluff, and the only structure in the arena that is genuinely thick. The
  // powder is inside it rather than beside it, so the keep has to be opened before it
  // can be blown — which is what makes reaching this point feel like arriving.
  b.spriteWall({ sheet: house, tx: 1, ty: 2, cols: 5, rows: 5, x: 66, baseY: G0 + 12, material: "concrete" });
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 66, baseY: G0 + 17, material: "brick" });
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 76, baseY: G0 + 12, material: "brick" });
  b.spriteWall({ sheet: house, tx: 8, ty: 2, cols: 5, rows: 5, x: 76, baseY: G0 + 19, material: "concrete" });
  b.explosiveStack(72, G0 + 12, 6);
  b.explosiveStack(73.6, G0 + 12, 6);

  b.gunner("guard", 62, G0 + 12, 1, { behavior: "patrol", patrol: 4, gun: "shotgun" });
  b.crowd(70, G0 + 12, ["guard", "guard"], 2.2, { behavior: "hunter" });
  b.gunner("guard", 69, G0 + 24, -1, { behavior: "sentry", gun: "sniper", range: 80, interval: 2.2 });
  b.enemy("boss", 84, G0 + 12, -1, { behavior: "hunter", gun: "shotgun" });

  b.prop({ sheet: b.sheet(`${PACK}/Angel Statue.png`), tx: 0, ty: 0, tw: 2, th: 4, x: 90, y: G0 + 12, z: 2 });
  b.landmark(LANDMARK.statue, 86, G0 + 12, { scale: 1.4, z: 4 });
  b.wall(98, G0 + 12, 4, 5, "gold", 0.7);
  b.crowd(94, G0 + 12, ["guard"], 2, { behavior: "sentry", gun: "rifle" });
  pine(108, G0 + 12, 1.3);
  pine(118, G0 + 12, 1.1, -2);

  // ---------------------------------------------------------------- line 4: the ridge
  // Above the treeline. Bare rock, a bell tower that can see the whole approach, and
  // the graves of the last garrison who tried this — the arena's one piece of scenery
  // that is an argument rather than a decoration.
  const R = G0 + 19;
  b.dress(134, 148, R, { kind: "graves", density: 0.85, pitch: 2.0, salt: 8 });
  b.prop({ sheet: b.sheet(`${PACK}/Angel Statue.png`), tx: 0, ty: 0, tw: 2, th: 4, x: 132, y: R, z: 2 });
  b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2, x: 150, y: R, z: 12, frames: 4, fps: 8 });
  b.gunner("guard", 142, R, 1, { behavior: "patrol", patrol: 6, gun: "shotgun" });
  b.block(148, R + 0.55, 3.6, 1.1, "concrete");

  // The chapel, and the bell tower over it. The tower is deliberately the only thing on
  // the ridge worth climbing, so a player with a pack has exactly one decision to make
  // here and it is a good one.
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 156, baseY: R, material: "wood" });
  b.explosiveStack(163, R, 5);
  b.crowd(160, R, ["grunt", "guard"], 2, { behavior: "hunter" });
  b.castleTower({
    x: 174, baseY: R, w: 6, height: 18, material: "concrete", roof: true,
    guards: ["guard", "guard"], clad: { sheet: house, tx: 2, ty: 3 },
  });
  b.gunner("guard", 168, R, -1, { behavior: "sentry", gun: "sniper", range: 90, interval: 2.2 });
  b.wall(184, R, 4, 6, "brick");
  b.block(184, R + 6.4, 6, 0.8, "concrete");
  b.gunner("grunt", 184, R + 7, -1, { behavior: "sentry", gun: "rifle", range: 55 });
  b.explosiveStack(190, R, 6);
  b.scatter(194, R, 7, 3.5);
  pine(196, R, 0.9, -2);

  // ---------------------------------------------------------------- line 5: the citadel
  // The summit. A gate, a curtain wall with the last of the garrison standing in the
  // crenellations, two keeps behind it and the heaviest thing in the arena in the yard
  // between them. Nothing here can be reached from the ridge without going through the
  // wall, which is the whole of the arena's argument stated once more at the top.
  const S = G0 + 26;
  b.gate(206, S, 5, 7, "concrete", { sheet: house, tx: 2, ty: 3 });
  b.battlement(220, S, 12, 6, "concrete", ["grunt", "guard", "grunt"],
               { sheet: house, tx: 2, ty: 3 });
  b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2, x: 201, y: S, z: 12, frames: 4, fps: 8 });
  b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2, x: 211, y: S, z: 12, frames: 4, fps: 8 });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: 214, baseY: S, material: "explosive" });

  const northKeep = b.castleTower({
    x: 240, baseY: S, w: 7, height: 20, material: "concrete", roof: true,
    guards: ["guard", "guard"], clad: { sheet: house, tx: 2, ty: 3 },
  });
  const southKeep = b.castleTower({
    x: 262, baseY: S, w: 6.5, height: 15, material: "brick", roof: true,
    guards: ["guard"], clad: { sheet: house, tx: 2, ty: 5 },
  });
  b.catwalk(243, 259, Math.min(northKeep, southKeep) + 0.6);
  b.gunner("grunt", 251, Math.min(northKeep, southKeep) + 1.2, -1,
           { behavior: "patrol", patrol: 5, gun: "smg" });

  b.crowd(232, S, ["guard", "guard", "grunt"], 2.1, { behavior: "hunter" });
  b.explosiveStack(248, S, 6);
  b.explosiveStack(249.6, S, 6);
  b.block(254, S + 0.55, 3.6, 1.1, "concrete");
  b.enemy("boss", 270, S, -1, { behavior: "hunter", gun: "shotgun" });
  b.gunner("guard", 276, S, -1, { behavior: "sentry", gun: "sniper", range: 90, interval: 2.1 });
  b.wall(284, S, 4, 5, "gold", 0.7);
  b.prop({ sheet: b.sheet(`${PACK}/Angel Statue.png`), tx: 0, ty: 0, tw: 2, th: 4, x: 289, y: S, z: 2 });
  b.landmark(LANDMARK.statue, 228, S, { scale: 1.4, z: 4 });

  return {
    spawn: v(-84, G0 + 1.2),
    bounds: { min: -92, max: 290 },
    enemies: b.enemies,
    groundY: G0,
    // The citadel's tall keep crowns out near 48 m. The roof clears it with room to
    // fight above it, which is the only way the summit is worth flying to.
    ceiling: 72,
  };
}

export const COLDSPINE: LevelDef = {
  id: "coldspine",
  name: "Coldspine",
  tagline: "Three walls. They only had to hold one.",
  theme: "winter",
  gravity: -26,
  tags: ["FORTRESS", "LAYERED", "SNOW"],
  accent: "#8fc6e8",
  assets: COLDSPINE_ASSETS,
  shape: "layered",
  build,
};
