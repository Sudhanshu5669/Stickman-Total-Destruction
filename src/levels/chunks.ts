import type { MaterialId } from "../entities/block";
import type { EnemyKind } from "../entities/enemy";
import type { Builder } from "./builder";

/**
 * The endless-mode chunk library.
 *
 * A chunk is one pre-programmed placement: a fixed arrangement of terrain, structures
 * and stickmen, authored against a local origin so the director can drop it anywhere
 * along the world axis. Nothing here is procedural — every entry is a specific,
 * hand-tuned layout. The variety comes from *how many* of them there are and the
 * order they get dealt in, which is what keeps a run from reading as noise.
 *
 * Each family below expands over an explicit parameter table, so one authored shape
 * yields a handful of distinct, deliberately different placements. The final table
 * runs to a few hundred entries — see `CHUNKS.length`, asserted by the director's
 * deck shuffle.
 */

export interface Chunk {
  id: string;
  /** Metres of world this chunk occupies. The director lays them end to end. */
  width: number;
  /**
   * Difficulty band, 0..3. The director unlocks higher tiers the further you get,
   * so the first few hundred metres never deal you a fortified sniper nest.
   */
  tier: number;
  /** @param x Left edge of the chunk. @param g Ground top surface. */
  place(b: Builder, x: number, g: number): void;
}

const CHUNKS: Chunk[] = [];

const def = (id: string, width: number, tier: number, place: Chunk["place"]) => {
  CHUNKS.push({ id, width, tier, place });
};

/** One storey of `Builder.tower`; needed to line skybridges up. */
const FLOOR_PITCH = 1.8 + 0.34;

// ---------------------------------------------------------------------------
// Breathing room — flat stretches so a run has a rhythm instead of a wall of stuff.
// ---------------------------------------------------------------------------

for (const [w, n] of [[14, 0], [20, 2], [26, 4], [32, 6]] as const) {
  def(`clearing-${w}`, w, 0, (b, x, g) => {
    if (n) b.scatter(x + w / 2, g, n, w * 0.3, ["wood", "wood", "glass"]);
  });
}

for (const [w, kind] of [[18, "grunt"], [24, "grunt"], [24, "guard"]] as const) {
  def(`patrol-yard-${w}-${kind}`, w, 0, (b, x, g) => {
    b.scatter(x + w * 0.35, g, 5, 3, ["wood", "explosive"]);
    b.enemy(kind, x + w * 0.6, g, -1, { behavior: "patrol", patrol: w * 0.3, gun: "smg", range: 24, spread: 0.15 });
  });
}

// ---------------------------------------------------------------------------
// Crate and barrel yards
// ---------------------------------------------------------------------------

const YARD_MIXES: [string, MaterialId[]][] = [
  ["timber", ["wood", "wood", "wood"]],
  ["volatile", ["explosive", "wood", "explosive"]],
  ["glassworks", ["glass", "glass", "wood"]],
  ["mixed", ["wood", "explosive", "glass", "brick"]],
];
for (const [name, mats] of YARD_MIXES) {
  for (const count of [8, 14, 20]) {
    def(`yard-${name}-${count}`, 20, 0, (b, x, g) => {
      b.scatter(x + 10, g, count, 7, mats);
      b.enemy("grunt", x + 4, g, -1);
    });
  }
}

for (const stacks of [2, 3, 4]) {
  for (const height of [3, 5, 7]) {
    def(`barrel-farm-${stacks}x${height}`, 16, 1, (b, x, g) => {
      for (let i = 0; i < stacks; i++) b.explosiveStack(x + 4 + i * 3.4, g, height);
      b.enemy("grunt", x + 13, g, -1, { behavior: "sentry", gun: "smg", range: 22, spread: 0.16 });
    });
  }
}

// ---------------------------------------------------------------------------
// Pyramids
// ---------------------------------------------------------------------------

const PYRAMID_MATS: MaterialId[] = ["wood", "brick", "concrete", "ice", "sandstone", "gold"];
for (const mat of PYRAMID_MATS) {
  for (const [rows, size] of [[4, 0.7], [6, 0.85], [8, 0.95]] as const) {
    def(`pyramid-${mat}-${rows}`, 16, mat === "gold" ? 2 : 0, (b, x, g) => {
      b.pyramid(x + 8, g, rows, size, mat);
      if (rows > 4) b.enemy("guard", x + 2, g, -1);
    });
  }
}

// ---------------------------------------------------------------------------
// Houses and hamlets
// ---------------------------------------------------------------------------

const HOUSE_KITS: [string, MaterialId, MaterialId][] = [
  ["shack", "wood", "wood"],
  ["cottage", "brick", "wood"],
  ["stonehouse", "concrete", "brick"],
  ["bunker", "metal", "metal"],
];
for (const [name, wall, roof] of HOUSE_KITS) {
  for (const count of [1, 2, 3]) {
    const width = 8 + count * 10;
    def(`hamlet-${name}-${count}`, width, count > 1 ? 1 : 0, (b, x, g) => {
      for (let i = 0; i < count; i++) {
        const hx = x + 8 + i * 10;
        b.house({ x: hx, baseY: g, w: 6.4 + (i % 2) * 0.8, h: 3.6, material: wall, roof });
        b.enemy(i % 2 ? "guard" : "grunt", hx - 4.2, g, -1);
      }
      b.scatter(x + 3, g, 4, 2, ["wood", "explosive"]);
    });
  }
}

// A raised terrace of houses on a plinth — cover you have to shoot through.
for (const mat of ["brick", "concrete", "sandstone"] as MaterialId[]) {
  for (const lift of [2.2, 3.4]) {
    def(`terrace-${mat}-${lift}`, 26, 1, (b, x, g) => {
      b.wall(x + 13, g, 15, lift, mat, 0.8);
      b.house({ x: x + 8, baseY: g + lift, w: 6, h: 3.4, material: mat });
      b.house({ x: x + 18, baseY: g + lift, w: 6, h: 3.4, material: mat });
      // On the plinth — it spans x+5.5 to x+20.5, and anything outside that falls.
      b.enemy("guard", x + 7, g + lift + 0.1, 1, { behavior: "patrol", patrol: 3, gun: "rifle", range: 32, spread: 0.11 });
      b.enemy("guard", x + 19, g + lift + 0.1, -1);
    });
  }
}

// ---------------------------------------------------------------------------
// Towers — the backbone of the mode
// ---------------------------------------------------------------------------

const TOWER_KITS: [string, MaterialId, MaterialId, number][] = [
  ["timber", "wood", "wood", 0],
  ["brick", "brick", "concrete", 0],
  ["office", "concrete", "metal", 1],
  ["ice", "ice", "ice", 1],
  ["hull", "hull", "metal", 2],
  ["fortified", "metal", "metal", 2],
  ["sandstone", "sandstone", "concrete", 1],
];
const TOWER_SIZES: [number, number, EnemyKind[]][] = [
  [4, 4.0, ["grunt"]],
  [7, 4.4, ["guard", "grunt"]],
  [11, 4.8, ["guard", "guard"]],
  [15, 5.4, ["boss", "guard"]],
];
for (const [name, mat, slab, baseTier] of TOWER_KITS) {
  TOWER_SIZES.forEach(([floors, width, guards], i) => {
    def(`tower-${name}-${floors}`, 18, Math.min(3, baseTier + (i > 1 ? 1 : 0)), (b, x, g) => {
      b.tower({
        x: x + 9, baseY: g, floors, width, material: mat, slab,
        windows: mat !== "metal", guards, goldTop: floors >= 11,
      });
      b.enemy("grunt", x + 2.5, g, 1);
      if (floors >= 7) b.enemy("guard", x + 15.5, g, -1, { behavior: "hunter", gun: "smg", range: 28, standoff: 11, spread: 0.13 });
    });
  });
}

// Twin towers with a skybridge, and a gunner standing on it.
for (const mat of ["concrete", "hull", "metal", "brick"] as MaterialId[]) {
  for (const [lo, hi, bridgeFloor] of [[6, 8, 4], [9, 12, 6], [13, 17, 8]] as const) {
    def(`twins-${mat}-${lo}`, 30, hi > 9 ? 2 : 1, (b, x, g) => {
      b.tower({ x: x + 9, baseY: g, floors: lo, width: 4.2, material: mat, slab: "metal", windows: true, guards: ["guard"] });
      b.tower({ x: x + 21, baseY: g, floors: hi, width: 4.8, material: mat, slab: "metal", windows: true, guards: ["boss"], goldTop: true });
      const y = g + FLOOR_PITCH * bridgeFloor + 0.18;
      b.catwalk(x + 11.2, x + 18.7, y);
      b.enemy("guard", x + 15, y + 0.2, -1, { behavior: "sentry", gun: "sniper", range: 70, interval: 2.5, spread: 0.035 });
    });
  }
}

// A cluster of three, staggered — the skyline chunk.
for (const mat of ["concrete", "hull", "brick"] as MaterialId[]) {
  for (const scale of [1, 1.4] as const) {
    def(`skyline-${mat}-${scale}`, 40, 3, (b, x, g) => {
      const f = (n: number) => Math.round(n * scale);
      b.tower({ x: x + 8, baseY: g, floors: f(8), width: 4.4, material: mat, slab: "metal", windows: true, guards: ["guard", "grunt"] });
      b.tower({ x: x + 20, baseY: g, floors: f(12), width: 5.0, material: mat, slab: "metal", windows: true, guards: ["boss", "guard"], goldTop: true });
      b.tower({ x: x + 32, baseY: g, floors: f(6), width: 4.2, material: mat, slab: "concrete", windows: true, guards: ["guard"] });
      b.explosiveStack(x + 14, g, 5);
      b.enemy("guard", x + 26, g, -1, { behavior: "hunter", gun: "rifle", range: 34, standoff: 14, spread: 0.1 });
    });
  }
}

// ---------------------------------------------------------------------------
// Walls, battlements and gates
// ---------------------------------------------------------------------------

const WALL_MATS: MaterialId[] = ["wood", "brick", "concrete", "metal", "ice", "sandstone"];
for (const mat of WALL_MATS) {
  for (const [w, h] of [[4, 6], [3, 9], [8, 4]] as const) {
    def(`barrier-${mat}-${w}x${h}`, 14, mat === "metal" ? 2 : 1, (b, x, g) => {
      b.wall(x + 7, g, w, h, mat, 0.6);
      b.enemy("grunt", x + 11, g, -1, { behavior: "sentry", gun: "smg", range: 22, spread: 0.15 });
    });
  }
}

for (const mat of ["concrete", "metal", "sandstone"] as MaterialId[]) {
  for (const [len, h, guards] of [
    [16, 4.6, ["grunt", "guard"]],
    [22, 5.6, ["guard", "grunt", "guard"]],
    [28, 6.6, ["guard", "guard", "guard"]],
  ] as [number, number, EnemyKind[]][]) {
    def(`battlement-${mat}-${len}`, len + 8, 2, (b, x, g) => {
      const top = b.battlement(x + (len + 8) / 2, g, len, h, mat, guards);
      b.enemy("grunt", x + 3, g, -1, { behavior: "hunter", gun: "smg", range: 26, standoff: 10, spread: 0.13 });
      void top;
    });
  }
}

for (const mat of ["concrete", "metal", "brick"] as MaterialId[]) {
  for (const [w, h] of [[4, 4.4], [5, 5.4]] as const) {
    def(`gatehouse-${mat}-${w}`, 20, 2, (b, x, g) => {
      b.gate(x + 10, g, w, h, mat);
      b.explosiveStack(x + 4, g, 4);
      b.enemy("guard", x + 16, g, -1, { behavior: "sentry", gun: "shotgun", range: 17 });
    });
  }
}

for (const [roof, height, guards] of [
  [false, 8, ["grunt"]],
  [true, 12, ["guard", "grunt"]],
  [true, 16, ["boss", "guard"]],
] as [boolean, number, EnemyKind[]][]) {
  for (const mat of ["concrete", "sandstone", "metal"] as MaterialId[]) {
    def(`keep-${mat}-${height}`, 16, height > 8 ? 2 : 1, (b, x, g) => {
      b.castleTower({ x: x + 8, baseY: g, w: 5.2, height, material: mat, roof, guards });
      b.decor(x + 2, g + 0.2, "torch", "#ffb03a");
    });
  }
}

// ---------------------------------------------------------------------------
// Gaps, bridges and elevation
// ---------------------------------------------------------------------------

for (const [span, piers, depth] of [[16, 4, 7], [22, 5, 9], [30, 7, 12]] as const) {
  for (const mat of ["wood", "metal", "concrete"] as MaterialId[]) {
    def(`bridge-${mat}-${span}`, span + 10, 1, (b, x, g) => {
      const x1 = x + 5;
      const x2 = x + 5 + span;
      b.bridge(x1, x2, g + 0.4, mat, piers, g - depth);
      const deck = g + 0.77;
      b.enemy("grunt", x1 + span * 0.3, deck, -1, { behavior: "patrol", patrol: 4, gun: "smg", range: 24, spread: 0.14 });
      b.enemy("grunt", x1 + span * 0.7, deck, 1);
      b.explosiveStack(x1 + span * 0.5, deck, 2);
    });
  }
}

for (const [h1, h2] of [[2.4, 5.0], [3.6, 7.2], [5.0, 9.5]] as const) {
  def(`steps-${h1}`, 22, 1, (b, x, g) => {
    b.ledge(x + 6, g + h1, 8, 1.2);
    b.ledge(x + 16, g + h2, 7, 1.2);
    b.enemy("guard", x + 6, g + h1 + 0.7, -1, { behavior: "sentry", gun: "rifle", range: 34, spread: 0.11 });
    b.enemy("grunt", x + 16, g + h2 + 0.7, -1, { behavior: "sentry", gun: "sniper", range: 65, interval: 2.7, spread: 0.04 });
    b.scatter(x + 11, g, 5, 4, ["wood", "explosive"]);
  });
}

// ---------------------------------------------------------------------------
// Alien / Martian set dressing, so the run doesn't stay one colour of building
// ---------------------------------------------------------------------------

for (const [r, mat] of [[5.5, "biomass"], [7, "hull"], [9, "hull"]] as [number, MaterialId][]) {
  for (const pods of [0, 4]) {
    def(`dome-${mat}-${r}-${pods}`, 22, 1, (b, x, g) => {
      b.dome(x + 11, g, r, mat, 15, 0.5);
      if (pods) b.hive(x + 11, g, pods, "biomass");
      b.enemy("guard", x + 11, g + r + 0.25, -1, { behavior: "sentry", gun: "rifle", range: 36, spread: 0.1 });
      // Clear of the dome's skirt, which reaches x+2 at its widest.
      b.enemy("grunt", x + 21, g, -1);
    });
  }
}

for (const [h, w, lean] of [[10, 1.8, 0.05], [14, 2.2, -0.04], [18, 2.6, 0.03]] as const) {
  for (const mat of ["crystal", "metal", "hull"] as MaterialId[]) {
    def(`spire-${mat}-${h}`, 18, 1, (b, x, g) => {
      b.spire(x + 6, g, h, w, mat, lean);
      b.spire(x + 13, g, h * 0.7, w * 0.8, mat, -lean);
      b.enemy("guard", x + 9.5, g, -1, { behavior: "hunter", gun: "smg", range: 28, standoff: 11, spread: 0.12 });
    });
  }
}

for (const [count, spread] of [[5, 3], [8, 4], [12, 5]] as const) {
  def(`crystals-${count}`, 18, 0, (b, x, g) => {
    // Shards are static: a stickman spawned inside one gets shoved halfway up it,
    // so the cluster is kept clear of both ends of the chunk.
    b.crystalCluster(x + 9, g, count, spread);
    b.enemy("grunt", x + 16, g, -1);
  });
}

for (const rows of [4, 6, 8]) {
  def(`hive-${rows}`, 16, 1, (b, x, g) => {
    b.hive(x + 8, g, rows);
    b.enemy("guard", x + 13, g, -1, { behavior: "sentry", gun: "shotgun", range: 16 });
  });
}

// ---------------------------------------------------------------------------
// Ambushes — enemies first, cover second. These are the ones that actually bite.
// ---------------------------------------------------------------------------

const SQUADS: [string, EnemyKind[], number][] = [
  ["scouts", ["grunt", "grunt", "grunt"], 1],
  ["fireteam", ["guard", "grunt", "guard"], 2],
  ["heavy", ["boss", "guard", "guard"], 3],
];
for (const [name, roster, tier] of SQUADS) {
  for (const gun of ["smg", "rifle", "shotgun"] as const) {
    def(`squad-${name}-${gun}`, 24, tier, (b, x, g) => {
      roster.forEach((k, i) => {
        b.enemy(k, x + 5 + i * 6, g, -1, {
          behavior: i === 1 ? "hunter" : "patrol",
          gun, patrol: 5, standoff: gun === "shotgun" ? 8 : 12,
          range: gun === "shotgun" ? 18 : 30, spread: 0.12,
        });
      });
      // Past the last of them (they stand at x+5, +11, +17), so nobody spawns inside it.
      b.wall(x + 21, g, 3, 2.0, "concrete", 0.7);
    });
  }
}

for (const gun of ["rifle", "sniper"] as const) {
  for (const [height, mat] of [[6, "concrete"], [9, "metal"], [13, "hull"]] as [number, MaterialId][]) {
    def(`nest-${gun}-${height}`, 18, gun === "sniper" ? 3 : 2, (b, x, g) => {
      b.wall(x + 9, g, 4.5, height, mat, 0.8);
      b.block(x + 9, g + height + 0.25, 6, 0.5, mat);
      b.enemy("guard", x + 9, g + height + 0.6, -1, {
        behavior: "sentry", gun,
        range: gun === "sniper" ? 85 : 40,
        interval: gun === "sniper" ? 2.3 : 0.95,
        spread: gun === "sniper" ? 0.03 : 0.09,
      });
      b.explosiveStack(x + 14, g, 3);
    });
  }
}

for (const count of [2, 3, 4]) {
  def(`rush-${count}`, 20, 2, (b, x, g) => {
    for (let i = 0; i < count; i++) {
      b.enemy(i === 0 ? "guard" : "grunt", x + 6 + i * 4, g, -1, {
        behavior: "hunter", gun: "shotgun", range: 18, standoff: 7, speed: 4.4, spread: 0.17,
      });
    }
    b.scatter(x + 16, g, 4, 2, ["explosive"]);
  });
}

// ---------------------------------------------------------------------------
// Boss beats — rare, expensive, and worth the ammo.
// ---------------------------------------------------------------------------

for (const mat of ["metal", "hull", "concrete"] as MaterialId[]) {
  for (const floors of [14, 18]) {
    def(`citadel-${mat}-${floors}`, 34, 3, (b, x, g) => {
      b.wall(x + 6, g, 3, 8, mat, 0.9);
      b.tower({
        x: x + 18, baseY: g, floors, width: 5.6, material: mat, slab: "metal",
        windows: mat !== "metal", guards: ["boss", "boss"], goldTop: true,
      });
      b.enemy("boss", x + 28, g, -1, { behavior: "hunter", gun: "rifle", range: 40, standoff: 15, spread: 0.08, speed: 4 });
      b.enemy("guard", x + 10, g, 1, { behavior: "sentry", gun: "sniper", range: 85, interval: 2.2, spread: 0.03 });
      b.explosiveStack(x + 13, g, 6);
    });
  }
}

for (const [w, h] of [[4, 6], [6, 9]] as const) {
  def(`vault-${w}x${h}`, 20, 3, (b, x, g) => {
    b.wall(x + 10, g, w, h, "gold", 0.7);
    b.enemy("boss", x + 4, g, 1, { behavior: "sentry", gun: "shotgun", range: 18 });
    b.enemy("boss", x + 16, g, -1, { behavior: "sentry", gun: "rifle", range: 38, interval: 0.9, spread: 0.08 });
  });
}

export { CHUNKS };

/** Chunks legal at a given difficulty tier. Precomputed — the director asks per spawn. */
export const CHUNKS_BY_TIER: readonly (readonly Chunk[])[] = [0, 1, 2, 3].map(
  (t) => CHUNKS.filter((c) => c.tier <= t),
);
