import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * Ironhold — the vertical arena.
 *
 * One tower, forty metres of it, on a footprint you could cross in four seconds. Every
 * other arena in the set is a place you walk across; this is a place you climb, and the
 * whole design follows from that one difference.
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
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles2.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const DECOR = `${PACK}/Decor.png`;

export const SPIRE_ASSETS: readonly string[] = [
  FLOOR, HOUSE, DECOR,
  `${PACK}/Large Pine Tree.png`, `${PACK}/Pine Trees.png`, `${PACK}/Tall Grass.png`,
  `${PACK}/GandalfHardcore Background layers/Autumn BG/Background Castle Autumn.png`,
  ...[1, 2, 3, 4, 5].map(
    (n) => `${PACK}/GandalfHardcore Background layers/Autumn BG/GandalfHardcore Background layers_layer ${n}.png`,
  ),
];

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  b.skinnedGround(-70, 70, G0, b.sheet(FLOOR));

  const decor = b.sheet(DECOR);
  const house = b.sheet(HOUSE);

  // ---------------------------------------------------------------- approach
  // Deliberately empty for twenty metres. The player needs one clear look at the tower
  // from the bottom before anything asks for their attention — an arena whose whole
  // point is its height has to establish that height before the shooting starts.
  b.prop({ sheet: b.sheet(`${PACK}/Large Pine Tree.png`), tx: 0, ty: 0, tw: 4, th: 5.5,
           x: -52, y: G0, scale: 1.3, z: 2, sway: 0.01 });
  b.prop({ sheet: b.sheet(`${PACK}/Pine Trees.png`), tx: 0, ty: 0, tw: 6, th: 5,
           x: -60, y: G0, scale: 1.1, z: -2, sway: 0.008 });
  b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x: -44, y: G0, z: 12 });
  b.crowd(-34, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-26, G0, 6, 3);

  // ---------------------------------------------------------------- the tower
  // Twelve storeys. The guards are on the landings — outside the structure — because a
  // guard sealed inside a stack of blocks is a guard the player never sees and never
  // gets to knock off anything.
  b.scaffold({
    x: 0, baseY: G0, floors: 12, width: 7, floorHeight: 3.2, material: "concrete",
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
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 20, baseY: G0, material: "brick" });
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 20, baseY: G0 + 7, material: "brick" });
  b.scaffold({
    x: 34, baseY: G0, floors: 6, width: 5.5, floorHeight: 3.2, material: "brick",
    guards: ["grunt"], guardEvery: 2,
    arms: { behavior: "sentry", gun: "sniper", range: 60 },
  });
  b.crowd(46, G0, ["guard", "grunt"], 2, { behavior: "hunter" });

  // A last low parapet on the far side, so the ground fight has somewhere to duck.
  b.block(56, G0 + 0.55, 3.4, 1.1, "concrete");
  b.wall(62, G0, 3, 4, "brick");

  return {
    spawn: v(-46, G0 + 1.2),
    bounds: { min: -66, max: 66 },
    enemies: b.enemies,
    groundY: G0,
    // The tower tops out near 43 m. The ceiling sits above it so the jetpack can crest
    // the thing — the view down from the roof you just cleared is the reward — without
    // letting a full tank take the player somewhere the arena stops existing.
    ceiling: 58,
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
  thumbArt: { path: HOUSE, tx: 8, ty: 0, tw: 5, th: 7 },
  build,
};
