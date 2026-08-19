import type { Actor, GameCtx } from "../core/types";
import { clamp, v } from "../core/math";
import { combat } from "../entities/enemy";
import type { Ctx } from "../render/draw";
import { CHUNKS, CHUNKS_BY_TIER, chunkWeight, type Chunk } from "./chunks";
import { dailyId, hashSeed, mulberry32, seeded } from "../core/rng";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/** How far ahead of the player the world is built. Comfortably past the far edge of the camera. */
const AHEAD = 130;
/** How far behind the player a chunk survives before it is unloaded. */
const BEHIND = 120;
/**
 * Metres of run per difficulty tier, up to tier 3.
 *
 * Shortened from 260: the dense districts are tier 2-3, and at the old pacing you
 * walked most of a kilometre of low-rise before the world started looking like a city.
 */
const TIER_METRES = 165;
/**
 * How much of a chunk's authored width the next one starts inside.
 *
 * Chunks are authored with a margin at each end so they can be dealt in any order
 * without their contents interpenetrating. Reclaiming a little of that margin pulls
 * the whole world tighter without any risk of spawning two structures inside each
 * other — 8% is roughly the smaller of the two margins on the tightest chunk in the
 * deck, and it compounds over a run into a visibly denser skyline.
 */
const PACKING = 0.92;
/** Never overlap by more than this, however wide the chunk. */
const MAX_OVERLAP = 2.4;

interface Loaded {
  /** Range into `Builder.spawned` that this chunk owns. */
  from: number;
  to: number;
  /** World x of the chunk's right edge. */
  end: number;
}

/**
 * Streams the world in front of the player, forever.
 *
 * The map is a deck of pre-authored chunks (see `chunks.ts`) dealt out at random.
 * The deck is shuffled and drawn from rather than sampled independently, so you get
 * variety instead of the same tower three times in a row — and it is reshuffled once
 * exhausted, which is what makes the mode genuinely endless rather than merely long.
 *
 * Chunks behind the player are retired: their actors are marked dead and reaped by
 * the game's normal population pass, so a 5km run costs the same as a 50m one.
 */
export class EndlessDirector implements Actor {
  dead = false;
  z = -100;

  /** World x where the built world currently ends. */
  private frontier: number;
  private readonly loaded: Loaded[] = [];
  private deck: Chunk[] = [];
  private startX: number;
  /**
   * The run's own generator. Seeded from the date for the daily so every player walks
   * an identical world, and from entropy otherwise. Owning a generator rather than
   * calling `Math.random` is what makes a shared daily possible at all.
   */
  private readonly rng: () => number;
  /** True for the daily challenge; only affects which seed was used and the HUD. */
  readonly seededRun: boolean;
  /** Furthest the player has actually reached, in metres from the spawn. */
  distance = 0;
  /** Enemies killed this run. Incremented by the game, since it owns death reporting. */
  kills = 0;

  constructor(
    private readonly game: GameCtx,
    private readonly b: Builder,
    private readonly info: LevelInfo,
    private readonly groundY: number,
    seed?: number,
  ) {
    this.seededRun = seed !== undefined;
    this.rng = mulberry32(seed ?? ((Math.random() * 0xffffffff) >>> 0));
    this.startX = info.spawn.x;
    this.frontier = info.spawn.x + 24;
    // Build the opening stretch immediately so the player never sees the seam.
    this.fill(this.frontier + AHEAD);
  }

  private get tier() {
    return clamp(Math.floor(this.distance / TIER_METRES), 0, 3);
  }

  /**
   * Draws the next chunk, rebuilding the deck whenever it runs dry.
   *
   * The deck is stacked rather than flat: each chunk is entered as many times as its
   * weight, so dense districts come up several times per pass and empty clearings
   * once. Still a *deck* and not independent sampling, because drawing without
   * replacement is what stops the same tower appearing three times in a row.
   */
  private nextChunk(): Chunk {
    if (!this.deck.length) {
      const pool = CHUNKS_BY_TIER[this.tier] ?? CHUNKS;
      this.deck = [];
      for (const c of pool) {
        for (let n = chunkWeight(c); n > 0; n--) this.deck.push(c);
      }
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = (this.rng() * (i + 1)) | 0;
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
    }
    return this.deck.pop()!;
  }

  /**
   * Builds world out to `until`.
   *
   * The whole body runs inside `seeded`, which points `core/math`'s randomness at this
   * run's generator for the duration. Chunk placement is synchronous and nothing else
   * draws from it in between, so two players on the same seed get byte-identical
   * worlds however differently their frames land.
   */
  private fill(until: number) {
    // Hard cap per call so a teleport (or a very fast jetpack) can't build a
    // kilometre of city inside one frame.
    let budget = 12;
    seeded(this.rng, () => {
      while (this.frontier < until && budget-- > 0) {
        const chunk = this.nextChunk();
        const from = this.b.mark();

        // Ground first, overlapping its neighbours slightly so there is no seam to
        // catch a foot on, then the chunk's own contents on top of it.
        this.b.groundRun(this.frontier + chunk.width / 2, this.groundY - 3, chunk.width + 2, 6);
        chunk.place(this.b, this.frontier, this.groundY);

        const overlap = Math.min(chunk.width * (1 - PACKING), MAX_OVERLAP);
        this.frontier += chunk.width - overlap;
        this.loaded.push({ from, to: this.b.mark(), end: this.frontier });
      }
    });
  }

  update(dt: number) {
    void dt;
    const t = this.game.target();
    if (!t) return;

    const x = t.pos.x;
    this.distance = Math.max(this.distance, x - this.startX);
    this.fill(x + AHEAD);

    // Retire everything the player has comfortably left behind.
    while (this.loaded.length > 1 && this.loaded[0].end < x - BEHIND) {
      const old = this.loaded.shift()!;
      this.b.retire(old.from, old.to);
    }

    // Drop retired and rotted-away stickmen from the roster; over a long run the
    // list would otherwise grow without bound.
    const keep = this.info.enemies.filter((e) => !e.dead);
    if (keep.length !== this.info.enemies.length) {
      this.info.enemies.length = 0;
      this.info.enemies.push(...keep);
    }

    // The player is fenced to the built world, with the trailing edge moving up
    // behind them so there is nowhere to retreat to that no longer exists.
    this.info.bounds.min = Math.max(this.info.bounds.min, x - BEHIND + 20);
    this.info.bounds.max = this.frontier - 6;
  }

  /** Registers a kill; called by the game when an enemy dies in endless mode. */
  countKill() {
    this.kills++;
  }

  draw(_ctx: Ctx) {}

  destroy() {}
}

/**
 * Endless is a level like any other: it just builds almost nothing up front and
 * hands the rest to a director actor that keeps building as you walk.
 */
function build(game: GameCtx, b: Builder, seed?: number): LevelInfo {
  const G0 = 0;
  // Everything that spawns out here is armed. The mode is a gauntlet, not a sandbox.
  b.defaultCombat = combat({ behavior: "patrol", gun: "smg", range: 26, spread: 0.14, interval: 0.42, patrol: 6 });

  // A short, safe apron behind the spawn so you have somewhere to back into.
  b.groundRun(-14, G0 - 3, 60, 6);
  b.ledge(-30, G0 + 2.4, 10, 1.2);

  const info: LevelInfo = {
    spawn: v(-8, G0 + 1.2),
    bounds: { min: -40, max: 60 },
    enemies: b.enemies,
    groundY: G0,
  };

  info.director = game.add(new EndlessDirector(game, b, info, G0, seed));
  return info;
}

export const ENDLESS: LevelDef = {
  id: "endless",
  kind: "endless",
  name: "The Long Walk",
  tagline: `${CHUNKS.length} authored set-pieces, dealt at random, forever.`,
  theme: "day",
  gravity: -26,
  tags: ["ENDLESS", "ARMED", "GO FURTHER"],
  accent: "#8a5cff",
  // Three knockouts ends the run. Without an end, "furthest run" means nothing —
  // and god mode is still available here for anyone who wants a pure sandbox.
  lives: 3,
  build: (game, b) => build(game, b),
};

/**
 * The daily challenge: the same run, for everybody, for one day.
 *
 * Mechanically identical to endless — the only difference is that the director is
 * handed a seed derived from today's date, so the deck order and every authored
 * placement inside it are the same world for every player until it rolls over at
 * midnight UTC. That is the entire feature: a run you can compare, and a reason to
 * come back tomorrow rather than merely a reason to keep playing today.
 *
 * God mode is off. A shared score means nothing if it can be walked.
 */
export const DAILY: LevelDef = {
  id: "daily",
  kind: "endless",
  name: "Daily Challenge",
  tagline: "One world. Everyone gets the same one. Resets at midnight UTC.",
  // Night, so the daily is visibly a different run from the ordinary endless one.
  theme: "night",
  gravity: -26,
  tags: ["DAILY", "SEEDED", "ONE SHOT"],
  accent: "#ffd23f",
  lives: 3,
  allowGod: false,
  build: (game, b) => build(game, b, hashSeed(dailyId())),
};
