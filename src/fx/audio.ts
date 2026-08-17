import { clamp, pick, rand } from "../core/math";

/**
 * Everything is synthesised at runtime — no audio files, so the whole game stays a
 * sub-2MB download and there is nothing to preload before the first shot.
 *
 * Browsers block audio until a gesture, so `unlock()` is wired to the first click/key.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private voices = 0;
  muted = false;
  volume = 0.75;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // Two seconds of white noise, reused by every percussive sound.
    const n = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(vol: number) {
    this.volume = clamp(vol, 0, 1);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  private get t() {
    return this.ctx!.currentTime;
  }

  /** Guard against effect storms (a collapsing tower can fire hundreds of events a frame). */
  private budget(cost = 1) {
    if (!this.ctx || this.muted) return false;
    if (this.voices > 26) return false;
    this.voices += cost;
    setTimeout(() => (this.voices = Math.max(0, this.voices - cost)), 220);
    return true;
  }

  // ------------------------------------------------------------- primitives

  private env(gain: number, attack: number, dur: number, curve: "exp" | "lin" = "exp") {
    const g = this.ctx!.createGain();
    const t = this.t;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (curve === "exp") g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }

  private noise(opts: {
    dur: number; gain: number; freq: number; q?: number;
    type?: BiquadFilterType; sweepTo?: number; attack?: number;
  }) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.85, 1.15);

    const f = c.createBiquadFilter();
    f.type = opts.type ?? "lowpass";
    f.frequency.setValueAtTime(opts.freq, this.t);
    if (opts.sweepTo !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.sweepTo), this.t + opts.dur);
    }
    f.Q.value = opts.q ?? 1;

    const g = this.env(opts.gain, opts.attack ?? 0.004, opts.dur);
    src.connect(f);
    f.connect(g);
    src.start();
    src.stop(this.t + opts.dur + 0.05);
  }

  private tone(opts: {
    freq: number; dur: number; gain: number;
    type?: OscillatorType; to?: number; attack?: number; detune?: number;
    vibrato?: { rate: number; depth: number };
  }) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(opts.freq, this.t);
    if (opts.to !== undefined) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), this.t + opts.dur);
    }
    if (opts.detune) o.detune.value = opts.detune;

    if (opts.vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = opts.vibrato.rate;
      lg.gain.value = opts.vibrato.depth;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start();
      lfo.stop(this.t + opts.dur + 0.05);
    }

    const g = this.env(opts.gain, opts.attack ?? 0.005, opts.dur);
    o.connect(g);
    o.start();
    o.stop(this.t + opts.dur + 0.05);
  }

  // ------------------------------------------------------------- game sounds

  /** `heft` 0..1 — a chicken pops, an elephant detonates. */
  shoot(heft: number) {
    if (!this.budget()) return;
    const h = clamp(heft, 0, 1);
    this.noise({ dur: 0.1 + h * 0.22, gain: 0.28 + h * 0.4, freq: 2600 - h * 1500, sweepTo: 180, q: 1.2 });
    this.tone({ freq: 190 - h * 100, to: 42, dur: 0.12 + h * 0.3, gain: 0.3 + h * 0.35, type: "square" });
  }

  explode(size: number) {
    if (!this.budget(2)) return;
    const s = clamp(size, 0.2, 3);
    this.noise({ dur: 0.5 + s * 0.5, gain: 0.5, freq: 900 * s, sweepTo: 60, q: 0.7, attack: 0.002 });
    this.tone({ freq: 120 / s, to: 24, dur: 0.5 + s * 0.45, gain: 0.55, type: "sine" });
    this.tone({ freq: 60 / s, to: 18, dur: 0.7 + s * 0.5, gain: 0.4, type: "triangle" });
  }

  /** Generic collision. `mat` picks the timbre so wood/glass/metal read differently. */
  thud(strength: number, mat: "wood" | "stone" | "glass" | "metal" | "flesh" = "stone") {
    if (!this.budget()) return;
    const s = clamp(strength, 0.05, 1);
    switch (mat) {
      case "wood":
        this.noise({ dur: 0.09 + s * 0.1, gain: 0.16 * s + 0.04, freq: 1500, sweepTo: 300, q: 2.5 });
        this.tone({ freq: rand(160, 260), to: 70, dur: 0.09, gain: 0.14 * s, type: "triangle" });
        break;
      case "glass":
        this.noise({ dur: 0.16 + s * 0.2, gain: 0.16 * s + 0.03, freq: 5200, q: 0.8, type: "highpass" });
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: rand(2200, 5200), to: rand(1400, 3000), dur: rand(0.08, 0.2), gain: 0.06 * s, type: "sine" });
        }
        break;
      case "metal":
        this.tone({ freq: rand(420, 900), to: rand(200, 380), dur: 0.4 + s * 0.4, gain: 0.14 * s, type: "square" });
        this.tone({ freq: rand(1400, 2600), dur: 0.3, gain: 0.06 * s, type: "sine" });
        break;
      case "flesh":
        this.noise({ dur: 0.11, gain: 0.2 * s, freq: 620, sweepTo: 110, q: 1.4 });
        break;
      default:
        this.noise({ dur: 0.12 + s * 0.14, gain: 0.2 * s + 0.04, freq: 700, sweepTo: 90, q: 1.1 });
        this.tone({ freq: rand(70, 120), to: 38, dur: 0.14, gain: 0.18 * s, type: "sine" });
    }
  }

  cluck() {
    if (!this.budget()) return;
    const base = rand(620, 900);
    this.tone({ freq: base, to: base * 1.7, dur: 0.06, gain: 0.16, type: "sawtooth" });
    setTimeout(() => {
      if (!this.ctx) return;
      this.tone({ freq: base * 1.3, to: base * 0.6, dur: 0.1, gain: 0.13, type: "sawtooth" });
    }, 70);
  }

  moo() {
    if (!this.budget()) return;
    this.tone({
      freq: rand(150, 190), to: rand(95, 125), dur: 0.75, gain: 0.24, type: "sawtooth",
      vibrato: { rate: 7, depth: 9 },
    });
  }

  trumpet() {
    if (!this.budget(2)) return;
    this.tone({
      freq: rand(230, 290), to: rand(430, 520), dur: 0.65, gain: 0.3, type: "sawtooth",
      vibrato: { rate: 12, depth: 22 },
    });
    this.noise({ dur: 0.6, gain: 0.1, freq: 900, q: 3 });
  }

  scream() {
    if (!this.budget()) return;
    this.tone({
      freq: rand(500, 760), to: rand(230, 340), dur: rand(0.5, 0.9), gain: 0.16, type: "sawtooth",
      vibrato: { rate: rand(14, 22), depth: 40 },
    });
  }

  splat() {
    if (!this.budget()) return;
    this.noise({ dur: 0.22, gain: 0.3, freq: 1200, sweepTo: 120, q: 0.6 });
    this.tone({ freq: 220, to: 46, dur: 0.2, gain: 0.16, type: "sine" });
  }

  ricochet() {
    if (!this.budget()) return;
    const f = rand(1400, 3200);
    this.tone({ freq: f, to: f * rand(0.25, 0.5), dur: 0.16, gain: 0.11, type: "square" });
  }

  whoosh(strength = 1) {
    if (!this.budget()) return;
    this.noise({ dur: 0.3 * strength, gain: 0.11 * strength, freq: 420, sweepTo: 2400, q: 1.6, type: "bandpass", attack: 0.06 });
  }

  /** Grand piano landing on a building: an actual chord, then the frame letting go. */
  pianoCrash() {
    if (!this.budget(3)) return;
    const root = pick([110, 130.81, 146.83, 164.81]);
    for (const mult of [1, 1.19, 1.5, 2, 2.38]) {
      this.tone({ freq: root * mult * rand(0.99, 1.01), dur: rand(0.8, 1.6), gain: 0.1, type: "triangle" });
    }
    this.noise({ dur: 0.5, gain: 0.18, freq: 3000, sweepTo: 300, q: 0.8 });
  }

  jetEngine() {
    if (!this.budget(2)) return;
    this.noise({ dur: 1.4, gain: 0.16, freq: 700, sweepTo: 2200, q: 2.4, type: "bandpass", attack: 0.25 });
    this.tone({ freq: 90, to: 150, dur: 1.4, gain: 0.1, type: "sawtooth", attack: 0.3 });
  }

  rocketLaunch() {
    if (!this.budget(2)) return;
    this.noise({ dur: 1.1, gain: 0.2, freq: 400, sweepTo: 1600, q: 1.2, attack: 0.05 });
  }

  nuke() {
    if (!this.budget(4)) return;
    this.noise({ dur: 3.2, gain: 0.6, freq: 2600, sweepTo: 40, q: 0.5, attack: 0.001 });
    this.tone({ freq: 70, to: 12, dur: 3.4, gain: 0.6, type: "sine" });
    this.tone({ freq: 33, to: 9, dur: 3.6, gain: 0.5, type: "triangle" });
  }

  blackhole() {
    if (!this.budget(2)) return;
    this.tone({ freq: 40, to: 620, dur: 2.6, gain: 0.22, type: "sawtooth", attack: 0.6 });
    this.noise({ dur: 2.6, gain: 0.14, freq: 200, sweepTo: 3400, q: 4, type: "bandpass", attack: 0.5 });
  }

  saw() {
    if (!this.budget()) return;
    this.tone({ freq: rand(700, 1100), to: rand(300, 500), dur: 0.25, gain: 0.1, type: "sawtooth" });
    this.noise({ dur: 0.25, gain: 0.12, freq: 4200, q: 3, type: "bandpass" });
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
   * WebAudio usually goes wrong.
   */
  jetpack(throttle: number) {
    if (!this.ctx) return;
    const t = clamp(throttle, 0, 1);

    if (!this.jetGain) {
      if (t <= 0.001) return; // don't build the graph until it's first needed
      const c = this.ctx;
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
      gain.connect(this.master);
      src.start();
      tone.start();

      this.jetGain = gain;
      this.jetFilter = filter;
      this.jetTone = tone;
    }

    const now = this.t;
    // setTargetAtTime gives a smooth exponential ramp without scheduling a new
    // automation event per frame.
    this.jetGain.gain.setTargetAtTime(t <= 0.001 ? 0.0001 : 0.05 + t * 0.13, now, 0.04);
    this.jetFilter!.frequency.setTargetAtTime(600 + t * 1900, now, 0.06);
    this.jetTone!.frequency.setTargetAtTime(62 + t * 46, now, 0.08);
  }

  /** Corrosive rain on stone — a wet sizzle, not a splash. */
  acidHiss() {
    if (!this.budget()) return;
    this.noise({ dur: rand(0.5, 1.1), gain: 0.05, freq: 5200, q: 0.7, type: "highpass", attack: 0.2 });
  }

  /** Wind for exposed worlds. */
  wind(strength = 1) {
    if (!this.budget()) return;
    this.noise({ dur: 2.4, gain: 0.045 * strength, freq: 380, sweepTo: 180, q: 1.4, type: "bandpass", attack: 0.9 });
  }

  /** Ammo swap / UI blip. */
  ui(up = true) {
    if (!this.budget()) return;
    this.tone({ freq: up ? 620 : 480, to: up ? 900 : 340, dur: 0.08, gain: 0.09, type: "square" });
  }

  levelUp() {
    if (!this.budget(3)) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      setTimeout(() => {
        if (this.ctx) this.tone({ freq: f, dur: 0.22, gain: 0.13, type: "triangle" });
      }, i * 75);
    });
  }
}

export const sfx = new Sfx();
