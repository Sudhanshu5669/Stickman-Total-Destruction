import { SANDBOX } from "./sandbox";
import { CASTLE } from "./castle";
import { ALIEN } from "./alien";
import { MARS } from "./mars";
import type { LevelDef } from "./types";

/** Menu order. The sandbox stays first: it is the one that teaches the arsenal. */
export const LEVELS: readonly LevelDef[] = [SANDBOX, CASTLE, ALIEN, MARS];

export const levelById = (id: string): LevelDef => LEVELS.find((l) => l.id === id) ?? LEVELS[0];

export type { LevelDef, LevelInfo } from "./types";
