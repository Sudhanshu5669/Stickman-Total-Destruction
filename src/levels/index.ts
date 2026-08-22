import { SANDBOX } from "./sandbox";
import { CASTLE } from "./castle";
import { ALIEN } from "./alien";
import { MARS } from "./mars";
import { HOLLOWBROOK } from "./hollowbrook";
import { CAMPAIGN } from "./campaign";
import { CONTRACTS } from "./contracts";
import { DAILY, ENDLESS } from "./endless";
import type { LevelDef } from "./types";

/** Free-play worlds. The sandbox stays first: it is the one that teaches the arsenal. */
export const PLAYGROUND: readonly LevelDef[] = [SANDBOX, HOLLOWBROOK, CASTLE, ALIEN, MARS];

/** Kept for the attract mode and anything that just wants "a world to show". */
export const LEVELS = PLAYGROUND;

export { CAMPAIGN, CONTRACTS, DAILY, ENDLESS };

/** Every level the game knows about, in every mode. */
export const ALL_LEVELS: readonly LevelDef[] = [...PLAYGROUND, ...CONTRACTS, ...CAMPAIGN, ENDLESS, DAILY];

/** Every sprite sheet any level needs up front. Boot warms these in one pass. */
export const LEVEL_ASSETS: readonly string[] =
  [...new Set(ALL_LEVELS.flatMap((l) => l.assets ?? []))];

export const levelById = (id: string): LevelDef => ALL_LEVELS.find((l) => l.id === id) ?? PLAYGROUND[0];

export type { LevelDef, LevelInfo, LevelKind } from "./types";
