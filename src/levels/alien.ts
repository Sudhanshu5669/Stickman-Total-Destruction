import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import type { Builder } from "./builder";
import { AcidRain } from "./hazards";
import type { LevelDef, LevelInfo } from "./types";

const GLOW = "#7dffb0";

/**
 * Xenoform Basin — a hive world under corrosive rain.
 *
 * The acid is the level's central mechanic: anything with open sky above it takes
 * damage every second or so, including you. Roofed structures are therefore genuine
 * cover, so the layout deliberately alternates exposed ground with domes and
 * overhangs you can duck under. Destroying your own cover is a real mistake.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  // ---------------------------------------------------------------- terrain
  b.ground(80, G0 - 3, 320, 6);
  b.ground(-110, G0 - 3, 90, 6);
  b.ledge(-60, G0 + 2.6, 14, 1.2);
  b.ledge(-80, G0 + 5.4, 10, 1.2);

  // ---------------------------------------------------------------- shelter at spawn
  // A roof over the start so the first thing you learn is that cover exists.
  b.dome(-30, G0, 5.2, "biomass", 13, 0.5);
  b.decor(-30, G0 + 3.4, "pod", GLOW, 24);
  b.crystalCluster(-16, G0, 5, 2.2);

  // ---------------------------------------------------------------- crystal fields
  b.crystalCluster(-2, G0, 6, 3);
  b.enemy("grunt", 6, G0, -1);
  b.hive(14, G0, 4);
  b.decor(14, G0 + 2.2, "pod", GLOW, 24);
  b.enemy("grunt", 22, G0, -1);

  b.spire(30, G0, 11, 1.5, "crystal", 0.04);
  b.spire(35, G0, 8, 1.2, "crystal", -0.05);
  b.decor(32, G0 + 8, "pod", "#c08bff", 24);

  // ---------------------------------------------------------------- hive colony
  b.dome(50, G0, 6.5, "biomass", 15, 0.55);
  b.enemy("guard", 44, G0, -1);
  b.enemy("guard", 56, G0, -1);
  b.decor(50, G0 + 4.4, "pod", GLOW, 24);
  b.hive(62, G0, 5);
  b.enemy("grunt", 68, G0, -1);

  // Raised crystal platform with a hive on top.
  b.wall(80, G0, 10, 3.2, "biomass", 0.8);
  b.dome(80, G0 + 3.2, 4.4, "crystal", 11, 0.45);
  b.enemy("guard", 74, G0 + 3.4, -1);
  b.enemy("guard", 86, G0 + 3.4, -1);
  b.decor(80, G0 + 6.2, "pod", "#c08bff", 24);

  // ---------------------------------------------------------------- the spire ring
  b.spire(100, G0, 16, 2.0, "crystal", 0.05);
  b.spire(108, G0, 20, 2.2, "crystal", -0.03);
  b.spire(116, G0, 14, 1.8, "crystal", 0.06);
  b.enemy("boss", 104, G0, -1);
  b.enemy("guard", 112, G0, -1);
  b.crystalCluster(122, G0, 7, 3);

  // ---------------------------------------------------------------- brood tower
  b.wall(140, G0, 12, 2.6, "biomass", 0.8);
  b.tower({
    x: 140, baseY: G0 + 2.6, floors: 8, width: 5.0,
    material: "biomass", slab: "crystal", windows: false,
    guards: ["boss", "guard"],
  });
  b.dome(140, G0 + 2.6 + 8 * 2.14, 3.2, "crystal", 9, 0.4);
  b.enemy("guard", 132, G0 + 2.8, -1);
  b.enemy("guard", 148, G0 + 2.8, -1);
  b.explosiveStack(154, G0, 4);

  // ---------------------------------------------------------------- deep colony
  b.dome(172, G0, 7.5, "biomass", 17, 0.6);
  b.decor(172, G0 + 5.2, "pod", GLOW, 24);
  b.hive(186, G0, 6);
  b.enemy("guard", 180, G0, -1);
  b.enemy("boss", 192, G0, -1);

  b.spire(206, G0, 24, 2.6, "crystal", -0.04);
  b.spire(214, G0, 18, 2.2, "crystal", 0.05);
  b.crystalCluster(222, G0, 8, 4);
  b.enemy("boss", 228, G0, -1);

  // A last covered pocket, in case you need somewhere to hide from the sky.
  b.dome(240, G0, 5.0, "biomass", 13, 0.5);
  b.decor(240, G0 + 3.2, "pod", GLOW, 24);

  return {
    spawn: v(-30, G0 + 1.2),
    bounds: { min: -140, max: 255 },
    enemies: b.enemies,
    groundY: G0,
  };
}

export const ALIEN: LevelDef = {
  id: "alien",
  name: "Xenoform Basin",
  tagline: "Hive world. The rain dissolves anything left in the open.",
  theme: "alien",
  gravity: -24,
  tags: ["ACID RAIN", "TAKE COVER", "CRYSTAL"],
  accent: "#7dffb0",
  build,
  hazard: (game) => new AcidRain(game, { damage: 9, interval: 0.9, drops: 300 }),
};
