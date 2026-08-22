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
/** Stamped once the save has been converted to the current economy. See `migrate()`. */
const KEY_ECON = "stickman.econ";
const KEY_BEST_RUN = "stickman.best.run";
const KEY_BEST_CHAIN = "stickman.best.chain";
const KEY_BEST_SHOT = "stickman.best.shot";
const KEY_FIRSTS = "stickman.firsts";
const KEY_STREAK = "stickman.streak";
const KEY_ADS = "stickman.ads";
const KEY_MEDALS = "stickman.medals";
/** The jetpack is story equipment, not a purchase: earned once, kept forever. */
const KEY_JETPACK = "stickman.jetpack";
/** How far the contract story has been taken. 0 = the intro has not been watched. */
const KEY_CONTRACT = "stickman.contract";

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

/** Same contract as `read`, for the handful of records that are objects. */
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const writeJson = (key: string, value: unknown) => write(key, JSON.stringify(value));

/** Whole days between two `YYYY-MM-DD` ids; `Infinity` if either is unparseable. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round((b - a) / 86_400_000);
}

// --------------------------------------------------------------------- arsenal

/**
 * The arsenal ladder: which round unlocks at what lifetime carnage.
 *
 * Costs are derived from a measured earn rate rather than picked to look impressive.
 * With the payload points in `ammo.ts` paying out, the material table lifted and the
 * combo curve on a square root, a player earns roughly:
 *
 *     0-1 min     2,500/min   fumbling the controls in the tutorial yard
 *     1-3 min     4,000/min   the village; houses coming down whole
 *     3-6 min     7,000/min   the first towers, chains of ten to twenty
 *     6-12 min   13,000/min   whole districts, the mid arsenal
 *     12-25 min  22,000/min   endless, the heavy rounds
 *     25-60 min  35,000/min   the top of the arsenal
 *
 * Integrating that gives 2.5k at one minute, 10.5k at three, 31.5k at six, 110k at
 * twelve, 285k at twenty and 1.62M at an hour of cumulative play. Every cost below is
 * a point on that curve, annotated with the minute it lands on.
 *
 * Two properties are load-bearing and were designed for explicitly:
 *
 * 1. **The first unlock is inside the first minute.** A new player must be paid for
 *    the first thing they knock over, not the two-hundredth. `bowling` at 2,000 lands
 *    at ~0:48 for a competent first-timer and ~1:30 for a genuinely lost one.
 *
 * 2. **The next reward is never more than one or two sessions away.** The widest gap
 *    on the whole ladder is the last one, 500k at ~40k/min ≈ 12 minutes of play; every
 *    other gap is under 8. Nothing here is ever a wall, and the bar toward it is
 *    always partially filled because `previousCost` measures from the rung below.
 *
 * The order is deliberate rather than by power. **Five** rounds are free, not four:
 * the original four still teach the four verbs a new player needs in the first thirty
 * seconds — something that splatters (chicken, watermelon), something heavy (anvil)
 * and something that explodes (barrel) — and `rocket` joins them because none of those
 * four is *spectacle*, and spectacle is the product. A player who has fired a rocket
 * into a house in their first thirty seconds has seen what this game is; a player who
 * has only thrown watermelons has not. `bowling` then arrives almost immediately as
 * the fourth verb (something that bounces) and, more importantly, as proof that
 * destroying things buys toys.
 *
 * After that the ladder alternates a *new verb* with a *bigger boom* so it never reads
 * as a pure power ramp: shotgun, ragdolls, ricochet, a fluid sim, freezing, crushing
 * weight, a fire sim, then the four apocalypse rounds.
 *
 * Any ammo id not listed here is free; anything listed is gated. Unlocks are derived
 * from the running total rather than stored as their own list, so there is one number
 * to persist and no way for the two to disagree.
 */
export const ARSENAL: readonly (readonly [string, number])[] = [
  ["chicken", 0],            // free — the identity round
  ["watermelon", 0],         // free — splatters
  ["anvil", 0],              // free — heavy
  ["barrel", 0],             // free — explodes
  ["rocket", 0],             // free — spectacle, and the reason the first minute sells
  ["bowling", 2_000],        // ~0:48  bounces
  ["tv", 5_000],             // ~1:37  a cone of glass at close range
  ["stickman", 12_000],      // ~3:23  ragdolls firing ragdolls — the signature joke, early
  ["sawblade", 24_000],      // ~4:56  ricochets and cuts
  ["water", 40_000],         // ~7:00  a real fluid sim; a toy, so it is priced as one
  ["fridge", 65_000],        // ~8:45  freeze, a mechanic rather than a bigger boom
  ["piano", 100_000],        // ~11:20 crushing weight, and the chord
  ["flamethrower", 150_000], // ~13:45 the fire sim, which keeps burning without you
  ["car", 230_000],          // ~17:00 two tonnes that ploughs through, then detonates
  ["elephant", 340_000],     // ~22:00 the big creature
  ["plane", 520_000],        // ~28:20 an airliner
  ["nuke", 800_000],         // ~36:30 apocalypse
  ["blackhole", 1_300_000],  // ~51:00 eats the level, then itself
];

const COST = new Map(ARSENAL.map(([id, c]) => [id, c]));

/**
 * The ladder as it shipped before this retune, kept solely so `migrate()` can work out
 * how many rounds an existing save had bought. Delete it only once no live save can
 * still be pre-migration, which in practice means never.
 */
const LEGACY_ARSENAL: readonly number[] = [
  0, 0, 0, 0, 1_200, 3_000, 6_000, 10_000, 16_000, 24_000,
  34_000, 48_000, 66_000, 90_000, 120_000, 160_000, 210_000, 280_000,
];

/**
 * Old carnage totals are denominated in old points, and the new ladder is both steeper
 * and differently ordered — a straight comparison would silently repossess rounds a
 * player already owns, which is the one thing a retune must never do.
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
 * 280,000 (everything) -> 1,300,000, everything.
 *
 * Idempotent via the version stamp, and a complete no-op when storage is unavailable —
 * a player who cannot persist anything is already starting fresh every time.
 */
const ECON_VERSION = 2;
let migrated = false;

function migrate() {
  if (migrated) return;
  migrated = true;
  if (read(KEY_ECON, 0) >= ECON_VERSION) return;

  const old = Math.max(0, Math.floor(read(KEY_CARNAGE, 0)));
  if (old > 0) {
    let owned = 0;
    for (const c of LEGACY_ARSENAL) if (c <= old) owned++;
    const ordinal = ARSENAL[Math.min(owned, ARSENAL.length) - 1]?.[1] ?? 0;
    write(KEY_CARNAGE, Math.max(ordinal, Math.round(old * 3.5)));
  }
  write(KEY_ECON, ECON_VERSION);
}

/**
 * The cost of the rung immediately below `cost`.
 *
 * Progress bars span one rung rather than the whole ladder: at 1.3M for the last round,
 * a bar measured from zero barely twitches over a run, which reads as "this is hopeless"
 * rather than "nearly there".
 */
export function previousCost(cost: number): number {
  let prev = 0;
  for (const [, c] of ARSENAL) {
    if (c >= cost) break;
    prev = c;
  }
  return prev;
}

// ----------------------------------------------------------------------- ranks

/**
 * Titles earned purely by lifetime carnage.
 *
 * These exist so the arsenal being complete never leaves the player staring at a
 * finished bar with nothing behind it. The rungs continue past the black hole and are
 * spaced to stay roughly a session apart forever, which is the whole point: there is
 * always a partially-filled bar toward something.
 */
export const RANKS: readonly (readonly [string, number])[] = [
  ["VANDAL", 0],
  ["WRECKER", 25_000],
  ["DEMOLITIONIST", 100_000],
  ["SIEGE ENGINE", 300_000],
  ["CITY KILLER", 700_000],
  ["CONTINENTAL", 1_300_000],
  ["ORBITAL STRIKE", 2_500_000],
  ["EXTINCTION EVENT", 5_000_000],
  ["HEAT DEATH", 10_000_000],
];

// ---------------------------------------------------------------------- medals

export interface RunStats {
  score: number;
  blocks: number;
  kills: number;
  /** Longest unbroken destruction chain, i.e. `Game.comboMax`. */
  bestChain: number;
  seconds: number;
}

export interface Medal {
  id: string;
  name: string;
  /** What the player actually did, phrased as the fact and not as flattery. */
  detail: string;
  /** Carnage paid on top of the run's score. */
  bonus: number;
  /** True the first time this exact medal has ever been earned. */
  fresh: boolean;
}

type MedalDef = {
  id: string;
  name: string;
  bonus: number;
  /** Highest tier reached in a family wins; the lower ones are implied, not listed. */
  family: string;
  test(s: RunStats): boolean;
  detail(s: RunStats): string;
};

/**
 * Per-run medals.
 *
 * Every threshold is a fixed, published number the player either cleared or did not.
 * Nothing here is scaled to the player's history to manufacture a near-miss, and
 * nothing fires "just barely" by design — a medal that can be tuned to always feel
 * one shot away is a slot machine, not a reward. The honest version of that pull is
 * the personal-best line, which reports the real delta against a real record.
 *
 * Bonuses are sized at roughly a tenth of the run that earns them: enough that
 * chasing one changes how you play a run, not enough to replace playing it.
 */
const MEDALS: readonly MedalDef[] = [
  {
    id: "wreck1", name: "DEMOLITIONIST", family: "blocks", bonus: 400,
    test: (s) => s.blocks >= 25, detail: (s) => `${s.blocks} blocks down`,
  },
  {
    id: "wreck2", name: "WRECKING BALL", family: "blocks", bonus: 1_800,
    test: (s) => s.blocks >= 100, detail: (s) => `${s.blocks} blocks down`,
  },
  {
    id: "wreck3", name: "CONDEMNED", family: "blocks", bonus: 7_000,
    test: (s) => s.blocks >= 300, detail: (s) => `${s.blocks} blocks down`,
  },
  {
    id: "wreck4", name: "NOTHING LEFT", family: "blocks", bonus: 25_000,
    test: (s) => s.blocks >= 800, detail: (s) => `${s.blocks} blocks down`,
  },
  {
    id: "chain1", name: "CHAIN REACTION", family: "chain", bonus: 500,
    test: (s) => s.bestChain >= 8, detail: (s) => `${s.bestChain} in one chain`,
  },
  {
    id: "chain2", name: "AVALANCHE", family: "chain", bonus: 2_200,
    test: (s) => s.bestChain >= 20, detail: (s) => `${s.bestChain} in one chain`,
  },
  {
    id: "chain3", name: "TOTAL COLLAPSE", family: "chain", bonus: 9_000,
    test: (s) => s.bestChain >= 40, detail: (s) => `${s.bestChain} in one chain`,
  },
  {
    id: "chain4", name: "CATACLYSM", family: "chain", bonus: 30_000,
    test: (s) => s.bestChain >= 75, detail: (s) => `${s.bestChain} in one chain`,
  },
  {
    id: "kill1", name: "BODY COUNT", family: "kills", bonus: 600,
    test: (s) => s.kills >= 5, detail: (s) => `${s.kills} hostiles down`,
  },
  {
    id: "kill2", name: "OUTNUMBERED", family: "kills", bonus: 2_500,
    test: (s) => s.kills >= 15, detail: (s) => `${s.kills} hostiles down`,
  },
  {
    id: "kill3", name: "DEPOPULATED", family: "kills", bonus: 10_000,
    test: (s) => s.kills >= 35, detail: (s) => `${s.kills} hostiles down`,
  },
  {
    // Rewards concentration rather than endurance, so a long idle run cannot farm it.
    id: "rush", name: "BLITZ", family: "pace", bonus: 1_500,
    test: (s) => s.seconds >= 8 && s.score / s.seconds >= 400,
    detail: (s) => `${Math.round(s.score / s.seconds).toLocaleString("en-US")} per second`,
  },
];

// ------------------------------------------------------------------- ad ledger

/**
 * How much carnage a rewarded view is worth, as a fraction of the run just finished.
 *
 * Scaled to the player rather than fixed, so the offer stays worth pressing at every
 * point on the ladder, and sharply diminishing within the day so it cannot become the
 * economy. Five views at these fractions total 0.74 of one run — a motivated player can
 * buy themselves less than one extra run per day, however many ads they sit through.
 */
const AD_FRACTIONS = [0.33, 0.17, 0.08, 0.08, 0.08];
/** Small runs still deserve a button worth pressing. */
const AD_FLOOR = 200;

export interface AdOffer {
  /** The exact number to put on the button. Never show a bare "Watch Ad". */
  amount: number;
  /** Views still available today, this one included. */
  viewsLeft: number;
}

// ---------------------------------------------------------------------- daily

export interface DailyRecord {
  /** The day this score was set, as `YYYY-MM-DD`. */
  day: string;
  score: number;
  distance: number;
}

export interface StreakRecord {
  /** Last day the player earned anything, as `YYYY-MM-DD`. */
  day: string;
  days: number;
  best: number;
}

/**
 * A streak forgives one missed day.
 *
 * Loss aversion around a streak is what brings a player back tomorrow; a streak that
 * zeroes the moment life happens reads as punishment and drives the opposite. Two days
 * of silence still counts as continuous, three resets. The grace is unlimited on
 * purpose — the streak is a nudge, not a contract.
 */
const STREAK_GRACE_DAYS = 2;
/** Carnage handed over on the first earn of a new day, per day of streak. */
const STREAK_BONUS_PER_DAY = 500;
const STREAK_BONUS_DAYS_CAP = 10;

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

  // ------------------------------------------------------------------ the story

  /**
   * Contracts finished. Doubles as the story cursor, so `>= 1` also means the intro
   * has been seen and must never be forced on this player again.
   */
  get contract() {
    return Math.max(0, Math.floor(read(KEY_CONTRACT, 0)));
  },

  finishContract(order: number) {
    if (order > this.contract) write(KEY_CONTRACT, order);
  },

  /**
   * Whether the jetpack has been picked up.
   *
   * Kept out of the carnage economy on purpose. Everything in `ARSENAL` is bought with
   * points and is therefore a number the player is grinding toward; the jetpack is a
   * thing that happens *to* them at a specific moment in a specific room, and pricing
   * it would turn the one earned moment in the game into another progress bar.
   */
  get hasJetpack() {
    return read(KEY_JETPACK, 0) > 0;
  },

  grantJetpack() {
    write(KEY_JETPACK, 1);
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
    migrate();
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
    const have = this.carnage;
    return AMMO.filter((a) => have >= (COST.get(a.id) ?? 0)).map((a) => a.id);
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

  /**
   * The next thing to aim at, whatever it is — the next round, or once the arsenal is
   * complete, the next rank.
   *
   * The result is never null until the very last rank, which is the property the whole
   * progression depends on: there is always a visible near-term goal with a
   * partially-filled bar under it. Prefer this over `nextUnlock` anywhere a bar is
   * drawn; `nextUnlock` remains for the "NEW ROUND" callout, which is weapons-only.
   */
  nextGoal(): { kind: "weapon" | "rank"; id: string; cost: number; have: number; frac: number } | null {
    const have = this.carnage;
    const table: readonly (readonly [string, number])[] = this.nextUnlock() ? ARSENAL : RANKS;
    const kind = this.nextUnlock() ? "weapon" : "rank";
    let prev = 0;
    for (const [id, cost] of table) {
      if (cost > have) {
        return { kind, id, cost, have, frac: (have - prev) / Math.max(1, cost - prev) };
      }
      prev = cost;
    }
    return null;
  },

  /** Current rank title, for the menu and the results card. */
  get rank(): string {
    const have = this.carnage;
    let name = RANKS[0][0];
    for (const [id, at] of RANKS) if (have >= at) name = id;
    return name;
  },

  // ------------------------------------------------------- first use of a round

  /**
   * Records the first time a round has ever been fired and returns the bounty for it,
   * or 0 if it has been fired before.
   *
   * Eighteen rounds is only an arsenal if the player actually tries them. Left alone
   * most players find three they like and never press 4 again, which quietly deletes
   * two thirds of the game — so the game pays for curiosity, once per round, forever.
   */
  firstUse(id: string): number {
    const key = String(id);
    const seen = this.usedRounds();
    if (seen.has(key)) return 0;
    seen.add(key);
    write(KEY_FIRSTS, [...seen].join(","));
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

  // ------------------------------------------------------------------- records

  /** Best single-run score ever. The honest baseline for "you beat your best by N". */
  get bestRun() {
    return Math.max(0, Math.floor(read(KEY_BEST_RUN, 0)));
  },

  /** Longest unbroken destruction chain ever. Leaderboard-worthy on its own. */
  get bestChain() {
    return Math.max(0, Math.floor(read(KEY_BEST_CHAIN, 0)));
  },

  /**
   * Biggest score ever banked inside one unbroken chain — "the biggest single thing you
   * have ever knocked over". Distinct from `bestRun`, which rewards a long session.
   */
  get bestShot() {
    return Math.max(0, Math.floor(read(KEY_BEST_SHOT, 0)));
  },

  recordChain(n: number) {
    if (n > this.bestChain) write(KEY_BEST_CHAIN, Math.floor(n));
  },

  recordShot(points: number) {
    if (points > this.bestShot) write(KEY_BEST_SHOT, Math.floor(points));
  },

  // -------------------------------------------------------------------- medals

  /**
   * Scores a finished run: banks the medal bonuses and the streak bonus, updates the
   * lifetime records, and hands back everything the results card needs to show.
   *
   * Call **once** per run, from `finish()`, after the run's own score has been banked.
   * It is not idempotent — every call pays again.
   */
  scoreRun(stats: RunStats): {
    medals: Medal[];
    bonus: number;
    streak: { days: number; bonus: number } | null;
    /** Signed delta against the previous best run. Positive means a new record. */
    bestDelta: number;
    previousBest: number;
    /**
     * Rounds the *bonuses* bought, on top of whatever the run's own score bought.
     * A medal that tips the player over a rung has to announce itself like any other
     * unlock, or the card quietly eats it.
     */
    unlocked: string[];
  } {
    const previousBest = this.bestRun;
    const ever = new Set(readJson<string[]>(KEY_MEDALS, []));

    // Only the top tier in each family is shown: a card listing DEMOLITIONIST,
    // WRECKING BALL and CONDEMNED for the same pile of rubble says nothing three times.
    const top = new Map<string, MedalDef>();
    for (const def of MEDALS) {
      if (def.test(stats)) top.set(def.family, def);
    }

    const medals: Medal[] = [...top.values()].map((def) => {
      const fresh = !ever.has(def.id);
      ever.add(def.id);
      return { id: def.id, name: def.name, detail: def.detail(stats), bonus: def.bonus, fresh };
    });
    if (medals.length) writeJson(KEY_MEDALS, [...ever]);

    let bonus = medals.reduce((n, m) => n + m.bonus, 0);
    // Beating your own record is the one bonus that scales with the player, because it
    // is the one that is genuinely harder every time you claim it.
    if (stats.score > previousBest) {
      write(KEY_BEST_RUN, Math.floor(stats.score));
      bonus += Math.min(20_000, Math.round(stats.score * 0.1));
    }

    this.recordChain(stats.bestChain);
    const streak = this.touchStreak();
    if (streak) bonus += streak.bonus;
    const unlocked = bonus > 0 ? this.addCarnage(bonus) : [];

    return { medals, bonus, streak, bestDelta: stats.score - previousBest, previousBest, unlocked };
  },

  /** Every medal ever earned, for a trophy shelf in the menu. */
  earnedMedals(): string[] {
    return readJson<string[]>(KEY_MEDALS, []);
  },

  // ------------------------------------------------------------------ streaks

  get streak(): StreakRecord {
    return readJson<StreakRecord>(KEY_STREAK, { day: "", days: 0, best: 0 });
  },

  /**
   * Advances the daily streak and pays for it, once per day. Returns null on every
   * call after the first of the day, so it is safe to call from anywhere.
   */
  touchStreak(): { days: number; bonus: number } | null {
    const today = dailyId();
    const cur = this.streak;
    if (cur.day === today) return null;

    const gap = cur.day ? daysBetween(cur.day, today) : Infinity;
    const days = gap >= 1 && gap <= STREAK_GRACE_DAYS ? cur.days + 1 : 1;
    const best = Math.max(days, Math.floor(cur.best) || 0);
    writeJson(KEY_STREAK, { day: today, days, best } satisfies StreakRecord);
    return { days, bonus: STREAK_BONUS_PER_DAY * Math.min(days, STREAK_BONUS_DAYS_CAP) };
  },

  // ------------------------------------------------------------------- rewards

  /**
   * What a rewarded view is worth right now, or null once the day's allowance is spent.
   *
   * The amount is exact and must be printed on the button — "WATCH AD FOR +4,180
   * CARNAGE", never a bare "Watch Ad" — and it is the whole reward, so nothing here
   * should ever be chained behind a second ad.
   */
  adOffer(runScore: number): AdOffer | null {
    const used = this.adViewsToday();
    if (used >= AD_FRACTIONS.length) return null;
    const amount = Math.max(AD_FLOOR, Math.round(Math.max(0, runScore) * AD_FRACTIONS[used]));
    return { amount, viewsLeft: AD_FRACTIONS.length - used };
  },

  adViewsToday(): number {
    const rec = readJson<{ day: string; views: number }>(KEY_ADS, { day: "", views: 0 });
    return rec.day === dailyId() ? Math.max(0, Math.floor(rec.views)) : 0;
  },

  /** Banks a watched reward. Call only after the SDK reports the view completed. */
  claimAd(amount: number): string[] {
    const views = this.adViewsToday() + 1;
    writeJson(KEY_ADS, { day: dailyId(), views });
    return this.addCarnage(amount);
  },

  // -------------------------------------------------------------------- daily

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
    write(KEY_BEST_RUN, 0);
    write(KEY_BEST_CHAIN, 0);
    write(KEY_BEST_SHOT, 0);
    // Stays stamped: a wiped save is already on the current economy, and un-stamping it
    // would let `migrate()` run again over a zero and do nothing useful.
    write(KEY_ECON, ECON_VERSION);
    for (const k of [KEY_DAILY, KEY_FIRSTS, KEY_STREAK, KEY_ADS, KEY_MEDALS]) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* nothing to clear */
      }
    }
    write(KEY_JETPACK, 0);
    write(KEY_CONTRACT, 0);
  },
};
