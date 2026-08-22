import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * Long Meadow — the open valley.
 *
 * The wide one. A hundred and sixty metres of clear ground with the targets spread
 * across it, and nothing tall enough anywhere to stop a shot travelling.
 *
 * **The idea:** this is the artillery arena, and it exists because every other arena in
 * the set punishes a long shot. Ironhold is a wall, the Quarry is a hole, the Drift is
 * a series of narrow perches and Grid City is a corridor — in all four, the honest play
 * is to get close. Here the sightlines run the full length of the level, the wide camera
 * has something to show, and the correct answer to a fortified farmhouse three hundred
 * feet away is a piano fired at forty-five degrees.
 *
 * **Why it is not boring:** an empty field would be. So the valley has a *floor that
 * moves* — a shallow rise in the middle that hides the far half from the near half
 * until you climb it, which turns one long sightline into two, and makes cresting the
 * ridge an event. Everything worth shooting is arranged in clumps with real gaps
 * between them, so the arena reads as four set-pieces rather than as one long smear.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles1.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const DECOR = `${PACK}/Decor.png`;
const OTHER = `${PACK}/Other Tiles1.png`;
const CAMPFIRE = `${PACK}/Animated Sprites/Campfire sheet.png`;

export const MEADOW_ASSETS: readonly string[] = [
  FLOOR, HOUSE, DECOR, OTHER, CAMPFIRE,
  `${PACK}/Tree1.png`, `${PACK}/Tree3.png`, `${PACK}/Tree4.png`,
  `${PACK}/Weeping Willow1.png`, `${PACK}/Large Pine Tree.png`,
  `${PACK}/Tall Grass.png`, `${PACK}/Pixel Art Wheat.png`, `${PACK}/Large Tent.png`,
  `${PACK}/Small Tent.png`, `${PACK}/hot air balloon.png`,
  `${PACK}/GandalfHardcore Background layers/Normal BG/Background Castle .png`,
  ...[1, 2, 3, 4, 5].map(
    (n) => `${PACK}/GandalfHardcore Background layers/Normal BG/GandalfHardcore Background layers_layer ${n}.png`,
  ),
];

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  const floor = b.sheet(FLOOR);
  const house = b.sheet(HOUSE);
  const other = b.sheet(OTHER);

  // The valley floor, in three heights. The middle rise is the whole reason this arena
  // is not a corridor: it breaks one long sightline into two shorter ones and gives the
  // player somewhere to shoot *from* as well as *at*.
  b.skinnedGround(-70, 26, G0, floor);
  b.skinnedGround(24, 62, G0 + 4, floor);
  b.skinnedGround(60, 150, G0 + 1, floor);

  const oak = (path: string, x: number, y: number, s = 1, z = 2) =>
    b.prop({ sheet: b.sheet(path), tx: 0, ty: 0, tw: 8, th: 6.5, x, y, scale: s, z, sway: 0.012 });
  const grass = (x: number, y: number, z = 12) =>
    b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x, y, z });

  // ---------------------------------------------------------------- 1. the camp
  // Close to the spawn, small, and full of powder. The first thing a player shoots in
  // this arena should go off, so they learn immediately that range is not a penalty.
  oak(`${PACK}/Tree1.png`, -60, G0, 1.1);
  grass(-52, G0);
  b.prop({ sheet: b.sheet(`${PACK}/Large Tent.png`), tx: 0, ty: 0, tw: 3, th: 4, x: -44, y: G0, z: 2 });
  b.prop({ sheet: b.sheet(`${PACK}/Small Tent.png`), tx: 0, ty: 0, tw: 2, th: 2, x: -39, y: G0, z: 2 });
  b.prop({ sheet: b.sheet(CAMPFIRE), tx: 0, ty: 0, tw: 1, th: 1, x: -41.5, y: G0, scale: 1.5, z: 12, frames: 40, fps: 14 });
  b.crowd(-41, G0, ["grunt", "grunt", "grunt"], 1.9, null);
  b.explosiveStack(-36, G0, 5);
  b.scatter(-33, G0, 6, 3);

  // ---------------------------------------------------------------- 2. the farm
  // The first real structure, and the first gunners. Far enough from the camp that a
  // shot at one is not a shot at the other.
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: -22, baseY: G0, material: "brick" });
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: -14, baseY: G0, material: "wood" });
  b.prop({ sheet: b.sheet(`${PACK}/Pixel Art Wheat.png`), tx: 0, ty: 0, tw: 4, th: 2, x: -8, y: G0, z: 12 });
  b.gunner("guard", -25, G0, 1, { behavior: "patrol", patrol: 4, gun: "rifle", range: 45 });
  b.gunner("grunt", -12, G0, -1, { behavior: "patrol", patrol: 4, gun: "smg" });
  b.block(-18, G0 + 0.55, 3.4, 1.1, "concrete");
  for (let i = 0; i < 5; i++) {
    b.spriteBlock({ sheet: other, tx: i % 4, ty: 6, x: -20 + i, baseY: G0 + 7, material: "wood", anchored: true });
  }
  b.gunner("grunt", -18, G0 + 7.5, -1, { behavior: "sentry", gun: "rifle", range: 50 });

  // ---------------------------------------------------------------- 3. the ridge
  // The middle rise. Held, because an unheld hill is just terrain.
  oak(`${PACK}/Weeping Willow1.png`, 30, G0 + 4, 1.1);
  b.block(36, G0 + 4.6, 4, 1.2, "concrete");
  b.gunner("guard", 34, G0 + 4, 1, { behavior: "patrol", patrol: 5, gun: "shotgun" });
  b.gunner("guard", 44, G0 + 4, -1, { behavior: "sentry", gun: "sniper", range: 75, interval: 2.4 });
  b.wall(50, G0 + 4, 3.5, 5, "brick");
  b.gunner("grunt", 50, G0 + 9, -1, { behavior: "sentry", gun: "rifle", range: 55 });
  b.crowd(40, G0 + 4, ["grunt", "grunt"], 2, { behavior: "hunter" });
  grass(56, G0 + 4);

  // ---------------------------------------------------------------- 4. the manor
  // The payoff, at the far end and deliberately the largest thing in the arena. Three
  // storeys of brick with a powder store built into the ground floor: the correct
  // solution is one very large round, arriving from a very long way away.
  oak(`${PACK}/Tree3.png`, 70, G0 + 1, 1.2);
  b.spriteWall({ sheet: house, tx: 1, ty: 2, cols: 5, rows: 5, x: 82, baseY: G0 + 1, material: "concrete" });
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 82, baseY: G0 + 6, material: "brick" });
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 90, baseY: G0 + 1, material: "brick" });
  b.explosiveStack(88, G0 + 1, 6);
  b.explosiveStack(80, G0 + 1, 5);
  b.crowd(76, G0 + 1, ["guard", "grunt"], 2, { behavior: "hunter" });
  b.gunner("guard", 85, G0 + 13, -1, { behavior: "sentry", gun: "sniper", range: 80, interval: 2.2 });
  b.enemy("boss", 96, G0 + 1, -1, { behavior: "hunter", gun: "shotgun" });

  // ---------------------------------------------------------------- 5. the treasury
  b.wall(112, G0 + 1, 5, 6, "gold", 0.7);
  b.crowd(106, G0 + 1, ["guard", "guard"], 2.2, { behavior: "sentry", gun: "rifle" });
  b.block(102, G0 + 1.55, 3.4, 1.1, "concrete");
  oak(`${PACK}/Tree4.png`, 126, G0 + 1, 1.2);
  b.prop({ sheet: b.sheet(`${PACK}/Large Pine Tree.png`), tx: 0, ty: 0, tw: 4, th: 5.5,
           x: 136, y: G0 + 1, scale: 1.3, z: 2, sway: 0.01 });
  grass(120, G0 + 1);

  // Distance markers of a sort: a balloon over the far end gives the eye something to
  // measure the length of the valley against.
  b.prop({ sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
           x: 96, y: G0 + 30, scale: 4.5, z: -5, sway: 0.03 });

  // Foreground tufts, over the top of everything including the player — one near layer
  // is what stops a flat side-on frame reading as a diagram.
  grass(-48, G0, 22);
  grass(12, G0, 22);
  grass(98, G0 + 1, 22);

  return {
    spawn: v(-62, G0 + 1.2),
    bounds: { min: -66, max: 146 },
    enemies: b.enemies,
    groundY: G0,
  };
}

export const MEADOW: LevelDef = {
  id: "meadow",
  name: "Long Meadow",
  tagline: "Everything is in range of something.",
  theme: "grove",
  gravity: -26,
  tags: ["OPEN", "ARTILLERY", "LONG SHOTS"],
  accent: "#8fbf4a",
  assets: MEADOW_ASSETS,
  shape: "flat",
  build,
};
