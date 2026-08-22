import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * The Proving Ground — the QA harness, and a real arena.
 *
 * This is the level every system is tested in before it is allowed near the six shipping
 * arenas, and it stays in the repo for the life of the project for exactly that reason.
 * It is not scaffolding and it is not throwaway: when the camera changes, this is where
 * you check the camera; when the AI changes, this is where you watch it think.
 *
 * It earns its place in the arena list too. A flat, legible, over-supplied range is the
 * best possible first thirty seconds for somebody who has just arrived and wants to find
 * out what a gun that fires elephants does — so the thing built for testing is also the
 * thing built for learning, and it ships.
 *
 * Laid out left to right in bands, each band isolating one thing worth looking at, with
 * a wide clear firing lane in front of all of them.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  void game;

  b.ground(-40, G0 - 3, 200, 6);

  // ------------------------------------------------------- band 1: materials
  // One column per material, same size, same spacing: the control group. If a weapon
  // change makes wood behave like concrete, it shows up here and nowhere else.
  const mats = ["wood", "brick", "concrete", "glass", "metal", "ice", "gold", "sandstone"] as const;
  mats.forEach((m, i) => {
    const x = -28 + i * 3.2;
    for (let row = 0; row < 4; row++) b.block(x, G0 + 0.6 + row * 1.2, 1.6, 1.2, m);
  });

  // ------------------------------------------------------- band 2: a thing to topple
  b.tower({ x: 6, baseY: G0, floors: 7, width: 5, material: "concrete", slab: "concrete" });

  // ------------------------------------------------------- band 3: loose physics
  b.scatter(20, G0, 10, 5);
  b.explosiveStack(28, G0, 5);

  // ------------------------------------------------------- band 4: the cast
  // Unarmed, armed and elevated, so panic, combat and falling can all be watched at once.
  b.crowd(38, G0, ["grunt", "grunt", "guard"], 1.9, null);
  b.gunner("guard", 48, G0, -1, { behavior: "patrol" });
  b.gunner("grunt", 54, G0, -1, { behavior: "hunter" });

  b.wall(62, G0, 4, 6, "brick");
  b.gunner("grunt", 64, G0 + 6, -1, { behavior: "sentry" });
  b.enemy("boss", 72, G0, -1, null);

  return {
    spawn: v(-34, G0 + 1.2),
    bounds: { min: -46, max: 92 },
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
  build,
};
