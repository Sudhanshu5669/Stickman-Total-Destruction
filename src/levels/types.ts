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
  /**
   * Endless mode only: the streaming director, so the HUD can read how far the run
   * has gone and the game can tell it about kills.
   */
  director?: { distance: number; kills: number; countKill(): void };
}

/** Which of the three front-end modes a level belongs to. */
export type LevelKind = "playground" | "campaign" | "endless";

export interface LevelDef {
  id: string;
  /** Defaults to "playground" — the free-play worlds reachable from the menu. */
  kind?: LevelKind;
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

  // ------------------------------------------------------------- run rules
  /**
   * Ammo ids the player is issued, in HUD order. Omit for the full arsenal.
   * Campaign missions use this to hand out the toys a mission is designed around.
   */
  loadout?: string[];
  /** Whether the god-mode cheat is available. Campaign missions say no. */
  allowGod?: boolean;
  /** Campaign: knockouts allowed before the mission is failed. */
  lives?: number;
  /** Campaign: the one-line brief shown on the mission card and at the start. */
  briefing?: string;
  /** Campaign: display order, 1-based. */
  order?: number;
}
