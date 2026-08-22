import type { Actor, GameCtx } from "../core/types";
import type { Enemy } from "../entities/enemy";
import type { V } from "../core/math";
import type { Builder } from "./builder";

/**
 * What a built arena hands back to the game.
 *
 * Deliberately small. The previous version carried an endless-mode streaming director
 * and a completion callback, because levels used to be able to be *won*. Arenas cannot
 * be won — you leave when you are bored — so neither exists any more.
 */
export interface LevelInfo {
  spawn: V;
  /** World X limits the player is kept inside. */
  bounds: { min: number; max: number };
  enemies: Enemy[];
  /** Ground height at the spawn. */
  groundY: number;
  /**
   * Optional ceiling, metres. The vertical and bowl arenas set it so the jetpack has a
   * roof to bump against instead of an infinite sky to climb out of the level through.
   */
  ceiling?: number;
}

/**
 * An arena.
 *
 * Every field that used to encode *run rules* — loadout, lives, briefing, mission order,
 * whether the jetpack was confiscated, which cutscene played first — is gone. There is
 * one mode now, and its rules are the same everywhere: you have what you have unlocked,
 * you cannot lose, and nothing is explained to you in prose.
 */
export interface LevelDef {
  id: string;
  name: string;
  /** One line on the arena card. Flavour, never instruction. */
  tagline: string;
  /** Key into `THEMES`. */
  theme: string;
  /** Metres per second squared, negative. Earth is -26 here (punchier than real). */
  gravity: number;
  /** Short modifier labels for the arena card, e.g. "LOW GRAVITY". */
  tags: string[];
  /** Arena card accent colour. */
  accent: string;
  build(game: GameCtx, b: Builder): LevelInfo;
  /**
   * Sprite sheets, by path under `src/Assets`, that must be decoded before `build` runs.
   * Boot preloads the union across all arenas and never blocks on a failure.
   */
  assets?: readonly string[];
  /**
   * The arena's silhouette, for its menu card.
   *
   * The card's job is to answer "how is this one different", and for these seven the
   * answer is almost always the *shape of the ground* — a tower, a pit, a chain of
   * islands, a street. Cards built only from a slice of tileset showed five near
   * identical houses, because five of the arenas legitimately use the same house
   * tileset. Drawing the shape instead makes each card say what its arena is.
   */
  shape?: "flat" | "tower" | "bowl" | "islands" | "city" | "layered";
  /** Optional persistent world hazard, e.g. acid rain. */
  hazard?(game: GameCtx): Actor;
}
