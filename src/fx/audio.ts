/**
 * Silence.
 *
 * The game shipped with a full synthesised WebAudio stack — a mixer, a DSP layer, a
 * mood-driven generative score, and forty-odd effect voices. It was judged not good
 * enough to keep, and rather than leave a bad mix in the build it was cut wholesale on
 * 2026-08-22 (see `GAME_SPEC.md` § Audio).
 *
 * What survives is this facade. Every method the game ever called is still here and
 * still callable; each one does nothing. That is deliberate and it is not laziness:
 *
 * - The seventy-odd call sites are *correct*. They mark the exact moments the game
 *   believes are worth hearing — a piano landing, a limb coming off, a first unlock.
 *   Deleting them would throw away the design work of deciding where sound belongs, and
 *   re-deriving that later is far more expensive than carrying an empty method.
 * - Reinstating audio is then a single-file change with no diff anywhere else.
 *
 * The real implementation is in git history at `e8906b5^`; `audio-mix.ts`, `audio-dsp.ts`
 * and `audio-music.ts` were deleted in the same commit and are recoverable from there.
 *
 * Everything is a no-op rather than a `console.warn`, because a silent game calling
 * `impact()` two hundred times a second must cost nothing at all.
 */

import type { V } from "../core/math";

/** Kept because `block.ts` computes impact magnitudes with it for non-audio purposes. */
export const magnitudeFromEnergy = (kj: number) =>
  Math.max(0, Math.min(1, Math.log(1 + Math.max(0, kj) / 8) / Math.log(1 + 4000 / 8)));

type Mood = "menu" | "combat" | "result";

/** Every argument is accepted and discarded. See the module note. */
class SilentSfx {
  /** Nothing is muted, because nothing makes a sound. The UI no longer asks. */
  readonly muted = false;

  unlock() {}
  setVolume(_vol: number) {}
  setVolumeStep(_i: number) {}
  toggleMute() {}
  setAdPlaying(_on: boolean) {}
  listener(_x: number, _y: number, _halfWidth: number) {}
  setIntensity(_v: number) {}
  excite(_amount: number) {}
  update(_dt: number) {}
  setMood(_m: Mood) {}
  startMusic() {}
  stopMusic() {}
  setMusicVolume(_v: number) {}

  impact(_mag: number, _mat?: string, _at?: V | null, _priority?: number) {}
  impactEnergy(_kj: number, _mat?: string, _at?: V | null) {}
  thud(_strength: number, _mat?: string, _at?: V | null) {}
  shoot(_heft: number, _at?: V | null) {}
  explode(_size: number, _at?: V | null) {}
  cluck(_at?: V | null) {}
  trumpet(_at?: V | null) {}
  scream(_at?: V | null) {}
  splat(_at?: V | null) {}
  gib(_at?: V | null) {}
  kill(_at?: V | null) {}
  combo(_n: number, _at?: V | null) {}
  reward() {}
  levelComplete() {}
  levelFail() {}
  heartbeat(_intensity: number) {}
  ignite(_at?: V | null) {}
  steam(_at?: V | null) {}
  splash(_strength?: number, _at?: V | null) {}
  ricochet(_at?: V | null) {}
  whoosh(_strength?: number, _at?: V | null) {}
  pianoCrash(_at?: V | null) {}
  jetEngine(_at?: V | null) {}
  rocketLaunch(_at?: V | null) {}
  nuke(_at?: V | null) {}
  blackhole(_at?: V | null) {}
  saw(_at?: V | null) {}
  jetpack(_throttle: number) {}
  hose(_level: number) {}
  flamethrower(_level: number) {}
  acidHiss(_at?: V | null) {}
  wind(_strength?: number) {}
  ui(_up?: boolean) {}
  levelUp() {}
}

export const sfx = new SilentSfx();
