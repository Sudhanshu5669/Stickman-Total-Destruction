import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * Grid City — the street.
 *
 * The densest arena in the set, and the only one built from a different pack. Three
 * hundred metres of boulevard, with the towers shoulder to shoulder and tall enough
 * that you cannot see the top of one and the base of the next in the same frame.
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
 *
 * **How it got long without getting slow:** every cell of every facade is a real rigid
 * body, so a street twice the length cannot simply be twice as many towers — that is
 * how you end up with two thousand bodies and a game that does not run on the machine
 * it was written for. So the extra two hundred metres are *street* rather than more
 * skyline: an intersection, a low-rise strip of two- and three-storey shopfronts, a
 * construction site that is mostly open scaffold, an elevated section of road on piers,
 * and exactly one more high-rise at the very end to give the far view a full stop. The
 * body count goes up by about half; the length more than doubles. See `ui/quality.ts`.
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
  b.skinnedGround(-86, 300, G0, tiles, 0, 0);

  /**
   * One tower. Height is in facade bands, so `storeys: 8` is a sixteen-metre building
   * plus its shopfront — and every one of those metres is destructible.
   */
  const tower = (x: number, cols: number, storeys: number, band: number, shop: number) =>
    b.cityBlock({
      sheet: build_, tx: 1, cols, groundTy: shop, facadeTy: band,
      storeys, x, baseY: G0, material: "concrete",
    });

  // ---------------------------------------------------------------- street furniture
  /**
   * The pavement, furnished.
   *
   * Grid City was the best-looking arena in the set and still had an empty street: a
   * row of towers standing on a bare grey plane with nothing between them. The pack
   * ships exactly what a street needs — lamps, lights, bins, signs — and none of it had
   * ever been placed.
   *
   * Streetlamps are a stack of one-metre tiles, because the sheet draws them that way:
   * the head at (6,1), plain pole at (6,2) repeated for as much height as the post
   * needs, and (6,3) — the same pole with a footplate — at the bottom. Traffic lights
   * are the same trick one column over, and signs one further. All of them are props
   * rather than blocks: a lamp post that survives a piano landing on it is less
   * annoying than one that becomes debris in every fight.
   *
   * ## Standing on the pavement
   *
   * `prop.y` is the sprite's **bottom edge**, and every pole tile's art runs the full
   * height of its cell, so the bottom tile of a post goes at `G0` exactly — no offset,
   * no fudge. Getting that wrong is what left the whole street hovering: the posts were
   * laid out downward from where their heads should be and stopped a tile short, so
   * every lamp, light and sign on the boulevard floated about a metre and a half over
   * the pavement with clear air under the footplate.
   *
   * So these build *upward* from the ground now. `POST` is the height of the pole part
   * in whole tiles, and the head sits on top of it; four metres puts a lamp head at
   * a bit over twice stickman height, which is what a streetlamp looks like.
   */
  const POST = 3;
  /** A post: footplate, plain pole up to `POST`, and whatever head goes on top. */
  const post = (x: number, tx: number, headTy: number) => {
    b.prop({ sheet: deco, tx, ty: 3, tw: 1, th: 1, x, y: G0, z: 6 });
    for (let i = 1; i < POST; i++) {
      b.prop({ sheet: deco, tx, ty: 2, tw: 1, th: 1, x, y: G0 + i, z: 6 });
    }
    b.prop({ sheet: deco, tx, ty: headTy, tw: 1, th: 1, x, y: G0 + POST, z: 6 });
  };
  const lamp = (x: number) => post(x, 6, 1);
  const signal = (x: number, ty: number) => post(x, 7, ty);
  /** Litter and bins, which is what actually makes a street look used. */
  const kerb = (x: number, n: number) => {
    const cells: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    for (let i = 0; i < n; i++) {
      const c = cells[(Math.abs(Math.round(x)) + i * 3) % cells.length];
      b.prop({ sheet: deco, tx: c[0], ty: c[1], tw: 1, th: 1, x: x + i * 1.5, y: G0, z: 7 });
    }
  };
  /**
   * A road sign: a thin post from column 8, with a sign face on top.
   *
   * Shorter than a lamp on purpose — a street where every vertical thing is the same
   * height is a fence. The signs themselves are 16px sprites packed into the *top
   * right* quadrant of their 32px cell (measured: x16-31, y0-15), which is why the head
   * is lifted half a tile: at a whole tile the face floats half a metre above the post
   * it is bolted to. The horizontal packing needs no correction, because the pole in
   * column 8 sits right of centre by the same amount the faces do.
   */
  const sign = (x: number, tx: number, ty: number) => {
    b.prop({ sheet: deco, tx: 8, ty: 3, tw: 1, th: 1, x, y: G0, z: 6 });
    b.prop({ sheet: deco, tx: 8, ty: 2, tw: 1, th: 1, x, y: G0 + 1, z: 6 });
    b.prop({ sheet: deco, tx, ty, tw: 1, th: 1, x, y: G0 + 1.5, z: 6 });
  };

  for (let x = -68; x < 280; x += 13) lamp(x);
  signal(-24, 0);
  signal(28, 1);
  signal(80, 0);
  signal(118, 1);
  signal(176, 0);
  signal(232, 1);
  sign(-40, 2, 1);
  sign(-6, 0, 2);
  sign(44, 2, 3);
  sign(92, 3, 1);
  sign(134, 0, 1);
  sign(190, 2, 2);
  sign(248, 3, 3);
  kerb(-46, 3);
  kerb(-14, 4);
  kerb(20, 3);
  kerb(52, 4);
  kerb(88, 3);
  kerb(126, 4);
  kerb(158, 3);
  kerb(198, 4);
  kerb(240, 3);
  kerb(268, 4);

  // ---------------------------------------------------------------- the approach
  // Two low blocks first, so the street's scale is established by something the player
  // can see the top of before the tall ones arrive.
  b.crowd(-62, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-56, G0, 7, 4, ["concrete", "wood", "explosive"]);
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

  // ---------------------------------------------------------------- the intersection
  // Twenty metres of nothing but road. The canyon has been shoulder-to-shoulder for a
  // hundred and forty metres by this point, and the only way to make the *next* hundred
  // read as a different part of town is to open the sky up in between them — an
  // intersection is a place a city stops being a corridor for a moment.
  signal(98, 0);
  signal(112, 1);
  kerb(104, 5);
  b.crowd(100, G0, ["grunt", "grunt", "grunt"], 2, null);
  b.crowd(110, G0, ["guard", "grunt"], 2.1, { behavior: "hunter" });
  b.block(105, G0 + 0.6, 5, 1.2, "concrete");
  b.scatter(96, G0, 8, 5, ["concrete", "wood", "explosive"]);

  // ---------------------------------------------------------------- the low-rise
  // Two- and three-storey shopfronts, packed tight. Cheap in bodies and completely
  // different in the frame: for sixty metres you can see the sky over the rooftops and
  // the whole street at once, which is the only stretch of Grid City where a long shot
  // is even possible.
  const strip: [number, number, number, number, number][] = [
    [120, 4, 2, BAND.BLUE, SHOP.SIGNED],
    [126, 4, 3, BAND.TAN, SHOP.PLAIN],
    [132, 5, 2, BAND.RED, SHOP.SIGNED],
    [139, 4, 3, BAND.PINK, SHOP.PLAIN],
    [145, 5, 2, BAND.TAN, SHOP.PLAIN],
    [152, 4, 3, BAND.BLUE, SHOP.SIGNED],
  ];
  strip.forEach(([x, cols, storeys, band, shop], i) => {
    const roof = tower(x, cols, storeys, band, shop);
    b.spriteBlock({ sheet: deco, tx: 0, ty: 0, x: x - 1, baseY: G0, material: "explosive" });
    // Every other roof, not all six. A gunner on each one turns a sixty-metre open
    // stretch back into a wall of fire and undoes the reason the strip is here.
    if (i % 2 === 0) {
      b.gunner("grunt", x + cols / 2, roof, -1, { behavior: "sentry", gun: "rifle", range: 46 });
    }
  });
  b.gunner("guard", 128, G0, -1, { behavior: "patrol", patrol: 6, gun: "smg" });
  b.gunner("guard", 148, G0, 1, { behavior: "patrol", patrol: 6, gun: "shotgun" });
  b.crowd(136, G0, ["grunt", "grunt"], 1.9, { behavior: "hunter" });
  b.explosiveStack(158, G0, 6);

  // ---------------------------------------------------------------- the site
  // A block that has been knocked down and not yet put back up. Open scaffold rather
  // than facade: almost no bodies, maximum silhouette, and the only structure in the
  // city you can see straight through — so for once you can watch the fight on the
  // other side of a building instead of guessing at it.
  b.scaffold({
    x: 172, baseY: G0, floors: 9, width: 7, floorHeight: 2.6, material: "metal",
    guards: ["grunt", "guard", "grunt"], guardEvery: 2,
    arms: { behavior: "sentry", gun: "rifle", range: 52 },
  });
  b.scaffold({
    x: 188, baseY: G0, floors: 6, width: 6, floorHeight: 2.6, material: "metal",
    guards: ["guard"], guardEvery: 3,
    arms: { behavior: "sentry", gun: "sniper", range: 75, interval: 2.5 },
  });
  b.catwalk(175, 185, G0 + 15.6);
  b.gunner("grunt", 180, G0 + 16.2, -1, { behavior: "patrol", patrol: 4, gun: "smg" });
  b.spire(198, G0, 20, 1.8, "metal", 0.02);   // the lift core, going up ahead of the floors
  b.scatter(164, G0, 10, 5, ["concrete", "wood", "explosive"]);
  b.scatter(194, G0, 8, 4, ["concrete", "wood", "explosive"]);
  b.block(182, G0 + 0.6, 4, 1.2, "concrete");
  b.crowd(192, G0, ["guard", "grunt", "guard"], 2.1, { behavior: "hunter" });

  // ---------------------------------------------------------------- the flyover
  // The road leaves the ground for forty metres. A deck on piers, at the height of a
  // third floor: cover for whoever is under it, a firing position for whoever is on it,
  // and a pier is one block — drop it and the whole span above it comes down with
  // everybody standing on it.
  b.bridge(206, 244, G0 + 7, "concrete", 5, G0);
  b.gunner("guard", 214, G0 + 7.4, -1, { behavior: "patrol", patrol: 7, gun: "rifle", range: 48 });
  b.gunner("guard", 232, G0 + 7.4, -1, { behavior: "sentry", gun: "shotgun", range: 20 });
  b.gunner("grunt", 224, G0 + 7.4, 1, { behavior: "patrol", patrol: 6, gun: "smg" });
  b.crowd(218, G0, ["grunt", "grunt"], 2, { behavior: "hunter" });
  b.explosiveStack(212, G0, 6);
  b.explosiveStack(238, G0, 6);
  b.block(228, G0 + 0.6, 4, 1.2, "concrete");
  kerb(222, 4);

  // ---------------------------------------------------------------- the tower
  // One building at the far end, taller than anything behind it, so the street has a
  // full stop rather than a fade-out. Everything else in this half of the arena is low
  // or open; this is the payoff for having walked three hundred metres of pavement.
  const crown = tower(252, 6, 11, BAND.BLUE, SHOP.SIGNED);
  b.gunner("guard", 255, crown, -1, { behavior: "sentry", gun: "sniper", range: 85, interval: 2.2 });
  // A balcony half way up, and a man on it. Without the slab he stands on nothing —
  // a facade is a wall, not a floor — and the arena opens with him falling eighteen
  // metres onto his own doorstep.
  b.block(259.5, crown - 8, 3, 0.4, "concrete");
  b.gunner("guard", 259.5, crown - 7.7, -1, { behavior: "sentry", gun: "rifle", range: 55 });
  b.enemy("boss", 266, G0, -1, { behavior: "hunter", gun: "shotgun" });
  b.crowd(262, G0, ["guard", "guard"], 2.2, { behavior: "hunter" });
  b.explosiveStack(250, G0, 6);
  b.block(272, G0 + 0.6, 4, 1.2, "concrete");
  tower(276, 4, 3, BAND.RED, SHOP.PLAIN);

  return {
    spawn: v(-66, G0 + 1.2),
    bounds: { min: -70, max: 282 },
    enemies: b.enemies,
    groundY: G0,
    // Above the tallest roof (~34 m) with room to fight over it.
    ceiling: 50,
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
