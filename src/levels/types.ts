import type { Actor, GameCtx } from "../core/types";
import type { Enemy } from "../entities/enemy";
import type { V } from "../core/math";
import type { Builder } from "./builder";

export interface LevelInfo {
  spawn: V;
  /** World X limits the player is kept inside. */
  bounds: { min: number; max: number };
  enemies: Enemy[];
  /** Ground height at the spawn. */
  groundY: number;
}

export interface LevelDef {
  id: string;
  name: string;
  tagline: string;
  /** Key into `THEMES`. */
  theme: string;
  /** Metres per second squared, negative. Earth is -26 here (punchier than real). */
  gravity: number;
  /** Short modifier labels for the menu card, e.g. "LOW GRAVITY". */
  tags: string[];
  /** Menu card accent colour. */
  accent: string;
  build(game: GameCtx, b: Builder): LevelInfo;
  /** Optional persistent world hazard, e.g. acid rain. */
  hazard?(game: GameCtx): Actor;
}
