import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";
import { LANDMARK, SKY_ASSETS } from "./dressing";

/**
 * The Quarry — the bowl.
 *
 * Fought in the round rather than across. Every other arena has a left and a right; this
 * one has a top and a bottom, and the whole garrison can see you from the moment you
 * step onto the rim.
 *
 * **On the size:** one hole is a set-piece, not a place. This is a working quarry now —
 * a haul road down off the moor, the main cut, a processing floor between the two, and
 * a second, deeper cut past it that the first one keeps out of sight until you walk the
 * ridge between them. Three hundred metres of it, and at no point can you see both
 * bottoms at once.
 *
 * **The idea:** the player arrives *above* the fight, looking down into it, which is the
 * one composition the rest of the set never offers. Standing on the rim you have range
 * and no cover; dropping into the pit you have cover everywhere and no angles. That
 * trade is the arena, and the jetpack is how you change your mind about it.
 *
 * **Why the terraces matter:** a flat pit floor would put every enemy at one height and
 * make the drop a one-way decision. The stepped walls give the garrison three tiers to
 * hold and the player three places to land, so the fight has a middle rather than just
 * a start and an end.
 *
 * The explosives are on the *terraces*, not the floor — a chain reaction that runs
 * around the walls brings the whole bowl in on itself, which is the thing this shape can
 * do that no flat arena can.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles1.png`;
const DECOR = `${PACK}/Decor.png`;
const OTHER = `${PACK}/Other Tiles1.png`;
const ORES = `${PACK}/Ores.png`;

export const PIT_ASSETS: readonly string[] = [
  FLOOR, DECOR, OTHER, ORES, ...SKY_ASSETS,
  `${PACK}/Tree3.png`, `${PACK}/Tall Grass.png`, `${PACK}/Pixel Art Furnace and Sawmill.png`,
  `${PACK}/GandalfHardcore Background layers/Normal BG/Background Castle .png`,
  ...[1, 2, 3, 4, 5].map(
    (n) => `${PACK}/GandalfHardcore Background layers/Normal BG/GandalfHardcore Background layers_layer ${n}.png`,
  ),
];

const CX = 0;
const HALF = 27;
const FLOOR_Y = -15;

/** The second cut: further out, narrower and a good deal deeper than the first. */
const CX2 = 112;
const HALF2 = 20;
const FLOOR2_Y = -23;

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  const decor = b.sheet(DECOR);
  const other = b.sheet(OTHER);
  const floor = b.sheet(FLOOR);

  // The bowl itself: floor, three terraces a side, and rims running out either way.
  const bowl = b.basin(CX, HALF, G0, FLOOR_Y, 3);

  // Skin the rims so the approach reads as the same grass the rest of the pack uses,
  // and leave the pit's own walls bare rock — it is a quarry, the point is that
  // something dug it.
  // Deep enough to reach past the bowl's floor: a six-metre slab beside a twelve-metre
  // hole leaves a band of open backdrop down the inside of the rim.
  b.skinnedGround(-118, CX - HALF - 1.5, G0, floor, 0, undefined, 24);
  b.skinnedGround(CX + HALF + 1.5, CX2 - HALF2 - 1.5, G0, floor, 0, undefined, 24);

  // The second cut, and the ground running out past it to the tips.
  const cut2 = b.basin(CX2, HALF2, G0, FLOOR2_Y, 3);
  b.skinnedGround(CX2 + HALF2 + 1.5, 210, G0, floor, 0, undefined, 32);

  b.sky(-128, 208, G0 + 11, { heaviness: 0.4, sun: { x: -30, y: G0 + 20, scale: 5 } });

  // Scrub on the rims only. The bowl itself stays bare: it is a quarry, the whole point
  // is that the vegetation has been dug away, and rocks scattered down the terraces
  // would hide the one thing the arena is asking you to read — which tier a man is on.
  b.dress(-116, CX - HALF - 3, G0, { density: 0.55, salt: 1 });
  b.dress(CX + HALF + 3, CX2 - HALF2 - 3, G0, { density: 0.55, salt: 2 });
  b.dress(CX2 + HALF2 + 3, 196, G0, { density: 0.5, salt: 6 });
  // The works at the top of the haul road, beside the sawmill.
  b.dress(38, 56, G0, { kind: "camp", density: 0.65, pitch: 1.7, salt: 3 });
  // The men's camp at the head of the road, and the tips at the far end.
  b.dress(-96, -76, G0, { kind: "camp", density: 0.62, pitch: 1.8, salt: 7 });
  b.dress(160, 188, G0, { kind: "camp", density: 0.55, pitch: 1.9, salt: 8 });

  // ---------------------------------------------------------------- the rim
  // Sparse. The player should be looking *down*, not at the scenery beside them.
  b.prop({ sheet: b.sheet(`${PACK}/Tree3.png`), tx: 0, ty: 0, tw: 8, th: 6.5,
           x: -50, y: G0, scale: 1.1, z: 2, sway: 0.012 });
  b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x: -38, y: G0, z: 12 });
  b.prop({ sheet: b.sheet(`${PACK}/Pixel Art Furnace and Sawmill.png`), tx: 0, ty: 0, tw: 6, th: 5,
           x: 46, y: G0, scale: 1, z: 2 });

  // ---------------------------------------------------------------- the haul road
  // Ninety metres of moor before the ground opens. It exists so the first cut arrives
  // as a *hole in the world* rather than as the thing that was already on screen — an
  // arena about looking down needs somewhere to have been looking level from first.
  b.prop({ sheet: b.sheet(`${PACK}/Tree3.png`), tx: 0, ty: 0, tw: 8, th: 6.5,
           x: -108, y: G0, scale: 1.2, z: 2, sway: 0.012 });
  b.prop({ sheet: b.sheet(`${PACK}/Tree3.png`), tx: 0, ty: 0, tw: 8, th: 6.5,
           x: -70, y: G0, scale: 1, z: -2, sway: 0.01 });
  b.crowd(-92, G0, ["grunt", "grunt"], 2, null);
  b.scatter(-86, G0, 7, 3.5);
  b.landmark(LANDMARK.logStack, -80, G0, { scale: 1.3, z: 6 });
  b.gunner("grunt", -74, G0, 1, { behavior: "patrol", patrol: 6, gun: "smg" });
  b.prop({ sheet: b.sheet(ORES), tx: 0, ty: 2, tw: 2, th: 2, x: -62, y: G0, z: 12 });
  b.teeter(-56, G0, 6);
  b.block(-46, G0 + 0.55, 3.4, 1.1, "concrete");
  b.gunner("guard", -42, G0, 1, { behavior: "sentry", gun: "rifle", range: 46 });

  // Rim guards, on both sides, so stepping up out of the pit is not a free escape.
  b.gunner("guard", -34, G0, 1, { behavior: "patrol", patrol: 5, gun: "rifle", range: 42 });
  b.gunner("guard", 34, G0, -1, { behavior: "patrol", patrol: 5, gun: "rifle", range: 42 });
  b.block(-31, G0 + 0.55, 3.4, 1.1, "concrete");
  b.block(31, G0 + 0.55, 3.4, 1.1, "concrete");

  // ---------------------------------------------------------------- the terraces
  // Three tiers a side. Each gets a gunner behind a low wall and a crate of powder,
  // so a shot anywhere on a wall runs around the bowl rather than stopping.
  const tiers = [1, 2, 3];
  for (const t of tiers) {
    const y = FLOOR_Y + bowl.stepH * t;
    const inset = HALF - (HALF * 0.42 / 3) * (4 - t);
    for (const side of [-1, 1] as const) {
      const x = side * (inset + 2.5);
      b.gunner(t === 3 ? "guard" : "grunt", x, y, side > 0 ? -1 : 1, {
        behavior: "sentry", gun: t === 2 ? "shotgun" : "smg", range: 30,
      });
      b.block(x - side * 2.2, y + 0.55, 2.6, 1.1, "concrete");
      b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: x + side * 1.6, baseY: y, material: "explosive" });
    }
  }

  // ---------------------------------------------------------------- the floor
  // Whatever the quarry was here for, plus the crew. Dense, because the floor is where
  // a heavy round dropped from the rim is going to land.
  b.crowd(CX - 8, FLOOR_Y, ["grunt", "grunt", "guard"], 2, { behavior: "hunter" });
  b.crowd(CX + 8, FLOOR_Y, ["guard", "grunt"], 2, { behavior: "hunter" });
  b.enemy("boss", CX, FLOOR_Y, -1, { behavior: "hunter", gun: "shotgun" });

  b.spriteWall({ sheet: other, tx: 0, ty: 0, cols: 4, rows: 4, x: CX - 6, baseY: FLOOR_Y, material: "wood" });
  b.explosiveStack(CX + 5, FLOOR_Y, 5);
  b.explosiveStack(CX + 6.6, FLOOR_Y, 4);
  b.scatter(CX - 14, FLOOR_Y, 8, 4);
  b.teeter(CX + 13, FLOOR_Y, 7);
  b.prop({ sheet: b.sheet(ORES), tx: 0, ty: 0, tw: 2, th: 2, x: CX - 17, y: FLOOR_Y, z: 12 });
  b.prop({ sheet: b.sheet(ORES), tx: 2, ty: 2, tw: 2, th: 2, x: CX + 17, y: FLOOR_Y, z: 12 });
  b.prop({ sheet: b.sheet(ORES), tx: 2, ty: 0, tw: 2, th: 2, x: CX - 11, y: FLOOR_Y, z: 11 });
  b.prop({ sheet: b.sheet(ORES), tx: 0, ty: 2, tw: 2, th: 2, x: CX + 12.5, y: FLOOR_Y, z: 11 });
  // Spoil heaps against the foot of each wall — the arena's only claim that anybody
  // ever worked here, and the thing that stops the floor reading as a flat brown tray.
  b.landmark(LANDMARK.statue, CX - 20, FLOOR_Y, { scale: 0.9, z: 6 });
  b.dress(CX - 21, CX - 15, FLOOR_Y, { kind: "camp", density: 0.7, pitch: 1.5, salt: 4 });
  b.dress(CX + 15, CX + 21, FLOOR_Y, { kind: "camp", density: 0.7, pitch: 1.5, salt: 5 });

  // A gantry across the middle of the bowl, at rim height. Somewhere to stand that is
  // neither the rim nor the floor, and the first thing most players will shoot out.
  b.shelf(CX - 7, CX + 7, G0 - 3, 0.8);
  b.gunner("grunt", CX, G0 - 2.4, -1, { behavior: "sentry", gun: "sniper", range: 55 });

  // ---------------------------------------------------------------- the works
  // The ground between the two cuts, and the only flat, built-on part of the arena.
  // Sheds, a crusher and the crew who run it: after the first bowl the eye needs
  // something at its own height before it is asked to look down a second time.
  b.spriteWall({ sheet: other, tx: 0, ty: 0, cols: 4, rows: 4, x: 58, baseY: G0, material: "wood" });
  b.wall(70, G0, 4, 6, "concrete");
  b.block(70, G0 + 6.4, 6, 0.8, "concrete");
  b.gunner("guard", 70, G0 + 7, -1, { behavior: "sentry", gun: "sniper", range: 70, interval: 2.4 });
  b.spire(78, G0, 14, 2, "metal");
  b.crowd(64, G0, ["grunt", "grunt", "guard"], 2, { behavior: "hunter" });
  b.explosiveStack(74, G0, 6);
  b.block(82, G0 + 0.55, 3.4, 1.1, "concrete");
  b.gunner("grunt", 86, G0, -1, { behavior: "patrol", patrol: 5, gun: "smg" });
  b.prop({ sheet: b.sheet(ORES), tx: 2, ty: 0, tw: 2, th: 2, x: 54, y: G0, z: 12 });
  b.landmark(LANDMARK.logStack, 88, G0, { scale: 1.2, z: 6 });

  // ---------------------------------------------------------------- the deep cut
  // Eight metres deeper than the first and half as wide, so it is a shaft rather than a
  // bowl: the walls are close enough that a round dropped in has nowhere to spread, and
  // everything on the terraces is inside everything else's blast.
  for (const t of tiers) {
    const y = FLOOR2_Y + cut2.stepH * t;
    const inset = HALF2 - (HALF2 * 0.42 / 3) * (4 - t);
    for (const side of [-1, 1] as const) {
      const x = CX2 + side * (inset + 2.2);
      b.gunner(t === 2 ? "guard" : "grunt", x, y, side > 0 ? -1 : 1, {
        behavior: "sentry", gun: t === 3 ? "rifle" : "smg", range: 28,
      });
      b.block(x - side * 2, y + 0.55, 2.4, 1.1, "concrete");
      if (t !== 2) b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: x + side * 1.4, baseY: y, material: "explosive" });
    }
  }
  b.enemy("boss", CX2, FLOOR2_Y, -1, { behavior: "hunter", gun: "shotgun" });
  b.crowd(CX2 - 7, FLOOR2_Y, ["guard", "guard"], 2.1, { behavior: "hunter" });
  b.crowd(CX2 + 7, FLOOR2_Y, ["grunt", "grunt"], 2, { behavior: "hunter" });
  b.explosiveStack(CX2 + 3, FLOOR2_Y, 6);
  b.explosiveStack(CX2 - 3, FLOOR2_Y, 6);
  b.scatter(CX2 - 12, FLOOR2_Y, 8, 4);
  b.prop({ sheet: b.sheet(ORES), tx: 0, ty: 0, tw: 2, th: 2, x: CX2 - 15, y: FLOOR2_Y, z: 12 });
  b.prop({ sheet: b.sheet(ORES), tx: 2, ty: 2, tw: 2, th: 2, x: CX2 + 14, y: FLOOR2_Y, z: 11 });
  b.dress(CX2 - 16, CX2 - 10, FLOOR2_Y, { kind: "camp", density: 0.7, pitch: 1.5, salt: 9 });

  // A tipping stage out over the shaft, at the same height as the main bowl's gantry
  // and for the same reason: somewhere to stand that is neither the rim nor the floor.
  // Built as a shelf rather than as a deck on piers — piers long enough to reach a
  // floor twenty-three metres down are four bare poles running the whole height of the
  // frame, which reads as scaffolding nobody built rather than as a stage.
  b.shelf(CX2 - 16, CX2 - 2, G0 - 2, 0.8);
  b.gunner("guard", CX2 - 8, G0 - 1.4, -1, { behavior: "patrol", patrol: 5, gun: "shotgun" });

  // ---------------------------------------------------------------- the tips
  // Spoil, and the last of the garrison sitting on top of it. The far end is bare on
  // purpose: after two holes and a crusher the arena has said what it has to say, and
  // the walk out should be quiet enough to notice.
  b.pyramid(150, G0, 6, 1.0, "sandstone");
  b.landmark(LANDMARK.statue, 162, G0, { scale: 1.1, z: 6 });
  b.gunner("guard", 158, G0, -1, { behavior: "sentry", gun: "sniper", range: 75, interval: 2.3 });
  b.teeter(170, G0, 7);
  b.wall(180, G0, 4, 5, "gold", 0.7);
  b.crowd(176, G0, ["guard", "grunt"], 2.2, { behavior: "hunter" });
  b.prop({ sheet: b.sheet(`${PACK}/Tree3.png`), tx: 0, ty: 0, tw: 8, th: 6.5,
           x: 192, y: G0, scale: 1.15, z: 2, sway: 0.012 });

  return {
    // On the lip, not back from it.
    //
    // This used to spawn at -40, which was eighteen metres short of the bowl's near
    // edge — and the camera frames *upward*, so the arena's entire subject started off
    // the bottom of the screen and the opening shot of the Quarry was a photograph of
    // the sky. Four metres back from the edge puts the near wall, the terraces and the
    // floor of the pit in the first frame, which is the only thing this arena has to
    // say. It moves whenever `HALF` does: the number that matters is the gap, not the
    // coordinate. The haul road behind it is where you walk in *from*, not where you
    // start, for exactly the same reason.
    spawn: v(-31, G0 + 1.2),
    bounds: { min: -112, max: 194 },
    enemies: b.enemies,
    groundY: G0,
    ceiling: 38,
  };
}

export const PIT: LevelDef = {
  id: "pit",
  name: "The Quarry",
  tagline: "They are all looking up. That is your problem.",
  theme: "grove",
  gravity: -26,
  tags: ["BOWL", "IN THE ROUND", "HIGH GROUND"],
  accent: "#6ab04a",
  assets: PIT_ASSETS,
  shape: "bowl",
  // Frame nearly level. Every other arena wants the camera above the action; this one
  // is a hole, and the default bias put the hole off the bottom of the screen.
  frameUp: 0.15,
  build,
};
