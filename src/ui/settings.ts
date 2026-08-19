/**
 * Player-facing options that are not progression.
 *
 * Separate from `progress` on purpose: wiping a save should reset what you have
 * *earned*, not re-enable a camera effect somebody turned off because it makes them
 * ill. Same failure-tolerant shape as `progress` — every read has a fallback and
 * every write is allowed to fail silently, so a locked-down browser still plays.
 */

const KEY = "stickman.settings.v1";

/**
 * Screen-shake amounts, as a multiplier on camera trauma.
 *
 * Stepped rather than continuous because this is a canvas control operated with a
 * mouse or a thumb: four labelled stops are hittable and unambiguous, where a
 * continuous track is a drag interaction nobody can land precisely and nobody can
 * describe to a friend. OFF is a real zero, not "a bit less" — motion sickness is
 * not a matter of degree for the people who get it.
 */
export const SHAKE_STEPS: readonly number[] = [0, 0.35, 0.7, 1];
export const SHAKE_LABELS: readonly string[] = ["OFF", "LOW", "MEDIUM", "FULL"];

interface Stored {
  shake: number;
  tips: boolean;
}

function load(): Stored {
  const fallback: Stored = { shake: SHAKE_STEPS.length - 1, tips: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const d = JSON.parse(raw) as Partial<Stored>;
    return {
      shake: Number.isFinite(d.shake) ? Math.max(0, Math.min(SHAKE_STEPS.length - 1, Math.floor(d.shake as number))) : fallback.shake,
      tips: d.tips !== false,
    };
  } catch {
    return fallback;
  }
}

const state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode: the choice holds for this session and no longer.
  }
}

export const settings = {
  /** Index into `SHAKE_STEPS`. */
  get shakeStep() {
    return state.shake;
  },

  setShakeStep(i: number) {
    state.shake = Math.max(0, Math.min(SHAKE_STEPS.length - 1, Math.floor(i)));
    save();
  },

  /**
   * Multiplier to apply to every camera trauma. Read this at the point trauma is
   * *added* rather than where it is consumed, so a setting change takes effect on the
   * next hit instead of freezing whatever shake was already in flight.
   */
  get shake() {
    return SHAKE_STEPS[state.shake] ?? 1;
  },

  get shakeLabel() {
    return SHAKE_LABELS[state.shake] ?? "FULL";
  },

  /** Whether the in-game coach may show prompts at all. */
  get tips() {
    return state.tips;
  },

  setTips(on: boolean) {
    state.tips = on;
    save();
  },
};
