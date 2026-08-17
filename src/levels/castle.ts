import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

const TORCH = "#ffb03a";

/**
 * Blackthorn Keep — a night siege.
 *
 * Reads left to right as an assault: outer palisade, curtain wall and gatehouse,
 * courtyard, then the keep itself. Stone is tough enough that the light rounds only
 * chip it, which is the level's way of pushing you toward the heavy ammo.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  // ---------------------------------------------------------------- terrain
  b.ground(70, G0 - 3, 300, 6);
  b.ground(-110, G0 - 3, 90, 6);
  b.ledge(-58, G0 + 2.4, 14, 1.2);
  b.ledge(-78, G0 + 5.0, 10, 1.2);

  // ---------------------------------------------------------------- approach
  b.scatter(-26, G0, 8, 4, ["wood", "wood", "explosive"]);
  b.decor(-24, G0 + 0.2, "torch", TORCH);
  b.pyramid(-12, G0, 4, 0.72, "wood");
  b.enemy("grunt", 2, G0, -1);

  // Wooden palisade, with its defenders standing at its foot.
  b.wall(14, G0, 7, 3.0, "wood", 0.7);
  b.enemy("grunt", 10, G0, -1);
  b.enemy("grunt", 19, G0, -1);
  b.decor(10, G0 + 0.2, "torch", TORCH);
  b.decor(18, G0 + 0.2, "torch", TORCH);

  // ---------------------------------------------------------------- curtain wall
  // Guards are handed to the builder so they land in the crenel gaps, not on the stone.
  const wallTop = b.battlement(40, G0, 22, 5.4, "concrete", ["guard", "grunt", "guard"]);
  b.decor(31, wallTop + 0.1, "torch", TORCH);
  b.decor(49, wallTop + 0.1, "torch", TORCH);
  b.decor(36, wallTop + 2.4, "banner", "#8e2f3f");
  b.decor(44, wallTop + 2.4, "banner", "#8e2f3f");

  // Flanking gate towers.
  b.castleTower({ x: 27, baseY: G0, w: 4.2, height: 8.5, roof: true, guards: ["guard"] });
  b.castleTower({ x: 53, baseY: G0, w: 4.2, height: 8.5, roof: true, guards: ["guard"] });
  b.gate(40, G0, 3.6, 4.2, "concrete");
  b.explosiveStack(58, G0, 4);

  // ---------------------------------------------------------------- courtyard
  b.house({ x: 70, baseY: G0, w: 6.5, h: 3.4, material: "wood", roof: "wood" });
  b.enemy("grunt", 65, G0, -1);
  b.decor(75, G0 + 0.2, "torch", TORCH);
  b.house({ x: 84, baseY: G0, w: 7, h: 3.8, material: "brick", roof: "brick" });
  b.enemy("guard", 90, G0, -1);
  b.scatter(96, G0, 7, 3, ["wood", "wood", "explosive"]);

  // Siege stockpile: knock this and the whole courtyard goes up.
  b.explosiveStack(102, G0, 5);
  b.decor(99, G0 + 0.2, "torch", TORCH);

  // ---------------------------------------------------------------- inner wall
  b.battlement(118, G0, 16, 7.0, "concrete", ["guard", "guard"]);
  b.castleTower({ x: 108, baseY: G0, w: 4.6, height: 12, roof: true, guards: ["boss"] });
  b.castleTower({ x: 128, baseY: G0, w: 4.6, height: 12, roof: true, guards: ["guard", "guard"] });
  b.decor(110, G0 + 0.2, "torch", TORCH);
  b.decor(126, G0 + 0.2, "torch", TORCH);

  // ---------------------------------------------------------------- the keep
  b.wall(160, G0, 20, 2.2, "concrete", 0.8);
  b.castleTower({ x: 152, baseY: G0 + 2.2, w: 6.0, height: 18, roof: true, guards: ["boss", "guard"] });
  b.castleTower({ x: 168, baseY: G0 + 2.2, w: 6.0, height: 22, roof: true, guards: ["boss", "boss"] });
  b.catwalk(155.2, 164.8, G0 + 2.2 + 12, "wood");
  b.enemy("grunt", 160, G0 + 2.2 + 12.4, -1);
  b.decor(148, G0 + 2.4, "torch", TORCH);
  b.decor(172, G0 + 2.4, "torch", TORCH);
  b.decor(152, G0 + 2.2 + 18.6, "banner", "#c9a227");
  b.decor(168, G0 + 2.2 + 22.6, "banner", "#c9a227");

  // Treasury behind the keep.
  b.wall(190, G0, 5, 5, "gold", 0.7);
  b.enemy("boss", 198, G0, -1);
  b.decor(186, G0 + 0.2, "torch", TORCH);

  // Outer bailey ruins.
  b.pyramid(212, G0, 5, 0.8, "concrete");
  b.scatter(226, G0, 9, 5, ["wood", "explosive", "wood"]);
  b.enemy("guard", 234, G0, -1);

  return {
    spawn: v(-34, G0 + 1.2),
    bounds: { min: -140, max: 250 },
    enemies: b.enemies,
    groundY: G0,
  };
}

export const CASTLE: LevelDef = {
  id: "castle",
  name: "Blackthorn Keep",
  tagline: "A castle, at night, with a very poor security posture.",
  theme: "night",
  gravity: -26,
  tags: ["NIGHT", "STONE", "SIEGE"],
  accent: "#c9a227",
  build,
};
