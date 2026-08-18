import { Block, Terrain, type MaterialId } from "../entities/block";
import { Enemy, combat, type CombatOptions, type CombatSpec, type EnemyKind } from "../entities/enemy";
import type { Actor, GameCtx } from "../core/types";
import { chance, pick, rand } from "../core/math";
import type { Theme } from "../render/theme";
import { Decor } from "./hazards";

/**
 * Structures are plain stacks of dynamic blocks — no pre-scored break points, no
 * scripted collapse. Everything you see fall down was solved, not animated.
 *
 * Terrain colours default to the level's theme, so a world's palette is declared once.
 */
export class Builder {
  readonly enemies: Enemy[] = [];

  /**
   * Every actor this builder has ever created, in creation order. Endless mode uses
   * it to retire the chunks the player has already left behind — see `mark()`.
   */
  readonly spawned: Actor[] = [];

  /**
   * Combat behaviour applied to enemies that don't ask for their own. Campaign and
   * endless levels set it once at the top of `build`, so every existing `b.enemy()`
   * and every `guards:` list on a tower comes out armed without touching the call.
   */
  defaultCombat: CombatSpec | null = null;

  constructor(private readonly game: GameCtx, readonly theme: Theme) {}

  /** Index into `spawned`; pass a pair to `retire()` to delete a range. */
  mark() {
    return this.spawned.length;
  }

  /** Kills every actor created between two marks. Used to unload distant chunks. */
  retire(from: number, to = this.spawned.length) {
    for (let i = from; i < to && i < this.spawned.length; i++) this.spawned[i].dead = true;
  }

  private track<T extends Actor>(a: T): T {
    this.spawned.push(a);
    return a;
  }

  ground(x: number, y: number, w: number, h = 6, color = this.theme.ground, top = this.theme.groundTop) {
    return this.track(this.game.add(new Terrain(this.game, x, y, w, h, color, top)));
  }

  /**
   * A ground slab meant to sit flush against its neighbours — no side outline, so a
   * run of them reads as one continuous surface. Endless mode streams these.
   */
  groundRun(x: number, y: number, w: number, h = 6) {
    return this.track(this.game.add(
      new Terrain(this.game, x, y, w, h, this.theme.ground, this.theme.groundTop, true),
    ));
  }

  /** Solid rock ledge — reads as terrain rather than something you can knock over. */
  ledge(x: number, y: number, w: number, h = 1.2) {
    return this.track(this.game.add(new Terrain(this.game, x, y, w, h, this.theme.rock, this.theme.rockTop)));
  }

  decor(x: number, y: number, kind: "torch" | "banner" | "antenna" | "pod", tint?: string, z?: number) {
    return this.track(this.game.add(new Decor(this.game, x, y, kind, tint, z)));
  }

  block(x: number, y: number, w: number, h: number, material: MaterialId, angle = 0, anchored = true) {
    return this.track(this.game.add(new Block(this.game, { x, y, w, h, material, angle, anchored })));
  }

  /** A block that is free from the start — loose crates, barrels, rubble. */
  loose(x: number, y: number, w: number, h: number, material: MaterialId, angle = 0) {
    return this.block(x, y, w, h, material, angle, false);
  }

  /**
   * @param arms Combat options for this one stickman. Omit to use `defaultCombat`,
   *             pass `null` to leave it unarmed even on an armed level.
   */
  enemy(kind: EnemyKind, x: number, y: number, facing: 1 | -1 = -1, arms?: CombatOptions | null) {
    const spec = arms === undefined ? this.defaultCombat : arms === null ? null : combat(arms);
    const e = this.game.add(new Enemy(this.game, kind, x, y, facing, spec));
    this.enemies.push(e);
    return this.track(e);
  }

  /** Shorthand for a stickman that definitely shoots back. */
  gunner(kind: EnemyKind, x: number, y: number, facing: 1 | -1 = -1, arms: CombatOptions = {}) {
    return this.enemy(kind, x, y, facing, arms);
  }

  /**
   * A stack of floors: two columns and a slab per storey, with optional windows.
   * Tall ones genuinely become unstable — that is the fun.
   */
  tower(opts: {
    x: number;
    baseY: number;
    floors: number;
    width: number;
    floorHeight?: number;
    material: MaterialId;
    slab?: MaterialId;
    windows?: boolean;
    /** Enemies dropped on the roof and every Nth floor. */
    guards?: EnemyKind[];
    goldTop?: boolean;
  }) {
    const fh = opts.floorHeight ?? 1.8;
    const colW = 0.42;
    const slabH = 0.34;
    const slabMat = opts.slab ?? opts.material;
    let y = opts.baseY;

    for (let f = 0; f < opts.floors; f++) {
      const left = opts.x - opts.width / 2 + colW / 2;
      const right = opts.x + opts.width / 2 - colW / 2;
      this.block(left, y + fh / 2, colW, fh, opts.material);
      this.block(right, y + fh / 2, colW, fh, opts.material);

      const midColumn = opts.width > 3.4;
      if (midColumn) this.block(opts.x, y + fh / 2, colW, fh, opts.material);

      if (opts.windows && chance(0.8)) {
        // Windows go in the bays *beside* the centre column. Spanning the middle
        // would place glass inside the column and the solver would blow both apart.
        const bay = (opts.width - colW * (midColumn ? 3 : 2)) / (midColumn ? 2 : 1);
        const paneW = bay * 0.78;
        const paneH = fh * 0.5;
        const paneY = y + fh * 0.55;
        if (midColumn) {
          const dx = colW / 2 + bay / 2;
          this.block(opts.x - dx, paneY, paneW, paneH, "glass");
          this.block(opts.x + dx, paneY, paneW, paneH, "glass");
        } else {
          this.block(opts.x, paneY, paneW, paneH, "glass");
        }
      }

      y += fh;
      this.block(opts.x, y + slabH / 2, opts.width, slabH, slabMat);
      y += slabH;
    }

    if (opts.goldTop) this.block(opts.x, y + 0.35, 0.7, 0.7, "gold");

    if (opts.guards?.length) {
      const roofY = y + 0.1;
      opts.guards.forEach((k, i) => {
        const gx = opts.x + (i - (opts.guards!.length - 1) / 2) * 1.1;
        this.enemy(k, gx, roofY, gx > opts.x ? -1 : 1);
      });
    }
    return y;
  }

  /** Single-storey building with a pitched roof, a door gap and breakable windows. */
  house(opts: { x: number; baseY: number; w: number; h: number; material: MaterialId; roof?: MaterialId }) {
    const { x, baseY, w, h } = opts;
    const wallT = 0.4;
    this.block(x - w / 2 + wallT / 2, baseY + h / 2, wallT, h, opts.material);
    this.block(x + w / 2 - wallT / 2, baseY + h / 2, wallT, h, opts.material);
    // Lintel over the doorway.
    this.block(x, baseY + h - 0.3, w - wallT * 2, 0.4, opts.material);
    this.block(x - w * 0.22, baseY + h * 0.55, w * 0.3, h * 0.45, "glass");
    this.block(x + w * 0.22, baseY + h * 0.55, w * 0.3, h * 0.45, "glass");

    // Peaked roof: two planks that meet exactly at the apex. Deriving the length and
    // angle from the rise keeps them from overlapping into a giant X over the house.
    const roofMat = opts.roof ?? "wood";
    const rise = 1.0;
    const half = w / 2 + 0.3; // slight eave overhang
    const len = Math.hypot(half, rise);
    const ang = Math.atan2(rise, half);
    const apexY = baseY + h + rise / 2;
    this.block(x - half / 2, apexY, len, 0.28, roofMat, ang);
    this.block(x + half / 2, apexY, len, 0.28, roofMat, -ang);
    return baseY + h;
  }

  /** Free-standing wall, one brick course at a time. */
  wall(x: number, baseY: number, w: number, h: number, material: MaterialId, brick = 0.55) {
    const rows = Math.max(1, Math.round(h / brick));
    const bh = h / rows;
    const cols = Math.max(1, Math.round(w / (brick * 1.6)));
    const bw = w / cols;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? bw * 0.5 : 0;
      const n = r % 2 ? cols - 1 : cols;
      for (let c = 0; c < n; c++) {
        this.block(x - w / 2 + bw / 2 + c * bw + offset, baseY + bh / 2 + r * bh, bw * 0.97, bh * 0.94, material);
      }
    }
  }

  /** Pyramid stack — the most satisfying thing in the game to knock over. */
  pyramid(x: number, baseY: number, rows: number, size: number, material: MaterialId) {
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      for (let c = 0; c < n; c++) {
        this.block(x + (c - (n - 1) / 2) * size * 1.02, baseY + size / 2 + r * size, size * 0.96, size * 0.96, material);
      }
    }
  }

  /**
   * Piers with a deck spanning between them. Each deck section rests on two piers,
   * so blowing one pier drops exactly the sections it was carrying — no more, no less.
   *
   * @param pierBottom How far down the piers reach; for a canyon, below the rim.
   */
  bridge(x1: number, x2: number, deckY: number, material: MaterialId = "wood", piers = 4, pierBottom = deckY - 4) {
    const n = Math.max(2, piers);
    const pierW = 0.5;
    const pierH = deckY - pierBottom;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(x1 + (i / (n - 1)) * (x2 - x1));

    for (const px of xs) {
      this.block(px, pierBottom + pierH / 2, pierW, pierH, material);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = xs[i];
      const c = xs[i + 1];
      // Overhang the piers by half their width so each section is carried at both ends.
      this.block((a + c) / 2, deckY + 0.2, c - a + pierW, 0.34, material);
    }
  }

  /**
   * Skybridge between two towers. A single anchored span rather than a chain of
   * loose planks — a free-floating plank bridge has nothing holding its middle up.
   */
  catwalk(x1: number, x2: number, y: number, material: MaterialId = "metal") {
    this.block((x1 + x2) / 2, y, x2 - x1, 0.36, material);
    this.block(x1 + 0.2, y + 0.7, 0.16, 1.1, material);
    this.block(x2 - 0.2, y + 0.7, 0.16, 1.1, material);
    return y + 0.18;
  }

  // ------------------------------------------------------------------ castle

  /**
   * Curtain wall with a walkway and crenellations.
   *
   * Merlon gaps are sized to fit a stickman, and `guards` are dropped **into** those
   * gaps rather than on top of the stone — anything perched on a merlon slides off and
   * is dead before the player arrives. Returns the walkway height.
   */
  battlement(
    x: number, baseY: number, w: number, h: number,
    material: MaterialId = "concrete", guards: EnemyKind[] = [],
  ) {
    this.wall(x, baseY, w, h, material, 0.62);

    const deck = baseY + h;
    this.block(x, deck + 0.2, w, 0.4, material);
    const top = deck + 0.4;

    const merlonW = 0.55;
    const gap = 1.7; // wide enough to stand in
    const pitch = merlonW + gap;
    const count = Math.max(2, Math.floor(w / pitch));
    const start = x - (count * pitch - gap) / 2 + merlonW / 2;

    const crenels: number[] = [];
    for (let i = 0; i < count; i++) {
      this.block(start + i * pitch, top + 0.4, merlonW, 0.8, material);
      if (i < count - 1) crenels.push(start + i * pitch + pitch / 2);
    }

    guards.forEach((k, i) => {
      const cx = crenels.length ? crenels[Math.floor((i * crenels.length) / Math.max(1, guards.length))] : x;
      this.enemy(k, cx, top + 0.02, cx > x ? -1 : 1);
    });
    return top;
  }

  /** Square keep tower: shaft, crenellated crown and an optional pitched roof. */
  castleTower(opts: {
    x: number; baseY: number; w: number; height: number;
    material?: MaterialId; roof?: boolean; guards?: EnemyKind[];
  }) {
    const mat = opts.material ?? "concrete";
    const courses = Math.max(2, Math.round(opts.height / 0.85));
    const ch = opts.height / courses;
    for (let i = 0; i < courses; i++) {
      const y = opts.baseY + ch / 2 + i * ch;
      this.block(opts.x - opts.w / 2 + 0.3, y, 0.6, ch * 0.96, mat);
      this.block(opts.x + opts.w / 2 - 0.3, y, 0.6, ch * 0.96, mat);
      // Arrow slit every third course, otherwise fill the middle in.
      if (i % 3 === 1) this.block(opts.x, y, opts.w - 1.2, ch * 0.3, mat);
      else this.block(opts.x, y, opts.w - 1.2, ch * 0.96, mat);
    }
    const top = opts.baseY + opts.height;
    const capW = opts.w + 0.5;
    this.block(opts.x, top + 0.2, capW, 0.4, mat);
    const deck = top + 0.4;

    // Corner merlons only. Ringing the whole cap leaves nowhere for a guard to stand.
    const merlonW = 0.5;
    for (const s of [-1, 1]) {
      this.block(opts.x + s * (capW / 2 - merlonW / 2), deck + 0.4, merlonW, 0.8, mat);
    }

    if (opts.roof) {
      const rise = opts.w * 0.75;
      const half = opts.w / 2 + 0.3;
      const len = Math.hypot(half, rise);
      const ang = Math.atan2(rise, half);
      // Rests just clear of the merlons (which top out at deck + 0.8).
      const roofY = deck + 0.95;
      this.block(opts.x - half / 2, roofY + rise / 2, len, 0.3, "wood", ang);
      this.block(opts.x + half / 2, roofY + rise / 2, len, 0.3, "wood", -ang);
    }

    opts.guards?.forEach((k, i) => {
      const span = capW - merlonW * 2.4;
      const n = opts.guards!.length;
      const gx = opts.x + (n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
      this.enemy(k, gx, deck + 0.02, gx > opts.x ? -1 : 1);
    });
    return deck;
  }

  /** Gatehouse: two piers with a stepped arch between them. */
  gate(x: number, baseY: number, width: number, height: number, material: MaterialId = "concrete") {
    const pier = 0.9;
    this.block(x - width / 2 - pier / 2, baseY + height / 2, pier, height, material);
    this.block(x + width / 2 + pier / 2, baseY + height / 2, pier, height, material);
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / (steps + 1);
      const span = width * (1 - t * 0.72);
      this.block(x, baseY + height + 0.25 + i * 0.5, span + pier, 0.5, material);
    }
    // Portcullis.
    for (let i = 0; i < 4; i++) {
      this.block(x - width / 2 + (i + 0.5) * (width / 4), baseY + height * 0.5, 0.16, height * 0.9, "metal");
    }
    return baseY + height + 0.25 + steps * 0.5;
  }

  // ------------------------------------------------------------------ alien / mars

  /** Half-dome of tangential panels. Habitats and hive chambers. */
  dome(cx: number, baseY: number, radius: number, material: MaterialId, segments = 13, thickness = 0.45) {
    for (let i = 0; i < segments; i++) {
      const a = (Math.PI * (i + 0.5)) / segments;
      const x = cx + Math.cos(a) * radius;
      const y = baseY + Math.sin(a) * radius;
      const segW = ((Math.PI * radius) / segments) * 1.08;
      this.block(x, y, segW, thickness, material, a - Math.PI / 2);
    }
    return baseY + radius;
  }

  /** Tapering stack — alien needles and Martian comm masts. */
  spire(x: number, baseY: number, height: number, baseW: number, material: MaterialId, lean = 0) {
    const segs = Math.max(3, Math.round(height / 1.3));
    const sh = height / segs;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const w = baseW * (1 - t * 0.72);
      const dx = lean * height * t * t;
      this.block(x + dx, baseY + sh / 2 + i * sh, w, sh * 0.97, material, lean * 0.5 * t);
    }
    return baseY + height;
  }

  /** Cluster of organic pods stacked into a mound. */
  hive(x: number, baseY: number, rows: number, material: MaterialId = "biomass") {
    for (let r = 0; r < rows; r++) {
      const n = rows - r;
      const size = 0.9 - r * 0.05;
      for (let c = 0; c < n; c++) {
        this.block(x + (c - (n - 1) / 2) * size * 1.04, baseY + size / 2 + r * size * 0.92, size, size, material, rand(-0.06, 0.06));
      }
    }
    return baseY + rows * 0.9;
  }

  /** A ring of crystal shards jutting from the ground at varied angles. */
  crystalCluster(x: number, baseY: number, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const a = rand(-0.5, 0.5);
      const h = rand(1.6, 4.2);
      this.block(x + rand(-spread, spread), baseY + (h / 2) * Math.cos(a), 0.5, h, "crystal", a);
    }
  }

  /** Loose crates and barrels for texture and easy early destruction. */
  scatter(x: number, baseY: number, count: number, spread: number, materials: MaterialId[] = ["wood", "wood", "explosive"]) {
    for (let i = 0; i < count; i++) {
      const s = rand(0.45, 0.8);
      // Resting on the ground, not raining down from nowhere on level load.
      this.loose(x + rand(-spread, spread), baseY + s / 2 + 0.02, s, s, pick(materials), rand(-0.08, 0.08));
    }
  }

  /** Column of stacked barrels — a chain reaction waiting to happen. */
  explosiveStack(x: number, baseY: number, count: number) {
    for (let i = 0; i < count; i++) {
      this.block(x, baseY + 0.42 + i * 0.84, 0.72, 0.82, "explosive");
    }
  }
}
