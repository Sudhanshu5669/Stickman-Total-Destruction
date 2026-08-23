import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";
import { SKY_ASSETS } from "./dressing";

/**
 * The Drift — the island chain.
 *
 * A row of platforms over a very long fall, at a third of Earth's gravity.
 *
 * **The idea:** gravity is the weapon here. Everywhere else, killing a stickman means
 * hitting it; here it means hitting the thing it is standing on, or simply hitting the
 * stickman hard enough that the ground runs out before it stops. A round that would
 * knock a man over on flat ground removes him from the level entirely, and that is the
 * joke the whole arena is built around.
 *
 * **Why low gravity:** at -9 the player's jetpack crosses gaps easily and every impact
 * throws debris in slow, readable arcs — so the consequence of a hit stays on screen
 * long enough to enjoy. It also makes the recoil of the heavy rounds a genuine movement
 * tool rather than a nuisance, which is the one place in the set that idea gets room.
 *
 * **Composition:** the chain climbs as it runs, so the silhouette rises to the right and
 * the last island is the highest thing in the arena — with the only boss on it. The
 * gaps widen as it goes, so the crossings get harder exactly as the fights get bigger.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles1.png`;
const DECOR = `${PACK}/Decor.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const OTHER = `${PACK}/Other Tiles1.png`;

export const DRIFT_ASSETS: readonly string[] = [
  FLOOR, DECOR, HOUSE, OTHER,
  `${PACK}/Birch1.png`, `${PACK}/Birch2.png`, `${PACK}/Tall Grass.png`,
  `${PACK}/hot air balloon.png`, ...SKY_ASSETS,
  `${PACK}/GandalfHardcore Background layers/Normal BG/Background Castle .png`,
  ...[1, 2, 3, 4, 5].map(
    (n) => `${PACK}/GandalfHardcore Background layers/Normal BG/GandalfHardcore Background layers_layer ${n}.png`,
  ),
];

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  const decor = b.sheet(DECOR);
  const house = b.sheet(HOUSE);
  const floor = b.sheet(FLOOR);

  // The launch shelf. The only piece of solid, generous ground in the arena, and the
  // only place a player can stand still and think.
  b.skinnedGround(-46, -18, G0, floor);
  b.prop({ sheet: b.sheet(`${PACK}/Birch1.png`), tx: 0, ty: 0, tw: 2.5, th: 3.5,
           x: -40, y: G0, scale: 1.2, z: 2, sway: 0.02 });
  b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x: -34, y: G0, z: 12 });
  b.crowd(-27, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-22, G0, 5, 2.5);
  b.dress(-46, -19, G0, { density: 0.6, salt: 1 });
  b.dress(-38, -30, G0, { kind: "camp", density: 0.55, pitch: 1.8, salt: 2 });

  // ---------------------------------------------------------------- the chain
  // Eight islands, climbing and widening apart. Seeded by `islands`, then furnished
  // here — the builder decides the shapes, this file decides what is worth shooting.
  const chain = b.islands(-14, 8, { width: 10, gap: 7, top: G0 + 1, rise: 2.2, spread: 0.3 });

  chain.forEach((isle, i) => {
    const top = isle.top;
    const last = i === chain.length - 1;

    if (i === 0) {
      b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: isle.x, baseY: top, material: "wood" });
      b.gunner("grunt", isle.x + 2, top, -1, { behavior: "sentry", gun: "smg", range: 28 });
      return;
    }

    // Every island gets one structure and one reason to shoot it. Alternating between
    // a building and a powder stack keeps the run from becoming eight identical beats.
    if (i % 3 === 1) {
      b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: isle.x - 2.5, baseY: top, material: "brick" });
      b.gunner("guard", isle.x + 3, top, -1, { behavior: "patrol", patrol: 3, gun: "rifle", range: 34 });
    } else if (i % 3 === 2) {
      b.explosiveStack(isle.x - 1, top, 4);
      b.explosiveStack(isle.x + 1, top, 3);
      b.crowd(isle.x + 3, top, ["grunt", "grunt"], 1.8, { behavior: "hunter" });
    } else {
      b.teeter(isle.x, top, 6);
      b.gunner("guard", isle.x - 3, top, 1, { behavior: "sentry", gun: "shotgun", range: 20 });
      b.gunner("grunt", isle.x + 3, top, -1, { behavior: "patrol", patrol: 2, gun: "smg" });
    }

    // Turf on the island itself. A bare shelf is a platform; a shelf with a bush and
    // two stones on it is a piece of ground that used to be somewhere.
    b.dress(isle.x - isle.w / 2 + 1, isle.x + isle.w / 2 - 1, top,
            { density: 0.55, pitch: 1.6, salt: 10 + i });

    // A plank bridge to the next island — the thing a player will shoot out from under
    // someone crossing it, which is the arena working as intended.
    if (!last) {
      const next = chain[i + 1];
      const y = (top + next.top) / 2 + 0.6;
      const from = isle.x + isle.w / 2;
      const to = next.x - next.w / 2;
      for (let x = from; x < to; x += 1) {
        b.spriteBlock({
          sheet: b.sheet(OTHER), tx: Math.floor(x) % 4, ty: 6,
          x: x + 0.5, baseY: y, material: "wood", anchored: true,
        });
      }
    }

    if (last) {
      b.enemy("boss", isle.x, top, -1, { behavior: "hunter", gun: "shotgun", range: 22 });
      b.wall(isle.x + 4, top, 3, 4, "brick");
      b.gunner("guard", isle.x + 4, top + 4, -1, { behavior: "sentry", gun: "sniper", range: 70 });
    }
  });

  // Scenery in the void, so the drop reads as height rather than as an empty rectangle.
  b.prop({ sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
           x: 20, y: G0 + 26, scale: 4, z: -5, sway: 0.03 });
  b.sky(-50, 130, G0 + 14, { heaviness: 0.5, clouds: 16 });
  // Cloud *below* the chain as well as above it. This is the arena where the drop is
  // the weapon, and nothing sells a drop like something white passing underneath the
  // island you are standing on.
  b.sky(-40, 120, G0 - 30, { heaviness: 0.8, clouds: 9, birds: 0 });

  return {
    spawn: v(-40, G0 + 1.2),
    bounds: { min: -50, max: 130 },
    enemies: b.enemies,
    groundY: G0,
    ceiling: 46,
  };
}

export const DRIFT: LevelDef = {
  id: "drift",
  name: "The Drift",
  tagline: "The ground is optional. So is everyone on it.",
  theme: "grove",
  // A third of Earth. See the note above: this is the arena where gravity is the weapon.
  gravity: -9,
  tags: ["ISLANDS", "LOW GRAVITY", "LONG WAY DOWN"],
  accent: "#4cc8e0",
  assets: DRIFT_ASSETS,
  shape: "islands",
  // No soil under the chain. This is the arena where the drop is the weapon, and a
  // floor painted a metre below the islands took the drop away.
  voidBelow: true,
  build,
};
