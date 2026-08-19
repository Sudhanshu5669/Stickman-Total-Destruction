import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

const BEACON = "#ff8a5c";

/** One storey of `Builder.tower` = floor height + slab. Needed to line skybridges up. */
const FLOOR_PITCH = 1.8 + 0.34;

/**
 * Ares Colony — a Martian outpost at roughly a third of Earth gravity.
 *
 * Low gravity changes the game rather than just the look: you jump about four metres,
 * recoil throws you much further, and every round carries three times the range. The
 * layout is built for that — wide gaps, tall structures, and rooftops meant to be
 * reached by rocket-jumping rather than walked to.
 *
 * It also changes what a collapse looks like, which is why the opening frame is a
 * thirty-metre hull tower ten metres from the spawn with a fuel tank at each foot. On
 * Earth that tower would fold into its own footprint; here the top half sails. The
 * first shot of the level should be at the near tank, and the tank is placed exactly
 * far enough out that its blast reaches the tower and not the player.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  // ---------------------------------------------------------------- terrain
  b.ground(70, G0 - 3, 420, 6);
  // Mesas: stepping stones that only make sense with a Martian jump.
  b.ledge(-48, G0 + 3.2, 12, 1.4);
  b.ledge(-68, G0 + 7.0, 10, 1.4);
  b.ledge(34, G0 + 6.5, 12, 1.4);
  b.ledge(52, G0 + 11.0, 10, 1.4);
  b.ledge(140, G0 + 7.5, 14, 1.4);

  // ---------------------------------------------------------------- landing zone
  b.scatter(-30, G0, 8, 4, ["hull", "sandstone", "explosive"]);
  b.dome(-24, G0, 4.6, "hull", 13, 0.5);
  b.decor(-24, G0 + 4.8, "antenna", "#c9d2de");

  // ---------------------------------------------------------------- the depot
  b.crowd(-11, G0, ["grunt", "guard", "grunt"], 1.9);
  b.explosiveStack(-6, G0, 5);
  b.tower({
    x: 4, baseY: G0, floors: 14, width: 5.0, material: "hull",
    slab: "metal", windows: true, goldTop: true, guards: ["boss", "guard", "grunt"],
  });
  b.enemy("guard", 2.7, G0, 1);
  b.enemy("guard", 5.3, G0, -1);
  b.explosiveStack(9, G0, 6);
  // Cargo left on the pad and never secured. In this gravity it goes a long way.
  b.teeter(-1.4, G0, 4, 0.9, "sandstone");
  b.teeter(12.5, G0, 5, 0.9, "hull");

  // ---------------------------------------------------------------- habitat row
  b.dome(19, G0, 5.6, "hull", 15, 0.55);
  b.enemy("guard", 19, G0 + 5.85, -1);
  b.crowd(27, G0, ["grunt", "guard", "grunt"], 2.0);
  b.pyramid(33.5, G0, 5, 0.9, "sandstone");
  // On the mesas, where only a rocket-jump reaches them.
  b.enemy("grunt", 34, G0 + 7.25, -1);
  b.enemy("grunt", 52, G0 + 11.75, -1);
  b.teeter(38, G0 + 7.25, 4, 0.8, "hull");

  // ---------------------------------------------------------------- comm array
  b.spire(42, G0, 20, 1.6, "metal", 0);
  b.decor(42, G0 + 20, "antenna", BEACON);
  b.crowd(46, G0, ["guard", "grunt"], 2.2);
  b.spire(60, G0, 15, 1.4, "metal", 0);
  b.decor(60, G0 + 15, "antenna", BEACON);
  b.explosiveStack(64, G0, 4);
  b.explosiveStack(68, G0, 5);

  // ---------------------------------------------------------------- main colony
  b.wall(82, G0, 20, 2.8, "hull", 0.9);
  b.dome(76, G0 + 2.8, 5.0, "hull", 13, 0.5);
  b.dome(88, G0 + 2.8, 5.0, "hull", 13, 0.5);
  // On the plinth, in the gap between the two domes — anything else on it is under a
  // skirt panel and gets shoved through the roof on load.
  b.enemy("guard", 82, G0 + 2.9, -1);
  b.enemy("guard", 72.5, G0 + 2.9, 1);
  b.enemy("guard", 91.5, G0 + 2.9, -1);
  b.decor(76, G0 + 8.0, "antenna", BEACON);
  b.explosiveStack(96, G0, 5);
  b.crowd(100, G0, ["grunt", "grunt"], 2.0);

  // ---------------------------------------------------------------- the high pair
  b.crowd(105, G0, ["guard", "grunt"], 2.2);
  b.tower({
    x: 110, baseY: G0, floors: 16, width: 4.8, material: "hull",
    slab: "metal", windows: true, guards: ["guard", "guard"],
  });
  b.tower({
    x: 124, baseY: G0, floors: 22, width: 5.4, material: "hull",
    slab: "metal", windows: true, goldTop: true, guards: ["boss", "boss"],
  });
  const skyY = G0 + FLOOR_PITCH * 8 + 0.18;
  b.catwalk(112.4, 121.3, skyY);
  b.enemy("grunt", 117, skyY + 0.2, -1);
  b.explosiveStack(117, G0, 6);
  b.enemy("guard", 128, G0, -1);

  // ---------------------------------------------------------------- fuel farm
  b.crowd(131, G0, ["guard", "grunt"], 2.2);
  b.explosiveStack(136, G0, 6);
  b.explosiveStack(140, G0, 6);
  b.explosiveStack(144, G0, 6);
  // Standing on the mesa directly over three full tanks. He has not thought this through.
  b.enemy("grunt", 140, G0 + 8.25, -1);
  b.decor(147, G0 + 6, "antenna", BEACON);
  b.crowd(150, G0, ["guard", "guard"], 2.2);

  // ---------------------------------------------------------------- deep site
  b.enemy("boss", 154, G0, 1);
  b.dome(164, G0, 8.0, "hull", 19, 0.6);
  b.decor(164, G0 + 8.2, "antenna", "#c9d2de");
  b.crowd(176, G0, ["guard", "grunt"], 2.2);
  b.hive(180, G0, 5, "sandstone");
  b.explosiveStack(186, G0, 5);

  // ---------------------------------------------------------------- the high colony
  b.crowd(192, G0, ["guard", "boss"], 2.4);
  b.tower({
    x: 198, baseY: G0, floors: 18, width: 5.0, material: "hull",
    slab: "metal", windows: true, guards: ["guard", "guard"],
  });
  b.tower({
    x: 212, baseY: G0, floors: 26, width: 5.8, material: "hull",
    slab: "metal", windows: true, goldTop: true, guards: ["boss", "boss"],
  });
  const hiSky = G0 + FLOOR_PITCH * 11 + 0.18;
  b.catwalk(200.5, 209.1, hiSky);
  b.enemy("grunt", 205, hiSky + 0.2, -1);
  b.explosiveStack(205, G0, 6);

  b.spire(224, G0, 28, 2.0, "metal", 0.03);
  b.decor(224, G0 + 28, "antenna", BEACON);
  b.pyramid(236, G0, 6, 0.9, "sandstone");
  b.crowd(244, G0, ["boss", "guard"], 2.4);
  b.wall(252, G0, 4, 6, "gold", 0.7);

  return {
    spawn: v(-16, G0 + 1.2),
    bounds: { min: -130, max: 265 },
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
