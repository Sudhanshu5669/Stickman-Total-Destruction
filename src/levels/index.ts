import { PROVING } from "./proving";
import { SPIRE } from "./spire";
import { PIT } from "./pit";
import { DRIFT } from "./drift";
import { DOWNTOWN } from "./downtown";
import { MEADOW } from "./meadow";
import { COLDSPINE } from "./coldspine";
import type { LevelDef } from "./types";

/**
 * Every arena in the game.
 *
 * One flat list, because there is one mode. The previous build split this into
 * playground / campaign / contracts / endless / daily and needed five exports plus a
 * lookup to keep them straight; all of that is gone.
 *
 * Order is a difficulty and legibility curve, not an authoring order. The Proving
 * Ground is first because it is the flattest and most legible and it teaches the
 * arsenal; Long Meadow second because it is the one that teaches *range* without
 * punishing you for it. The three that change the rules — vertical, bowl, low-gravity
 * islands — come after both, and the two densest are last.
 */
export const ARENAS: readonly LevelDef[] = [
  PROVING, MEADOW, SPIRE, PIT, DRIFT, DOWNTOWN, COLDSPINE,
];

/** Kept for the attract mode and anything that just wants "an arena to show". */
export const LEVELS = ARENAS;

/** Every sprite sheet any arena needs up front. Boot warms these in one pass. */
export const LEVEL_ASSETS: readonly string[] =
  [...new Set(ARENAS.flatMap((l) => l.assets ?? []))];

export const levelById = (id: string): LevelDef => ARENAS.find((l) => l.id === id) ?? ARENAS[0];

export type { LevelDef, LevelInfo } from "./types";
