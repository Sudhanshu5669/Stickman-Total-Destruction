import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";
import { SKY_ASSETS } from "./dressing";

/**
 * The Drift — the island chain.
 *
 * Three hundred metres of platforms over a very long fall, at a third of Earth's
 * gravity, climbing the whole way.
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
 *
 * **Why it is three legs and not one row:** eight islands was a sequence you finished;
 * eighteen in a straight line would be a sequence you got bored of. So the chain is cut
 * into three runs of six, and between the runs sits an *anchor* — a mesa twice the width
 * of anything around it, wide enough to fight a proper engagement on, with a fort built
 * on top. The anchors are where the arena breathes: they are the only ground out here
 * you can stand still on, they mark how far you have come, and each one is visibly
 * higher than the last, so the climb reads as progress rather than as repetition.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles1.png`;
const DECOR = `${PACK}/Decor.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const OTHER = `${PACK}/Other Tiles1.png`;

export const DRIFT_ASSETS: readonly string[] = [
  FLOOR, DECOR, HOUSE, OTHER,
  `${PACK}/Birch1.png`, `${PACK}/Birch2.png`, `${PACK}/Birch3.png`, `${PACK}/Tall Grass.png`,
  `${PACK}/Flowering Tree.png`, `${PACK}/Torch.png`,
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
  b.skinnedGround(-76, -18, G0, floor);
  b.prop({ sheet: b.sheet(`${PACK}/Birch1.png`), tx: 0, ty: 0, tw: 2.5, th: 3.5,
           x: -40, y: G0, scale: 1.2, z: 2, sway: 0.02 });
  b.prop({ sheet: b.sheet(`${PACK}/Birch2.png`), tx: 0, ty: 0, tw: 2.5, th: 3.5,
           x: -55, y: G0, scale: 1.3, z: 2, sway: 0.02 });
  b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x: -34, y: G0, z: 12 });
  b.crowd(-27, G0, ["grunt", "grunt"], 2, null);
  b.crowd(-50, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-22, G0, 5, 2.5);
  b.teeter(-45, G0, 6);
  b.dress(-76, -19, G0, { density: 0.6, salt: 1 });
  b.dress(-38, -30, G0, { kind: "camp", density: 0.55, pitch: 1.8, salt: 2 });

  // ---------------------------------------------------------------- the chain
  // Eighteen islands in three legs, climbing and widening apart. Seeded by `islands`,
  // then furnished here — the builder decides the shapes, this file decides what is
  // worth shooting.
  //
  // Every leg is generated rather than placed, so the run is never the same twice; the
  // *anchors* between them are placed by hand off the end of the leg before, because
  // the one thing that must be certain out here is that there is somewhere to land.

  /** Right-hand edge of a leg, so the next thing can be put down beyond it. */
  const legEnd = (leg: { x: number; w: number }[]) => {
    const last = leg[leg.length - 1];
    return last.x + last.w / 2;
  };

  /**
   * One island, furnished.
   *
   * Alternating between a building, a powder stack and a see-saw of crates keeps the
   * run from becoming eighteen identical beats, and `tier` walks the garrison up as the
   * chain climbs — the far leg is guards and snipers where the near leg is grunts.
   */
  const furnish = (isle: { x: number; top: number; w: number }, i: number, tier: number) => {
    const top = isle.top;
    const range = 26 + tier * 6;

    if (i % 3 === 1) {
      b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: isle.x - 2.5, baseY: top, material: "brick" });
      b.gunner(tier > 0 ? "guard" : "grunt", isle.x + 3, top, -1,
               { behavior: "patrol", patrol: 3, gun: "rifle", range });
    } else if (i % 3 === 2) {
      b.explosiveStack(isle.x - 1, top, 4);
      b.explosiveStack(isle.x + 1, top, 3);
      b.crowd(isle.x + 3, top, tier > 1 ? ["guard", "grunt"] : ["grunt", "grunt"], 1.8, { behavior: "hunter" });
    } else {
      b.teeter(isle.x, top, 6);
      b.gunner("guard", isle.x - 3, top, 1, { behavior: "sentry", gun: "shotgun", range: 20 });
      b.gunner("grunt", isle.x + 3, top, -1, { behavior: "patrol", patrol: 2, gun: "smg" });
    }

    // Turf on the island itself. A bare shelf is a platform; a shelf with a bush and
    // two stones on it is a piece of ground that used to be somewhere.
    b.dress(isle.x - isle.w / 2 + 1, isle.x + isle.w / 2 - 1, top,
            { density: 0.55, pitch: 1.6, salt: 10 + i + tier * 20 });
  };

  /** A plank bridge between two islands — the thing to shoot out from under someone. */
  const planks = (from: { x: number; top: number; w: number }, to: { x: number; top: number; w: number }) => {
    const y = (from.top + to.top) / 2 + 0.6;
    const x0 = from.x + from.w / 2;
    const x1 = to.x - to.w / 2;
    for (let x = x0; x < x1; x += 1) {
      b.spriteBlock({
        sheet: b.sheet(OTHER), tx: Math.floor(x) % 4, ty: 6,
        x: x + 0.5, baseY: y, material: "wood", anchored: true,
      });
    }
  };

  /** Links a leg's islands together and furnishes each one. */
  const runLeg = (leg: { x: number; top: number; w: number }[], tier: number) => {
    leg.forEach((isle, i) => {
      furnish(isle, i, tier);
      if (i < leg.length - 1) planks(isle, leg[i + 1]);
    });
  };

  /**
   * An anchor: a mesa twice the width of an island, with a fort on it.
   *
   * The only ground in the arena wide enough to lose a fight on. Everything about it is
   * a contrast with the islands either side — it is broad, it is held, and it is the one
   * place out here that has been *built on* rather than merely stood on.
   */
  const anchor = (x0: number, top: number, tier: number) => {
    const w = 24;
    b.shelf(x0, x0 + w, top, 3.2);
    const cx = x0 + w / 2;
    b.dress(x0 + 1.5, x0 + w - 1.5, top, { density: 0.5, pitch: 1.7, salt: 60 + tier });

    b.spriteWall({ sheet: house, tx: 1, ty: 2, cols: 5, rows: 5, x: cx - 6, baseY: top, material: "concrete" });
    b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: cx - 6, baseY: top + 5, material: "brick" });
    b.wall(cx + 5, top, 3.5, 5, "brick");
    b.block(cx + 5, top + 5.4, 5, 0.8, "concrete");
    b.gunner("guard", cx + 5, top + 6, -1, { behavior: "sentry", gun: "sniper", range: 70, interval: 2.3 });

    b.crowd(cx, top, ["guard", "grunt", "guard"], 2.1, { behavior: "hunter" });
    b.gunner("guard", x0 + 3, top, 1, { behavior: "patrol", patrol: 5, gun: "shotgun" });
    b.explosiveStack(cx + 9, top, 6);
    b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: cx - 10, baseY: top, material: "explosive" });
    b.scatter(x0 + 6, top, 6, 3);
    b.block(x0 + 8, top + 0.55, 3.2, 1.1, "concrete");
    b.prop({ sheet: b.sheet(`${PACK}/Torch.png`), tx: 0, ty: 0, tw: 1, th: 2,
             x: cx - 8, y: top, z: 12, frames: 4, fps: 8 });
    b.prop({ sheet: b.sheet(`${PACK}/Flowering Tree.png`), tx: 0, ty: 0, tw: 3, th: 3.5,
             x: x0 + w - 3, y: top, scale: 1.2, z: 2, sway: 0.018 });
    return { x: cx, top, w };
  };

  // Leg one: close hops, low, and mostly grunts. The tutorial for the other two.
  const legA = b.islands(-14, 6, { width: 10, gap: 6, top: G0 + 1, rise: 1.4, spread: 0.28 });
  runLeg(legA, 0);

  const anchorA = anchor(legEnd(legA) + 8, legA[legA.length - 1].top + 4, 0);
  planks(legA[legA.length - 1], anchorA);

  // Leg two: wider gaps, and the garrison starts carrying rifles.
  const legB = b.islands(anchorA.x + anchorA.w / 2 + 9, 6,
                         { width: 9, gap: 8, top: anchorA.top + 2, rise: 1.6, spread: 0.3 });
  planks(anchorA, legB[0]);
  runLeg(legB, 1);

  const anchorB = anchor(legEnd(legB) + 9, legB[legB.length - 1].top + 4, 1);
  planks(legB[legB.length - 1], anchorB);

  // Leg three: the widest crossings in the game, the highest ground in the arena, and
  // the boss on the last rock in it.
  const legC = b.islands(anchorB.x + anchorB.w / 2 + 10, 6,
                         { width: 9, gap: 10, top: anchorB.top + 2, rise: 1.8, spread: 0.32 });
  planks(anchorB, legC[0]);
  runLeg(legC, 2);

  const summit = legC[legC.length - 1];
  b.enemy("boss", summit.x, summit.top, -1, { behavior: "hunter", gun: "shotgun", range: 22 });
  b.wall(summit.x + 3, summit.top, 3, 4, "brick");
  b.gunner("guard", summit.x + 3, summit.top + 4, -1, { behavior: "sentry", gun: "sniper", range: 70 });

  // Scenery in the void, so the drop reads as height rather than as an empty rectangle.
  b.prop({ sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
           x: 20, y: G0 + 26, scale: 4, z: -5, sway: 0.03 });
  b.prop({ sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
           x: 170, y: G0 + 38, scale: 4.5, z: -5, sway: 0.026 });
  b.prop({ sheet: b.sheet(`${PACK}/hot air balloon.png`), tx: 0, ty: 0, tw: 0.625, th: 1.09,
           x: 268, y: G0 + 50, scale: 3.6, z: -5, sway: 0.032 });
  b.sky(-66, 320, G0 + 14, { heaviness: 0.5, clouds: 30 });
  // Cloud *below* the chain as well as above it. This is the arena where the drop is
  // the weapon, and nothing sells a drop like something white passing underneath the
  // island you are standing on.
  b.sky(-56, 310, G0 - 30, { heaviness: 0.8, clouds: 22, birds: 0 });

  return {
    spawn: v(-56, G0 + 1.2),
    // Generous at the far end: the chain is generated, so where it stops moves by a
    // few metres between loads, and a bound that clips the last island is worse than
    // one with slack past it.
    bounds: { min: -60, max: 330 },
    enemies: b.enemies,
    groundY: G0,
    // The third leg tops out around 32 m and the summit fort sits on top of that, so
    // the roof is well above anything built — this is the one arena where flying *is*
    // the movement, and a low ceiling here reads as a lid.
    ceiling: 62,
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
