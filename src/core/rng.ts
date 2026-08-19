/**
 * Deterministic randomness, for the daily challenge.
 *
 * The daily has to deal every player on the planet the exact same world, which means
 * world generation cannot touch `Math.random`. Rather than thread a generator through
 * every builder call, `seeded()` temporarily swaps the source that `core/math`'s
 * `rand`/`chance`/`pick` draw from, for the duration of one synchronous build. Nothing
 * else runs during a chunk placement, so the sequence of draws is identical on every
 * machine regardless of frame rate — which is exactly the property a shared daily run
 * needs and a per-frame effect does not.
 */

import { setRandomSource } from "./math";

/** Mulberry32: 32 bits of state, one multiply-xor round. Fast, and good enough here. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs `build` with the global random source replaced by `rng`.
 *
 * Restores the previous source even if `build` throws — a builder blowing up must not
 * leave the whole game running on a seeded stream forever.
 */
export function seeded<T>(rng: () => number, build: () => T): T {
  const restore = setRandomSource(rng);
  try {
    return build();
  } finally {
    restore();
  }
}

/** `YYYY-MM-DD` in UTC, so the daily rolls over at the same instant everywhere. */
export function dailyId(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Stable 32-bit hash of a string — turns a day id into a seed. */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seconds until the current daily expires, for the menu countdown. */
export function secondsUntilRollover(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, (next - now.getTime()) / 1000);
}
