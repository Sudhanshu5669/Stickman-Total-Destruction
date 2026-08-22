import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * Grid City — the street.
 *
 * The densest arena in the set, and the only one built from a different pack. Six
 * towers on a boulevard, shoulder to shoulder, tall enough that you cannot see the top
 * of one and the base of the next in the same frame.
 *
 * **The idea:** everywhere else the buildings are targets standing in space. Here they
 * are the space — the street is a corridor with walls forty metres high, and every shot
 * that misses hits something anyway. Density is the whole design: a rocket that goes
 * wide in Ironhold sails into a field, and the same rocket here takes out a shopfront.
 *
 * **What makes it funny rather than just busy:** the ground floors are all glass
 * storefronts, so the first thing that happens in any fight is that somebody's shop
 * front goes. And the towers are close enough to fall into each other, which is the one
 * thing the previous build's city never did.
 *
 * The rooftops are a second, parallel level: snipers up there, and a player with a
 * jetpack can fight the whole arena from above without ever touching the pavement.
 */

const CITY = "GandalfHardcore City Tiles";
const BUILD = `${CITY}/Building Tiles 32x32.png`;
const TILES = `${CITY}/GandalfHardcore city tiles 32x32.png`;
const CITY_DECOR = `${CITY}/Decoration 32x32.png`;

export const DOWNTOWN_ASSETS: readonly string[] = [
  BUILD, TILES, CITY_DECOR,
  `${CITY}/City background sky.png`,
  `${CITY}/City background layer1.png`,
  `${CITY}/City background layer2.png`,
];

/**
 * The sheet's colour bands, each two tiles tall. Named here because `4` means nothing
 * at a call site and `RED` means a red building.
 *
 * Columns: 0 is plain wall, 2 is the dark doorway, 4-8 are window variants. Buildings
 * start at 1 or 2 so a doorway lands on the ground floor rather than in mid-air.
 */
const BAND = { BLUE: 0, TAN: 2, RED: 4, PINK: 6 } as const;
/** Two-row shopfront bands, for ground floors. */
const SHOP = { PLAIN: 8, SIGNED: 10 } as const;

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  const build_ = b.sheet(BUILD);
  const tiles = b.sheet(TILES);
  const deco = b.sheet(CITY_DECOR);

  // Pavement, running the length of the boulevard.
  b.skinnedGround(-60, 120, G0, tiles, 0, 0);

  /**
   * One tower. Height is in facade bands, so `storeys: 8` is a sixteen-metre building
   * plus its shopfront — and every one of those metres is destructible.
   */
  const tower = (x: number, cols: number, storeys: number, band: number, shop: number) =>
    b.cityBlock({
      sheet: build_, tx: 1, cols, groundTy: shop, facadeTy: band,
      storeys, x, baseY: G0, material: "concrete",
    });

  // ---------------------------------------------------------------- the approach
  // Two low blocks first, so the street's scale is established by something the player
  // can see the top of before the tall ones arrive.
  b.crowd(-50, G0, ["grunt", "grunt"], 2, null);
  tower(-44, 5, 2, BAND.TAN, SHOP.SIGNED);
  b.gunner("grunt", -36, G0, -1, { behavior: "patrol", patrol: 4, gun: "smg" });
  tower(-32, 4, 3, BAND.BLUE, SHOP.PLAIN);

  // ---------------------------------------------------------------- the canyon
  // Four towers, close-packed. The gaps are deliberately narrower than the buildings
  // are tall: that ratio is what turns a row of towers into a street.
  //
  // Heights are chosen against a body budget, not just a silhouette. Every cell of every
  // facade is a real rigid body — that is the point of the arena — and the first draft
  // of this street came to 1236 of them, which held 60 fps here and would not have on
  // the 4 GB machine this game is supposed to run on. Trimming two bands off each tower
  // and a column off the widest costs nothing anyone can see and takes roughly 40% of
  // the bodies out. See `ui/quality.ts` for the other half of that argument.
  const canyon: [number, number, number, number, number][] = [
    [-20, 5, 6, BAND.RED, SHOP.PLAIN],
    [-10, 5, 8, BAND.PINK, SHOP.SIGNED],
    [2, 6, 7, BAND.BLUE, SHOP.PLAIN],
    [14, 5, 9, BAND.TAN, SHOP.PLAIN],
  ];
  for (const [x, cols, storeys, band, shop] of canyon) {
    const roof = tower(x, cols, storeys, band, shop);
    // A sniper on every roof. They are the reason to look up, and the reason the
    // rooftops are worth flying to.
    b.gunner("guard", x + cols / 2, roof, -1, {
      behavior: "sentry", gun: "sniper", range: 70, interval: 2.6,
    });
    // Street-level garrison in the doorway.
    b.gunner("grunt", x + cols / 2, G0, -1, { behavior: "patrol", patrol: 3, gun: "smg" });
    // Something in front of the shopfront to duck behind, and something to set off.
    b.block(x + cols / 2, G0 + 0.55, 2.8, 1.1, "concrete");
    b.spriteBlock({ sheet: deco, tx: 0, ty: 0, x: x - 1.2, baseY: G0, material: "explosive" });
  }

  // A skybridge between the two tallest. Somewhere to be shot at from, and a spectacular
  // thing to remove.
  b.shelf(-5, 14, G0 + 15, 0.9);
  b.gunner("guard", 4, G0 + 16, -1, { behavior: "patrol", patrol: 6, gun: "rifle", range: 40 });
  b.gunner("grunt", 9, G0 + 16, -1, { behavior: "sentry", gun: "shotgun", range: 18 });

  // ---------------------------------------------------------------- the far end
  b.crowd(30, G0, ["guard", "grunt", "guard"], 2.1, { behavior: "hunter" });
  tower(36, 5, 5, BAND.PINK, SHOP.SIGNED);
  b.gunner("guard", 38.5, G0 + 12.6, -1, { behavior: "sentry", gun: "rifle", range: 44 });

  tower(48, 6, 8, BAND.RED, SHOP.PLAIN);
  b.enemy("boss", 58, G0, -1, { behavior: "hunter", gun: "shotgun" });
  b.explosiveStack(46, G0, 6);
  b.explosiveStack(60, G0, 6);

  // Rubble and abandoned vehicles-worth of cover, so the far end is a fight rather than
  // a firing range.
  b.scatter(66, G0, 10, 6, ["concrete", "wood", "explosive"]);
  b.block(72, G0 + 0.6, 4, 1.2, "concrete");
  b.gunner("guard", 76, G0, -1, { behavior: "patrol", patrol: 5, gun: "shotgun" });
  tower(84, 5, 4, BAND.TAN, SHOP.PLAIN);

  return {
    spawn: v(-54, G0 + 1.2),
    bounds: { min: -58, max: 106 },
    enemies: b.enemies,
    groundY: G0,
    // Above the tallest roof (~30 m) with room to fight over it.
    ceiling: 44,
  };
}

export const DOWNTOWN: LevelDef = {
  id: "downtown",
  name: "Grid City",
  tagline: "Mixed-use development. Mostly the one use now.",
  theme: "city",
  gravity: -26,
  tags: ["STREET", "DENSE", "ROOFTOPS"],
  accent: "#e0574c",
  assets: DOWNTOWN_ASSETS,
  shape: "city",
  build,
};
