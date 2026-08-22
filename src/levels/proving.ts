import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * The Proving Ground — the QA harness, and a real arena.
 *
 * This is where every system is tested before it is allowed near the six shipping
 * arenas, and it stays in the repo for the life of the project for exactly that reason.
 * It is not scaffolding: when the camera changes, this is where you check the camera;
 * when the AI changes, this is where you watch it think; when a material is retuned,
 * this is the control group that shows it.
 *
 * It earns its place in the arena list too. A flat, legible, over-supplied range is the
 * best possible first thirty seconds for somebody who has just arrived and wants to find
 * out what a gun that fires elephants does — so the thing built for testing is also the
 * thing built for learning, and it ships.
 *
 * ## Layout
 *
 * Bands, left to right, each isolating one thing worth looking at, with a clear firing
 * lane in front of all of them and nothing tall enough to block the next band along:
 *
 * | x        | band              | exists to test                                    |
 * |----------|-------------------|---------------------------------------------------|
 * | -34      | spawn             | —                                                 |
 * | -30..-8  | material control  | every `MaterialId`, identical geometry            |
 * | -4..8    | structures        | collapse — tower, house, wall, pyramid            |
 * | 12..26   | loose physics     | scatter, teeter, explosive chain                  |
 * | 30..44   | pixel art         | `spriteWall` / `spriteBlock` / `prop` / `skin`    |
 * | 48..70   | the cast          | every enemy kind and behaviour, with real cover   |
 * | 74..110  | the long shot     | camera reach and aim-lead at distance             |
 *
 * The range markers past x=74 are the reason the last band exists: they are placed at
 * known distances so "can the camera see what I am aiming at" has a *measurable* answer
 * rather than an impression. See System 4 in `SYSTEMS.md`.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles1.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const DECOR = `${PACK}/Decor.png`;
const OTHER = `${PACK}/Other Tiles1.png`;
const CAMPFIRE = `${PACK}/Animated Sprites/Campfire sheet.png`;

/** Decoded before `build` runs — `spriteWall` reads the artwork's alpha. See `LevelDef.assets`. */
export const PROVING_ASSETS: readonly string[] = [
  FLOOR, HOUSE, DECOR, OTHER, CAMPFIRE,
  `${PACK}/Tree1.png`, `${PACK}/Birch1.png`, `${PACK}/Tall Grass.png`,
];

/** Every material in the game, in one row, so a tuning change shows up as a difference. */
const MATERIALS = [
  "wood", "brick", "concrete", "glass", "metal", "ice",
  "gold", "sandstone", "crystal", "biomass", "hull", "explosive",
] as const;

function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  // One continuous slab, spanning x -50..125 — everything the arena uses, plus slack.
  //
  // NOTE `ground(x, y, w, h)` places a slab by its **centre**, not its bottom-left
  // corner (see `Terrain`). Reading it as a corner is what left bands 5 and 6 of this
  // arena standing over a void, with every stickman in them quietly falling out of the
  // world while the anchored props hung in the air looking fine.
  // `skinnedGround` takes explicit edges, which is why this can be read at a glance and
  // the centre-based `ground()` it replaces could not. See the note on `Builder`.
  b.skinnedGround(-50, 125, G0, b.sheet(FLOOR));

  // ------------------------------------------------------- band 0: crouch cover
  // The only geometry in the arena that tests ducking, and it needs its own clear lane.
  //
  // A full-height wall gives *binary* cover: an enemy is either already behind one or
  // would have to walk through it to get behind it, so no amount of searching can change
  // its situation. A low parapet is the shape that works — the gunner stands beside it
  // in the open, and dropping below it is both reachable and effective. See
  // `Enemy.crouch` and `CHEST_CROUCH`.
  //
  // Placed left of the spawn, where nothing else can wander into the sightline. The
  // first version of this sat at x=78 and was silently blocked by a range marker two
  // metres further on, which cost an hour of believing the AI was broken.
  b.block(-40, G0 + 0.55, 3.2, 1.1, "concrete");
  b.gunner("grunt", -44, G0, 1, { behavior: "patrol", patrol: 2, gun: "rifle" });

  // ------------------------------------------------------- band 1: material control
  // Identical stacks, one per material, same size and spacing. Everything about them is
  // held constant *except* the material, which is the only way a change in how wood
  // behaves is visible rather than merely plausible.
  MATERIALS.forEach((m, i) => {
    const x = -30 + i * 1.9;
    for (let row = 0; row < 3; row++) b.block(x, G0 + 0.5 + row * 1.0, 1.4, 1.0, m);
  });

  // ------------------------------------------------------- band 2: structures
  // The four collapse shapes, close enough together that one big round reaches all of
  // them and far enough apart that each fails on its own.
  b.tower({ x: -3, baseY: G0, floors: 6, width: 4.5, material: "concrete", windows: true });
  b.house({ x: 4, baseY: G0, w: 5, h: 3, material: "brick" });
  b.wall(10, G0, 4, 5, "brick");
  b.pyramid(16, G0, 5, 0.9, "wood");

  // ------------------------------------------------------- band 3: loose physics
  b.scatter(22, G0, 8, 3.5);
  b.teeter(27, G0, 6);
  b.explosiveStack(31, G0, 5);

  // ------------------------------------------------------- band 4: pixel art
  // The sprite path, exercised end to end: a structure built from its own artwork, loose
  // skinned crates, an animated prop and flat scenery. If the tileset pipeline breaks,
  // it breaks here before it breaks in an arena somebody is trying to enjoy.
  const house = b.sheet(HOUSE);
  const decor = b.sheet(DECOR);
  const other = b.sheet(OTHER);

  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 36, baseY: G0, material: "brick" });
  b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: 42.5, baseY: G0, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: 43.7, baseY: G0, material: "wood" });
  b.spriteBlock({ sheet: decor, tx: 0, ty: 0, x: 42.5, baseY: G0 + 1, material: "wood" });
  b.prop({ sheet: b.sheet(CAMPFIRE), tx: 0, ty: 0, tw: 1, th: 1, x: 45.5, y: G0, scale: 1.6, z: 12, frames: 40, fps: 14 });
  b.prop({ sheet: b.sheet(`${PACK}/Tree1.png`), tx: 0, ty: 0, tw: 8, th: 6.5, x: 33, y: G0, z: 2, sway: 0.012 });
  b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x: 40, y: G0, z: 12 });
  // Planks, so a sprite-skinned *anchored* block is on the bench too.
  for (let i = 0; i < 4; i++) {
    b.spriteBlock({ sheet: other, tx: i % 4, ty: 6, x: 47.5 + i, baseY: G0 + 2.4, material: "wood", anchored: true });
  }

  // ------------------------------------------------------- band 5: the cast
  // Every kind and every behaviour, each with something to stand behind. The cover is
  // the point: an AI that takes cover cannot be evaluated on an empty field, and the
  // previous build's flat maps are exactly why "the enemies just stand there" was true.
  b.crowd(53, G0, ["grunt", "grunt"], 1.9, null);       // unarmed — panic and topple
  b.enemy("boss", 56.5, G0, -1, null);                   // unarmed heavyweight

  b.wall(60, G0, 2.4, 2.2, "concrete");                  // chest-high cover
  b.gunner("grunt", 62, G0, -1, { behavior: "patrol" });
  b.gunner("guard", 65, G0, -1, { behavior: "hunter" });

  b.wall(69, G0, 3, 6, "brick");                         // a wall to break line of sight
  b.gunner("grunt", 69, G0 + 6, -1, { behavior: "sentry" });
  b.gunner("guard", 72, G0, -1, { gun: "shotgun", behavior: "hunter" });


  // ------------------------------------------------------- band 6: the long shot
  // Range markers at known distances from the last cover, for measuring camera reach.
  // A sniper at the far end so the *enemy's* sightline is testable too, not just ours.
  [80, 90, 100, 110].forEach((x, i) => {
    b.block(x, G0 + 1.5, 0.5, 3, "metal");
    b.block(x, G0 + 3.4, 1.6, 0.8, "glass");
    if (i % 2 === 0) b.spriteBlock({ sheet: decor, tx: 2, ty: 0, x: x + 1.4, baseY: G0, material: "explosive" });
  });
  b.gunner("guard", 112, G0, -1, { gun: "sniper", behavior: "sentry" });

  // ------------------------------------------------------- band 7: shape primitives
  // The four span/shape builders the six shipping arenas are made of, each proved here
  // before an arena is authored on top of it. They are the pieces most likely to be
  // subtly wrong — a shelf a metre from where you meant it is invisible in code and
  // obvious the moment a stickman walks off it.
  //
  // Deliberately past the sniper: this band is a test rig, not a place to fight.

  // `islands` — a chain over a drop, rising as it goes.
  b.islands(132, 5, { width: 7, gap: 5, top: G0 + 2, rise: 1.6 });

  // Ground under the scaffold and up to the basin rim. The islands keep their void on
  // purpose — a chain of platforms with a floor under it is a set of steps.
  b.skinnedGround(172, 199, G0, b.sheet(FLOOR));

  // `scaffold` — a tower with a climbable open side and a landing per storey.
  b.scaffold({ x: 178, baseY: G0, floors: 5, width: 6, material: "concrete",
               guards: ["grunt", "guard"], arms: { behavior: "sentry" } });

  // `basin` — a stepped pit with a rim to look into it from.
  b.basin(215, 16, G0, G0 - 9, 3);
  b.crowd(215, G0 - 9, ["grunt", "grunt", "guard"], 2.2, null);

  return {
    spawn: v(-34, G0 + 1.2),
    bounds: { min: -44, max: 245 },
    enemies: b.enemies,
    groundY: G0,
  };
}

export const PROVING: LevelDef = {
  id: "proving",
  name: "Proving Ground",
  tagline: "Nothing here has any sentimental value.",
  theme: "day",
  gravity: -26,
  tags: ["OPEN", "EVERY TOY"],
  accent: "#ffd23f",
  assets: PROVING_ASSETS,
  thumbArt: { path: HOUSE, tx: 1, ty: 0, tw: 5, th: 7 },
  build,
};
