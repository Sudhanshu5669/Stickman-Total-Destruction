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
 *
 * The spawn is under a dome's right flank rather than at its centre: you still get the
 * roof that teaches the mechanic, but with a clear line out at chest height instead of
 * your own shelter in the way. What that line points at is the brood gate — a hive
 * tower on a plinth with a fifteen-metre crystal leaning over it from each side. The
 * spires are the interesting shot: they are tall enough to reach the tower and free
 * enough at the base that which way they go is not decided in advance.
 */
function build(game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  // ---------------------------------------------------------------- terrain
  b.ground(60, G0 - 3, 400, 6);
  b.ledge(-48, G0 + 2.6, 14, 1.2);
  b.ledge(-68, G0 + 5.4, 10, 1.2);

  // ---------------------------------------------------------------- shelter at spawn
  b.dome(-20, G0, 5.4, "biomass", 13, 0.5);
  b.decor(-20, G0 + 3.6, "pod", GLOW, 24);

  // ---------------------------------------------------------------- the brood gate
  b.crystalCluster(-13.5, G0, 4, 1.4);
  b.spire(-10, G0, 15, 1.8, "crystal", 0.06);
  b.crowd(-7, G0, ["grunt", "guard", "grunt"], 1.6);

  b.wall(3, G0, 11, 2.6, "biomass", 0.8);
  b.tower({
    x: 3, baseY: G0 + 2.6, floors: 7, width: 4.6, material: "biomass",
    slab: "crystal", windows: false, guards: ["boss", "guard", "grunt"],
  });
  const broodTop = G0 + 2.6 + 7 * 2.14;
  b.dome(3, broodTop, 2.8, "crystal", 9, 0.4);
  b.decor(3, broodTop + 3.0, "pod", "#c08bff", 24);
  // In the ground-floor bays, on the plinth — the tower comes populated.
  b.enemy("guard", 1.9, G0 + 2.7, 1);
  b.enemy("guard", 4.1, G0 + 2.7, -1);
  // Egg sacks piled against the plinth: loose from frame one, so the first thing that
  // touches them scatters them somewhere new.
  b.teeter(-4.2, G0, 5, 0.85, "biomass");
  b.teeter(9.6, G0, 5, 0.85, "biomass");

  b.enemy("grunt", 11.3, G0, -1);
  b.spire(13, G0, 19, 2.0, "crystal", -0.05);
  b.crowd(16.5, G0, ["grunt", "grunt"], 2.0);
  b.explosiveStack(20, G0, 4);

  // ---------------------------------------------------------------- crystal fields
  b.crystalCluster(26, G0, 7, 3);
  b.hive(32, G0, 5);
  b.decor(32, G0 + 2.6, "pod", GLOW, 24);
  b.crowd(35.5, G0, ["grunt", "guard"], 1.8);
  b.dome(44, G0, 6.5, "biomass", 15, 0.55);
  b.decor(44, G0 + 4.4, "pod", GLOW, 24);
  b.enemy("guard", 44, G0 + 6.7, -1);
  b.crowd(53, G0, ["grunt", "grunt", "guard"], 2.0);

  // ---------------------------------------------------------------- the spire ring
  b.spire(62, G0, 17, 2.0, "crystal", 0.05);
  b.crowd(66, G0, ["boss", "guard"], 2.2);
  b.spire(70, G0, 22, 2.2, "crystal", -0.03);
  b.crowd(74, G0, ["guard", "grunt"], 2.2);
  b.spire(78, G0, 15, 1.8, "crystal", 0.06);
  b.crystalCluster(84, G0, 8, 3);
  b.explosiveStack(88, G0, 4);

  // ---------------------------------------------------------------- raised colony
  b.explosiveStack(94, G0, 4);
  b.wall(105, G0, 14, 3.2, "biomass", 0.8);
  b.dome(105, G0 + 3.2, 5.0, "crystal", 13, 0.45);
  b.enemy("guard", 105, G0 + 3.3, -1);
  b.enemy("guard", 98, G0 + 3.3, 1);
  b.enemy("guard", 112, G0 + 3.3, -1);
  b.decor(105, G0 + 8.4, "pod", "#c08bff", 24);
  b.explosiveStack(116, G0, 4);
  b.crowd(120, G0, ["grunt", "grunt"], 2.0);

  // ---------------------------------------------------------------- brood tower
  b.explosiveStack(126, G0, 5);
  b.enemy("guard", 129, G0, 1);
  b.wall(136, G0, 12, 2.6, "biomass", 0.8);
  b.tower({
    x: 136, baseY: G0 + 2.6, floors: 10, width: 5.0,
    material: "biomass", slab: "crystal", windows: false,
    guards: ["boss", "guard", "guard"],
  });
  b.dome(136, G0 + 2.6 + 10 * 2.14, 3.2, "crystal", 9, 0.4);
  b.crowd(136, G0 + 2.7, ["guard", "guard"], 2.6);
  b.explosiveStack(146, G0, 5);
  b.spire(150, G0, 20, 2.0, "crystal", -0.05);

  // ---------------------------------------------------------------- deep colony
  b.dome(162, G0, 7.5, "biomass", 17, 0.6);
  b.decor(162, G0 + 5.2, "pod", GLOW, 24);
  b.enemy("boss", 162, G0 + 7.7, -1);
  b.enemy("guard", 170.5, G0, -1);
  b.hive(174, G0, 6);
  b.crowd(180, G0, ["guard", "boss"], 2.2);
  b.explosiveStack(184, G0, 4);

  // ---------------------------------------------------------------- the great spires
  b.spire(194, G0, 26, 2.6, "crystal", -0.04);
  b.crowd(198, G0, ["guard", "grunt"], 2.2);
  b.spire(202, G0, 20, 2.2, "crystal", 0.05);
  b.crowd(206, G0, ["boss", "guard"], 2.2);
  b.spire(210, G0, 24, 2.4, "crystal", -0.03);
  b.crystalCluster(218, G0, 8, 4);
  b.explosiveStack(224, G0, 5);
  b.crowd(228, G0, ["boss", "boss"], 2.6);

  // A last covered pocket, in case you need somewhere to hide from the sky.
  b.dome(236, G0, 5.0, "biomass", 13, 0.5);
  b.decor(236, G0 + 3.2, "pod", GLOW, 24);

  return {
    spawn: v(-16, G0 + 1.2),
    bounds: { min: -130, max: 245 },
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
