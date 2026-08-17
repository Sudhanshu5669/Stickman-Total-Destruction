import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import { v } from "../core/math";
import type { LevelDef, LevelInfo } from "./types";

/** One storey of `Builder.tower` = floor height + slab. Needed to line skybridges up. */
const FLOOR_PITCH = 1.8 + 0.34;

/**
 * Sandbox 01 — a left-to-right destruction range.
 *
 * Laid out as a difficulty ramp so the core loop teaches itself: crates, then a
 * house, then a proper tower, then a skyline you need the heavy ammo for.
 *
 * Placement rule of thumb: put stickmen on flat surfaces. Anything standing on a
 * pitched roof slides off and dies before the player has fired a shot.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0; // ground top surface

  // ---------------------------------------------------------------- terrain
  b.ground(60, G0 - 3, 260, 6);
  b.ground(-96, G0 - 3, 60, 6);
  b.ground(238, G0 - 3, 70, 6);
  // Floor of the canyon between the mid and far districts, so a fall is survivable
  // and the bridge piers have something to stand on.
  b.ground(196.5, G0 - 9, 17, 4, "#43443c", "#575a4a");

  b.ledge(-52, G0 + 2.2, 12, 1.1);
  b.ledge(-70, G0 + 4.6, 9, 1.1);
  b.ledge(150, G0 + 3.4, 10, 1.1);
  b.ledge(166, G0 + 6.2, 8, 1.1);

  // ---------------------------------------------------------------- tutorial yard
  b.scatter(-24, G0, 9, 4, ["wood", "wood", "wood", "glass"]);
  b.pyramid(-10, G0, 4, 0.7, "wood");
  b.wall(4, G0, 6, 3.2, "glass", 0.8);
  b.explosiveStack(12, G0, 3);
  b.enemy("grunt", 18, G0, -1);

  // ---------------------------------------------------------------- village
  b.house({ x: 30, baseY: G0, w: 6.5, h: 3.6, material: "wood" });
  b.enemy("grunt", 26, G0, -1);

  b.house({ x: 44, baseY: G0, w: 7.5, h: 4.2, material: "brick", roof: "brick" });
  b.enemy("grunt", 39, G0, -1);
  b.enemy("guard", 49, G0, -1);
  b.scatter(54, G0, 6, 2.5);

  // ---------------------------------------------------------------- the tower
  b.wall(64, G0, 9, 1.2, "concrete", 0.6);
  b.tower({
    x: 64, baseY: G0 + 1.2, floors: 6, width: 4.6, material: "brick",
    slab: "concrete", windows: true, goldTop: true,
    guards: ["grunt", "guard", "grunt"],
  });
  b.enemy("grunt", 59, G0, 1);
  b.enemy("grunt", 69, G0, -1);
  b.explosiveStack(72, G0, 4);

  // ---------------------------------------------------------------- twin towers
  // 8 and 10 storeys, both from y=0, so storey 4 lines up on each for the skybridge.
  b.tower({ x: 86, baseY: G0, floors: 8, width: 4.0, material: "concrete", windows: true, guards: ["guard", "guard"] });
  b.tower({ x: 96, baseY: G0, floors: 10, width: 4.4, material: "concrete", slab: "metal", windows: true, guards: ["boss"], goldTop: true });
  const skyY = G0 + FLOOR_PITCH * 4 + 0.18;
  b.catwalk(88.0, 93.8, skyY);
  b.enemy("grunt", 90.9, skyY + 0.2, -1);

  b.scatter(104, G0, 10, 5, ["wood", "explosive", "glass"]);

  // ---------------------------------------------------------------- the block
  b.wall(120, G0, 14, 2.4, "concrete", 0.8);
  b.house({ x: 116, baseY: G0 + 2.4, w: 6, h: 3.4, material: "brick" });
  b.house({ x: 126, baseY: G0 + 2.4, w: 6, h: 3.4, material: "brick" });
  b.enemy("guard", 112, G0 + 2.5, -1);
  b.enemy("guard", 130, G0 + 2.5, -1);
  b.pyramid(136, G0, 5, 0.8, "brick");

  // ---------------------------------------------------------------- the fortress
  b.wall(150, G0, 3, 8, "metal", 0.9);
  b.tower({
    x: 162, baseY: G0, floors: 7, width: 5.4, material: "metal",
    slab: "metal", windows: false, guards: ["boss", "guard"],
  });
  b.explosiveStack(156, G0, 5);
  b.enemy("guard", 144, G0, -1);
  b.enemy("guard", 173, G0, -1);

  // ---------------------------------------------------------------- canyon crossing
  const deckY = G0 + 0.4;
  b.bridge(188, 208, deckY, "wood", 5, G0 - 7);
  const deckTop = deckY + 0.37;
  b.enemy("grunt", 193, deckTop, -1);
  b.enemy("grunt", 203, deckTop, 1);
  b.explosiveStack(198, deckTop, 2);

  // ---------------------------------------------------------------- downtown finale
  b.tower({ x: 224, baseY: G0, floors: 12, width: 5.0, material: "concrete", slab: "metal", windows: true, guards: ["guard", "guard"] });
  b.tower({ x: 236, baseY: G0, floors: 16, width: 5.6, material: "concrete", slab: "metal", windows: true, guards: ["boss", "boss"], goldTop: true });
  b.tower({ x: 248, baseY: G0, floors: 10, width: 4.6, material: "brick", slab: "concrete", windows: true, guards: ["guard"] });
  const dtSkyY = G0 + FLOOR_PITCH * 6 + 0.18;
  b.catwalk(226.5, 233.2, dtSkyY);
  b.wall(258, G0, 4, 6, "gold", 0.7);
  b.scatter(214, G0, 12, 4, ["wood", "explosive", "glass", "explosive"]);
  b.enemy("boss", 262, G0, -1);

  return {
    spawn: v(-30, G0 + 1.2),
    bounds: { min: -120, max: 275 },
    enemies: b.enemies,
    groundY: G0,
  };
}

export const SANDBOX: LevelDef = {
  id: "sandbox",
  name: "Test Range",
  tagline: "Daylight, crates and a skyline. Learn what each round does here.",
  theme: "day",
  gravity: -26,
  tags: ["DAYLIGHT", "SANDBOX", "TUTORIAL"],
  accent: "#ffd23f",
  build,
};
