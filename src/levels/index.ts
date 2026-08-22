import { PROVING } from "./proving";
import type { LevelDef } from "./types";

/**
 * Every arena in the game.
 *
 * One flat list, because there is one mode. The previous build split this into
 * playground / campaign / contracts / endless / daily and needed five exports plus a
 * lookup to keep them straight; all of that is gone.
 *
 * The Proving Ground stays first: it is the flattest, most legible arena and the one
 * that teaches the arsenal.
 */
export const ARENAS: readonly LevelDef[] = [PROVING];

/** Kept for the attract mode and anything that just wants "an arena to show". */
export const LEVELS = ARENAS;

/** Every sprite sheet any arena needs up front. Boot warms these in one pass. */
export const LEVEL_ASSETS: readonly string[] =
  [...new Set(ARENAS.flatMap((l) => l.assets ?? []))];

export const levelById = (id: string): LevelDef => ARENAS.find((l) => l.id === id) ?? ARENAS[0];

export type { LevelDef, LevelInfo } from "./types";
