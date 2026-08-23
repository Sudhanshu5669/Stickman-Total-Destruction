import { Block, Terrain, type BlockSkin, type MaterialId, type TerrainSkin } from "../entities/block";
import { SpriteProp, type SpritePropOptions } from "../entities/spriteprop";
import { PPM, sheet, type Sheet } from "../render/sprites";
import { Enemy, combat, type CombatOptions, type CombatSpec, type EnemyKind } from "../entities/enemy";
import type { Actor, GameCtx } from "../core/types";
import { chance, pick, rand } from "../core/math";
import type { Theme } from "../render/theme";
import { Decor } from "./hazards";
import {
  BIRDS, CAMP, CLOUDS, GRAVES, roll, seasonSet, SUN, weighted, type Piece,
} from "./dressing";

/** The platformer pack's scenery sheet. Every non-city arena already preloads it. */
const DECOR_SHEET = "GandalfHardcore FREE Platformer Assets/Decor.png";

/**
 * Structures are plain stacks of dynamic blocks — no pre-scored break points, no
 * scripted collapse. Everything you see fall down was solved, not animated.
 *
 * Terrain colours default to the level's theme, so a world's palette is declared once.
 *
 * ## Coordinates, and the one thing that keeps going wrong
 *
 * This class grew three different conventions, and mixing them up does not throw — it
 * quietly builds a level with a hole in it:
 *
 * | family                              | x        | y                |
 * |-------------------------------------|----------|------------------|
 * | `ground`, `ledge` (raw `Terrain`)    | centre   | **centre**       |
 * | `block`, `loose` (raw `Block`)       | centre   | **centre**       |
 * | `wall`, `tower`, `house`, `pyramid`  | centre   | bottom (`baseY`) |
 * | `spriteWall`                         | **left** | bottom           |
 *
 * Reading `ground`'s x as a left edge is what left two whole bands of the Proving
 * Ground standing over a void, with every stickman in them falling out of the world
 * while the anchored props hung in the air looking perfectly fine.
 *
 * **Prefer the span helpers below** — `groundSpan`, `shelf`, `basin` — for anything
 * load-bearing. They take explicit left and right edges and an explicit top surface,
 * which is how a level author actually thinks about ground, and they cannot be read
 * two ways.
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
  // ------------------------------------------------------------- pixel art
  /**
   * Loads a sheet by its path under `src/Assets`. Sheets are cached, so calling this
   * once per prop in a level costs one map lookup after the first.
   */
  sheet(path: string): Sheet {
    return sheet(path);
  }

  /** A piece of scenery. No body, no collision — see `SpriteProp`. */
  prop(o: SpritePropOptions) {
    return this.track(this.game.add(new SpriteProp(this.game, o)));
  }

  /** Gives a ground slab a tiled surface. Returns the slab, so it chains off `ground`. */
  skin(t: Terrain, s: TerrainSkin) {
    t.skin = s;
    return t;
  }

  /**
   * Builds a structure directly out of its own artwork.
   *
   * Lays a `cols x rows` grid of one-metre blocks over the sheet region starting at
   * tile (tx, ty), skins each block with the cell it covers, and **skips every cell the
   * artwork leaves empty** — so a gabled roof comes out gabled, with no invisible boxes
   * hanging off its slopes, without anyone writing down which tiles those are.
   *
   * The result is an ordinary stack of blocks: it takes damage, catches fire, topples
   * and shatters exactly like a hand-built tower, and each piece falls carrying its own
   * square of the picture.
   *
   * Note this reads pixels, so it needs the sheet decoded — levels using it must be
   * behind `preload`. If the sheet is missing, every cell is treated as solid, which
   * degrades to a plain rectangular building rather than to nothing.
   */
  spriteWall(o: {
    sheet: Sheet;
    /** Top-left source cell, in tiles. */
    tx: number; ty: number;
    cols: number; rows: number;
    /** World position of the structure's bottom-left corner. */
    x: number; baseY: number;
    material: MaterialId;
    /** Metres per tile. 1 keeps the pack's own scale. */
    size?: number;
    anchored?: boolean;
  }) {
    const m = o.size ?? 1;
    const out: Block[] = [];
    for (let cy = 0; cy < o.rows; cy++) {
      for (let cx = 0; cx < o.cols; cx++) {
        const sx = o.tx + cx;
        const sy = o.ty + cy;
        if (!o.sheet.covered(sx, sy)) continue;
        out.push(this.track(this.game.add(new Block(this.game, {
          // Source row 0 is the top of the image; world Y grows upward, so the grid is
          // walked downward in source space and upward in world space.
          x: o.x + (cx + 0.5) * m,
          y: o.baseY + (o.rows - 1 - cy + 0.5) * m,
          w: m, h: m,
          material: o.material,
          anchored: o.anchored ?? true,
          skin: { sheet: o.sheet, sx: sx * PPM, sy: sy * PPM, sw: PPM, sh: PPM },
        }))));
      }
    }
    return out;
  }

  /** One skinned block — a crate, a barrel, anything meant to be knocked over. */
  spriteBlock(o: {
    sheet: Sheet; tx: number; ty: number; tw?: number; th?: number;
    x: number; baseY: number; material: MaterialId; size?: number; anchored?: boolean;
  }) {
    const tw = o.tw ?? 1;
    const th = o.th ?? 1;
    const m = o.size ?? 1;
    return this.track(this.game.add(new Block(this.game, {
      x: o.x, y: o.baseY + (th * m) / 2,
      w: tw * m, h: th * m,
      material: o.material,
      anchored: o.anchored ?? false,
      skin: { sheet: o.sheet, sx: o.tx * PPM, sy: o.ty * PPM, sw: tw * PPM, sh: th * PPM },
    })));
  }

  ledge(x: number, y: number, w: number, h = 1.2) {
    return this.track(this.game.add(new Terrain(this.game, x, y, w, h, this.theme.rock, this.theme.rockTop)));
  }

  decor(x: number, y: number, kind: "torch" | "banner" | "antenna" | "pod", tint?: string, z?: number) {
    return this.track(this.game.add(new Decor(this.game, x, y, kind, tint, z)));
  }

  block(
    x: number, y: number, w: number, h: number, material: MaterialId,
    angle = 0, anchored = true, skin?: BlockSkin,
  ) {
    return this.track(this.game.add(new Block(this.game, { x, y, w, h, material, angle, anchored, skin })));
  }

  /**
   * A skin that tiles one source cell across a block of any size.
   *
   * `spriteBlock` maps one tile to one block, which is right for a wall built cell by
   * cell and wrong for a six-metre floor slab: the tile stretches over it and the
   * pixels smear. This repeats the cell instead, so a beam or a slab is clad at the
   * artwork's own scale whatever length it happens to be.
   */
  private cell(sheet: Sheet, tx: number, ty: number): BlockSkin {
    return { sheet, sx: tx * PPM, sy: ty * PPM, sw: PPM, sh: PPM, tile: true };
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
   * A line of stickmen centred on `x`, each turned to face the middle of the group.
   *
   * A structure with nobody in it is scenery; the same structure with six people
   * standing under it is a target. Placing them one `enemy()` call at a time is how a
   * level ends up with three inhabitants spread over two hundred metres, so populating
   * a set-piece gets a verb of its own.
   */
  crowd(x: number, y: number, kinds: EnemyKind[], pitch = 1.9, arms?: CombatOptions | null) {
    kinds.forEach((k, i) => {
      const gx = x + (i - (kinds.length - 1) / 2) * pitch;
      this.enemy(k, gx, y, gx > x ? -1 : 1, arms);
    });
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

  /**
   * A free-standing stack with a little jitter in every course.
   *
   * Everything in it is loose from the first frame, so it is already leaning when the
   * level loads and the solver — not the author — decides which way it goes. That is
   * the point: a set-piece that fails identically every attempt is watched once, and a
   * stack that falls differently every attempt is what a retry is *for*. Put these
   * where a near miss still knocks something over.
   */
  teeter(x: number, baseY: number, count: number, size = 0.8, material: MaterialId = "wood") {
    let y = baseY;
    for (let i = 0; i < count; i++) {
      const w = size * rand(0.85, 1.15);
      const h = size * rand(0.8, 1.1);
      this.loose(x + rand(-size * 0.22, size * 0.22), y + h / 2 + 0.02, w, h, material, rand(-0.09, 0.09));
      y += h;
    }
    return y;
  }

  // ------------------------------------------------------------- dressing

  /**
   * Scatters scenery along a run of ground.
   *
   * The bulk layer described in `levels/dressing.ts`. One call dresses a whole band:
   *
   * ```ts
   * b.dress(-70, 26, G0);                       // wild turf
   * b.dress(-46, -30, G0, { kind: "camp" });    // somebody lives here
   * ```
   *
   * Placement walks the span at a fixed pitch and rejects most candidates, rather than
   * placing N items at random x. Rejection sampling on a grid is what keeps the spacing
   * *irregular but bounded* — pure random x clumps three rocks on one metre and leaves
   * a twenty-metre hole, which is precisely the look the hand-placed pass already had.
   *
   * Everything is seeded off world position, so an arena's scenery is part of the arena
   * rather than a different level every time it loads.
   *
   * @param density 0..1 — roughly the fraction of candidate slots that get filled.
   */
  dress(x0: number, x1: number, y: number, o: {
    kind?: "wild" | "camp" | "graves";
    density?: number;
    /** Draw order. The default sits scenery behind the things you can shoot. */
    z?: number;
    /** Distinguishes two bands at the same x so they do not get identical scenery. */
    salt?: number;
    /** Metres between candidate slots. */
    pitch?: number;
  } = {}) {
    const sheet = this.decorSheet();
    if (!sheet) return;

    const kind = o.kind ?? "wild";
    const density = o.density ?? 0.62;
    const z = o.z ?? 3;
    const salt = o.salt ?? 0;
    const pitch = o.pitch ?? 1.5;
    const season = seasonSet(this.theme.groundRow);

    // Weighted by *kind*, not uniform: turf is mostly small things with the occasional
    // stone, because a field of evenly-mixed rocks and shrubs reads as a rockery.
    const table = (r: number): Piece[] => {
      if (kind === "camp") return CAMP;
      if (kind === "graves") return GRAVES;
      if (r < 0.42) return season.tufts;
      if (r < 0.74) return season.rocks;
      if (r < 0.96) return season.bushes;
      return season.boulders;
    };

    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    for (let x = lo; x < hi; x += pitch) {
      if (roll(x, 11 + salt) > density) continue;
      const piece = weighted(table(roll(x, 29 + salt)), roll(x, 47 + salt));
      // Jittered off the slot so the pitch itself never becomes visible as a rhythm.
      const jx = x + (roll(x, 63 + salt) - 0.5) * pitch * 0.8;
      this.prop({
        sheet, tx: piece.tx, ty: piece.ty, tw: piece.tw, th: piece.th,
        x: jx, y, scale: piece.m, sway: piece.sway ?? 0,
        flip: roll(x, 71 + salt) < 0.5,
        // A metre of depth spread, so a band of scenery has a near edge and a far one
        // instead of standing in a single rank.
        z: z + (roll(x, 83 + salt) < 0.3 ? 6 : 0),
      });
    }
  }

  /**
   * Places one named piece of scenery from the decor sheet.
   *
   * For the things a level wants *there*, specifically — the scarecrow in the field,
   * the statue in the courtyard — as opposed to the bulk `dress` pass.
   */
  landmark(piece: Piece, x: number, y: number, o: { scale?: number; z?: number; flip?: boolean } = {}) {
    const sheet = this.decorSheet();
    if (!sheet) return;
    this.prop({
      sheet, tx: piece.tx, ty: piece.ty, tw: piece.tw, th: piece.th,
      x, y, scale: (o.scale ?? 1) * piece.m, sway: piece.sway ?? 0,
      z: o.z ?? 4, flip: o.flip ?? false,
    });
  }

  /**
   * The platformer pack's decor sheet, or nothing.
   *
   * Grid City is built from a different pack entirely and has no business growing
   * shrubs, so the city theme opts out by returning null rather than by every call site
   * remembering not to ask.
   */
  private decorSheetCache: Sheet | null = null;
  private decorSheet(): Sheet | null {
    if (this.theme.id === "city") return null;
    return (this.decorSheetCache ??= this.sheet(DECOR_SHEET));
  }

  /**
   * Weather and wildlife, over the whole arena.
   *
   * One call per level. Clouds are spread across the span at three altitudes so the sky
   * has depth rather than a single rank of stickers, birds are hung high and small, and
   * the sun is optional because half these worlds are overcast.
   *
   * All of it is seeded off world position, so an arena's sky is as fixed as its ground.
   *
   * @param skyY The height the backdrop's own treeline or skyline tops out at. Clouds
   *             are hung just above it: the painted layers are drawn before any actor,
   *             so a cloud placed level with the trees would sit *in front* of them and
   *             read as fog on the near ground rather than as weather behind it.
   */
  sky(x0: number, x1: number, skyY: number, o: {
    clouds?: number;
    birds?: number;
    /** Bias toward the bigger sprites. 0 is wisps, 1 is weather. */
    heaviness?: number;
    sun?: { x: number; y: number; scale?: number } | null;
  } = {}) {
    // Grid City's backdrop paints its own sky, and a fluffy white cloud over a
    // rain-lit skyline reads as a mistake rather than as weather.
    if (this.theme.id === "city") return;

    // One cloud per dozen metres and a flock per forty. The frame is about 35 m wide,
    // so that is roughly three clouds and one flock on screen at any time — enough that
    // the sky is never empty, sparse enough that it never becomes the subject.
    const count = o.clouds ?? Math.max(5, Math.round((x1 - x0) / 12));
    const birds = o.birds ?? Math.max(2, Math.round((x1 - x0) / 40));
    const heaviness = o.heaviness ?? 0.5;
    const span = x1 - x0;

    for (let i = 0; i < count; i++) {
      const r = roll(i * 7.3, 5);
      const x = x0 + ((i + roll(i * 3.1, 9) * 0.8) / count) * span;
      // Three altitudes, and the higher a cloud is the smaller it is drawn — cheap
      // aerial perspective, and the reason this does not read as one flat rank.
      const rank = i % 3;
      const pick = Math.min(
        CLOUDS.length - 1,
        Math.floor((roll(i * 5.7, 13) * 0.55 + heaviness * 0.45) * CLOUDS.length),
      );
      const c = CLOUDS[pick];
      const scale = (1.5 - rank * 0.32) * (0.8 + r * 0.5);
      this.prop({
        sheet: this.sheet(c.path), tx: 0, ty: 0, tw: c.tw, th: c.th,
        x, y: skyY + 1.5 + rank * 4.5 + r * 3.5,
        scale, z: -8 - rank, alpha: 0.9 - rank * 0.12,
        flip: roll(i * 11.9, 17) < 0.5,
        // Barely-there drift. Enough that a still frame and a live one differ.
        sway: 0.006 + r * 0.006,
      });
    }

    for (let i = 0; i < birds; i++) {
      const b = BIRDS[Math.floor(roll(i * 4.1, 23) * BIRDS.length)];
      this.prop({
        sheet: this.sheet(b.path), tx: 0, ty: 0, tw: b.tw, th: b.th,
        x: x0 + ((i + 0.5) / birds) * span + roll(i * 6.7, 29) * 14,
        y: skyY + 3 + roll(i * 8.3, 31) * 8,
        scale: 1.6 + roll(i * 2.3, 37) * 1.4,
        z: -6, alpha: 0.85, sway: 0.05,
        flip: roll(i * 9.1, 41) < 0.5,
      });
    }

    if (o.sun) {
      this.prop({
        sheet: this.sheet(SUN.path), tx: 0, ty: 0, tw: SUN.tw, th: SUN.th,
        x: o.sun.x, y: o.sun.y, scale: o.sun.scale ?? 5, z: -12, alpha: 0.9,
      });
    }
  }

  // ------------------------------------------------------------- spans
  //
  // Everything below takes explicit edges. See the coordinate note on the class.

  /**
   * Ground from `x0` to `x1`, with its surface at `top`.
   *
   * This is the one that should be reached for by default. `ground()` places a slab by
   * its centre in both axes, which is the correct thing for a physics body and the
   * wrong thing for a level author, who knows where the ground *starts*, where it
   * *ends*, and what height you stand on.
   */
  groundSpan(x0: number, x1: number, top: number, depth = 6) {
    const w = Math.abs(x1 - x0);
    return this.ground(Math.min(x0, x1) + w / 2, top - depth / 2, w, depth);
  }

  /**
   * `groundSpan` with a tiled surface, in one call — every pixel-art arena wants this.
   *
   * The row defaults to the *theme's* season rather than to zero. Passing it at the
   * call site is how Ironhold ended up with summer turf under an autumn sky and how
   * Coldspine ran a green stripe across a snowfield: the sheets draw three seasons and
   * every author took the first one. See `Theme.groundRow`.
   */
  skinnedGround(
    x0: number, x1: number, top: number,
    sheet: Sheet = this.groundSheet(), tx = 0, ty = this.theme.groundRow, depth = 6,
  ) {
    return this.skin(this.groundSpan(x0, x1, top, depth), { sheet, tx, ty });
  }

  /**
   * The theme's own terrain sheet, cached.
   *
   * Every span helper below reaches for this so that a platform, a terrace and the
   * floor of a pit are all made of the same material as the ground outside them —
   * which is what a level author means by "ground" and what none of them used to get.
   */
  private groundSheetCache: Sheet | null = null;
  groundSheet(): Sheet {
    return (this.groundSheetCache ??= this.sheet(this.theme.groundSheet));
  }

  /** The terrain skin this world's ground is tiled with. */
  groundSkin(): TerrainSkin {
    return { sheet: this.groundSheet(), tx: 0, ty: this.theme.groundRow };
  }

  /**
   * A floating platform, by edges, with its walkable surface at `top`.
   *
   * Static terrain rather than a block: a platform the player is meant to stand on and
   * fight from should not be knocked out from under them by a stray chicken. Things
   * that are *supposed* to fall are built out of `block`.
   */
  shelf(x0: number, x1: number, top: number, thickness = 1.2) {
    const w = Math.abs(x1 - x0);
    // Skinned like the ground, because it *is* ground: the untextured version left the
    // Quarry's terraces and the Drift's whole island chain as flat grey-brown boxes in
    // arenas whose every other surface was tiled artwork.
    return this.skin(
      this.ledge(Math.min(x0, x1) + w / 2, top - thickness / 2, w, thickness),
      this.groundSkin(),
    );
  }

  /**
   * A pit with walls: floor, two sides, and a run of steps up each of them.
   *
   * The shape the "fight in the round" arena is built on. A flat field puts every enemy
   * at one height and reduces the whole fight to left-or-right; a basin stacks them
   * above each other, so the frame has a foreground, a middle and a rim, and the
   * jetpack becomes a way of choosing which of the three you are in.
   *
   * Steps rather than a smooth curve because a curve made of boxes is a staircase with
   * extra steps, and because the ledges are where the interesting enemies stand.
   *
   * @param rimY   Height of the ground outside the bowl.
   * @param floorY Height of the bowl's floor.
   */
  basin(cx: number, halfW: number, rimY: number, floorY: number, steps = 3) {
    const depth = rimY - floorY;
    const stepH = depth / (steps + 1);
    const stepW = (halfW * 0.42) / steps;

    this.skinnedGround(cx - halfW, cx + halfW, floorY);

    // The two walls, as stacks of terrain, each course inset from the one below.
    //
    // Full-depth slabs, not thin shelves. A shelf is a metre of rock with nothing
    // underneath it, so a stepped wall built out of shelves left the whole inside face
    // of the bowl as open air with the *backdrop* showing through — a flat brown plane
    // where twelve metres of quarried rock should be, which was most of the frame in
    // the one arena you spend the whole time looking into. Each course now runs from
    // its own surface down past the floor, so the wall is solid all the way.
    for (let i = 0; i < steps; i++) {
      const y = floorY + stepH * (i + 1);
      const inset = halfW - stepW * (steps - i);
      const deep = y - floorY + 6;
      this.skinnedGround(cx - halfW - 2, cx - inset, y, undefined, 0, undefined, deep);
      this.skinnedGround(cx + inset, cx + halfW + 2, y, undefined, 0, undefined, deep);
    }

    // The rim, running out to either side. Generous, so the player has somewhere to
    // stand and look down into the thing before committing to it.
    const rimDeep = Math.max(6, rimY - floorY + 6);
    this.skinnedGround(cx - halfW - 40, cx - halfW - 1.5, rimY, undefined, 0, undefined, rimDeep);
    this.skinnedGround(cx + halfW + 1.5, cx + halfW + 40, rimY, undefined, 0, undefined, rimDeep);
    return { floorY, rimY, stepH };
  }

  // ------------------------------------------------------------- structures

  /**
   * A tower you are meant to climb, not just knock over.
   *
   * `tower()` builds a sealed stack of floors: excellent to topple, impossible to enter.
   * This leaves one side of every storey open, alternating which side, so there is a
   * route up the outside — and it hangs a landing off each opening, so the route is
   * flyable with the jetpack and survivable without it.
   *
   * The floors are ordinary blocks, so the climb can still be deleted underneath you.
   * That is the arena: the fastest way down is to remove the way up.
   */
  scaffold(opts: {
    x: number;
    baseY: number;
    floors: number;
    width: number;
    floorHeight?: number;
    material: MaterialId;
    /**
     * Cladding: a sheet and a source cell, tiled over every column, slab and landing.
     *
     * Without it a scaffold is a lattice of flat grey rectangles, which is exactly what
     * Ironhold's twelve-storey centrepiece and Coldspine's two watchtowers were — the
     * only structures in the game that still looked like a physics test scene, standing
     * in the middle of arenas whose every other surface was painted artwork.
     */
    clad?: { sheet: Sheet; tx: number; ty: number };
    /** Enemies placed on the landing of every Nth floor. */
    guards?: EnemyKind[];
    guardEvery?: number;
    arms?: CombatOptions | null;
  }) {
    const fh = opts.floorHeight ?? 3.2;
    const skin = opts.clad ? this.cell(opts.clad.sheet, opts.clad.tx, opts.clad.ty) : undefined;
    const colW = 0.5;
    const half = opts.width / 2;
    const every = opts.guardEvery ?? 2;
    let y = opts.baseY;

    for (let f = 0; f < opts.floors; f++) {
      const openRight = f % 2 === 0;
      // The closed side is a full column. The open side gets a lintel hung from the
      // slab above rather than a stub standing on the floor: a short column floating in
      // the middle of a storey reads as a bug, where a header over a doorway reads as
      // a doorway — and both carry the same load, because both are anchored.
      const closedX = openRight ? opts.x - half + colW / 2 : opts.x + half - colW / 2;
      const openX = openRight ? opts.x + half - colW / 2 : opts.x - half + colW / 2;
      this.block(closedX, y + fh / 2, colW, fh, opts.material, 0, true, skin);
      const lintel = fh * 0.3;
      this.block(openX, y + fh - lintel / 2, colW, lintel, opts.material, 0, true, skin);

      y += fh;
      this.block(opts.x, y + 0.2, opts.width, 0.4, opts.material, 0, true, skin);

      // Landing on the open side — the thing that makes the climb a route rather than
      // a wall with gaps in it.
      const lx = opts.x + (openRight ? half + 1.4 : -half - 1.4);
      this.block(lx, y + 0.2, 3, 0.4, opts.material, 0, true, skin);

      if (opts.guards?.length && f % every === 0) {
        const k = opts.guards[Math.floor(f / every) % opts.guards.length];
        this.enemy(k, lx, y + 0.5, openRight ? -1 : 1, opts.arms);
      }
      y += 0.4;
    }
    return y;
  }

  /**
   * A city block, straight out of the City Tiles pack.
   *
   * Same trick as `spriteWall` — every cell is a real body wearing its own square of the
   * sheet — but laid out the way that sheet is actually organised, which is in **two-row
   * bands**: rows 0-1 are a blue glass facade, 2-3 tan, 4-5 red, 6-7 magenta, and 8-11
   * are shopfronts. A naive `spriteWall` six rows tall reads straight down through three
   * different buildings' worth of colour, which is how you get a tower that changes
   * material every two metres.
   *
   * So the ground band and the facade band are named separately and the facade repeats.
   * One call makes a tower of any height out of a sheet that only draws two storeys.
   *
   * @param x Left edge, in metres — matching `spriteWall`, not the `wall` family.
   */
  cityBlock(o: {
    sheet: Sheet;
    /** Left column in the sheet. Column 2 of any band is the dark doorway. */
    tx: number;
    cols: number;
    /** Top row of the two-row shopfront band used for the ground floor. */
    groundTy: number;
    /** Top row of the two-row facade band that repeats above it. */
    facadeTy: number;
    /** How many times the facade band repeats. Each is 2 metres. */
    storeys: number;
    x: number;
    baseY: number;
    material: MaterialId;
    /** Concrete parapet on top, so the building has a lip rather than a raw edge. */
    parapet?: boolean;
  }) {
    let y = o.baseY;
    this.spriteWall({
      sheet: o.sheet, tx: o.tx, ty: o.groundTy, cols: o.cols, rows: 2,
      x: o.x, baseY: y, material: o.material,
    });
    y += 2;
    for (let i = 0; i < o.storeys; i++) {
      this.spriteWall({
        sheet: o.sheet, tx: o.tx, ty: o.facadeTy, cols: o.cols, rows: 2,
        x: o.x, baseY: y, material: o.material,
      });
      y += 2;
    }
    if (o.parapet !== false) {
      this.block(o.x + o.cols / 2, y + 0.3, o.cols + 0.4, 0.6, "concrete");
      y += 0.6;
    }
    return y;
  }

  /**
   * A chain of islands over a drop.
   *
   * Returns the centre of each island so the caller can put something on top of them
   * without recomputing the arithmetic — which is the only reason this is a method
   * rather than a loop at the call site.
   *
   * Widths and gaps vary with `spread` so the chain is not a metronome: an even
   * sequence of identical hops is a corridor drawn vertically.
   */
  islands(x0: number, count: number, opts: {
    width?: number;
    gap?: number;
    top?: number;
    rise?: number;
    spread?: number;
  } = {}) {
    const width = opts.width ?? 9;
    const gap = opts.gap ?? 6;
    const top = opts.top ?? 0;
    const rise = opts.rise ?? 0;
    const spread = opts.spread ?? 0.35;
    const out: { x: number; top: number; w: number }[] = [];
    let x = x0;
    for (let i = 0; i < count; i++) {
      const w = width * (1 + rand(-spread, spread));
      const y = top + rise * i + rand(-1, 1) * rise * 0.4;
      this.shelf(x, x + w, y, 2.2);
      out.push({ x: x + w / 2, top: y, w });
      x += w + gap * (1 + rand(-spread, spread));
    }
    return out;
  }

}
