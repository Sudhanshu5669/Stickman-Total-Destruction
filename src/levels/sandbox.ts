import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import { v } from "../core/math";
import type { LevelDef, LevelInfo } from "./types";

/** One storey of `Builder.tower` = floor height + slab. Needed to line skybridges up. */
const FLOOR_PITCH = 1.8 + 0.34;

/**
 * Sandbox 01 — a left-to-right destruction range.
 *
 * The ramp is still crates → house → tower → skyline, but it no longer *starts* with
 * the crates. The camera shows roughly forty metres, so anything more than twenty
 * metres from the spawn does not exist as far as a new player is concerned: the level
 * opens with a manned high-rise pair fourteen metres ahead, barrels under the skybridge
 * between them, and people on the ground, the roofs and the span. A single round fired
 * level from the spawn reaches the barrels, and the barrels reach everything else.
 *
 * Set-pieces sit roughly thirty metres apart from there on, which is a few seconds of
 * walking — never long enough to wonder whether the level has ended.
 *
 * Placement rule of thumb: put stickmen on flat surfaces. Anything standing on a
 * pitched roof slides off and dies before the player has fired a shot.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0; // ground top surface

  // ---------------------------------------------------------------- terrain
  b.ground(13, G0 - 3, 346, 6);
  // Floor of the canyon between the mid and far districts, so a fall is survivable
  // and the bridge piers have something to stand on.
  b.ground(194, G0 - 9, 18, 4, "#43443c", "#575a4a");
  b.ground(251, G0 - 3, 98, 6);

  b.ledge(-34, G0 + 2.4, 12, 1.1);
  b.ledge(-52, G0 + 5.0, 10, 1.1);
  b.ledge(160, G0 + 3.4, 10, 1.1);
  b.ledge(176, G0 + 6.2, 8, 1.1);

  // ---------------------------------------------------------------- behind the spawn
  // The player starts facing right, so this is only ever peripheral — but an empty
  // half-frame still reads as an empty level.
  b.scatter(-30, G0, 6, 2.5, ["wood", "wood", "glass"]);
  b.house({ x: -22, baseY: G0, w: 6.0, h: 3.4, material: "wood" });
  b.enemy("grunt", -17, G0, 1);

  // ---------------------------------------------------------------- ignition row
  // The opening frame. Two towers ten metres apart with a span between them, and the
  // barrel stack sitting under the span at exactly the height of a level shot.
  b.crowd(-1.5, G0, ["grunt", "guard", "grunt"], 1.9);
  // Eleven metres out: inside a level shot's reach, outside its 6.5m blast radius.
  b.explosiveStack(3.0, G0, 3);

  b.tower({
    x: 7, baseY: G0, floors: 7, width: 4.6, material: "brick",
    slab: "concrete", windows: true, guards: ["grunt", "guard", "grunt"],
  });
  // In the ground-floor bays, between the columns — the tower comes populated.
  b.enemy("grunt", 5.9, G0, -1);
  b.enemy("guard", 8.1, G0, 1);

  b.tower({
    x: 17, baseY: G0, floors: 10, width: 4.4, material: "concrete",
    slab: "metal", windows: true, goldTop: true, guards: ["boss", "guard"],
  });
  b.enemy("grunt", 16.1, G0, -1);
  b.enemy("grunt", 20.2, G0, -1);

  const skyY = G0 + FLOOR_PITCH * 4 + 0.18;
  b.catwalk(9.3, 14.8, skyY);
  b.enemy("grunt", 12.0, skyY + 0.2, -1);
  b.explosiveStack(11.8, G0, 4);

  // Roof cargo, parked on the lip. It leaves before the building does.
  b.loose(18.6, G0 + 10 * FLOOR_PITCH + 0.45, 0.85, 0.85, "explosive", 0.05);

  // ---------------------------------------------------------------- village
  b.crowd(28.5, G0, ["grunt", "grunt"], 2.0);
  b.house({ x: 34, baseY: G0, w: 6.8, h: 3.8, material: "wood" });
  // Parked between the two houses, three metres from each. Neither survives the other.
  b.explosiveStack(38.6, G0, 3);
  b.house({ x: 45, baseY: G0, w: 7.4, h: 4.2, material: "brick", roof: "brick" });
  b.crowd(50.5, G0, ["grunt", "guard"], 2.0);

  b.tower({
    x: 55, baseY: G0, floors: 5, width: 3.2, material: "wood",
    slab: "wood", windows: true, guards: ["grunt", "grunt"],
  });
  b.scatter(59.5, G0, 6, 2.4, ["wood", "wood", "explosive"]);

  // ---------------------------------------------------------------- the terrace
  // A row of houses standing on a plinth, with the barrels at the plinth's feet: the
  // interesting shot is not at the houses at all.
  b.wall(74, G0, 16, 2.6, "concrete", 0.8);
  b.house({ x: 69, baseY: G0 + 2.6, w: 6, h: 3.4, material: "brick" });
  b.house({ x: 79, baseY: G0 + 2.6, w: 6, h: 3.4, material: "brick" });
  b.crowd(74.5, G0 + 2.7, ["grunt", "guard"], 2.2);
  b.enemy("guard", 66.5, G0 + 2.7, 1);
  b.explosiveStack(64, G0, 4);
  b.explosiveStack(84, G0, 4);
  b.crowd(87.5, G0, ["grunt", "grunt"], 2.2);
  b.pyramid(92, G0, 6, 0.82, "brick");

  // ---------------------------------------------------------------- twin towers
  // 9 and 13 storeys, both from y=0, so storey 5 lines up on each for the skybridge.
  b.crowd(95, G0, ["grunt", "guard", "grunt"], 2.0);
  b.tower({
    x: 102, baseY: G0, floors: 9, width: 4.2, material: "concrete",
    slab: "metal", windows: true, guards: ["guard", "guard"],
  });
  b.tower({
    x: 114, baseY: G0, floors: 13, width: 4.8, material: "concrete",
    slab: "metal", windows: true, goldTop: true, guards: ["boss", "guard"],
  });
  const twinSkyY = G0 + FLOOR_PITCH * 5 + 0.18;
  b.catwalk(104.1, 111.6, twinSkyY);
  b.enemy("grunt", 108, twinSkyY + 0.2, -1);
  b.explosiveStack(108, G0, 5);
  b.enemy("guard", 118.5, G0, -1);
  b.scatter(123, G0, 8, 3.5, ["wood", "explosive", "glass"]);

  // ---------------------------------------------------------------- the fortress
  b.wall(130, G0, 3, 9, "metal", 0.9);
  b.enemy("guard", 126, G0, -1);
  b.explosiveStack(134.5, G0, 6);
  b.tower({
    x: 140, baseY: G0, floors: 8, width: 5.4, material: "metal",
    slab: "metal", windows: false, guards: ["boss", "guard", "guard"],
  });
  b.crowd(145, G0, ["guard", "guard"], 2.2);
  b.wall(152, G0, 8, 2.0, "concrete", 0.7);
  b.enemy("guard", 152, G0 + 2.1, -1);

  // ---------------------------------------------------------------- the outwork
  b.pyramid(164, G0, 7, 0.9, "concrete");
  b.crowd(171, G0, ["grunt", "guard", "grunt"], 2.0);
  b.explosiveStack(176, G0, 4);

  // ---------------------------------------------------------------- canyon crossing
  const deckY = G0 + 0.4;
  b.bridge(184, 204, deckY, "wood", 5, G0 - 7);
  const deckTop = deckY + 0.37;
  b.crowd(189, deckTop, ["grunt", "grunt"], 2.4);
  b.enemy("grunt", 199, deckTop, 1);
  b.explosiveStack(194, deckTop, 3);
  b.house({ x: 208, baseY: G0, w: 6, h: 3.4, material: "wood" });
  b.enemy("guard", 212, G0, -1);

  // ---------------------------------------------------------------- the yards
  b.scatter(217, G0, 12, 4.5, ["wood", "explosive", "glass", "explosive"]);
  b.crowd(223, G0, ["grunt", "guard", "grunt"], 2.0);
  b.explosiveStack(226.5, G0, 5);

  // ---------------------------------------------------------------- downtown finale
  b.crowd(228.5, G0, ["grunt", "guard", "grunt"], 2.0);
  b.tower({
    x: 234, baseY: G0, floors: 12, width: 5.0, material: "concrete",
    slab: "metal", windows: true, guards: ["guard", "guard"],
  });
  b.tower({
    x: 246, baseY: G0, floors: 17, width: 5.6, material: "concrete",
    slab: "metal", windows: true, goldTop: true, guards: ["boss", "boss"],
  });
  b.tower({
    x: 258, baseY: G0, floors: 10, width: 4.6, material: "brick",
    slab: "concrete", windows: true, guards: ["guard", "grunt"],
  });
  // Two spans at different heights, each with barrels underneath it. The block is one
  // structure: whichever tower goes first is holding up the next one along.
  const dtLow = G0 + FLOOR_PITCH * 6 + 0.18;
  const dtHigh = G0 + FLOOR_PITCH * 9 + 0.18;
  b.catwalk(236.5, 243.2, dtLow);
  b.catwalk(248.8, 255.7, dtHigh);
  b.enemy("guard", 240, dtLow + 0.2, -1);
  b.enemy("grunt", 252, dtHigh + 0.2, -1);
  b.explosiveStack(240, G0, 6);
  b.explosiveStack(252, G0, 6);

  // ---------------------------------------------------------------- the vault
  b.scatter(266, G0, 5, 2, ["wood", "explosive"]);
  b.wall(270, G0, 4, 7, "gold", 0.7);
  b.crowd(276, G0, ["guard", "boss"], 2.4);

  return {
    spawn: v(-8, G0 + 1.2),
    bounds: { min: -120, max: 288 },
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
