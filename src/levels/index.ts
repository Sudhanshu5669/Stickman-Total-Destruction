import { SANDBOX } from "./sandbox";
import { CASTLE } from "./castle";
import { ALIEN } from "./alien";
import { MARS } from "./mars";
import { CAMPAIGN } from "./campaign";
import { DAILY, ENDLESS } from "./endless";
import type { LevelDef } from "./types";

/** Free-play worlds. The sandbox stays first: it is the one that teaches the arsenal. */
export const PLAYGROUND: readonly LevelDef[] = [SANDBOX, CASTLE, ALIEN, MARS];

/** Kept for the attract mode and anything that just wants "a world to show". */
export const LEVELS = PLAYGROUND;

export { CAMPAIGN, DAILY, ENDLESS };

/** Every level the game knows about, in every mode. */
export const ALL_LEVELS: readonly LevelDef[] = [...PLAYGROUND, ...CAMPAIGN, ENDLESS, DAILY];

export const levelById = (id: string): LevelDef => ALL_LEVELS.find((l) => l.id === id) ?? PLAYGROUND[0];

export type { LevelDef, LevelInfo, LevelKind } from "./types";
