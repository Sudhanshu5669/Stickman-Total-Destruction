import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";
import { LANDMARK, SKY_ASSETS } from "./dressing";

/**
 * Long Meadow — the open valley.
 *
 * The wide one. Getting on for four hundred metres of open country with the targets
 * spread the whole length of it, and nothing tall enough anywhere to stop a shot
 * travelling.
 *
 * **The idea:** this is the artillery arena, and it exists because every other arena in
 * the set punishes a long shot. Ironhold is a wall, the Quarry is a hole, the Drift is
 * a series of narrow perches and Grid City is a corridor — in all four, the honest play
 * is to get close. Here the sightlines run the full length of the level, the wide camera
 * has something to show, and the correct answer to a fortified farmhouse three hundred
 * feet away is a piano fired at forty-five degrees.
 *
 * **Why it is not boring:** an empty field would be. So the valley has a *floor that
 * moves* — five plateaus at five different heights, each hiding the next until you
 * climb onto it, which turns one long sightline into a series of them and makes
 * cresting every rise an event. Everything worth shooting is arranged in clumps with
 * real gaps between them, so the arena reads as a sequence of set-pieces rather than
 * as one long smear.
 *
 * **On the length:** the first draft stopped at the treasury, two hundred metres in,
 * and the whole valley could be read from the spawn in a single glance — which is the
 * one thing an artillery arena must not be. It runs to three hundred now: past the
 * treasury the ground climbs onto a second rise carrying a mill, drops into a flooded
 * meadow crossed on planks, and finishes on a bare pasture with a redoubt on it that
 * is genuinely out of sight from the start. You cannot see the end of this arena from
 * the beginning of it, and that is the point.
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
  `${PACK}/Small Tent.png`, `${PACK}/hot air balloon.png`, ...SKY_ASSETS,
  `${PACK}/Tree2.png`, `${PACK}/Weeping Willow2.png`, `${PACK}/Flowering Tree.png`,
  `${PACK}/Pine Trees.png`, `${PACK}/Pixel Art Furnace and Sawmill.png`,
  `${PACK}/Birch1.png`, `${PACK}/Torch.png`,
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
  b.skinnedGround(-100, 26, G0, floor);
  b.skinnedGround(24, 62, G0 + 4, floor);
  b.skinnedGround(60, 150, G0 + 1, floor);
  // The far half. Each plateau is a place the arena keeps out of sight until you have
  // walked far enough to earn it, and the steps between them are kept to four metres
  // or less so the climb is a jetpack tap rather than a wall.
  b.skinnedGround(148, 200, G0 + 5, floor);
  b.skinnedGround(198, 252, G0 + 1, floor);
  b.skinnedGround(250, 322, G0 + 4, floor);

  const oak = (path: string, x: number, y: number, s = 1, z = 2) =>
    b.prop({ sheet: b.sheet(path), tx: 0, ty: 0, tw: 8, th: 6.5, x, y, scale: s, z, sway: 0.012 });
  const grass = (x: number, y: number, z = 12) =>
    b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x, y, z });

  // A sky with weather in it. The painted backdrop switched the procedural clouds off
  // and nothing replaced them, so the top third of this arena — the widest one in the
  // game — was one flat colour.
  b.sky(-96, 320, G0 + 11, { heaviness: 0.45, sun: { x: 22, y: G0 + 19, scale: 5 } });

  // ---------------------------------------------------------------- the dressing
  // Laid down before the set-pieces so everything authored by hand sits on top of it.
  // Three bands, one per plateau, at a density that reads as meadow rather than as
  // wilderness — this is farmland, so it is scrubby rather than overgrown.
  b.dress(-86, 24, G0, { density: 0.62, salt: 1 });
  b.dress(24, 60, G0 + 4, { density: 0.5, salt: 2 });
  b.dress(60, 148, G0 + 1, { density: 0.58, salt: 3 });
  b.dress(148, 198, G0 + 5, { density: 0.56, salt: 6 });
  // The flooded meadow is reeds and standing water rather than scrub, so it is dressed
  // heavier and lower — it should read as ground you would rather not fight on.
  b.dress(198, 250, G0 + 1, { density: 0.78, pitch: 1.3, salt: 7 });
  b.dress(250, 310, G0 + 4, { density: 0.44, salt: 8 });
  // Two worked patches: somebody's camp at the near end and the manor's yard at the
  // far one. Clutter rather than scrub, so the eye can tell the lived-in ground from
  // the walk between them.
  b.dress(-46, -30, G0, { kind: "camp", density: 0.7, pitch: 1.7, salt: 4 });
  b.dress(74, 100, G0 + 1, { kind: "camp", density: 0.45, pitch: 2.1, salt: 5 });

  // ---------------------------------------------------------------- 1. the camp
  // Close to the spawn, small, and full of powder. The first thing a player shoots in
  // this arena should go off, so they learn immediately that range is not a penalty.
  b.prop({ sheet: b.sheet(`${PACK}/Pine Trees.png`), tx: 0, ty: 0, tw: 10, th: 6.5,
           x: -80, y: G0, scale: 1.1, z: -3, sway: 0.006 });
  oak(`${PACK}/Tree2.png`, -71, G0, 1.15);
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
  // The scarecrow is the arena's one joke that is not made of physics: it stands in the
  // field at exactly stickman height, and at four hundred feet it is the thing players
  // shoot first by mistake.
  b.landmark(LANDMARK.scarecrow, -5, G0, { z: 4 });
  b.landmark(LANDMARK.washingLine, -30, G0, { z: 4 });
  b.landmark(LANDMARK.marketStall, -28.5, G0, { z: 5 });
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
  b.landmark(LANDMARK.statue, 118, G0 + 1, { scale: 1.6, z: 4 });
  b.wall(112, G0 + 1, 5, 6, "gold", 0.7);
  b.crowd(106, G0 + 1, ["guard", "guard"], 2.2, { behavior: "sentry", gun: "rifle" });
  b.block(102, G0 + 1.55, 3.4, 1.1, "concrete");
  oak(`${PACK}/Tree4.png`, 126, G0 + 1, 1.2);
  b.prop({ sheet: b.sheet(`${PACK}/Large Pine Tree.png`), tx: 0, ty: 0, tw: 4, th: 5.5,
           x: 136, y: G0 + 1, scale: 1.3, z: 2, sway: 0.01 });
  grass(120, G0 + 1);

  // ---------------------------------------------------------------- 6. the mill
  // The second rise, and the first thing in the arena that cannot be seen from the
  // spawn at all. A working mill on the skyline: the granary is the target, the mill
  // tower is the sniper post that stops you taking it at leisure, and the wheat is
  // there so the eye can tell at a glance that the ground has changed hands.
  oak(`${PACK}/Weeping Willow2.png`, 154, G0 + 5, 1.1);
  b.prop({ sheet: b.sheet(`${PACK}/Pixel Art Wheat.png`), tx: 0, ty: 0, tw: 8, th: 1,
           x: 160, y: G0 + 5, z: 12 });
  b.prop({ sheet: b.sheet(`${PACK}/Pixel Art Wheat.png`), tx: 0, ty: 0, tw: 8, th: 1,
           x: 169, y: G0 + 5, z: 12 });
  b.landmark(LANDMARK.scarecrowPumpkin, 165, G0 + 5, { scale: 1.4, z: 5 });

  // The granary: two storeys of timber with the whole harvest's worth of powder in it.
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 172, baseY: G0 + 5, material: "wood" });
  b.explosiveStack(178.5, G0 + 5, 6);
  b.explosiveStack(180.2, G0 + 5, 5);
  b.crowd(176, G0 + 5, ["grunt", "grunt"], 1.9, { behavior: "hunter" });
  b.block(169, G0 + 5.55, 3.6, 1.1, "concrete");
  b.gunner("guard", 166, G0 + 5, 1, { behavior: "patrol", patrol: 5, gun: "smg" });

  // The mill tower. Five storeys with a climbable outside, which makes it the one
  // structure out here a player can answer either by flying up it or by removing it.
  b.scaffold({
    x: 188, baseY: G0 + 5, floors: 5, width: 5.5, floorHeight: 3.2, material: "concrete",
    clad: { sheet: house, tx: 2, ty: 3 },
    guards: ["grunt", "guard"], guardEvery: 2,
    arms: { behavior: "sentry", gun: "sniper", range: 85, interval: 2.3 },
  });
  b.prop({ sheet: b.sheet(`${PACK}/Pixel Art Furnace and Sawmill.png`), tx: 6, ty: 0, tw: 6, th: 4,
           x: 194, y: G0 + 5, scale: 1, z: 2 });

  // ---------------------------------------------------------------- 7. the water meadow
  // The dip. Four metres lower than the mill and four lower than the pasture beyond it,
  // so crossing it means being *below* both ends of the arena at once with reeds up to
  // your knees — the one stretch of Long Meadow where the long shot is coming at you
  // rather than from you.
  const reeds = (x: number) => b.landmark(LANDMARK.reeds, x, G0 + 1, { scale: 1.3, z: 11 });
  reeds(202); reeds(209); reeds(221); reeds(233); reeds(244);
  oak(`${PACK}/Weeping Willow2.png`, 206, G0 + 1, 1.25);
  oak(`${PACK}/Weeping Willow1.png`, 240, G0 + 1, 1.15);
  b.prop({ sheet: b.sheet(`${PACK}/Flowering Tree.png`), tx: 0, ty: 0, tw: 3, th: 3.5,
           x: 214, y: G0 + 1, scale: 1.3, z: 2, sway: 0.016 });

  // A plank causeway over the wet ground, on trestles. Anchored, so it holds — and
  // made of wood, so it does not hold for long once anyone starts shooting at it.
  for (let i = 0; i < 22; i++) {
    b.spriteBlock({ sheet: other, tx: i % 4, ty: 6, x: 210 + i, baseY: G0 + 3.4, material: "wood", anchored: true });
  }
  b.wall(212, G0 + 1, 1, 2.4, "wood", 0.35);
  b.wall(226, G0 + 1, 1, 2.4, "wood", 0.35);
  // On the deck, not in it: the planks are one-metre blocks sitting on `baseY`, so the
  // walkable surface is 4.4, and a stickman placed at 4.0 spawns inside the timber.
  b.gunner("grunt", 218, G0 + 4.5, -1, { behavior: "patrol", patrol: 5, gun: "smg" });
  b.gunner("grunt", 228, G0 + 4.5, -1, { behavior: "sentry", gun: "rifle", range: 50 });
  b.crowd(234, G0 + 1, ["grunt", "guard"], 2, { behavior: "hunter" });
  b.teeter(222, G0 + 1, 6);
  b.scatter(238, G0 + 1, 7, 3.5);

  // ---------------------------------------------------------------- 8. the redoubt
  // The end of the valley, and the only thing in it that was built to be shot at. Bare
  // pasture, one squat fort of concrete and gold, and a boss who has had three hundred
  // metres of warning that you were coming.
  b.landmark(LANDMARK.brickWall, 256, G0 + 4, { scale: 1.5, z: 4 });
  b.wall(262, G0 + 4, 4, 6, "concrete");
  b.wall(274, G0 + 4, 4, 6, "concrete");
  b.block(268, G0 + 10.4, 14, 0.8, "concrete");
  b.gunner("guard", 262, G0 + 11, -1, { behavior: "sentry", gun: "sniper", range: 90, interval: 2.1 });
  b.gunner("guard", 274, G0 + 11, -1, { behavior: "sentry", gun: "rifle", range: 60 });
  b.block(268, G0 + 11.5, 3.4, 1.1, "concrete");
  b.explosiveStack(266, G0 + 4, 6);
  b.explosiveStack(270, G0 + 4, 6);
  b.spriteWall({ sheet: house, tx: 1, ty: 2, cols: 5, rows: 5, x: 280, baseY: G0 + 4, material: "concrete" });
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 280, baseY: G0 + 9, material: "brick" });
  b.enemy("boss", 290, G0 + 4, -1, { behavior: "hunter", gun: "shotgun" });
  b.crowd(286, G0 + 4, ["guard", "guard"], 2.2, { behavior: "hunter" });
  b.wall(296, G0 + 4, 5, 5, "gold", 0.7);
  b.landmark(LANDMARK.statue, 301, G0 + 4, { scale: 1.7, z: 4 });
  b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2,
           x: 258, y: G0 + 4, z: 12, frames: 4, fps: 8 });
  oak(`${PACK}/Tree2.png`, 306, G0 + 4, 1.2);

  // Distance markers of a sort: a balloon over the far end gives the eye something to
  // measure the length of the valley against.
  b.prop({ sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
           x: 96, y: G0 + 30, scale: 4.5, z: -5, sway: 0.03 });
  b.prop({ sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
           x: 232, y: G0 + 34, scale: 4, z: -5, sway: 0.028 });

  // Foreground tufts, over the top of everything including the player — one near layer
  // is what stops a flat side-on frame reading as a diagram.
  grass(-48, G0, 22);
  grass(12, G0, 22);
  grass(98, G0 + 1, 22);
  grass(176, G0 + 5, 22);
  grass(268, G0 + 4, 22);

  return {
    spawn: v(-78, G0 + 1.2),
    bounds: { min: -84, max: 306 },
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
