import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

const BEACON = "#ff8a5c";

/**
 * Ares Colony — a Martian outpost at roughly a third of Earth gravity.
 *
 * Low gravity changes the game rather than just the look: you jump about four metres,
 * recoil throws you much further, and every round carries three times the range. The
 * layout is built for that — wide gaps, tall structures, and rooftops meant to be
 * reached by rocket-jumping rather than walked to.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  // ---------------------------------------------------------------- terrain
  b.ground(90, G0 - 3, 340, 6);
  b.ground(-110, G0 - 3, 90, 6);
  // Mesas: stepping stones that only make sense with a Martian jump.
  b.ledge(-56, G0 + 3.2, 12, 1.4);
  b.ledge(-76, G0 + 7.0, 10, 1.4);
  b.ledge(30, G0 + 5.5, 12, 1.4);
  b.ledge(46, G0 + 10.0, 10, 1.4);
  b.ledge(120, G0 + 6.5, 14, 1.4);

  // ---------------------------------------------------------------- landing zone
  b.scatter(-28, G0, 8, 4, ["hull", "sandstone", "explosive"]);
  b.dome(-14, G0, 4.6, "hull", 13, 0.5);
  b.decor(-14, G0 + 4.8, "antenna", "#c9d2de");
  b.enemy("grunt", -4, G0, -1);

  // ---------------------------------------------------------------- habitat row
  b.dome(10, G0, 5.5, "hull", 15, 0.55);
  b.enemy("grunt", 4, G0, -1);
  b.enemy("guard", 16, G0, -1);
  b.decor(10, G0 + 5.7, "antenna", "#c9d2de");
  b.explosiveStack(22, G0, 3);

  b.pyramid(36, G0, 4, 0.85, "sandstone");
  b.enemy("grunt", 30, G0 + 6.3, -1);
  b.enemy("grunt", 46, G0 + 10.8, -1);

  // ---------------------------------------------------------------- comm array
  b.spire(58, G0, 18, 1.4, "metal", 0);
  b.decor(58, G0 + 18, "antenna", BEACON);
  b.spire(66, G0, 13, 1.2, "metal", 0);
  b.decor(66, G0 + 13, "antenna", BEACON);
  b.enemy("guard", 62, G0, -1);
  b.wall(74, G0, 8, 2.4, "sandstone", 0.7);
  b.enemy("guard", 74, G0 + 2.6, -1);

  // ---------------------------------------------------------------- main colony
  b.wall(96, G0, 20, 2.8, "hull", 0.9);
  b.dome(90, G0 + 2.8, 5.0, "hull", 13, 0.5);
  b.dome(104, G0 + 2.8, 5.0, "hull", 13, 0.5);
  b.enemy("guard", 84, G0 + 3.0, -1);
  b.enemy("guard", 110, G0 + 3.0, -1);
  // On a dome apex, not in the gap between the two.
  b.decor(90, G0 + 8.0, "antenna", BEACON);

  // Tall, because low gravity lets these stand far past an Earth silhouette.
  b.tower({
    x: 128, baseY: G0, floors: 14, width: 4.6,
    material: "hull", slab: "metal", windows: true,
    guards: ["guard", "guard"], goldTop: true,
  });
  b.tower({
    x: 142, baseY: G0, floors: 20, width: 5.2,
    material: "hull", slab: "metal", windows: true,
    guards: ["boss", "boss"],
  });
  b.catwalk(130.4, 139.4, G0 + (1.8 + 0.34) * 7 + 0.18, "metal");
  b.enemy("grunt", 135, G0 + (1.8 + 0.34) * 7 + 0.38, -1);
  b.explosiveStack(150, G0, 5);

  // ---------------------------------------------------------------- fuel farm
  b.explosiveStack(166, G0, 6);
  b.explosiveStack(170, G0, 6);
  b.explosiveStack(174, G0, 6);
  b.wall(170, G0, 14, 1.4, "sandstone", 0.7);
  b.enemy("guard", 160, G0, -1);
  b.enemy("guard", 180, G0, -1);
  b.decor(170, G0 + 6, "antenna", BEACON);

  // ---------------------------------------------------------------- deep site
  b.dome(196, G0, 8.0, "hull", 19, 0.6);
  b.decor(196, G0 + 8.2, "antenna", "#c9d2de");
  b.enemy("boss", 190, G0, -1);
  b.enemy("guard", 204, G0, -1);

  b.tower({
    x: 220, baseY: G0, floors: 24, width: 5.6,
    material: "hull", slab: "metal", windows: true,
    guards: ["boss", "boss"], goldTop: true,
  });
  b.spire(234, G0, 26, 2.0, "metal", 0.03);
  b.decor(234, G0 + 26, "antenna", BEACON);
  b.pyramid(248, G0, 6, 0.9, "sandstone");
  b.enemy("boss", 258, G0, -1);
  b.wall(266, G0, 4, 6, "gold", 0.7);

  return {
    spawn: v(-34, G0 + 1.2),
    bounds: { min: -140, max: 280 },
    enemies: b.enemies,
    groundY: G0,
  };
}

export const MARS: LevelDef = {
  id: "mars",
  name: "Ares Colony",
  tagline: "One third gravity. Everything you fire goes three times as far.",
  theme: "mars",
  gravity: -9.6,
  tags: ["LOW GRAVITY", "LONG RANGE", "BIG AIR"],
  accent: "#ff8a5c",
  build,
};
