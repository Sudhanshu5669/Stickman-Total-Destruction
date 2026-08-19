import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import { combat } from "../entities/enemy";
import { AcidRain } from "./hazards";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * The campaign.
 *
 * Every mission is the same contract: clear the map, with a fixed loadout, a fixed
 * number of lives, and no god mode. That last rule is enforced by the game rather
 * than by this file — see `LevelDef.allowGod`.
 *
 * The difficulty curve is carried almost entirely by three numbers on each enemy:
 * `spread` (how accurate), `interval` (how often) and `range` (how far). Mission 1
 * hands out inaccurate SMGs at short range; mission 6 hands out snipers.
 */

/** One storey of `Builder.tower`, needed to line skybridges up. */
const FLOOR_PITCH = 1.8 + 0.34;

const mission = (
  order: number,
  def: Omit<LevelDef, "kind" | "allowGod" | "order">,
): LevelDef => ({ ...def, kind: "campaign", allowGod: false, order });

// ---------------------------------------------------------------------------
// 1 — Wake-up call
// ---------------------------------------------------------------------------

function buildOutpost(_game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  // Every enemy on this map that doesn't say otherwise gets this: a short-range SMG
  // with plenty of spread. They can hurt you, but only if you stand still.
  b.defaultCombat = combat({ behavior: "sentry", gun: "smg", range: 20, spread: 0.2, interval: 0.65, reaction: 0.9 });

  b.ground(40, G0 - 3, 300, 6);
  b.ledge(-30, G0 + 2.2, 10, 1.1);

  // The approach is quiet in the sense that matters — nothing can reach you yet — but
  // it is not empty. The outpost's near tower stands twenty-two metres out with its
  // ground floor occupied, which is inside the camera's window and just outside the
  // twenty-metre reach of everything standing in it. The mission opens on a target,
  // and the first shot fired at *you* is still one you saw coming.
  b.scatter(-4, G0, 7, 3, ["wood", "wood", "explosive"]);
  b.teeter(2, G0, 5, 0.85, "wood");
  b.explosiveStack(6, G0, 3);
  b.tower({
    x: 12, baseY: G0, floors: 5, width: 4.2, material: "wood", slab: "wood",
    windows: true, guards: ["grunt", "grunt"],
  });
  b.enemy("grunt", 10.9, G0, -1);
  b.enemy("grunt", 13.1, G0, 1);

  b.house({ x: 22, baseY: G0, w: 6.5, h: 3.6, material: "wood" });
  b.crowd(28, G0, ["grunt", "grunt"], 2.0);

  b.wall(36, G0, 8, 2.6, "wood", 0.6);
  b.enemy("guard", 32, G0, -1);
  b.explosiveStack(41, G0, 3);

  b.tower({
    x: 52, baseY: G0, floors: 6, width: 4.4, material: "wood", slab: "wood",
    windows: true, guards: ["grunt", "guard"],
  });
  b.enemy("grunt", 46, G0, 1);
  b.teeter(57, G0, 5, 0.85, "wood");

  b.house({ x: 68, baseY: G0, w: 7, h: 4, material: "brick", roof: "brick" });
  b.enemy("guard", 62, G0, -1);
  b.enemy("grunt", 75, G0, -1, { behavior: "patrol", patrol: 6, gun: "smg", range: 22, spread: 0.16 });

  b.explosiveStack(82, G0, 4);
  b.wall(88, G0, 10, 1.4, "concrete", 0.6);
  b.tower({ x: 88, baseY: G0 + 1.4, floors: 6, width: 4.6, material: "brick", slab: "concrete", windows: true, guards: ["boss", "guard"] });
  b.explosiveStack(94, G0, 4);
  b.crowd(99, G0, ["grunt", "guard"], 2.2);
  b.scatter(105, G0, 8, 4, ["wood", "explosive", "glass"]);

  return { spawn: v(-10, G0 + 1.2), bounds: { min: -70, max: 125 }, enemies: b.enemies, groundY: G0 };
}

export const M1: LevelDef = mission(1, {
  id: "c1-outpost",
  name: "Wake-Up Call",
  tagline: "A lumber outpost that shoots back. Barely.",
  briefing: "Clear the outpost. They have guns now — use cover.",
  theme: "day",
  gravity: -26,
  tags: ["ARMED", "SHORT RANGE", "3 LIVES"],
  accent: "#ffd23f",
  loadout: ["chicken", "rocket", "watermelon", "barrel"],
  lives: 3,
  build: buildOutpost,
});

// ---------------------------------------------------------------------------
// 2 — Night watch
// ---------------------------------------------------------------------------

function buildKeep(_game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  b.defaultCombat = combat({ behavior: "sentry", gun: "rifle", range: 30, spread: 0.12, interval: 1.3, reaction: 0.8 });
  const TORCH = "#ffb03a";

  b.ground(50, G0 - 3, 300, 6);
  b.ledge(-34, G0 + 2.4, 12, 1.2);

  // The wall is the mission, so the wall is the opening frame: a lit palisade, powder
  // at its foot and a roofed gate tower at eighteen metres. The battlement itself
  // starts at thirty — one metre inside its own rifles' reach, so the moment you take
  // a single step forward the mission's actual problem announces itself.
  b.scatter(-14, G0, 6, 3, ["wood", "explosive"]);
  b.decor(-16, G0 + 0.2, "torch", TORCH);
  b.teeter(-12, G0, 5, 0.85, "wood");
  b.wall(-8, G0, 6, 2.6, "wood", 0.7);
  b.decor(-11, G0 + 0.2, "torch", TORCH);
  b.explosiveStack(-3.2, G0, 3);
  b.castleTower({ x: 0, baseY: G0, w: 4.0, height: 9, material: "concrete", roof: true, guards: ["grunt"] });

  // Wall gunners: rooted, accurate, and the reason you want the rocket.
  const wallTop = b.battlement(12, G0, 20, 5.6, "concrete", ["guard", "grunt", "guard", "grunt"]);
  b.decor(4, wallTop + 0.1, "torch", TORCH);
  b.decor(20, wallTop + 0.1, "torch", TORCH);
  b.decor(8, wallTop + 2.6, "banner", "#8e2f3f");
  b.decor(16, wallTop + 2.6, "banner", "#8e2f3f");
  b.gate(12, G0, 4, 4.6, "concrete");

  b.castleTower({ x: 23, baseY: G0, w: 4.2, height: 10, material: "concrete", roof: true, guards: ["guard"] });
  b.explosiveStack(28, G0, 4);
  b.enemy("guard", 32, G0, -1, { behavior: "hunter", gun: "smg", range: 26, standoff: 11, spread: 0.14 });
  b.crowd(38, G0, ["grunt", "guard"], 2.2);

  b.castleTower({ x: 48, baseY: G0, w: 5.4, height: 12, material: "concrete", roof: true, guards: ["guard", "guard"] });
  b.castleTower({ x: 64, baseY: G0, w: 6.0, height: 16, material: "concrete", roof: true, guards: ["boss", "guard"] });
  b.catwalk(50.7, 61, G0 + 9, "wood");
  b.enemy("grunt", 56, G0 + 9.2, -1);
  b.explosiveStack(56, G0, 4);
  b.decor(46, G0 + 0.2, "torch", TORCH);
  b.decor(66, G0 + 0.2, "torch", TORCH);

  b.scatter(74, G0, 8, 4, ["wood", "explosive", "glass"]);
  b.crowd(80, G0, ["grunt", "guard"], 2.2);
  b.enemy("boss", 88, G0, -1, { behavior: "hunter", gun: "shotgun", range: 17, standoff: 8 });

  return { spawn: v(-18, G0 + 1.2), bounds: { min: -75, max: 110 }, enemies: b.enemies, groundY: G0 };
}

export const M2: LevelDef = mission(2, {
  id: "c2-keep",
  name: "Night Watch",
  tagline: "Wall gunners with a clear field of fire.",
  briefing: "The battlement is the problem. Solve it before you cross the open ground.",
  theme: "night",
  gravity: -26,
  tags: ["RIFLES", "STONE", "3 LIVES"],
  accent: "#c9a227",
  loadout: ["chicken", "rocket", "anvil", "barrel", "sawblade"],
  lives: 3,
  build: buildKeep,
});

// ---------------------------------------------------------------------------
// 3 — Downtown
// ---------------------------------------------------------------------------

function buildDowntown(_game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  b.defaultCombat = combat({ behavior: "sentry", gun: "rifle", range: 36, spread: 0.1, interval: 1.1 });

  b.ground(45, G0 - 3, 300, 6);

  // The briefing says drop the skybridge early, so the skybridge is on screen from the
  // first frame with the barrels that reach it sitting underneath. The bridge sniper
  // gets a long reaction rather than a short range: it *can* see you at the spawn, and
  // the two seconds it spends acquiring are the window the mission is asking you to use.
  b.scatter(-7, G0, 8, 3, ["wood", "explosive", "glass"]);
  b.teeter(-2, G0, 5, 0.85, "wood");
  b.explosiveStack(2, G0, 4);

  b.tower({ x: 8, baseY: G0, floors: 8, width: 4.2, material: "concrete", slab: "metal", windows: true, guards: ["guard", "grunt"] });
  b.enemy("grunt", 7, G0, -1, { behavior: "sentry", gun: "shotgun", range: 16 });
  b.enemy("guard", 9, G0, 1, { behavior: "sentry", gun: "shotgun", range: 16 });
  b.tower({ x: 20, baseY: G0, floors: 10, width: 4.6, material: "concrete", slab: "metal", windows: true, guards: ["guard", "guard"] });
  const skyY = G0 + FLOOR_PITCH * 5 + 0.18;
  b.catwalk(10.1, 17.7, skyY);
  // Snipers on the skybridge: long reach, slow cadence, very visible laser.
  b.enemy("guard", 14, skyY + 0.2, -1, { behavior: "sentry", gun: "sniper", range: 52, interval: 2.6, spread: 0.035, reaction: 2.4 });
  b.explosiveStack(14, G0, 5);

  b.enemy("grunt", 28, G0, 1, { behavior: "hunter", gun: "smg", range: 28, standoff: 12, spread: 0.13 });
  b.crowd(34, G0, ["grunt", "guard"], 2.2);

  b.wall(46, G0, 12, 2.2, "concrete", 0.8);
  b.house({ x: 43, baseY: G0 + 2.2, w: 6, h: 3.4, material: "brick" });
  b.house({ x: 52, baseY: G0 + 2.2, w: 6, h: 3.4, material: "brick" });
  b.enemy("guard", 40.5, G0 + 2.3, -1, { behavior: "patrol", patrol: 4, gun: "rifle", range: 34, spread: 0.1 });
  b.enemy("guard", 56, G0 + 2.3, -1, { behavior: "patrol", patrol: 4, gun: "rifle", range: 34, spread: 0.1 });
  b.explosiveStack(38, G0, 4);
  b.explosiveStack(60, G0, 4);

  b.tower({ x: 74, baseY: G0, floors: 12, width: 5.0, material: "concrete", slab: "metal", windows: true, guards: ["boss", "guard"], goldTop: true });
  b.enemy("guard", 66, G0, 1, { behavior: "sentry", gun: "shotgun", range: 16 });
  b.tower({ x: 86, baseY: G0, floors: 8, width: 4.4, material: "brick", slab: "concrete", windows: true, guards: ["guard"] });
  const skyY2 = G0 + FLOOR_PITCH * 7 + 0.18;
  b.catwalk(76.5, 83.8, skyY2);
  b.enemy("grunt", 80, skyY2 + 0.2, -1);
  b.explosiveStack(80, G0, 5);
  b.pyramid(98, G0, 5, 0.8, "brick");
  b.crowd(106, G0, ["guard", "grunt"], 2.2);
  b.enemy("boss", 112, G0, -1, { behavior: "hunter", gun: "rifle", range: 34, standoff: 14, spread: 0.09 });

  return { spawn: v(-14, G0 + 1.2), bounds: { min: -75, max: 135 }, enemies: b.enemies, groundY: G0 };
}

export const M3: LevelDef = mission(3, {
  id: "c3-downtown",
  name: "Downtown Problem",
  tagline: "Snipers on the skybridge, shotguns in the lobby.",
  briefing: "Drop the skybridge early. Everything above you has line of sight.",
  theme: "day",
  gravity: -26,
  tags: ["SNIPERS", "VERTICAL", "3 LIVES"],
  accent: "#5ec8ff",
  loadout: ["chicken", "rocket", "sawblade", "car", "barrel", "anvil"],
  lives: 3,
  build: buildDowntown,
});

// ---------------------------------------------------------------------------
// 4 — Hive, under acid rain
// ---------------------------------------------------------------------------

function buildHive(_game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  const GLOW = "#9dff6a";
  b.defaultCombat = combat({ behavior: "sentry", gun: "rifle", range: 32, spread: 0.11, interval: 1.15 });

  b.ground(40, G0 - 3, 280, 6);
  // Roofs matter here: the acid raycast is a real ray, so cover is genuine cover.
  // The spawn sits under a dome's right flank rather than at its centre — the mission
  // still opens inside shelter instead of dissolving you before you have moved, but
  // with a clear line out at chest height rather than its own roof in the way. What
  // that line points at is a fourteen-metre crystal and a hive, both breakable.
  b.dome(-20, G0, 5.2, "hull", 13, 0.5);
  b.decor(-20, G0 + 3.4, "pod", GLOW, 24);
  b.crystalCluster(-12, G0, 4, 1.5);
  b.hive(-6, G0, 5);
  b.decor(-6, G0 + 2.6, "pod", GLOW, 24);
  b.teeter(-1, G0, 5, 0.85, "biomass");
  b.spire(4, G0, 14, 1.8, "crystal", 0.05);
  b.crowd(9, G0, ["guard", "guard"], 2.2);

  b.dome(16, G0, 7, "hull", 15, 0.5);
  b.decor(16, G0 + 7.4, "pod", GLOW, 24);
  b.enemy("grunt", 16, G0 + 7.2, -1, { behavior: "sentry", gun: "sniper", range: 66, interval: 2.8, spread: 0.04, reaction: 2.2 });

  b.spire(26, G0, 10, 1.5, "crystal", -0.05);
  b.crystalCluster(32, G0, 6, 3);
  b.hive(40, G0, 5);
  b.crowd(46, G0, ["guard", "guard"], 2.2);
  b.explosiveStack(51, G0, 4);

  b.spire(58, G0, 16, 2.2, "crystal", 0.06);
  b.spire(66, G0, 11, 1.8, "crystal", -0.05);
  b.enemy("guard", 62, G0, -1, { behavior: "hunter", gun: "smg", range: 28, standoff: 10, spread: 0.12 });

  b.dome(82, G0, 8, "hull", 17, 0.5);
  b.hive(82, G0, 4);
  b.enemy("boss", 82, G0 + 8.2, -1, { behavior: "sentry", gun: "rifle", range: 40, interval: 0.9, spread: 0.08 });
  b.enemy("guard", 74, G0, 1);
  b.enemy("guard", 91, G0, -1);

  b.crystalCluster(100, G0, 8, 5);
  b.spire(110, G0, 18, 2.6, "crystal", 0.04);
  b.crowd(116, G0, ["guard", "grunt"], 2.2);
  b.enemy("boss", 122, G0, -1, { behavior: "hunter", gun: "shotgun", range: 18, standoff: 8 });

  return { spawn: v(-16, G0 + 1.2), bounds: { min: -80, max: 135 }, enemies: b.enemies, groundY: G0 };
}

export const M4: LevelDef = mission(4, {
  id: "c4-hive",
  name: "Acid Test",
  tagline: "Hostiles, and weather that eats you if you stand still.",
  briefing: "Acid rain. Stay under something, and keep moving.",
  theme: "alien",
  gravity: -24,
  tags: ["ACID RAIN", "COVER", "2 LIVES"],
  accent: "#7dffb0",
  loadout: ["chicken", "rocket", "sawblade", "bowling", "barrel"],
  lives: 2,
  build: buildHive,
  hazard: (game) => new AcidRain(game, { damage: 7, interval: 1.1, drops: 260 }),
});

// ---------------------------------------------------------------------------
// 5 — Mars, low gravity
// ---------------------------------------------------------------------------

function buildAres(_game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  const BEACON = "#ff8a5c";
  // Low gravity means bullets and bodies both fly further. Longer ranges, slower fire.
  b.defaultCombat = combat({ behavior: "sentry", gun: "rifle", range: 44, spread: 0.09, interval: 1.2 });

  b.ground(60, G0 - 3, 260, 6);
  b.ground(-80, G0 - 3, 70, 6);
  b.ledge(-44, G0 + 3.0, 12, 1.2);
  b.ledge(-24, G0 + 6.5, 9, 1.2);

  b.enemy("grunt", -8, G0, -1, { behavior: "patrol", patrol: 10, gun: "smg", range: 30, spread: 0.12, speed: 3.2 });
  b.scatter(6, G0, 8, 4, ["wood", "explosive"]);

  b.dome(22, G0, 6.5, "hull", 15, 0.5);
  b.decor(22, G0 + 6.9, "antenna", BEACON);
  // Range deliberately short of the spawn (60m away) — nothing opens fire on a
  // player who has not had a chance to move yet.
  b.enemy("guard", 22, G0 + 6.7, -1, { behavior: "sentry", gun: "sniper", range: 46, interval: 2.4, spread: 0.03 });
  b.enemy("guard", 15, G0, 1);

  b.tower({ x: 42, baseY: G0, floors: 8, width: 4.4, material: "hull", slab: "metal", windows: true, guards: ["guard", "guard"] });
  b.spire(52, G0, 16, 1.8, "metal");
  b.enemy("grunt", 34, G0, -1, { behavior: "hunter", gun: "smg", range: 32, standoff: 14, spread: 0.12, speed: 4 });

  b.bridge(62, 82, G0 + 0.4, "metal", 5, G0 - 6);
  b.enemy("guard", 68, G0 + 0.77, -1, { behavior: "patrol", patrol: 5, gun: "rifle", range: 40, spread: 0.09 });
  b.enemy("guard", 77, G0 + 0.77, 1, { behavior: "patrol", patrol: 5, gun: "rifle", range: 40, spread: 0.09 });

  b.dome(96, G0, 9, "hull", 17, 0.55);
  b.hive(96, G0, 4, "sandstone");
  b.enemy("boss", 96, G0 + 9.2, -1, { behavior: "sentry", gun: "sniper", range: 90, interval: 2.0, spread: 0.028 });
  b.explosiveStack(88, G0, 5);

  b.tower({ x: 116, baseY: G0, floors: 14, width: 5.2, material: "hull", slab: "metal", windows: true, guards: ["boss", "guard", "guard"], goldTop: true });
  b.pyramid(130, G0, 6, 0.9, "sandstone");
  b.enemy("boss", 138, G0, -1, { behavior: "hunter", gun: "rifle", range: 40, standoff: 16, spread: 0.08 });

  return { spawn: v(-38, G0 + 1.2), bounds: { min: -100, max: 160 }, enemies: b.enemies, groundY: G0 };
}

export const M5: LevelDef = mission(5, {
  id: "c5-ares",
  name: "Thin Air",
  tagline: "One third gravity. Their bullets travel just as far as yours.",
  briefing: "Low gravity: your jumps carry, and so do their sniper rounds.",
  theme: "mars",
  gravity: -9.6,
  tags: ["LOW GRAVITY", "SNIPERS", "2 LIVES"],
  accent: "#ff8a5c",
  loadout: ["chicken", "rocket", "sawblade", "plane", "bowling", "barrel"],
  lives: 2,
  build: buildAres,
});

// ---------------------------------------------------------------------------
// 6 — The last stand
// ---------------------------------------------------------------------------

function buildCitadel(_game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;
  b.defaultCombat = combat({ behavior: "sentry", gun: "rifle", range: 42, spread: 0.075, interval: 0.85 });

  b.ground(60, G0 - 3, 300, 6);
  b.ground(-90, G0 - 3, 80, 6);
  b.ledge(-50, G0 + 2.6, 12, 1.2);

  b.enemy("guard", -18, G0, -1, { behavior: "hunter", gun: "shotgun", range: 18, standoff: 8, speed: 4.2 });
  b.enemy("guard", -8, G0, -1, { behavior: "hunter", gun: "smg", range: 30, standoff: 12, spread: 0.1, speed: 4 });

  const wallTop = b.battlement(16, G0, 20, 6.2, "metal", ["guard", "guard", "guard"]);
  b.enemy("grunt", 16, wallTop + 0.05, -1, { behavior: "sentry", gun: "sniper", range: 50, interval: 2.1, spread: 0.025 });

  b.gate(38, G0, 5, 5.2, "metal");
  b.explosiveStack(32, G0, 5);
  b.enemy("boss", 46, G0, -1, { behavior: "hunter", gun: "shotgun", range: 19, standoff: 9, speed: 4.4 });

  b.tower({ x: 62, baseY: G0, floors: 10, width: 4.8, material: "metal", slab: "metal", guards: ["guard", "guard"] });
  b.tower({ x: 76, baseY: G0, floors: 13, width: 5.2, material: "metal", slab: "metal", guards: ["boss", "guard"], goldTop: true });
  const skyY = G0 + FLOOR_PITCH * 7 + 0.18;
  b.catwalk(64.4, 73.4, skyY);
  b.enemy("guard", 69, skyY + 0.2, -1, { behavior: "sentry", gun: "sniper", range: 95, interval: 1.9, spread: 0.022 });

  b.wall(92, G0, 4, 9, "metal", 0.9);
  b.enemy("guard", 88, G0, 1, { behavior: "patrol", patrol: 6, gun: "rifle", range: 42, spread: 0.075 });

  b.tower({ x: 108, baseY: G0, floors: 16, width: 5.8, material: "metal", slab: "metal", windows: true, guards: ["boss", "boss"], goldTop: true });
  b.enemy("guard", 100, G0, 1, { behavior: "hunter", gun: "smg", range: 32, standoff: 13, spread: 0.09, speed: 4 });
  b.enemy("guard", 118, G0, -1, { behavior: "hunter", gun: "smg", range: 32, standoff: 13, spread: 0.09, speed: 4 });

  b.wall(132, G0, 6, 8, "gold", 0.7);
  b.enemy("boss", 142, G0, -1, { behavior: "sentry", gun: "sniper", range: 100, interval: 1.7, spread: 0.02 });
  b.enemy("boss", 150, G0, -1, { behavior: "hunter", gun: "rifle", range: 44, standoff: 16, spread: 0.07, speed: 4.2 });

  return { spawn: v(-44, G0 + 1.2), bounds: { min: -110, max: 170 }, enemies: b.enemies, groundY: G0 };
}

export const M6: LevelDef = mission(6, {
  id: "c6-citadel",
  name: "The Last Stand",
  tagline: "Everything they have left, in one fortified line.",
  briefing: "No more warm-ups. Marksmen on every roof, and they close on you.",
  theme: "night",
  gravity: -26,
  tags: ["MARKSMEN", "FORTIFIED", "1 LIFE"],
  accent: "#e8433a",
  loadout: ["chicken", "rocket", "sawblade", "car", "plane", "nuke", "blackhole"],
  lives: 1,
  build: buildCitadel,
});

/** Mission order. `Menu` and the campaign progress store both key off this. */
export const CAMPAIGN: readonly LevelDef[] = [M1, M2, M3, M4, M5, M6];
