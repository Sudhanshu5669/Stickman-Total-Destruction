import { Block, Terrain, type MaterialId } from "../entities/block";
import { Enemy, type EnemyKind } from "../entities/enemy";
import type { GameCtx } from "../core/types";
import { chance, pick, rand } from "../core/math";

/**
 * Structures are plain stacks of dynamic blocks — no pre-scored break points, no
 * scripted collapse. Everything you see fall down was solved, not animated.
 */
export class Builder {
  readonly enemies: Enemy[] = [];

  constructor(private readonly game: GameCtx) {}

  ground(x: number, y: number, w: number, h = 6, color = "#3a4b3a", top = "#5c8a43") {
    return this.game.add(new Terrain(this.game, x, y, w, h, color, top));
  }

  /** Solid rock ledge — reads as terrain rather than something you can knock over. */
  ledge(x: number, y: number, w: number, h = 1.2) {
    return this.game.add(new Terrain(this.game, x, y, w, h, "#4a4740", "#6b6353"));
  }

  block(x: number, y: number, w: number, h: number, material: MaterialId, angle = 0, anchored = true) {
    return this.game.add(new Block(this.game, { x, y, w, h, material, angle, anchored }));
  }

  /** A block that is free from the start — loose crates, barrels, rubble. */
  loose(x: number, y: number, w: number, h: number, material: MaterialId, angle = 0) {
    return this.block(x, y, w, h, material, angle, false);
  }

  enemy(kind: EnemyKind, x: number, y: number, facing: 1 | -1 = -1) {
    const e = this.game.add(new Enemy(this.game, kind, x, y, facing));
    this.enemies.push(e);
    return e;
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
