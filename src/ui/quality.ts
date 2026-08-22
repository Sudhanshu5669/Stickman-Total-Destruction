/**
 * The effects budget.
 *
 * This game's whole appeal is that a lot of things happen at once, which is also the
 * only reason it would ever fail to run. A 4 GB Chromebook and a desktop with a
 * discrete GPU are both in scope, and the honest way to serve both is to let the
 * expensive half be turned down rather than to author for the weaker machine and ship
 * a duller game to everybody.
 *
 * ## What actually costs frames here
 *
 * Not the physics — Rapier holds three hundred bodies comfortably. It is **overdraw**:
 * a thousand additive, alpha-blended, screen-space-sized particles are a thousand
 * blend operations over the same pixels, and Canvas2D does that on the CPU. So the
 * budget is spent where it is earned:
 *
 * 1. **At emission.** Every preset in `Particles` scales its count through
 *    `quality.count()`. Half the particles is half the sim *and* half the overdraw,
 *    and it is the single biggest lever available.
 * 2. **At the soft cap.** The pools stay allocated at full size — they are typed
 *    arrays built once at boot, and reallocating them on a settings change would be
 *    both fiddly and pointless — but the *active* count is capped lower, so the update
 *    loop is shorter and the pool saturates (and starts recycling) sooner.
 * 3. **By dropping whole cosmetic layers.** Decals and ambient scenery motion are pure
 *    decoration; at LOW they simply do not happen.
 *
 * ## What is never cut
 *
 * Anything the player reads as information. Score popups, muzzle flashes, the hit
 * flash, explosion rings and unlock callouts are exempt at every tier: a player on a
 * slow machine must not be told *less* about what is happening than a player on a fast
 * one. That is the line between a performance setting and a worse game.
 *
 * Water and fire are weapons, not effects — the hose and the flamethrower are two of
 * the nineteen rounds. Their budgets shrink; they are never switched off.
 */

const KEY = "stickman.quality.v1";

export type QualityTier = "low" | "medium" | "high";

export const TIERS: readonly QualityTier[] = ["low", "medium", "high"];
export const TIER_LABELS: readonly string[] = ["LOW", "MEDIUM", "HIGH"];

interface Budget {
  /** Multiplier on every scalable particle emission count. */
  particles: number;
  /** Soft caps on the active count of each sim. Pools stay allocated at full size. */
  maxParticles: number;
  maxFlames: number;
  maxFluid: number;
  /** Ground marks — blood pools, scorch, bullet holes. 0 disables them entirely. */
  maxDecals: number;
  /** Loose debris chunks kept alive at once. */
  maxDebris: number;
  /** Parallax layers drawn behind the world. */
  backgroundLayers: number;
  /** Whether scenery props are allowed to sway. Cheap each, but there are hundreds. */
  ambientMotion: boolean;
}

const BUDGETS: Record<QualityTier, Budget> = {
  // Aimed squarely at the 4 GB Chromebook floor. Deliberately still *legible*: a third
  // of the particles is a thinner explosion, not an absent one.
  low: {
    particles: 0.34,
    maxParticles: 380,
    maxFlames: 240,
    maxFluid: 340,
    maxDecals: 0,
    maxDebris: 70,
    backgroundLayers: 2,
    ambientMotion: false,
  },
  medium: {
    particles: 0.7,
    maxParticles: 850,
    maxFlames: 540,
    maxFluid: 760,
    maxDecals: 140,
    maxDebris: 130,
    backgroundLayers: 3,
    ambientMotion: true,
  },
  // The game as it is tuned. Every pool at its authored ceiling.
  high: {
    particles: 1,
    maxParticles: 1400,
    maxFlames: 900,
    maxFluid: 1200,
    maxDecals: 320,
    maxDebris: 200,
    backgroundLayers: 4,
    ambientMotion: true,
  },
};

/**
 * Picks a starting tier from what the browser will admit to.
 *
 * Only ever a *default*. Both signals are coarse and both lie — `deviceMemory` is
 * bucketed and capped at 8, `hardwareConcurrency` counts a phone's little cores the
 * same as a desktop's big ones — so this is deliberately conservative and the player's
 * own choice always wins. Guessing MEDIUM for a machine that could run HIGH costs some
 * sparks; guessing HIGH for a Chromebook costs the session.
 */
function detect(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 0;
  const cores = nav.hardwareConcurrency ?? 0;
  if ((mem > 0 && mem <= 4) || (cores > 0 && cores <= 4)) return "low";
  if ((mem > 0 && mem <= 8) || (cores > 0 && cores <= 8)) return "medium";
  return "high";
}

function load(): QualityTier {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && (TIERS as readonly string[]).includes(raw)) return raw as QualityTier;
  } catch {
    // Locked-down browser. Detection is the answer for this session.
  }
  return detect();
}

let tier: QualityTier = load();
let budget: Budget = BUDGETS[tier];

export const quality = {
  get tier() {
    return tier;
  },

  /** Index into `TIERS` / `TIER_LABELS`, for the options row. */
  get step() {
    return Math.max(0, TIERS.indexOf(tier));
  },

  setStep(i: number) {
    this.set(TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.floor(i)))]);
  },

  set(t: QualityTier) {
    tier = t;
    budget = BUDGETS[t];
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // The choice holds for this session and no longer.
    }
  },

  /** What `detect()` would pick on this machine, so the UI can mark it "auto". */
  get detected() {
    return detect();
  },

  /**
   * Scales an emission count, never below 1.
   *
   * The floor matters more than the multiplier: a burst that rounds to zero is a
   * *missing* effect, and a player who cannot see that their shot connected will
   * conclude the game is broken rather than that it is thrifty. One spark still says
   * "that happened".
   */
  count(n: number): number {
    if (n <= 0) return 0;
    return Math.max(1, Math.round(n * budget.particles));
  },

  /** Raw multiplier, for callers already doing their own arithmetic. */
  get scale() {
    return budget.particles;
  },

  get maxParticles() { return budget.maxParticles; },
  get maxFlames() { return budget.maxFlames; },
  get maxFluid() { return budget.maxFluid; },
  get maxDecals() { return budget.maxDecals; },
  get maxDebris() { return budget.maxDebris; },
  get backgroundLayers() { return budget.backgroundLayers; },
  get ambientMotion() { return budget.ambientMotion; },

  /** Ground marks are the first thing to go — pure decoration, and they accumulate. */
  get decals() { return budget.maxDecals > 0; },
};
