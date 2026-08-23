import { hash01 } from "../core/math";
import { SEASON } from "../render/theme";

/**
 * Set dressing — the layer that decides whether an arena is a place or a test harness.
 *
 * The arenas were not ugly because the artwork was bad. They were ugly because there
 * was almost nothing in them: Long Meadow ran two hundred and sixteen metres and had
 * about twenty five props in it, so a screen-and-a-bit of frame held a tent, a tree and
 * forty metres of empty turf. Every set-piece was authored by hand and placing scenery
 * by hand does not scale past the things the author considered important — which is
 * exactly the stuff between the set-pieces that makes a level look inhabited.
 *
 * So this is the bulk layer. `Builder.dress` walks a span and lays decor along it off a
 * position hash, which buys three things the hand-placed pass could not:
 *
 * - **Density.** One line dresses forty metres.
 * - **Stability.** Seeded on world X, so the same metre of ground gets the same rock
 *   every load — an arena does not shuffle its own scenery between attempts.
 * - **Season.** The tables are indexed by the theme's own ground row, so a snow world
 *   gets snow-capped stones and a bare autumn one gets orange scrub, without any level
 *   naming a tile index. This is the same lesson as `Theme.groundRow`: the world knows
 *   what season it is, and asking every call site to remember is how it goes wrong.
 *
 * Everything here is a `SpriteProp` — no body, no collision, no damage. The things the
 * player is meant to *shoot* are still authored by hand as blocks, because those are
 * gameplay and this is not.
 */

/** One entry in a dressing table. `tw`/`th` are in tiles; `m` is metres per tile. */
export interface Piece {
  tx: number; ty: number;
  tw: number; th: number;
  /** Metres per source tile. Sets the prop's real size. */
  m: number;
  /** Relative likelihood within its table. */
  weight: number;
  sway?: number;
}

const p = (tx: number, ty: number, tw: number, th: number, m: number, weight = 1, sway = 0): Piece =>
  ({ tx, ty, tw, th, m, weight, sway });

/**
 * The three seasons of `Decor.png`, which draws the same scenery three times over.
 *
 * Columns 0-2 are the green set, 3-5 autumn, 6-8 snow — the same layout `Floor Tiles`
 * uses down its rows, and the reason both are keyed off one season number.
 */
interface SeasonSet {
  /** Ankle-high sprigs. The cheapest thing that stops turf reading as a painted plane. */
  tufts: Piece[];
  /** Stones, knee to waist. The mid-frequency detail between turf and structures. */
  rocks: Piece[];
  /** Shrubs. Taller than a stone, so they break the ground line rather than sit on it. */
  bushes: Piece[];
  /** One big cairn, for punctuating a long empty run. */
  boulders: Piece[];
}

const GREEN: SeasonSet = {
  tufts: [p(0, 4, 1, 1, 0.8, 3), p(1, 4, 1, 1, 0.8, 3), p(2, 4, 1, 1, 0.75, 2),
          p(0, 5, 1, 1, 0.9, 2), p(0, 6, 1, 1, 1.05, 2)],
  rocks: [p(1, 5, 1, 1, 1.0, 2), p(2, 5, 1, 1, 1.0, 2), p(1, 6, 1, 1, 1.25, 2),
          p(2, 6, 1, 1, 1.25, 2), p(0, 7, 1, 1, 1.5, 1), p(1, 7, 1, 1, 1.5, 1),
          p(2, 7, 1, 1, 1.5, 1)],
  bushes: [p(0, 13, 2, 1, 1.5, 2, 0.01), p(2, 13, 1, 1, 1.5, 2, 0.012),
           p(3, 13, 1, 1, 1.2, 1, 0.014)],
  boulders: [p(0, 8, 3, 2, 1.2, 1)],
};

const AUTUMN: SeasonSet = {
  tufts: [p(3, 4, 1, 1, 0.8, 3), p(4, 4, 1, 1, 0.8, 3), p(5, 4, 1, 1, 0.75, 2),
          p(3, 5, 1, 1, 0.9, 2), p(3, 6, 1, 1, 1.05, 2)],
  rocks: [p(4, 5, 1, 1, 1.0, 2), p(5, 5, 1, 1, 1.0, 2), p(4, 6, 1, 1, 1.25, 2),
          p(5, 6, 1, 1, 1.25, 2), p(3, 7, 1, 1, 1.5, 1), p(4, 7, 1, 1, 1.5, 1),
          p(5, 7, 1, 1, 1.5, 1)],
  bushes: [p(0, 14, 2, 1, 1.5, 2, 0.01), p(2, 14, 1, 1, 1.5, 2, 0.012),
           p(3, 14, 1, 1, 1.2, 1, 0.014)],
  boulders: [p(3, 8, 3, 2, 1.2, 1)],
};

const SNOW: SeasonSet = {
  tufts: [p(6, 4, 1, 1, 0.8, 3), p(7, 4, 1, 1, 0.8, 3), p(8, 4, 1, 1, 0.75, 2),
          p(6, 5, 1, 1, 0.9, 2), p(6, 6, 1, 1, 1.05, 2)],
  rocks: [p(7, 5, 1, 1, 1.0, 2), p(8, 5, 1, 1, 1.0, 2), p(7, 6, 1, 1, 1.25, 2),
          p(8, 6, 1, 1, 1.25, 2), p(6, 7, 1, 1, 1.5, 1), p(7, 7, 1, 1, 1.5, 1),
          p(8, 7, 1, 1, 1.5, 1)],
  bushes: [p(0, 15, 2, 1, 1.5, 2, 0.008), p(2, 15, 1, 1, 1.5, 2, 0.01),
           p(3, 15, 1, 1, 1.2, 1, 0.012)],
  boulders: [p(9, 8, 3, 2, 1.2, 1)],
};

const SEASONS: Record<number, SeasonSet> = {
  [SEASON.green]: GREEN,
  [SEASON.autumn]: AUTUMN,
  [SEASON.snow]: SNOW,
};

export const seasonSet = (groundRow: number): SeasonSet => SEASONS[groundRow] ?? GREEN;

/**
 * Things people leave lying about, which do not change with the weather.
 *
 * Kept apart from the seasonal tables because they say something different: a rock says
 * "nobody has been here", and a chopping block, a washing line and a stack of firewood
 * say "somebody lives here and is about to have a very bad afternoon". Arenas want to
 * choose between those two, so they are two tables.
 */
export const CAMP: Piece[] = [
  p(0, 0, 1, 1, 1.1, 3),   // crate
  p(1, 0, 1, 1, 1.3, 2),   // tall crate
  p(2, 0, 1, 1, 1.0, 3),   // barrel
  p(3, 0, 1, 1, 1.1, 2),   // paired barrels
  p(4, 0, 1, 1, 0.85, 1),  // stool
  p(5, 0, 1, 1, 0.85, 1),  // cooking pot
  p(6, 0, 1, 1, 1.1, 2),   // chopping block
  p(7, 0, 1, 1, 1.1, 2),   // firewood and axe
  p(8, 0, 1, 1, 1.1, 1),   // table
  p(9, 0, 1, 1, 1.0, 1),   // chair
  p(6, 2, 2, 1, 1.2, 2),   // stacked logs
  p(10, 2, 1, 1, 0.85, 1), // basket
  p(11, 2, 1, 1, 0.85, 1), // covered basket
  p(2, 3, 1, 1, 1.0, 2),   // keg
  p(3, 3, 1, 1, 0.75, 1),  // pail
];

/** A graveyard, for the one arena that has earned it. */
export const GRAVES: Piece[] = [
  p(6, 3, 1, 1, 1.1, 2), p(7, 3, 1, 1, 1.1, 2), p(8, 3, 1, 1, 1.1, 2),
  p(9, 3, 1, 1, 1.2, 1), p(10, 3, 1, 1, 1.0, 1),
];

/** Landmarks worth naming, placed one at a time rather than scattered. */
export const LANDMARK = {
  scarecrow: p(9, 6, 2, 2, 1.0),
  statue: p(12, 8, 1, 2, 1.1),
  reeds: p(9, 4, 2, 2, 1.0, 1, 0.02),
  brickWall: p(11, 4, 2, 2, 1.0),
  washingLine: p(0, 10, 5, 3, 1.0, 1, 0.006),
  scarecrowPumpkin: p(11, 6, 1, 1, 0.7),
  logStack: p(6, 2, 2, 1, 1.0),
  marketStall: p(8, 1, 2, 2, 1.0),
} as const;

/** Picks from a weighted table using a 0..1 roll. Stable for a stable roll. */
export function weighted(table: Piece[], roll: number): Piece {
  let total = 0;
  for (const it of table) total += it.weight;
  let n = roll * total;
  for (const it of table) {
    n -= it.weight;
    if (n <= 0) return it;
  }
  return table[table.length - 1];
}

/** Deterministic 0..1 stream for a position, so scenery never shuffles between loads. */
export const roll = (x: number, salt: number) => hash01(x * 12.9898 + salt * 78.233);


// ------------------------------------------------------------------ the sky

const PACK = "GandalfHardcore FREE Platformer Assets";

/**
 * Everything that goes above the treeline.
 *
 * The painted backdrops replace the procedural sky wholesale — `Theme.sprites` switches
 * off the generated clouds, skyline and ridges — and nothing was ever put back. So five
 * of the seven arenas ran a third of their frame as one flat unbroken colour, and the
 * pack's own `cloud1-6`, `birds1-4` and `sun` sat in the repo unreferenced by anything.
 *
 * These are ordinary props at a negative draw order, not a parallax layer. Clouds are
 * far enough away and large enough that world-anchored is indistinguishable from
 * parallaxed at the distances an arena spans, and it costs no new rendering path.
 */
export const SKY_ASSETS: readonly string[] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => `${PACK}/cloud${n}.png`),
  ...[1, 2, 3, 4].map((n) => `${PACK}/birds${n}.png`),
  `${PACK}/sun.png`,
];

/** A cloud sprite and its true size in tiles — these are loose files, not a sheet. */
export interface SkySprite { path: string; tw: number; th: number }

const px = (path: string, w: number, h: number): SkySprite =>
  ({ path, tw: w / 32, th: h / 32 });

/** Sorted small to large, so a caller can bias a sky toward wisps or toward weather. */
export const CLOUDS: SkySprite[] = [
  px(`${PACK}/cloud1.png`, 25, 10),
  px(`${PACK}/cloud2.png`, 43, 15),
  px(`${PACK}/cloud3.png`, 55, 16),
  px(`${PACK}/cloud4.png`, 73, 29),
  px(`${PACK}/cloud5.png`, 110, 35),
  px(`${PACK}/cloud6.png`, 165, 101),
];

export const BIRDS: SkySprite[] = [
  px(`${PACK}/birds1.png`, 20, 20),
  px(`${PACK}/birds2.png`, 12, 24),
  px(`${PACK}/birds3.png`, 7, 7),
  px(`${PACK}/birds4.png`, 9, 9),
];

export const SUN: SkySprite = px(`${PACK}/sun.png`, 32, 32);
