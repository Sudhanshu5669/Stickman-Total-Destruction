/**
 * Music, and nothing else.
 *
 * The game shipped with a full synthesised WebAudio stack — a mixer, a DSP layer, a
 * mood-driven generative score, and forty-odd effect voices. It was judged not good
 * enough to keep, and rather than leave a bad mix in the build it was cut wholesale on
 * 2026-08-22 (see `GAME_SPEC.md` § Audio). Real music tracks were dropped into
 * `src/Assets/music` on 2026-08-25 and this file grew a player for them; **the effect
 * voices are still gone**, and every effect method below is still a no-op.
 *
 * Keeping the facade is what made that a one-file change, and it is still worth
 * keeping:
 *
 * - The seventy-odd effect call sites are *correct*. They mark the exact moments the
 *   game believes are worth hearing — a piano landing, a limb coming off, a first
 *   unlock. Deleting them would throw away the design work of deciding where sound
 *   belongs, and re-deriving that later is far more expensive than carrying an empty
 *   method.
 * - `setMood`, `unlock`, `update` and `setAdPlaying` were already called from the right
 *   places, which is why the music needed no diff outside this file and the options
 *   panel.
 *
 * The deleted effect implementation is in git history at `e8906b5^`; `audio-mix.ts`,
 * `audio-dsp.ts` and `audio-music.ts` were deleted in the same commit.
 *
 * Effects are no-ops rather than `console.warn`s, because a silent game calling
 * `impact()` two hundred times a second must cost nothing at all.
 *
 * ## Why `<audio>` rather than WebAudio
 *
 * The tracks are three-to-four megabyte MP3s. An `HTMLAudioElement` streams them and
 * starts on the first few kilobytes; `decodeAudioData` wants the whole file in memory
 * first, which on a phone is several seconds of silence at boot and ~40 MB of decoded
 * PCM resident for two tracks. Crossfading needs one gain ramp, which `.volume` does
 * perfectly well from the frame loop that is already running.
 */

import type { V } from "../core/math";
import { settings } from "../ui/settings";

/**
 * Every track under `src/Assets/music`, as URLs Vite has hashed and emitted.
 *
 * Globbed, and sorted by path, for the same reason the sprite sheets are: the audio
 * arrives as a folder of third-party files, and a manifest you must edit to add one
 * more track is a manifest that will be wrong within a week. Drop an MP3 in and it
 * joins the rotation.
 */
const TRACK_URLS = Object.entries(
  import.meta.glob("../Assets/music/*.{mp3,ogg,m4a,wav}", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>,
)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([, url]) => url);

/**
 * Ceiling on music gain, before the player's volume setting.
 *
 * The tracks are mastered loud, as released music is, and a game is not an album: this
 * plays under the thing the player is concentrating on, for a long time, and the level
 * that sounds right for ten seconds is exhausting after ten minutes. 0.45 is the point
 * at which the bass still moves and nothing has to be talked over.
 */
const MUSIC_CEILING = 0.45;

/** Seconds a crossfade takes when the mood changes. Long enough to read as a mix. */
const FADE = 2.2;

/**
 * One track, its element, and the gain it is heading toward.
 *
 * A deck per track rather than two decks sharing a pool of sources: there are only a
 * handful of tracks, an idle `<audio>` costs nothing once paused, and keeping each
 * track on its own element means a crossfade back to the menu resumes that track where
 * it left off instead of restarting it — which is what makes bouncing between the menu
 * and an arena sound like one continuous piece of music rather than a stutter.
 */
interface Deck {
  el: HTMLAudioElement;
  /** Where the crossfade is taking this deck: 1 for the live track, 0 for the rest. */
  target: number;
  gain: number;
  /** A `play()` is in flight. Stops the frame loop stacking one call per frame on it. */
  starting: boolean;
}

/** Kept because `block.ts` computes impact magnitudes with it for non-audio purposes. */
export const magnitudeFromEnergy = (kj: number) =>
  Math.max(0, Math.min(1, Math.log(1 + Math.max(0, kj) / 8) / Math.log(1 + 4000 / 8)));

type Mood = "menu" | "combat" | "result";

/**
 * Music player wearing the old effects facade.
 *
 * Effect methods are still no-ops; everything above `impact()` is real.
 */
class Sfx {
  private decks: Deck[] = [];
  /** Index into `decks` of the track that should be audible. -1 before the first mood. */
  private live = -1;
  /** Advanced each time an arena starts, so consecutive runs are not the same loop. */
  private combatPick = 0;
  private mood: Mood = "menu";
  /** False until a real gesture. Browsers reject `play()` before one; see `unlock()`. */
  private armed = false;
  private adPlaying = false;
  /** Extra scalar for callers that want to duck the music. 1 unless something ducks it. */
  private musicVol = 1;
  private started = false;

  get muted() {
    return settings.muted;
  }

  /**
   * Arms playback on the first real gesture.
   *
   * Wired to `pointerdown` and `keydown` with `once: false`, so it is called on *every*
   * input for the life of the session and must stay cheap and idempotent. It is also
   * the retry path: a `play()` rejected by the autoplay policy leaves the deck paused,
   * and the next key the player presses picks it up.
   */
  unlock() {
    this.armed = true;
    this.sync();
  }

  /** Loads a track on demand. Nothing is fetched until a mood actually asks for it. */
  private deck(i: number): Deck | null {
    if (i < 0 || i >= TRACK_URLS.length) return null;
    const existing = this.decks[i];
    if (existing) return existing;
    const el = new Audio(TRACK_URLS[i]);
    el.loop = true;
    el.preload = "none";
    el.volume = 0;
    // A stalled or missing track must not take the game with it, and must not retry in
    // a loop either: drop the deck and the next mood change picks another one.
    el.addEventListener("error", () => {
      el.pause();
    });
    const d: Deck = { el, target: 0, gain: 0, starting: false };
    this.decks[i] = d;
    return d;
  }

  /**
   * Which track a mood plays.
   *
   * The menu keeps the first track for itself, so the front end has an identity you
   * recognise before you have pressed anything. Arenas take the rest in rotation. With
   * the two tracks in the repo that is one each; with one track everything shares it
   * rather than falling silent, and with five the arenas cycle four.
   */
  private trackFor(m: Mood): number {
    const n = TRACK_URLS.length;
    if (n === 0) return -1;
    if (m === "menu" || n === 1) return 0;
    return 1 + (this.combatPick % (n - 1));
  }

  setAdPlaying(on: boolean) {
    if (this.adPlaying === on) return;
    this.adPlaying = on;
    this.sync();
  }

  /**
   * Picks the track for the mood and starts the crossfade.
   *
   * Called every frame from `Game.updateAudio`, so the common case — nothing changed —
   * has to be free.
   */
  setMood(m: Mood) {
    if (m === this.mood && this.live >= 0) return;
    // A fresh arena advances the rotation; leaving one does not, or bouncing through
    // the menu between runs would skip a track each time.
    if (m === "combat" && this.mood !== "combat") this.combatPick++;
    this.mood = m;
    const want = this.trackFor(m);
    if (want === this.live) return;
    this.live = want;
    for (let i = 0; i < this.decks.length; i++) {
      const d = this.decks[i];
      if (d) d.target = 0;
    }
    const next = this.deck(want);
    if (next) next.target = 1;
    this.sync();
  }

  /**
   * Advances the crossfade and keeps every deck's element in step with it.
   *
   * Driven from the *raw* frame delta rather than the fixed step, so a fade takes the
   * same wall-clock time whether the sim is running, paused or slowed down.
   */
  update(dt: number) {
    if (!this.decks.length) return;
    const step = Math.min(0.25, Math.max(0, dt)) / FADE;
    const master = this.armed && !this.adPlaying && !settings.muted
      ? MUSIC_CEILING * settings.volume * this.musicVol
      : 0;

    for (const d of this.decks) {
      if (!d) continue;
      const delta = d.target - d.gain;
      d.gain = Math.abs(delta) <= step ? d.target : d.gain + Math.sign(delta) * step;
      const vol = d.gain * master;
      // Clamped because `volume` throws on anything outside 0..1, and a float that
      // lands at 1.0000000000000002 would take the game down with it.
      d.el.volume = Math.max(0, Math.min(1, vol));
      if (vol > 0.0005) {
        if (d.el.paused && !d.starting) this.play(d);
      } else if (!d.el.paused) {
        // Faded out, or muted: pause rather than leaving a silent stream decoding.
        d.el.pause();
      }
    }
  }

  /**
   * Starts one deck, and decides what a refusal means.
   *
   * Only `NotAllowedError` — "no gesture yet" — disarms the player, because that is the
   * one failure the *next* keypress fixes. Everything else (a track that will not
   * decode, a file that 404s, an output device that disappeared) is this deck's problem
   * alone: an early version disarmed on any rejection, which meant one bad track
   * silenced the whole game for the session, and the crossfade to it silenced the track
   * that had been playing perfectly well.
   */
  private play(d: Deck) {
    d.starting = true;
    void d.el.play().then(
      () => { d.starting = false; },
      (err: unknown) => {
        d.starting = false;
        if (err instanceof DOMException && err.name === "NotAllowedError") this.armed = false;
      },
    );
  }

  /**
   * Pushes the current settings at the decks immediately.
   *
   * `update()` would get there on the next frame anyway, but "next frame" is not soon
   * enough for a mute: the player pressed M *because* they want it quiet now, and a
   * frame that never arrives because the tab just lost focus would leave it playing.
   */
  private sync() {
    if (!this.started && this.armed) {
      this.started = true;
      if (this.live < 0) this.setMood(this.mood);
    }
    this.update(0);
  }

  setVolume(_vol: number) {}

  /** Volume lives in `settings`; the options panel writes it there. This re-syncs. */
  setVolumeStep(_i: number) {
    this.sync();
  }

  toggleMute() {
    settings.setMuted(!settings.muted);
    this.sync();
  }

  listener(_x: number, _y: number, _halfWidth: number) {}
  setIntensity(_v: number) {}
  excite(_amount: number) {}

  startMusic() {
    this.armed = true;
    this.sync();
  }

  stopMusic() {
    this.live = -1;
    for (const d of this.decks) if (d) d.target = 0;
    this.sync();
  }

  setMusicVolume(v: number) {
    this.musicVol = Math.max(0, Math.min(1, v));
    this.sync();
  }

  // ------------------------------------------------- effects: still silent
  // Every argument below is accepted and discarded. See the module note: these mark
  // where sound belongs, and cost nothing until there is a mix worth shipping.

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
  balloonPop(_at?: V | null) {}
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

export const sfx = new Sfx();
