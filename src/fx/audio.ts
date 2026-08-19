import { clamp, pick, rand, type V } from "../core/math";
import { impactBank, tierDuration, type ImpactId, type Tier } from "./audio-dsp";
import { Mixer, type Cat, type Slot } from "./audio-mix";
import { Music, type Mood } from "./audio-music";

/**
 * Everything is synthesised at runtime — no audio files, so the whole game stays a
 * sub-2MB download and there is nothing to preload before the first shot.
 *
 * Browsers block audio until a gesture, so `unlock()` is wired to the first click/key.
 *
 * Three layers sit under this class and each owns one problem:
 *
 * - `audio-dsp` bakes impacts and drums into buffers, so the hot path plays a sample
 *   instead of building a synth per hit.
 * - `audio-mix` is the bus, the limiter and the voice allocator. Every one-shot here has
 *   to be granted a slot before it may sound, and the allocator is allowed to refuse.
 * - `audio-music` is the generative score.
 *
 * The rule that keeps all of it cheap: nothing in this file creates a node until a slot
 * has been granted, and the number of slots is fixed.
 */

/**
 * Maps every material name the game uses onto an impact voice. Both the coarse
 * `Material.sound` families and the specific `MaterialId`s resolve here, so passing the
 * more specific id simply gets you a more specific sound.
 */
const MAT: Record<string, ImpactId> = {
  wood: "wood", brick: "brick", concrete: "concrete", sandstone: "sandstone", stone: "stone",
  glass: "glass", ice: "ice", crystal: "crystal", metal: "metal", gold: "gold", hull: "hull",
  explosive: "explosive", flesh: "flesh", biomass: "biomass",
};

/**
 * Impact energy -> 0..1 magnitude.
 *
 * Deliberately the same curve as `juice.fromEnergy`, mirrored rather than imported so
 * the audio layer carries no dependency on the game-feel layer. If that curve moves,
 * move this one with it: the entire point of a shared magnitude is that the sound and
 * the screenshake are describing the same event.
 */
export const magnitudeFromEnergy = (kj: number) =>
  clamp(Math.log(1 + Math.max(0, kj) / 8) / Math.log(1 + 4000 / 8), 0, 1);

/**
 * Where the sound changes character. These are `juice`'s own tier boundaries — "solid"
 * at 0.30 and "kill" at 0.68 — so the sample bank steps up on exactly the event where
 * the hitstop and the shake do.
 */
const TIER_SOLID = 0.3;
const TIER_HEAVY = 0.68;

/** Legacy 0..1 "strength" -> magnitude, kept so old call sites still sound sensible. */
const fromStrength = (s: number) => clamp(0.12 + clamp(s, 0, 1) * 0.72, 0, 1);

interface ToneOpts {
  freq: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  to?: number;
  attack?: number;
  detune?: number;
  vibrato?: { rate: number; depth: number };
  /** Seconds after the slot's start time. Scheduled, never a `setTimeout`. */
  delay?: number;
}

interface NoiseOpts {
  dur: number;
  gain: number;
  freq: number;
  q?: number;
  type?: BiquadFilterType;
  sweepTo?: number;
  attack?: number;
  delay?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private mix: Mixer | null = null;
  private music: Music | null = null;
  private noiseBuf!: AudioBuffer;

  muted = false;
  volume = 0.75;
  /** Music sits well under the effects: it is the bed, not the event. */
  musicVolume = 0.34;

  /** Set while a portal ad owns the screen. Silences everything without touching `muted`. */
  private adPlaying = false;
  private hidden = false;

  /** Music state requested before the context existed, replayed on unlock. */
  private wantMusic = true;
  private wantMood: Mood = "menu";
  private intensity = 0;

  private nextBeat = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !this.hidden && !this.adPlaying) void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.mix = new Mixer(this.ctx, this.gain, this.musicVolume);

    // Two seconds of white noise, reused by every live percussive sound. The baked
    // impacts carry their own noise, so this is only for the sustained/tonal effects.
    const n = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    this.music = new Music(this.ctx, this.mix.musicBus);
    this.music.setMood(this.wantMood);
    this.music.setIntensity(this.intensity);
    this.music.setMuted(this.muted);
    if (this.wantMusic) this.music.start();

    // Portals penalise a game that keeps making noise in a background tab, and on a
    // phone it is pure battery burn. Suspending the whole context is the only way to
    // stop *everything*, including the music scheduler's clock.
    document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("pagehide", this.onVisibility);
  }

  private onVisibility = () => {
    const ctx = this.ctx;
    if (!ctx) return;
    this.hidden = document.visibilityState === "hidden";
    if (this.hidden) void ctx.suspend();
    else if (!this.adPlaying) void ctx.resume();
  };

  /** What the master bus should actually be at right now. */
  private get gain() {
    return this.muted || this.adPlaying ? 0 : this.volume;
  }

  setVolume(vol: number) {
    this.volume = clamp(vol, 0, 1);
    this.mix?.setVolume(this.gain);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.mix?.setVolume(this.gain);
    // Muted music keeps its clock but stops allocating nodes — unmuting drops you back
    // into the arrangement where it would have been rather than restarting it.
    this.music?.setMuted(this.muted);
    return this.muted;
  }

  /**
   * Silences the game for the duration of a portal ad.
   *
   * Separate from `muted` on purpose: an ad must never leave the player's own mute
   * setting flipped, and the ad's own audio has to be the only thing playing.
   */
  setAdPlaying(on: boolean) {
    if (this.adPlaying === on) return;
    this.adPlaying = on;
    this.mix?.setVolume(this.gain);
    const ctx = this.ctx;
    if (!ctx) return;
    if (on) void ctx.suspend();
    else if (!this.hidden) void ctx.resume();
  }

  /**
   * Where the camera is, in world metres, and half the width it can see.
   *
   * Call once a frame. Everything positional is expressed in screens rather than metres
   * so the mix stays correct while the camera zooms out during a rampage.
   */
  listener(x: number, y: number, halfWidth: number) {
    this.mix?.listener(x, y, halfWidth);
  }

  /** Concurrent voices — for the debug overlay. */
  get voices() {
    return this.mix?.active ?? 0;
  }

  // ------------------------------------------------------------------- music

  /** 0 = idle, 1 = total carnage. Smoothed inside the music system. */
  setIntensity(v: number) {
    this.intensity = clamp(v, 0, 1);
    this.music?.setIntensity(this.intensity);
  }

  /**
   * Nudges the score upward on an event, to be decayed by `update()`.
   *
   * This is the interface the game actually wants: destruction adds excitement, standing
   * still lets it drain, and the arrangement follows without anyone having to model it.
   */
  excite(amount: number) {
    this.setIntensity(this.intensity + amount);
  }

  /** Decays intensity. Call once a frame with the real frame time. */
  update(dt: number) {
    if (this.intensity > 0) this.setIntensity(this.intensity - dt * 0.16);
  }

  setMood(m: Mood) {
    this.wantMood = m;
    this.music?.setMood(m);
  }

  startMusic() {
    this.wantMusic = true;
    this.music?.start();
  }

  stopMusic() {
    this.wantMusic = false;
    this.music?.stop();
  }

  setMusicVolume(v: number) {
    this.musicVolume = clamp(v, 0, 1);
    this.mix?.setMusicVolume(this.musicVolume);
  }

  // -------------------------------------------------------------- allocation

  /**
   * The gate every one-shot passes through. Returning null means "make no sound", and
   * the silent cases are checked before the allocator so a muted or backgrounded game
   * does no work at all rather than building graphs into a zeroed master.
   */
  private grab(cat: Cat, key: string, level: number, dur: number, at?: V | null, priority = 1, gap = 1) {
    if (!this.mix || this.muted || this.adPlaying || this.hidden) return null;
    return this.mix.acquire({ cat, key, level, dur, at, priority, gap });
  }

  // ------------------------------------------------------------- primitives

  private env(s: Slot, gain: number, attack: number, dur: number, t0: number, curve: "exp" | "lin" = "exp") {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    if (curve === "exp") g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    s.attach(g);
    return g;
  }

  private noise(s: Slot, opts: NoiseOpts) {
    const c = this.ctx!;
    const t0 = s.startAt + (opts.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.85, 1.15);

    const f = c.createBiquadFilter();
    f.type = opts.type ?? "lowpass";
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.sweepTo !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.sweepTo), t0 + opts.dur);
    }
    f.Q.value = opts.q ?? 1;

    const g = this.env(s, opts.gain, opts.attack ?? 0.004, opts.dur, t0);
    src.connect(f);
    f.connect(g);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  private tone(s: Slot, opts: ToneOpts) {
    const c = this.ctx!;
    const t0 = s.startAt + (opts.delay ?? 0);
    const o = c.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to !== undefined) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
    }
    if (opts.detune) o.detune.value = opts.detune;

    if (opts.vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = opts.vibrato.rate;
      lg.gain.value = opts.vibrato.depth;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + opts.dur + 0.05);
    }

    const g = this.env(s, opts.gain, opts.attack ?? 0.005, opts.dur, t0);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + opts.dur + 0.05);
  }

  // ----------------------------------------------------------------- impacts

  /**
   * The one impact entry point.
   *
   * `mag` is a normalised 0..1 "how big was that", the same scalar the game uses to
   * drive hitstop, shake and particles — so the sound is guaranteed to agree with what
   * the screen is doing. `mat` is any material name the game knows (`MaterialId` or the
   * coarse `Material.sound` family); the more specific the name, the more specific the
   * sound. `at` is the world position, and omitting it plays the sound dead centre.
   *
   * Three layers, all scaled by `mag` rather than switched between: a baked transient +
   * body from the material's own bank, a continuous playback-rate shift so a bigger hit
   * of the same material is a lower, slower version of itself, and — past halfway — a
   * live sub that keeps growing after the sample has stopped getting bigger. A tap and a
   * tower coming down are the same sound at two ends of one continuum.
   */
  impact(mag: number, mat: string = "stone", at?: V | null, priority = 1) {
    const mix = this.mix;
    if (!mix || this.muted || this.adPlaying || this.hidden) return;
    const m = clamp(mag, 0, 1);
    const id = MAT[mat] ?? "stone";
    const tier: Tier = m < TIER_SOLID ? 0 : m < TIER_HEAVY ? 1 : 2;
    const level = 0.14 + m * 0.9;
    // Heavy hits are worth more than light ones when a slot has to be taken.
    const slot = mix.acquire({
      cat: tier === 2 ? "big" : "impact",
      key: id + tier,
      level,
      dur: tierDuration(tier),
      at,
      priority: priority * (0.7 + m * 1.2),
    });
    if (!slot) return;

    const bank = impactBank(mix.ctx, id, tier);
    const buf = bank[(Math.random() * bank.length) | 0];
    // Where this hit sits *within* its tier, so the steps between tiers are inaudible.
    const local = tier === 0
      ? m / TIER_SOLID
      : tier === 1
        ? (m - TIER_SOLID) / (TIER_HEAVY - TIER_SOLID)
        : (m - TIER_HEAVY) / (1 - TIER_HEAVY);
    const rate = (1.16 - clamp(local, 0, 1) * 0.26) * rand(0.97, 1.04);

    const src = mix.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = mix.ctx.createGain();
    g.gain.value = level;
    src.connect(g);
    slot.attach(g);
    src.start(slot.startAt);
    src.stop(slot.startAt + buf.duration / rate + 0.02);

    // The chest layer. Only the big half of the range gets one, which is exactly what
    // makes the big half feel big.
    if (m > 0.5) {
      const w = (m - 0.5) * 2;
      this.tone(slot, {
        freq: 96 - w * 26, to: 26, dur: 0.22 + w * 0.5,
        gain: 0.18 + w * 0.5, type: "sine", attack: 0.006,
      });
    }
    // Anything this size owns the room for a moment.
    if (m > 0.86) mix.duckAll(0.3 + (m - 0.86) * 2, 0.1);
  }

  /**
   * Impact from raw kilojoules, for call sites that have the physics number to hand.
   * Identical to `impact()` past the energy curve.
   */
  impactEnergy(kj: number, mat: string = "stone", at?: V | null) {
    this.impact(magnitudeFromEnergy(kj), mat, at);
  }

  /**
   * Generic collision, kept for the existing 0..1 "strength" call sites. New code should
   * prefer `impact()` with the shared magnitude, or `impactEnergy()` with kilojoules.
   */
  thud(strength: number, mat: string = "stone", at?: V | null) {
    this.impact(fromStrength(strength), mat, at);
  }

  // ------------------------------------------------------------- game sounds

  /** `heft` 0..1 — a chicken pops, an elephant detonates. */
  shoot(heft: number, at?: V | null) {
    const h = clamp(heft, 0, 1);
    const s = this.grab("weapon", "shoot", 0.3 + h * 0.5, 0.36, at, 1 + h);
    if (!s) return;
    // A real muzzle report is a click, a body and a low thump — the same three layers as
    // an impact, because it is one: an explosion happening inside a tube.
    this.noise(s, { dur: 0.02 + h * 0.02, gain: 0.3 + h * 0.3, freq: 6200, q: 0.8, type: "highpass", attack: 0.0008 });
    this.noise(s, { dur: 0.1 + h * 0.22, gain: 0.28 + h * 0.4, freq: 2600 - h * 1500, sweepTo: 180, q: 1.2 });
    this.tone(s, { freq: 190 - h * 100, to: 42, dur: 0.12 + h * 0.3, gain: 0.3 + h * 0.35, type: "square" });
    if (h > 0.7) this.tone(s, { freq: 70, to: 24, dur: 0.3, gain: (h - 0.7) * 1.4, type: "sine" });
  }

  explode(size: number, at?: V | null) {
    const s0 = clamp(size, 0.2, 3);
    const s = this.grab("big", "explode", 0.55 + s0 * 0.12, 1.1 + s0 * 0.5, at, 2.2);
    if (!s) return;
    this.noise(s, { dur: 0.5 + s0 * 0.5, gain: 0.5, freq: 900 * s0, sweepTo: 60, q: 0.7, attack: 0.002 });
    this.tone(s, { freq: 120 / s0, to: 24, dur: 0.5 + s0 * 0.45, gain: 0.55, type: "sine" });
    this.tone(s, { freq: 60 / s0, to: 18, dur: 0.7 + s0 * 0.5, gain: 0.4, type: "triangle" });
    // Debris raining back down. Delayed, so the blast reads as having thrown something.
    this.noise(s, { dur: 0.5, gain: 0.1 * s0, freq: 2400, q: 0.6, type: "highpass", attack: 0.08, delay: 0.14 });
    this.mix!.duckAll(0.28 + s0 * 0.12, 0.12 + s0 * 0.06);
  }

  cluck(at?: V | null) {
    const s = this.grab("voice", "cluck", 0.2, 0.25, at, 0.8);
    if (!s) return;
    const base = rand(620, 900);
    this.tone(s, { freq: base, to: base * 1.7, dur: 0.06, gain: 0.16, type: "sawtooth" });
    this.tone(s, { freq: base * 1.3, to: base * 0.6, dur: 0.1, gain: 0.13, type: "sawtooth", delay: 0.07 });
  }

  trumpet(at?: V | null) {
    const s = this.grab("voice", "trumpet", 0.34, 0.7, at, 1.4);
    if (!s) return;
    this.tone(s, {
      freq: rand(230, 290), to: rand(430, 520), dur: 0.65, gain: 0.3, type: "sawtooth",
      vibrato: { rate: 12, depth: 22 },
    });
    this.noise(s, { dur: 0.6, gain: 0.1, freq: 900, q: 3 });
  }

  scream(at?: V | null) {
    const s = this.grab("voice", "scream", 0.2, 0.9, at, 1.2);
    if (!s) return;
    this.tone(s, {
      freq: rand(500, 760), to: rand(230, 340), dur: rand(0.5, 0.9), gain: 0.16, type: "sawtooth",
      vibrato: { rate: rand(14, 22), depth: 40 },
    });
  }

  splat(at?: V | null) {
    const s = this.grab("impact", "splat", 0.34, 0.26, at, 1.3);
    if (!s) return;
    this.noise(s, { dur: 0.22, gain: 0.3, freq: 1200, sweepTo: 120, q: 0.6 });
    this.tone(s, { freq: 220, to: 46, dur: 0.2, gain: 0.16, type: "sine" });
  }

  /** A limb coming off — wetter and lower than a splat, with a bone snap on top. */
  gib(at?: V | null) {
    const s = this.grab("impact", "gib", 0.4, 0.4, at, 1.6);
    if (!s) return;
    this.noise(s, { dur: 0.34, gain: 0.34, freq: 900, sweepTo: 80, q: 0.5 });
    this.tone(s, { freq: 150, to: 34, dur: 0.3, gain: 0.2, type: "sine" });
    this.tone(s, { freq: rand(900, 1500), to: 300, dur: 0.05, gain: 0.1, type: "square" });
  }

  /**
   * A hostile going down for good.
   *
   * Deliberately the loudest thing in the impact family and on the un-ducked bus: the
   * kill is the beat the whole session is built around, and it has to cut through a
   * collapsing building.
   */
  kill(at?: V | null) {
    const s = this.grab("big", "kill", 0.66, 0.5, at, 2.6);
    if (!s) return;
    this.noise(s, { dur: 0.06, gain: 0.4, freq: 3600, q: 0.8, type: "bandpass", attack: 0.001 });
    this.noise(s, { dur: 0.26, gain: 0.36, freq: 1000, sweepTo: 90, q: 0.6 });
    this.tone(s, { freq: 128, to: 32, dur: 0.34, gain: 0.5, type: "sine", attack: 0.004 });
    this.tone(s, { freq: rand(1200, 1700), to: 260, dur: 0.05, gain: 0.14, type: "square" });
    this.mix!.duckAll(0.3, 0.08);
  }

  /**
   * A chain milestone. `n` is the chain length, and each tier lands a fourth higher, so
   * the reward reads as a ladder even when you cannot see the popup.
   */
  combo(n: number, at?: V | null) {
    const tier = n >= 100 ? 3 : n >= 50 ? 2 : n >= 25 ? 1 : 0;
    const s = this.grab("ui", "combo", 0.5 + tier * 0.1, 0.75, at, 2.4);
    if (!s) return;
    const root = [392, 523.25, 698.46, 932.33][tier];
    for (let i = 0; i < 3; i++) {
      this.tone(s, {
        freq: root * Math.pow(2, i / 3), dur: 0.3 - i * 0.05,
        gain: 0.16 + tier * 0.03, type: i === 2 ? "square" : "triangle", delay: i * 0.055,
      });
    }
    this.noise(s, { dur: 0.3, gain: 0.06 + tier * 0.02, freq: 900, sweepTo: 7000, q: 1.4, type: "bandpass", attack: 0.05 });
    this.mix!.duckAll(0.2 + tier * 0.06, 0.06);
    this.excite(0.12 + tier * 0.1);
  }

  /** Something new in the arsenal. The one sound that should stop a player mid-swing. */
  reward() {
    const s = this.grab("ui", "reward", 0.75, 1.5, null, 3);
    if (!s) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      this.tone(s, { freq: f, dur: 0.5 - i * 0.05, gain: 0.15, type: "triangle", delay: i * 0.08 });
      this.tone(s, { freq: f * 2, dur: 0.2, gain: 0.05, type: "sine", delay: i * 0.08 });
    });
    this.noise(s, { dur: 0.9, gain: 0.07, freq: 2000, sweepTo: 9000, q: 1.2, type: "bandpass", attack: 0.2 });
    this.mix!.duckAll(0.45, 0.5);
    this.music?.stinger("reward");
  }

  /** Mission complete. Resolves upward and lets the music take the last word. */
  levelComplete() {
    const s = this.grab("ui", "result", 0.8, 1.8, null, 3);
    if (!s) return;
    [261.63, 329.63, 392, 523.25].forEach((f, i) => {
      this.tone(s, { freq: f, dur: 1.1 - i * 0.12, gain: 0.14, type: "triangle", delay: i * 0.12 });
    });
    this.tone(s, { freq: 65.41, dur: 1.4, gain: 0.2, type: "sine", attack: 0.02 });
    this.mix!.duckAll(0.55, 0.7);
    this.music?.stinger("win");
  }

  /**
   * Run over. Falls a minor third and stops dead rather than fading — the point is to be
   * unsatisfying enough that the retry button is the obvious next move.
   */
  levelFail() {
    const s = this.grab("ui", "result", 0.8, 1.6, null, 3);
    if (!s) return;
    [349.23, 293.66, 233.08, 174.61].forEach((f, i) => {
      this.tone(s, { freq: f, dur: 0.5 + i * 0.2, gain: 0.14, type: "triangle", delay: i * 0.14 });
    });
    this.tone(s, { freq: 87.31, to: 43, dur: 1.2, gain: 0.22, type: "sine", attack: 0.03 });
    this.mix!.duckAll(0.6, 0.6);
    this.music?.stinger("lose");
  }

  /**
   * Near-death pulse. Call every frame with 0..1 (how close to dead); it paces itself,
   * speeding up as it goes, and stops the moment you stop asking.
   */
  heartbeat(intensity: number) {
    const mix = this.mix;
    if (!mix || intensity <= 0.02) return;
    const i = clamp(intensity, 0, 1);
    const now = mix.now;
    if (now < this.nextBeat) return;
    this.nextBeat = now + 1.0 - i * 0.5;
    const s = this.grab("ui", "heart", 0.2 + i * 0.35, 0.42, null, 2, 6);
    if (!s) return;
    // Two thumps, the second softer and a beat behind: lub-dub, not a metronome.
    this.tone(s, { freq: 62, to: 34, dur: 0.16, gain: 0.28 + i * 0.3, type: "sine", attack: 0.008 });
    this.tone(s, { freq: 54, to: 30, dur: 0.2, gain: 0.18 + i * 0.2, type: "sine", attack: 0.01, delay: 0.16 });
  }

  /** Something catching light: a short, soft whump. */
  ignite(at?: V | null) {
    const s = this.grab("impact", "ignite", 0.18, 0.4, at, 0.6);
    if (!s) return;
    this.noise(s, { dur: 0.35, gain: 0.16, freq: 300, sweepTo: 900, q: 0.9, type: "bandpass", attack: 0.05 });
  }

  /** Water hitting fire. */
  steam(at?: V | null) {
    const s = this.grab("impact", "steam", 0.12, 1.2, at, 0.4, 3);
    if (!s) return;
    this.noise(s, { dur: rand(0.6, 1.2), gain: 0.11, freq: 4200, q: 0.8, type: "highpass", attack: 0.05 });
  }

  /** Water hitting anything else. */
  splash(strength = 1, at?: V | null) {
    const s = this.grab("impact", "splash", 0.12 * strength, 0.3, at, 0.5, 2);
    if (!s) return;
    this.noise(s, { dur: 0.24 * strength, gain: 0.1 * strength, freq: 1800, sweepTo: 600, q: 0.7, type: "bandpass" });
  }

  ricochet(at?: V | null) {
    const s = this.grab("impact", "ricochet", 0.14, 0.2, at, 0.8);
    if (!s) return;
    const f = rand(1400, 3200);
    this.tone(s, { freq: f, to: f * rand(0.25, 0.5), dur: 0.16, gain: 0.11, type: "square" });
  }

  whoosh(strength = 1, at?: V | null) {
    const s = this.grab("weapon", "whoosh", 0.13 * strength, 0.35, at, 0.7);
    if (!s) return;
    this.noise(s, { dur: 0.3 * strength, gain: 0.11 * strength, freq: 420, sweepTo: 2400, q: 1.6, type: "bandpass", attack: 0.06 });
  }

  /** Grand piano landing on a building: an actual chord, then the frame letting go. */
  pianoCrash(at?: V | null) {
    const s = this.grab("big", "piano", 0.5, 1.7, at, 2);
    if (!s) return;
    const root = pick([110, 130.81, 146.83, 164.81]);
    for (const mult of [1, 1.19, 1.5, 2, 2.38]) {
      this.tone(s, { freq: root * mult * rand(0.99, 1.01), dur: rand(0.8, 1.6), gain: 0.1, type: "triangle" });
    }
    this.noise(s, { dur: 0.5, gain: 0.18, freq: 3000, sweepTo: 300, q: 0.8 });
    this.tone(s, { freq: 90, to: 30, dur: 0.4, gain: 0.34, type: "sine" });
  }

  jetEngine(at?: V | null) {
    const s = this.grab("weapon", "jet", 0.28, 1.5, at, 1.6);
    if (!s) return;
    this.noise(s, { dur: 1.4, gain: 0.16, freq: 700, sweepTo: 2200, q: 2.4, type: "bandpass", attack: 0.25 });
    this.tone(s, { freq: 90, to: 150, dur: 1.4, gain: 0.1, type: "sawtooth", attack: 0.3 });
  }

  rocketLaunch(at?: V | null) {
    const s = this.grab("weapon", "rocket", 0.3, 1.2, at, 1.5);
    if (!s) return;
    this.noise(s, { dur: 1.1, gain: 0.2, freq: 400, sweepTo: 1600, q: 1.2, attack: 0.05 });
    this.tone(s, { freq: 120, to: 50, dur: 0.35, gain: 0.24, type: "sine" });
  }

  nuke(at?: V | null) {
    const s = this.grab("big", "nuke", 1, 3.8, at, 8);
    if (!s) return;
    this.noise(s, { dur: 3.2, gain: 0.6, freq: 2600, sweepTo: 40, q: 0.5, attack: 0.001 });
    this.tone(s, { freq: 70, to: 12, dur: 3.4, gain: 0.6, type: "sine" });
    this.tone(s, { freq: 33, to: 9, dur: 3.6, gain: 0.5, type: "triangle" });
    // The long roll of everything within a mile of it falling over.
    this.noise(s, { dur: 2.6, gain: 0.22, freq: 500, sweepTo: 120, q: 0.5, attack: 0.4, delay: 0.5 });
    // Nothing else gets to be heard for the first second. This is the moment the whole
    // dynamic mix exists for.
    this.mix!.duckAll(0.85, 1.1);
  }

  blackhole(at?: V | null) {
    const s = this.grab("big", "blackhole", 0.35, 2.8, at, 2);
    if (!s) return;
    this.tone(s, { freq: 40, to: 620, dur: 2.6, gain: 0.22, type: "sawtooth", attack: 0.6 });
    this.noise(s, { dur: 2.6, gain: 0.14, freq: 200, sweepTo: 3400, q: 4, type: "bandpass", attack: 0.5 });
  }

  saw(at?: V | null) {
    const s = this.grab("impact", "saw", 0.16, 0.3, at, 0.9);
    if (!s) return;
    this.tone(s, { freq: rand(700, 1100), to: rand(300, 500), dur: 0.25, gain: 0.1, type: "sawtooth" });
    this.noise(s, { dur: 0.25, gain: 0.12, freq: 4200, q: 3, type: "bandpass" });
  }

  // --------------------------------------------------------- sustained sources

  private jetGain: GainNode | null = null;
  private jetFilter: BiquadFilterNode | null = null;
  private jetTone: OscillatorNode | null = null;

  /**
   * Continuous jetpack roar. Call every frame with a 0..1 throttle; 0 fades it out.
   *
   * Unlike every other sound here this is a persistent graph rather than a one-shot.
   * It is built once and then left running with its gain modulated — starting and
   * stopping a source every frame clicks, and juggling the lifecycle is where looping
   * WebAudio usually goes wrong. For the same reason loops bypass the voice allocator:
   * there is nothing to allocate, and they must never be stolen.
   */
  jetpack(throttle: number) {
    const mix = this.mix;
    if (!mix) return;
    const t = clamp(throttle, 0, 1);

    if (!this.jetGain) {
      if (t <= 0.001) return; // don't build the graph until it's first needed
      const c = mix.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;

      const filter = c.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 700;
      filter.Q.value = 0.9;

      const gain = c.createGain();
      gain.gain.value = 0.0001;

      // A low sawtooth under the noise gives it body rather than just hiss.
      const tone = c.createOscillator();
      tone.type = "sawtooth";
      tone.frequency.value = 70;
      const toneGain = c.createGain();
      toneGain.gain.value = 0.35;

      src.connect(filter);
      filter.connect(gain);
      tone.connect(toneGain);
      toneGain.connect(gain);
      gain.connect(mix.loopBus);
      src.start();
      tone.start();

      this.jetGain = gain;
      this.jetFilter = filter;
      this.jetTone = tone;
    }

    const now = mix.now;
    // setTargetAtTime gives a smooth exponential ramp without scheduling a new
    // automation event per frame.
    this.jetGain.gain.setTargetAtTime(t <= 0.001 ? 0.0001 : 0.05 + t * 0.13, now, 0.04);
    this.jetFilter!.frequency.setTargetAtTime(600 + t * 1900, now, 0.06);
    this.jetTone!.frequency.setTargetAtTime(62 + t * 46, now, 0.08);
  }

  /**
   * The two continuous weapon loops. Both follow the jetpack's pattern: one noise
   * source built lazily on first use and then only automated, because scheduling a
   * fresh voice every frame at 60 fps is what turns a sound engine into a crackle.
   */
  private loop(
    which: "hose" | "flame",
    level: number,
    build: () => { gain: GainNode; filter: BiquadFilterNode },
    tune: (g: GainNode, f: BiquadFilterNode, t: number, now: number) => void,
  ) {
    if (!this.mix) return;
    const t = clamp(level, 0, 1);
    let node = this.loops[which];
    if (!node) {
      if (t <= 0.001) return;
      node = this.loops[which] = build();
    }
    tune(node.gain, node.filter, t, this.mix.now);
  }

  private loops: Partial<Record<"hose" | "flame", { gain: GainNode; filter: BiquadFilterNode }>> = {};

  /** Pressurised water: broadband hiss with a hollow, rushing band on top. */
  hose(level: number) {
    this.loop("hose", level, () => {
      const c = this.mix!.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2400;
      filter.Q.value = 0.7;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.mix!.loopBus);
      src.start();
      return { gain, filter };
    }, (g, f, t, now) => {
      g.gain.setTargetAtTime(t <= 0.001 ? 0.0001 : 0.04 + t * 0.12, now, 0.05);
      f.frequency.setTargetAtTime(1600 + t * 2200, now, 0.08);
    });
  }

  /** Burning gas: a low roar, not a hiss. */
  flamethrower(level: number) {
    this.loop("flame", level, () => {
      const c = this.mix!.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      filter.Q.value = 1.6;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.mix!.loopBus);
      src.start();
      return { gain, filter };
    }, (g, f, t, now) => {
      g.gain.setTargetAtTime(t <= 0.001 ? 0.0001 : 0.05 + t * 0.16, now, 0.05);
      f.frequency.setTargetAtTime(420 + t * 1100, now, 0.07);
    });
  }

  /** Corrosive rain on stone — a wet sizzle, not a splash. */
  acidHiss(at?: V | null) {
    const s = this.grab("impact", "acid", 0.06, 1.1, at, 0.3, 5);
    if (!s) return;
    this.noise(s, { dur: rand(0.5, 1.1), gain: 0.05, freq: 5200, q: 0.7, type: "highpass", attack: 0.2 });
  }

  /** Wind for exposed worlds. */
  wind(strength = 1) {
    const s = this.grab("impact", "wind", 0.05 * strength, 2.4, null, 0.25, 20);
    if (!s) return;
    this.noise(s, { dur: 2.4, gain: 0.045 * strength, freq: 380, sweepTo: 180, q: 1.4, type: "bandpass", attack: 0.9 });
  }

  /** Ammo swap / UI blip. */
  ui(up = true) {
    const s = this.grab("ui", "ui", 0.12, 0.12, null, 1.2);
    if (!s) return;
    this.tone(s, { freq: up ? 620 : 480, to: up ? 900 : 340, dur: 0.08, gain: 0.09, type: "square" });
  }

  /** Generic positive chime — level start, respawn, anything that went right. */
  levelUp() {
    const s = this.grab("ui", "levelup", 0.4, 0.8, null, 2);
    if (!s) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(s, { freq: f, dur: 0.22, gain: 0.13, type: "triangle", delay: i * 0.075 });
    });
  }
}

export const sfx = new Sfx();
