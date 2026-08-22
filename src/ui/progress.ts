import { AMMO } from "../weapons/ammo";

/**
 * Everything the game remembers between sessions.
 *
 * Which, as of the 2026-08-22 sandbox reset, is **one number**: lifetime carnage, and
 * the set of rounds that have been fired at least once.
 *
 * The build this replaced also persisted campaign clears, contract story progress, a
 * jetpack grant, best run, best chain, best shot, an endless distance record, a daily
 * challenge record, a daily streak with a grace day, a medal shelf, and an ad-offer
 * ledger. Every one of those existed to serve a mode that no longer exists, and each
 * was a thing on screen that a new player had to work out was not for them. They are
 * gone, and the front end got much quieter for it.
 *
 * What survives is the only progression an arena sandbox can honestly have: you break
 * things, that buys the next absurd round, and the next round is a new reason to go
 * back into an arena you have already flattened.
 *
 * Deliberately tiny and failure-tolerant — a locked-down browser with no storage should
 * still let you play, just without remembering. Every read has a fallback and every
 * write is allowed to silently fail.
 */

const KEY_CARNAGE = "stickman.carnage";
/** Stamped once the save has been converted to the current economy. See `migrate()`. */
const KEY_ECON = "stickman.econ";
/** Rounds that have ever been fired, for the first-strike bounty. */
const KEY_FIRSTS = "stickman.firsts";

/**
 * Keys written by systems that no longer exist. Cleared once, on the same version stamp
 * that migrates the economy.
 *
 * Not strictly necessary — nothing reads them — but a save that still carries
 * `stickman.campaign.cleared` is a save that will confuse whoever opens devtools next,
 * and leaving litter in someone's browser because it is harmless is not a good enough
 * reason to leave it.
 */
const DEAD_KEYS = [
  "stickman.campaign.cleared", "stickman.endless.best", "stickman.daily",
  "stickman.best.run", "stickman.best.chain", "stickman.best.shot",
  "stickman.streak", "stickman.ads", "stickman.medals",
  "stickman.jetpack", "stickman.contract",
];

function read(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Private mode. The session still plays; it just will not be remembered.
  }
}

/**
 * The unlock ladder: round id, and the lifetime carnage that buys it.
 *
 * The first five are free, and that is the most important decision in this file. A
 * player who arrives and is handed one gun has been shown a demo; a player handed five
 * absurd ones — including the rocket launcher — has been shown the game.
 *
 * ## Where these numbers come from
 *
 * Measured, not guessed. The attract-mode driver (`ai/demo.ts`) playing Long Meadow
 * earns about **1,100 carnage per second while it has targets in reach** — it cleared
 * the camp and the farm, 57 blocks and 6 kills, in the first fifteen seconds. A person
 * is slower than that: they walk, they aim, they change rounds, they stand and watch
 * the thing they just did. Call a realistic sustained rate **~350/sec**, and these
 * rungs fall roughly where the comments say.
 *
 * The ladder this replaced was scaled for the deleted modes and was out by about 30x
 * against these arenas: its first rung landed in under two seconds and the whole
 * arsenal came out inside twenty minutes, which is not a progression, it is an
 * unlock-everything button with a delay on it.
 *
 * The shape that matters: the first purchase arrives inside a minute — early enough to
 * teach that breaking things pays — and the gaps then widen steadily, so there is
 * always a partially-filled bar and the last few rounds are a genuine chase.
 *
 * These are still estimates from a bot. Real pacing needs a human playtest; see
 * `SYSTEMS.md` system 11.
 */
export const ARSENAL: readonly (readonly [string, number])[] = [
  ["chicken", 0],              // free — the identity round
  ["watermelon", 0],           // free — splatters
  ["anvil", 0],                // free — heavy
  ["barrel", 0],               // free — explodes
  ["rocket", 0],               // free — spectacle, and the reason the first minute sells
  ["bowling", 20_000],         // ~1 min     bounces
  ["tv", 60_000],              // ~3 min     a cone of glass at close range
  ["stickman", 130_000],       // ~6 min     ragdolls firing ragdolls — the signature joke
  ["sawblade", 210_000],       // ~10 min    ricochets and cuts
  ["water", 340_000],          // ~16 min    a real fluid sim; a toy, so priced as one
  ["fridge", 500_000],         // ~24 min    freeze, a mechanic rather than a bigger boom
  ["piano", 730_000],          // ~35 min    crushing weight, and the chord
  ["flamethrower", 1_050_000], // ~50 min    the fire sim, which burns on without you
  ["car", 1_500_000],          // ~1h10      two tonnes that ploughs through, then detonates
  ["elephant", 2_100_000],     // ~1h40      the big creature
  ["plane", 2_900_000],        // ~2h20      an airliner
  ["nuke", 4_200_000],         // ~3h20      apocalypse
  ["blackhole", 6_300_000],    // ~5h        eats the level, then itself
];

const COST = new Map(ARSENAL.map(([id, c]) => [id, c]));

/**
 * The ladder as it shipped before the economy retune, kept solely so `migrate()` can
 * work out how many rounds an existing save had bought. Delete it only once no live
 * save can still be pre-migration, which in practice means never.
 */
const LEGACY_ARSENAL: readonly number[] = [
  0, 0, 0, 0, 1_200, 3_000, 6_000, 10_000, 16_000, 24_000,
  34_000, 48_000, 66_000, 90_000, 120_000, 160_000, 210_000, 280_000,
];

/**
 * Old carnage totals are denominated in old points, and the ladder is both steeper and
 * differently ordered — a straight comparison would silently repossess rounds a player
 * already owns, which is the one thing a retune must never do.
 *
 * So the save is converted once, to the larger of two arms:
 *
 *   - **ordinal** — count the rounds the old total bought, then hand out exactly enough
 *     new carnage to own that many. Guarantees nobody loses a round.
 *   - **rescale** — old x 3.5, the ratio between the old and new earn rates. Keeps a
 *     grinder's relative standing instead of flattening them onto a rung.
 *
 * Worked examples: 3,000 (6 rounds) -> 10,500, which is 7 rounds and part way to the
 * eighth. 66,000 (13) -> 231,000, still 13 and still holding `car` specifically.
 * 210,000 (17) -> 800,000 via the ordinal arm, which the rescale alone would have lost.
 *
 * Idempotent via the version stamp, and a complete no-op when storage is unavailable —
 * a player who cannot persist anything is already starting fresh every time.
 */
const ECON_VERSION = 3;
let migrated = false;

function migrate() {
  if (migrated) return;
  migrated = true;
  const stamp = read(KEY_ECON, 0);
  if (stamp >= ECON_VERSION) return;

  if (stamp < 2) {
    const old = Math.max(0, Math.floor(read(KEY_CARNAGE, 0)));
    if (old > 0) {
      let owned = 0;
      for (const c of LEGACY_ARSENAL) if (c <= old) owned++;
      const ordinal = ARSENAL[Math.min(owned, ARSENAL.length) - 1]?.[1] ?? 0;
      write(KEY_CARNAGE, Math.max(ordinal, Math.round(old * 3.5)));
    }
  }

  // Version 3 is the sandbox reset: sweep the keys whose systems are gone.
  try {
    for (const k of DEAD_KEYS) localStorage.removeItem(k);
  } catch {
    // Nothing to sweep if there is no storage.
  }
  write(KEY_ECON, ECON_VERSION);
}

export const progress = {
  get carnage() {
    migrate();
    return Math.max(0, Math.floor(read(KEY_CARNAGE, 0)));
  },

  /** Banks destruction. Returns the ids unlocked by it, in ladder order. */
  addCarnage(points: number): string[] {
    if (!(points > 0)) return [];
    const before = this.carnage;
    const after = before + Math.floor(points);
    write(KEY_CARNAGE, after);
    return ARSENAL.filter(([, c]) => c > before && c <= after).map(([id]) => id);
  },

  weaponUnlocked(id: string) {
    return this.carnage >= (COST.get(id) ?? 0);
  },

  /** Every round currently owned, in arsenal order. */
  unlockedWeapons(): string[] {
    const have = this.carnage;
    return AMMO.filter((a) => have >= (COST.get(a.id) ?? 0)).map((a) => a.id);
  },

  /**
   * The next round on the ladder and how far off it is, plus how far through this rung
   * the player is — or null once the arsenal is complete.
   *
   * `frac` is measured from the *previous* rung rather than from zero. At 1.3M for the
   * last round, a bar measured from zero barely twitches over a session, which reads as
   * "this is hopeless" rather than "nearly there".
   */
  nextUnlock(): { id: string; cost: number; have: number; frac: number } | null {
    const have = this.carnage;
    let prev = 0;
    for (const [id, cost] of ARSENAL) {
      if (cost > have) {
        return { id, cost, have, frac: (have - prev) / Math.max(1, cost - prev) };
      }
      prev = cost;
    }
    return null;
  },

  /**
   * Pays a one-off bounty the first time each round is ever fired.
   *
   * Eighteen rounds is only an arsenal if the player tries them. Left alone, most
   * players find three they like in the first minute and never press `4` again, which
   * quietly deletes two thirds of the game — so curiosity gets paid for, once per
   * round, for as long as the save lives.
   */
  firstUse(id: string): number {
    const seen = this.usedRounds();
    if (seen.has(id)) return 0;
    seen.add(id);
    try {
      localStorage.setItem(KEY_FIRSTS, [...seen].join(","));
    } catch {
      // Unpersisted. The bounty still pays this session.
    }
    return 400;
  },

  usedRounds(): Set<string> {
    try {
      const raw = localStorage.getItem(KEY_FIRSTS);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    } catch {
      return new Set();
    }
  },

  /** Wipes the save. Exposed for the options menu and for testing. */
  reset() {
    try {
      for (const k of [KEY_CARNAGE, KEY_ECON, KEY_FIRSTS, ...DEAD_KEYS]) {
        localStorage.removeItem(k);
      }
    } catch {
      // Nothing to wipe.
    }
    migrated = false;
  },
};
