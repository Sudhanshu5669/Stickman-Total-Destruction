import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * Hollowbrook — the pixel-art village.
 *
 * Every other world in this game is drawn by code. This one is drawn by an artist
 * (GandalfHardcore's platformer pack) and the level's whole job is to prove the two can
 * share a frame without either being reduced to a backdrop for the other.
 *
 * The rule it follows: **if you can shoot it, it is a block.** The cottages, the barn,
 * the crates, the bridge and the well are all ordinary stacks of rigid bodies that
 * happen to wear a square of the tileset each (`Builder.spriteWall`), so the village
 * comes apart under the same solver as Blackthorn Keep — a roof caves in one tile at a
 * time, and every falling piece keeps its own bit of the picture. Only what you cannot
 * touch — trees, tents, reeds, the far hills — is a flat sprite.
 *
 * That split is also why the level reads. The stickmen are pure black vector against
 * 32-pixel art, which sounds like a clash and is actually the point: the one thing the
 * player controls is the one thing drawn in a different language, and it never gets
 * lost in the scenery no matter how busy the scenery gets.
 *
 * Composition runs left to right in four beats — the lane, the village green, the camp,
 * and the manor across the ravine — with the first cottage close enough to the spawn
 * that the opening shot is available before anybody has walked anywhere.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles1.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const DECOR = `${PACK}/Decor.png`;
const OTHER = `${PACK}/Other Tiles1.png`;
const CAMPFIRE = `${PACK}/Animated Sprites/Campfire sheet.png`;

/** Everything this level needs decoded before `build` runs. See `LevelDef.assets`. */
export const HOLLOWBROOK_ASSETS: readonly string[] = [
  FLOOR, HOUSE, DECOR, OTHER, CAMPFIRE,
  `${PACK}/Tree1.png`, `${PACK}/Tree3.png`, `${PACK}/Tree4.png`,
  `${PACK}/Birch1.png`, `${PACK}/Birch2.png`, `${PACK}/Birch3.png`,
  `${PACK}/Large Pine Tree.png`, `${PACK}/Weeping Willow1.png`, `${PACK}/Weeping Willow2.png`,
  `${PACK}/Tall Grass.png`, `${PACK}/Flowering Tree.png`, `${PACK}/hot air balloon.png`,
  `${PACK}/GandalfHardcore Background layers/Normal BG/Background Castle .png`,
  ...[1, 2, 3, 4, 5].map(
    (n) => `${PACK}/GandalfHardcore Background layers/Normal BG/GandalfHardcore Background layers_layer ${n}.png`,
  ),
];

/** Where the ravine cuts the valley in half. The bridge is the only way across on foot. */
const GAP_A = 45;
const GAP_B = 53;

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  const floor = b.sheet(FLOOR);
  const house = b.sheet(HOUSE);
  const decor = b.sheet(DECOR);
  const other = b.sheet(OTHER);
  const fire = b.sheet(CAMPFIRE);

  // ---------------------------------------------------------------- ground
  // Two slabs with the ravine between them, each skinned with the pack's nine-slice so
  // the surface is grass tiles rather than the engine's flat green.
  b.skin(b.ground(-10, G0 - 3, 110, 6), { sheet: floor, tx: 0, ty: 0 });
  b.skin(b.ground(106, G0 - 3, 106, 6), { sheet: floor, tx: 0, ty: 0 });

  // ---------------------------------------------------------------- distance
  // There is deliberately no mid-distance tree layer here. The obvious move is a row of
  // half-transparent trees between the backdrop and the village — but the pack's near
  // plate is *opaque* pine all the way down to a metre below the ground line, so those
  // trees have nothing to sit against and read as smudges on the treeline rather than
  // as distance. The plates already carry four ranks of depth; the world starts where
  // they stop.
  //
  // The balloon is the one exception, and it works precisely because it is above them.
  b.prop({
    sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
    x: 62, y: G0 + 34, scale: 4.5, z: -5, sway: 0.03,
  });

  // ---------------------------------------------------------------- 1. the lane
  const oak = (path: string, x: number, s = 1, z = 2) =>
    b.prop({ sheet: b.sheet(path), tx: 0, ty: 0, tw: 8, th: 6.5, x, y: G0, scale: s, z, sway: 0.012 });
  const birch = (path: string, x: number, s = 1, z = 2) =>
    b.prop({ sheet: b.sheet(path), tx: 0, ty: 0, tw: 2.5, th: 3.5, x, y: G0, scale: s, z, sway: 0.02 });
  const grass = (x: number, z = 12) =>
    b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x, y: G0, z });
  const bush = (x: number, cell: number, z = 12) =>
    b.prop({ sheet: decor, tx: cell, ty: 4, tw: 1, th: 1, x, y: G0, z });
  const rock = (x: number, tx: number, tw = 1, z = 2) =>
    b.prop({ sheet: decor, tx, ty: tx > 3 ? 6 : 5, tw, th: 1, x, y: G0, z });

  oak(`${PACK}/Tree1.png`, -30, 1.05);
  birch(`${PACK}/Birch1.png`, -24.5, 1.1);
  grass(-27);
  bush(-21, 0);
  rock(-18, 1);

  // Something to shoot from the spawn. Loose crates, so the very first round tells the
  // player these pixels are physics and not wallpaper.
  b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: -16.5, baseY: G0, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: -16.5, baseY: G0 + 1, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: -15.2, baseY: G0, material: "wood" });

  // ---------------------------------------------------------------- 2. the village green
  // Cottage one, five metres of frontage, close enough to be in range from the spawn.
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: -11, baseY: G0, material: "brick" });
  b.prop({ sheet: decor, tx: 0, ty: 1, tw: 3, th: 2, x: -13.5, y: G0, z: 12 });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: -5.2, baseY: G0, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 3, ty: 0, x: -4.0, baseY: G0, material: "wood" });
  b.crowd(-7, G0, ["grunt", "grunt"], 1.6);

  // A well of stacked brick between the two cottages, and the fence line behind it.
  b.spriteWall({ sheet: decor, tx: 11, ty: 4, cols: 2, rows: 2, x: -2, baseY: G0, material: "brick" });
  b.prop({ sheet: decor, tx: 9, ty: 6, tw: 1, th: 2, x: 1.5, y: G0, z: 2 });

  // Cottage two, the far side of the green. The second house in the sheet, so the two
  // are not the same building twice.
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 4, baseY: G0, material: "brick" });
  b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: 10.4, baseY: G0, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 1, ty: 0, x: 11.6, baseY: G0, material: "wood" });
  b.crowd(9.5, G0, ["guard", "grunt"], 1.7);
  oak(`${PACK}/Flowering Tree.png`, 2.0, 1.0, 2);
  bush(-0.5, 1);
  grass(13);

  // ---------------------------------------------------------------- 3. the camp
  b.prop({ sheet: decor, tx: 0, ty: 1, tw: 3, th: 2, x: 17, y: G0, z: 2 });
  b.prop({ sheet: decor, tx: 3, ty: 1, tw: 3, th: 2, x: 24, y: G0, z: 2 });
  b.prop({ sheet: fire, tx: 0, ty: 0, tw: 1, th: 1, x: 20.5, y: G0, scale: 1.6, z: 12, frames: 40, fps: 14 });
  b.prop({ sheet: decor, tx: 6, ty: 2, tw: 2, th: 1, x: 22.6, y: G0, z: 12 });
  b.prop({ sheet: decor, tx: 0, ty: 3, tw: 1, th: 1, x: 18.6, y: G0, z: 12 });
  b.prop({ sheet: decor, tx: 1, ty: 3, tw: 1, th: 1, x: 26.5, y: G0, z: 12 });

  // The powder store. Barrels, but explosive ones — the level's one big lever, and the
  // camp is arranged around it so the payoff is worth finding.
  for (let i = 0; i < 4; i++) {
    b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: 28.5 + (i % 2) * 1.1, baseY: G0 + Math.floor(i / 2), material: "explosive" });
  }
  b.crowd(21, G0, ["grunt", "guard", "grunt"], 1.8);

  // The barn: a taller stack of the same house art, with a crate loft inside range of
  // the powder so one shot can take both.
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 32, baseY: G0, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: 34.5, baseY: G0 + 3, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: 35.6, baseY: G0 + 3, material: "wood" });
  oak(`${PACK}/Tree3.png`, 39.5, 1.15, 2);
  birch(`${PACK}/Birch2.png`, 41.8, 1.0);
  rock(43, 4, 2);
  b.prop({ sheet: decor, tx: 10, ty: 4, tw: 1, th: 2, x: 44.3, y: G0, z: 12 });

  // ---------------------------------------------------------------- 4. the ravine
  // Planks laid one metre at a time, so the bridge fails a board at a time too.
  for (let i = 0; i < GAP_B - GAP_A; i++) {
    b.spriteBlock({
      sheet: other, tx: i % 4, ty: 6, x: GAP_A + i + 0.5, baseY: G0 - 1,
      material: "wood", anchored: true,
    });
  }
  b.prop({ sheet: decor, tx: 10, ty: 4, tw: 1, th: 2, x: GAP_B + 1.2, y: G0, z: 12 });
  rock(GAP_A - 1.4, 1);

  // ---------------------------------------------------------------- 5. the manor
  oak(`${PACK}/Weeping Willow1.png`, 57, 1.0, 2);
  b.crowd(60, G0, ["guard", "guard"], 1.9);

  // Three storeys of cottage stacked into one house, which is not a shape the tileset
  // ships — the point being that the artwork is a material here, not a decal.
  b.spriteWall({ sheet: house, tx: 1, ty: 2, cols: 5, rows: 5, x: 64, baseY: G0, material: "concrete" });
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 64, baseY: G0 + 5, material: "brick" });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: 70.4, baseY: G0, material: "explosive" });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: 70.4, baseY: G0 + 1, material: "explosive" });
  b.crowd(67, G0 + 5, ["grunt"], 1.6);

  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 74, baseY: G0, material: "brick" });
  b.spriteWall({ sheet: decor, tx: 11, ty: 4, cols: 2, rows: 2, x: 80.5, baseY: G0, material: "brick" });
  b.crowd(79, G0, ["guard", "boss"], 2.0);

  // The graveyard behind the manor, and the treasure that makes the walk worth it.
  for (let i = 0; i < 3; i++) {
    b.prop({ sheet: decor, tx: 6 + i, ty: 3, tw: 1, th: 1, x: 85 + i * 1.6, y: G0, z: 12 });
  }
  oak(`${PACK}/Weeping Willow2.png`, 89, 1.1, 2);
  b.wall(94, G0, 4, 5, "gold", 0.7);
  b.crowd(99, G0, ["boss", "guard"], 2.2);

  // ---------------------------------------------------------------- the far treeline
  oak(`${PACK}/Tree4.png`, 104, 1.2, 2);
  birch(`${PACK}/Birch3.png`, 108, 1.1);
  b.prop({
    sheet: b.sheet(`${PACK}/Large Pine Tree.png`), tx: 0, ty: 0, tw: 4, th: 5.5,
    x: 113, y: G0, scale: 1.2, z: 2, sway: 0.01,
  });
  grass(101);
  bush(96, 2);
  rock(111, 1);

  // A last pair of foreground tufts, drawn over the top of everything including the
  // player: one near layer is what stops a flat side-on frame reading as a diagram.
  grass(-12, 22);
  grass(30, 22);
  grass(76, 22);

  return {
    spawn: v(-22, G0 + 1.2),
    bounds: { min: -55, max: 130 },
    enemies: b.enemies,
    groundY: G0,
  };
}

export const HOLLOWBROOK: LevelDef = {
  id: "hollowbrook",
  name: "Hollowbrook",
  tagline: "A hand-painted village that has never once been shot at.",
  theme: "grove",
  gravity: -26,
  tags: ["PIXEL ART", "VILLAGE", "TILESET"],
  accent: "#6ab04a",
  assets: HOLLOWBROOK_ASSETS,
  // The card is painted from the pack too — a hand-drawn world advertised with a
  // generated skyline would be the one screen in the game that lies about itself.
  thumbArt: { path: HOUSE, tx: 1, ty: 0, tw: 5, th: 7 },
  build,
};
