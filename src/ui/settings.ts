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

/**
 * Master volume stops, as a multiplier on the mixer's master gain.
 *
 * Stepped for the same reason the shake control is: this is a canvas widget operated
 * with a thumb, and four hittable stops beat a track nobody can land on. The top stop
 * is the mix as it was tuned — nothing here can push the output above that, so the
 * limiter never sees a level it was not designed for.
 *
 * Deliberately *not* a replacement for mute. A player who wants silence reaches for
 * the speaker icon, and finding it at 25% instead would be a broken promise.
 */
export const VOLUME_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1];
export const VOLUME_LABELS: readonly string[] = ["25", "50", "75", "100"];

interface Stored {
  shake: number;
  tips: boolean;
  volume: number;
  /**
   * Whether the player muted the game.
   *
   * Persisted because a mute is a *statement*, not a per-session accident: somebody
   * playing on a train and muting the game means it every time, and re-muting on every
   * load is exactly the kind of small friction that ends a session early.
   */
  muted: boolean;
}

function clampStep(x: unknown, steps: readonly number[], fallback: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(steps.length - 1, Math.floor(x as number))) : fallback;
}

function load(): Stored {
  const fallback: Stored = {
    shake: SHAKE_STEPS.length - 1,
    tips: true,
    volume: VOLUME_STEPS.length - 1,
    muted: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const d = JSON.parse(raw) as Partial<Stored>;
    return {
      shake: clampStep(d.shake, SHAKE_STEPS, fallback.shake),
      tips: d.tips !== false,
      volume: clampStep(d.volume, VOLUME_STEPS, fallback.volume),
      muted: d.muted === true,
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

  // ------------------------------------------------------------------- audio

  /** Index into `VOLUME_STEPS`. */
  get volumeStep() {
    return state.volume;
  },

  setVolumeStep(i: number) {
    state.volume = Math.max(0, Math.min(VOLUME_STEPS.length - 1, Math.floor(i)));
    save();
  },

  /** Master gain the mixer should sit at, ignoring mute. */
  get volume() {
    return VOLUME_STEPS[state.volume] ?? 1;
  },

  get volumeLabel() {
    return VOLUME_LABELS[state.volume] ?? "100";
  },

  get muted() {
    return state.muted;
  },

  setMuted(on: boolean) {
    state.muted = on;
    save();
  },
};
