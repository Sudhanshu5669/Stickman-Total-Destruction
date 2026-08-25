import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";
import { LANDMARK, SKY_ASSETS } from "./dressing";

/**
 * Ironhold — the vertical arena.
 *
 * One tower, forty metres of it, at the head of three hundred metres of fortified
 * ground. Every other arena in the set is a place you walk across; this is a place you
 * climb, and the whole design follows from that one difference.
 *
 * **The idea:** the garrison is stacked above you, so the fight is decided by height
 * rather than distance, and the fastest way to win is to stop climbing and start
 * removing the floors — at which point everyone standing on them arrives at your level
 * involuntarily. That joke is the arena. It is why the tower is built out of ordinary
 * blocks rather than terrain, why the guards are on landings rather than inside, and
 * why there is a very large pile of explosives at the base.
 *
 * **Composition:** the tower is off-centre, with a long clear approach on the left so
 * the first thing a player sees is the whole thing standing up. A second, shorter tower
 * on the right gives the collapse something to fall *against*, which is far more
 * interesting than falling into open air, and gives a sniper somewhere to be a problem
 * from.
 *
 * **On the length:** for a while this arena *was* the two towers — a hundred and thirty
 * metres end to end, which meant the whole of Ironhold could be seen from the spawn and
 * finished from one firing position. It is a fortress now, and a fortress has depth: a
 * curtain wall and gatehouse behind the spire, a walled ward of keeps and catwalks
 * behind that, and a foundry at the far end that is still throwing sparks. The climb is
 * no longer one tower; it is a skyline you can cross without ever coming down, which is
 * what the jetpack was always for.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles2.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const DECOR = `${PACK}/Decor.png`;
const OTHER = `${PACK}/Other Tiles1.png`;

export const SPIRE_ASSETS: readonly string[] = [
  FLOOR, HOUSE, DECOR, OTHER, ...SKY_ASSETS,
  `${PACK}/Large Pine Tree.png`, `${PACK}/Pine Trees.png`, `${PACK}/Tall Grass.png`,
  `${PACK}/Tree2.png`, `${PACK}/Tree4.png`, `${PACK}/Torch.png`,
  `${PACK}/Pixel Art Furnace and Sawmill.png`, `${PACK}/Ores.png`,
  `${PACK}/GandalfHardcore Background layers/Autumn BG/Background Castle Autumn.png`,
  ...[1, 2, 3, 4, 5].map(
    (n) => `${PACK}/GandalfHardcore Background layers/Autumn BG/GandalfHardcore Background layers_layer ${n}.png`,
  ),
];

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  // The yard, and the raised ground the rest of the fortress stands on. Three metres
  // is deliberately the smallest step in the game: this arena's height is supposed to
  // come from what people built, never from what the ground happened to do.
  b.skinnedGround(-110, 82, G0, b.sheet(FLOOR));
  b.skinnedGround(80, 230, G0 + 3, b.sheet(FLOOR));

  const decor = b.sheet(DECOR);
  const house = b.sheet(HOUSE);

  // An overcast autumn sky, low and heavy. The tower is the subject here, so the
  // weather is drawn to sit behind it rather than to compete with it.
  b.sky(-106, 226, G0 + 11, { heaviness: 0.7, sun: null });

  // Scrub across the whole floor. Sparser than Long Meadow on purpose: this is a
  // building site, and the ground between the towers is walked on.
  b.dress(-96, 78, G0, { density: 0.5, salt: 1 });
  b.dress(-30, -14, G0, { kind: "camp", density: 0.6, pitch: 1.8, salt: 2 });
  b.dress(24, 44, G0, { kind: "camp", density: 0.5, pitch: 2.0, salt: 3 });
  b.dress(82, 214, G0 + 3, { density: 0.34, salt: 6 });
  b.dress(88, 104, G0 + 3, { kind: "camp", density: 0.55, pitch: 1.9, salt: 7 });
  b.dress(160, 182, G0 + 3, { kind: "camp", density: 0.6, pitch: 1.7, salt: 8 });

  // ---------------------------------------------------------------- approach
  // Deliberately empty for twenty metres. The player needs one clear look at the tower
  // from the bottom before anything asks for their attention — an arena whose whole
  // point is its height has to establish that height before the shooting starts.
  b.prop({ sheet: b.sheet(`${PACK}/Large Pine Tree.png`), tx: 0, ty: 0, tw: 4, th: 5.5,
           x: -52, y: G0, scale: 1.3, z: 2, sway: 0.01 });
  b.prop({ sheet: b.sheet(`${PACK}/Pine Trees.png`), tx: 0, ty: 0, tw: 6, th: 5,
           x: -60, y: G0, scale: 1.1, z: -2, sway: 0.008 });
  b.prop({ sheet: b.sheet(`${PACK}/Pine Trees.png`), tx: 0, ty: 0, tw: 6, th: 5,
           x: -84, y: G0, scale: 1.3, z: -3, sway: 0.006 });
  b.prop({ sheet: b.sheet(`${PACK}/Tree2.png`), tx: 0, ty: 0, tw: 8, th: 6.5,
           x: -74, y: G0, scale: 1.1, z: 2, sway: 0.012 });
  b.crowd(-66, G0, ["grunt", "grunt"], 2, null);
  b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x: -44, y: G0, z: 12 });
  b.landmark(LANDMARK.scarecrow, -40, G0, { z: 4 });
  b.landmark(LANDMARK.logStack, -30, G0, { scale: 1.3, z: 6 });
  b.crowd(-34, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-26, G0, 6, 3);

  // ---------------------------------------------------------------- the tower
  // Twelve storeys. The guards are on the landings — outside the structure — because a
  // guard sealed inside a stack of blocks is a guard the player never sees and never
  // gets to knock off anything.
  b.scaffold({
    x: 0, baseY: G0, floors: 12, width: 7, floorHeight: 3.2, material: "concrete",
    clad: { sheet: house, tx: 2, ty: 3 },
    guards: ["grunt", "guard", "grunt", "guard", "boss"],
    guardEvery: 2,
    arms: { behavior: "sentry", gun: "rifle", range: 40 },
  });

  // The reason to shoot the bottom instead of the top. Stacked against the near column,
  // in plain sight from the approach, and worth about six storeys.
  b.explosiveStack(-3.2, G0, 6);
  b.explosiveStack(3.2, G0, 6);
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: -5.4, baseY: G0, material: "explosive" });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: 5.4, baseY: G0, material: "explosive" });

  // Ground-floor garrison, so the base is defended and shooting it is a decision.
  b.gunner("guard", -7.5, G0, 1, { behavior: "patrol", patrol: 4, gun: "shotgun" });
  b.gunner("guard", 7.5, G0, -1, { behavior: "patrol", patrol: 4, gun: "smg" });

  // ---------------------------------------------------------------- the neighbour
  // Something for the tower to fall against. A collapse into open air is a shape
  // changing; a collapse into another building is two shapes changing.
  // Plain wall band underneath, gabled top storey above it — the order the manor in
  // Long Meadow uses. Stacking two *gabled* houses, which is what this was, leaves the
  // upper one balanced on the lower one's roof peak with open air under both eaves: it
  // reads as a bug from forty metres away and it was the first thing the eye found.
  b.spriteWall({ sheet: house, tx: 1, ty: 2, cols: 5, rows: 5, x: 20, baseY: G0, material: "concrete" });
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 20, baseY: G0 + 5, material: "brick" });
  b.scaffold({
    x: 34, baseY: G0, floors: 6, width: 5.5, floorHeight: 3.2, material: "brick",
    clad: { sheet: house, tx: 2, ty: 5 },
    guards: ["grunt"], guardEvery: 2,
    arms: { behavior: "sentry", gun: "sniper", range: 60 },
  });
  b.crowd(46, G0, ["guard", "grunt"], 2, { behavior: "hunter" });

  // A last low parapet on the far side, so the ground fight has somewhere to duck.
  b.block(56, G0 + 0.55, 3.4, 1.1, "concrete");
  b.wall(62, G0, 3, 4, "brick");
  b.landmark(LANDMARK.statue, 66, G0, { scale: 1.5, z: 4 });

  // ---------------------------------------------------------------- the curtain wall
  // Where the fortress proper starts. A gatehouse with a wall running off it, standing
  // on the step up to the upper ground so it reads as a threshold rather than as one
  // more thing in the yard — and the last cover before the ward, which is why the
  // garrison on top of it is worth taking off before you go through.
  b.gate(76, G0, 4.5, 6, "concrete", { sheet: house, tx: 2, ty: 3 });
  b.battlement(88, G0 + 3, 11, 6, "concrete", ["grunt", "guard", "grunt"],
               { sheet: house, tx: 2, ty: 3 });
  b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2,
           x: 71, y: G0, z: 12, frames: 4, fps: 8 });
  b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2,
           x: 81, y: G0, z: 12, frames: 4, fps: 8 });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: 84, baseY: G0 + 3, material: "explosive" });
  b.gunner("guard", 95, G0 + 3, -1, { behavior: "patrol", patrol: 5, gun: "shotgun" });

  // ---------------------------------------------------------------- the ward
  // Two keeps and the walkways between them. This is the half of the arena you are
  // meant to fight *at height* — the catwalks link the keeps to the watchtower, so a
  // player with a pack can cross the whole ward without touching the ground, and every
  // span of it can be deleted from underneath them.
  const keepA = b.castleTower({
    x: 108, baseY: G0 + 3, w: 6, height: 16, material: "concrete", roof: true,
    guards: ["guard", "grunt"], clad: { sheet: house, tx: 2, ty: 3 },
  });
  const keepB = b.castleTower({
    x: 132, baseY: G0 + 3, w: 6.5, height: 22, material: "brick", roof: true,
    guards: ["guard", "guard"], clad: { sheet: house, tx: 2, ty: 5 },
  });
  // The ward's own scaffold, shorter than the spire and open on both flanks — somewhere
  // to be shot at from that is also somewhere to shoot back from.
  b.scaffold({
    x: 150, baseY: G0 + 3, floors: 7, width: 6, floorHeight: 3.2, material: "concrete",
    clad: { sheet: house, tx: 2, ty: 5 },
    guards: ["grunt", "guard"], guardEvery: 2,
    arms: { behavior: "sentry", gun: "rifle", range: 50 },
  });

  // Two spans, at the two heights the ward actually has. The low one runs from the
  // short keep's roof into the flank of the tall one; the high one leaves the tall
  // keep's roof for the scaffold's sixth landing, which is the only place in the ward
  // at the same height. Heights are read off what was built rather than written down
  // twice — a catwalk a metre out is a catwalk nobody can step onto.
  b.catwalk(111, 129, keepA + 0.6);
  b.gunner("grunt", 120, keepA + 1.2, -1, { behavior: "patrol", patrol: 6, gun: "smg" });
  const landing6 = G0 + 3 + 6 * 3.6;
  b.catwalk(135, 147, Math.min(keepB, landing6) + 0.6);
  b.gunner("guard", 140, Math.min(keepB, landing6) + 1.2, -1,
           { behavior: "sentry", gun: "sniper", range: 80, interval: 2.2 });

  // Yard level, so the ward is a fight and not just a set of things overhead.
  b.crowd(116, G0 + 3, ["grunt", "grunt", "guard"], 2, { behavior: "hunter" });
  b.block(124, G0 + 3.55, 3.6, 1.1, "concrete");
  b.explosiveStack(105, G0 + 3, 6);
  b.explosiveStack(136, G0 + 3, 6);
  b.scatter(142, G0 + 3, 7, 3.5);

  // ---------------------------------------------------------------- the foundry
  // The far end, and the only part of Ironhold that is still working. Low, wide and
  // dirty after two hundred metres of vertical stone: sheds, ore, two chimneys and the
  // heaviest thing in the arena standing in the middle of it. The chimneys are metal
  // and thin, so they come down in one piece and land on whatever is beside them.
  b.prop({ sheet: b.sheet(`${PACK}/Pixel Art Furnace and Sawmill.png`), tx: 0, ty: 0, tw: 6, th: 4,
           x: 164, y: G0 + 3, scale: 1.1, z: 2 });
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 172, baseY: G0 + 3, material: "wood" });
  b.spire(180, G0 + 3, 18, 2.2, "metal");
  b.spire(196, G0 + 3, 15, 2.0, "metal", 0.03);
  b.prop({ sheet: b.sheet(`${PACK}/Ores.png`), tx: 0, ty: 0, tw: 2, th: 2, x: 170, y: G0 + 3, z: 12 });
  b.prop({ sheet: b.sheet(`${PACK}/Ores.png`), tx: 2, ty: 2, tw: 2, th: 2, x: 188, y: G0 + 3, z: 11 });
  b.gunner("guard", 176, G0 + 3, 1, { behavior: "patrol", patrol: 5, gun: "smg" });
  b.gunner("grunt", 192, G0 + 3, -1, { behavior: "patrol", patrol: 4, gun: "rifle" });
  b.block(184, G0 + 3.55, 3.6, 1.1, "concrete");
  b.explosiveStack(186, G0 + 3, 6);
  b.enemy("boss", 200, G0 + 3, -1, { behavior: "hunter", gun: "shotgun" });
  b.wall(208, G0 + 3, 4, 5, "gold", 0.7);
  b.landmark(LANDMARK.statue, 213, G0 + 3, { scale: 1.6, z: 4 });
  b.prop({ sheet: b.sheet(`${PACK}/Tree4.png`), tx: 0, ty: 0, tw: 8, th: 6.5,
           x: 216, y: G0 + 3, scale: 1.1, z: 2, sway: 0.012 });

  return {
    spawn: v(-72, G0 + 1.2),
    bounds: { min: -92, max: 214 },
    enemies: b.enemies,
    groundY: G0,
    // The tower tops out near 43 m. The ceiling sits above it so the jetpack can crest
    // the thing — the view down from the roof you just cleared is the reward — without
    // letting a full tank take the player somewhere the arena stops existing.
    ceiling: 62,
  };
}

export const SPIRE: LevelDef = {
  id: "spire",
  name: "Ironhold",
  tagline: "Twelve floors. One load-bearing decision.",
  theme: "autumn",
  gravity: -26,
  tags: ["VERTICAL", "CLIMB IT", "OR DON'T"],
  accent: "#e08a3a",
  assets: SPIRE_ASSETS,
  shape: "tower",
  build,
};
