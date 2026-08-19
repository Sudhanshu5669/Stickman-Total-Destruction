import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

const TORCH = "#ffb03a";

/**
 * Blackthorn Keep — a night siege.
 *
 * The level is named after a castle, so the opening frame is a castle: a lit curtain
 * wall with four men in the crenels, a roofed gate tower and a manned barricade, all
 * inside the first twenty metres. The old approach march across empty grass has been
 * cut entirely — the assault now starts at the wall and works inward through courtyard,
 * inner ward and keep, which is the same escalation with the walking removed.
 *
 * Stone is tough enough that the light rounds only chip it, which is the level's way of
 * pushing you toward the heavy ammo. The barrels stacked against every wall foot are
 * the shortcut, and they are placed so the first one is in range from the spawn.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  // ---------------------------------------------------------------- terrain
  b.ground(50, G0 - 3, 400, 6);
  b.ledge(-46, G0 + 2.4, 14, 1.2);
  b.ledge(-66, G0 + 5.0, 10, 1.2);

  // ---------------------------------------------------------------- behind the spawn
  b.scatter(-30, G0, 7, 3, ["wood", "wood", "glass"]);
  b.decor(-26, G0 + 0.2, "torch", TORCH);

  // ---------------------------------------------------------------- the curtain wall
  // A low barricade in the foreground with the wall rising behind it: the whole castle
  // is composed into the opening frame rather than approached across a field.
  b.wall(-12.5, G0, 5, 1.8, "wood", 0.6);
  b.decor(-15, G0 + 0.2, "torch", TORCH);
  b.crowd(-8.8, G0, ["grunt", "guard", "grunt"], 1.5);
  // Twelve metres out. A shot fired level from the spawn reaches it; its blast does not
  // reach back.
  b.explosiveStack(-5.9, G0, 3);

  b.castleTower({ x: -2.9, baseY: G0, w: 4.2, height: 10, roof: true, guards: ["guard"] });
  // Guards are handed to the builder so they land in the crenel gaps, not on the stone.
  const wallTop = b.battlement(7, G0, 16, 5.4, "concrete", ["guard", "grunt", "guard", "grunt"]);
  b.gate(7, G0, 3.6, 4.2, "concrete");
  b.castleTower({ x: 17.1, baseY: G0, w: 4.2, height: 10, roof: true, guards: ["guard"] });
  b.decor(2, wallTop + 0.1, "torch", TORCH);
  b.decor(12, wallTop + 0.1, "torch", TORCH);
  b.decor(4, wallTop + 2.6, "banner", "#8e2f3f");
  b.decor(10, wallTop + 2.6, "banner", "#8e2f3f");

  b.explosiveStack(21, G0, 4);
  b.crowd(25, G0, ["grunt", "grunt"], 2.0);

  // ---------------------------------------------------------------- courtyard
  b.house({ x: 32, baseY: G0, w: 6.5, h: 3.4, material: "wood", roof: "wood" });
  b.decor(36, G0 + 0.2, "torch", TORCH);
  b.crowd(38.5, G0, ["grunt", "guard"], 2.0);
  b.house({ x: 44, baseY: G0, w: 7, h: 3.8, material: "brick", roof: "brick" });
  // Siege stockpile: knock this and the whole courtyard goes up.
  b.explosiveStack(49.5, G0, 5);
  b.decor(52, G0 + 0.2, "torch", TORCH);
  b.crowd(53.5, G0, ["grunt", "grunt"], 2.2);

  // ---------------------------------------------------------------- inner ward
  b.explosiveStack(56, G0, 4);
  b.castleTower({ x: 60, baseY: G0, w: 4.6, height: 13, roof: true, guards: ["boss"] });
  b.battlement(70, G0, 16, 7.0, "concrete", ["guard", "guard", "grunt"]);
  b.castleTower({ x: 80, baseY: G0, w: 4.6, height: 13, roof: true, guards: ["guard", "guard"] });
  b.decor(58, G0 + 0.2, "torch", TORCH);
  b.decor(82, G0 + 0.2, "torch", TORCH);

  // ---------------------------------------------------------------- the keep
  // Both towers stand on one shared plinth, and the powder sits at the plinth's ends —
  // so the interesting shot is at the ground, not at the stone twenty metres up.
  b.wall(99, G0, 22, 2.2, "concrete", 0.8);
  b.explosiveStack(85, G0, 5);
  b.explosiveStack(113, G0, 5);
  b.castleTower({ x: 93, baseY: G0 + 2.2, w: 6.0, height: 18, roof: true, guards: ["boss", "guard"] });
  b.castleTower({ x: 105, baseY: G0 + 2.2, w: 6.0, height: 23, roof: true, guards: ["boss", "boss"] });
  b.catwalk(96.2, 101.8, G0 + 2.2 + 12, "wood");
  b.enemy("grunt", 99, G0 + 2.2 + 12.4, -1);
  b.crowd(99, G0 + 2.3, ["guard", "guard"], 2.6);
  b.decor(88, G0 + 2.4, "torch", TORCH);
  b.decor(110, G0 + 2.4, "torch", TORCH);
  b.decor(93, G0 + 2.2 + 18.6, "banner", "#c9a227");
  b.decor(105, G0 + 2.2 + 23.6, "banner", "#c9a227");

  // ---------------------------------------------------------------- treasury
  b.explosiveStack(118, G0, 3);
  b.decor(120, G0 + 0.2, "torch", TORCH);
  b.wall(124, G0, 5, 6, "gold", 0.7);
  b.crowd(131, G0, ["guard", "boss"], 2.4);

  // ---------------------------------------------------------------- outer bailey
  b.pyramid(142, G0, 6, 0.85, "concrete");
  b.crowd(149, G0, ["grunt", "guard", "grunt"], 2.0);
  b.tower({
    x: 156, baseY: G0, floors: 6, width: 4.0, material: "concrete",
    slab: "concrete", windows: false, guards: ["guard", "grunt"],
  });
  b.explosiveStack(160.5, G0, 4);
  b.scatter(166, G0, 8, 4, ["wood", "explosive", "wood"]);

  // ---------------------------------------------------------------- the last wall
  b.explosiveStack(171, G0, 6);
  b.decor(172, G0 + 0.2, "torch", TORCH);
  b.castleTower({ x: 176, baseY: G0, w: 5.0, height: 20, roof: true, guards: ["boss", "boss"] });
  b.battlement(186, G0, 16, 6.2, "concrete", ["guard", "guard", "guard"]);
  b.castleTower({ x: 196, baseY: G0, w: 5.0, height: 16, roof: true, guards: ["boss", "guard"] });
  b.explosiveStack(202, G0, 6);
  b.decor(200, G0 + 0.2, "torch", TORCH);
  b.crowd(206, G0, ["guard", "boss"], 2.4);
  b.wall(214, G0, 4, 6, "gold", 0.7);

  return {
    spawn: v(-17.5, G0 + 1.2),
    bounds: { min: -130, max: 230 },
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
