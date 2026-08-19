import { AMMO } from "../weapons/ammo";
import { dailyId } from "../core/rng";

/**
 * Everything the game remembers between sessions.
 *
 * Deliberately tiny and failure-tolerant — a locked-down browser with no storage
 * should still let you play, just without remembering. Every read has a fallback and
 * every write is allowed to silently fail.
 */

const KEY_CAMPAIGN = "stickman.campaign.cleared";
const KEY_ENDLESS = "stickman.endless.best";
const KEY_CARNAGE = "stickman.carnage";
const KEY_DAILY = "stickman.daily";

function read(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: number | string) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Private mode, disabled storage — progress just doesn't persist.
  }
}

/**
 * The arsenal ladder: which round unlocks at what lifetime carnage.
 *
 * Ordered deliberately rather than by power. The four free rounds cover the three
 * things a new player needs to discover in the first thirty seconds — something that
 * bounces, something that splatters, something heavy and something that explodes —
 * and everything after that is a reason to keep playing. Costs are steep enough that
 * the last few are a genuine long-term goal, but the first four unlocks land inside
 * the opening session, which is the only part most players will ever see.
 *
 * Any ammo id not listed here is free; anything listed is gated. Unlocks are derived
 * from the running total rather than stored as their own list, so there is one number
 * to persist and no way for the two to disagree.
 */
export const ARSENAL: readonly (readonly [string, number])[] = [
  ["chicken", 0],
  ["watermelon", 0],
  ["anvil", 0],
  ["barrel", 0],
  ["bowling", 1_200],
  ["tv", 3_000],
  ["sawblade", 6_000],
  ["rocket", 10_000],
  ["fridge", 16_000],
  ["stickman", 24_000],
  ["water", 34_000],
  ["piano", 48_000],
  ["car", 66_000],
  ["flamethrower", 90_000],
  ["elephant", 120_000],
  ["plane", 160_000],
  ["nuke", 210_000],
  ["blackhole", 280_000],
];

const COST = new Map(ARSENAL.map(([id, c]) => [id, c]));

/**
 * The cost of the rung immediately below `cost`.
 *
 * Progress bars span one rung rather than the whole ladder: at 280k for the last
 * round, a bar measured from zero barely twitches over a run, which reads as "this
 * is hopeless" rather than "nearly there".
 */
export function previousCost(cost: number): number {
  let prev = 0;
  for (const [, c] of ARSENAL) {
    if (c >= cost) break;
    prev = c;
  }
  return prev;
}

export interface DailyRecord {
  /** The day this score was set, as `YYYY-MM-DD`. */
  day: string;
  score: number;
  distance: number;
}

export const progress = {
  /** Number of campaign missions cleared, i.e. how many are unlocked beyond the first. */
  get cleared() {
    return Math.max(0, Math.floor(read(KEY_CAMPAIGN, 0)));
  },

  /** Records a clear. Only ever moves forward, so replaying mission 1 can't lock you out. */
  clear(order: number) {
    if (order > this.cleared) write(KEY_CAMPAIGN, order);
  },

  /** A mission is playable once the one before it is done. */
  unlocked(order: number) {
    return order <= this.cleared + 1;
  },

  get bestDistance() {
    return read(KEY_ENDLESS, 0);
  },

  recordDistance(metres: number) {
    if (metres > this.bestDistance) write(KEY_ENDLESS, Math.floor(metres));
  },

  // ------------------------------------------------------------------ arsenal

  /**
   * Lifetime score across every run in every mode. The single currency the whole
   * arsenal is bought with, which is what turns the goalless playground into the
   * place you go to grind toward the next toy.
   */
  get carnage() {
    return Math.max(0, Math.floor(read(KEY_CARNAGE, 0)));
  },

  /** Banks a finished run. Returns the ids unlocked by it, in ladder order. */
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
    return AMMO.filter((a) => this.weaponUnlocked(a.id)).map((a) => a.id);
  },

  /**
   * The next round on the ladder and how far off it is, or null once the arsenal is
   * complete. This is the line that goes on the results card.
   */
  nextUnlock(): { id: string; cost: number; have: number } | null {
    const have = this.carnage;
    for (const [id, cost] of ARSENAL) {
      if (cost > have) return { id, cost, have };
    }
    return null;
  },

  // ------------------------------------------------------------------ daily

  /** Today's best, or null if today has not been played. */
  get daily(): DailyRecord | null {
    try {
      const raw = localStorage.getItem(KEY_DAILY);
      if (!raw) return null;
      const d = JSON.parse(raw) as DailyRecord;
      // A record from yesterday is not a record for today.
      return d && d.day === dailyId() ? d : null;
    } catch {
      return null;
    }
  },

  recordDaily(score: number, distance: number) {
    const cur = this.daily;
    if (cur && cur.score >= score) return;
    write(KEY_DAILY, JSON.stringify({ day: dailyId(), score: Math.floor(score), distance: Math.floor(distance) }));
  },

  resetAll() {
    write(KEY_CAMPAIGN, 0);
    write(KEY_ENDLESS, 0);
    write(KEY_CARNAGE, 0);
    try {
      localStorage.removeItem(KEY_DAILY);
    } catch {
      /* nothing to clear */
    }
  },
};
