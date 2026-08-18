/**
 * The only persistent state in the game: how far the campaign has been cleared and
 * the best endless run. Deliberately tiny and failure-tolerant — a locked-down
 * browser with no storage should still let you play, just without remembering.
 */

const KEY_CAMPAIGN = "stickman.campaign.cleared";
const KEY_ENDLESS = "stickman.endless.best";

function read(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Private mode, disabled storage — progress just doesn't persist.
  }
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

  resetAll() {
    write(KEY_CAMPAIGN, 0);
    write(KEY_ENDLESS, 0);
  },
};
