import { clamp } from "../core/math";
import { drum } from "./audio-dsp";

/**
 * The generative score.
 *
 * A destruction sandbox has no scenes and no cutscenes, so there is nothing for a
 * composed loop to be *timed* to — and a two-minute loop heard for the twentieth time in
 * a session is worse than silence. This is a step sequencer instead: fixed harmony,
 * layers that arm and disarm with how much carnage is happening, and patterns re-picked
 * every eight bars so the same music never plays twice while always being the same music.
 *
 * The player controls the arrangement by playing. Idle in a corner and it is a drone;
 * chain twenty kills and the kit, the bass and the lead have all arrived. That is the
 * whole design: the soundtrack is a scoreboard.
 *
 * Cost: one 25ms timer, a handful of permanent nodes for the pad, and two or three
 * short-lived nodes per note — roughly a dozen node creations a second at full tilt,
 * which is two orders of magnitude below the impact path.
 */

export type Mood = "menu" | "combat" | "result";

/** Natural minor with the flat second available — cheap menace, still consonant. */
const SCALE = [0, 2, 3, 5, 7, 8, 10];
/** Semitone offsets of the tonic per two-bar cell. Picked per phrase. */
const PROGRESSIONS = [
  [0, 0, 8, 5],
  [0, 8, 5, 3],
  [0, 0, 10, 8],
  [0, 5, 3, 10],
];

/** 16 sixteenths per bar. Higher-index patterns are denser. */
const KICK = [
  0b1000000010000000,
  0b1000001010000000,
  0b1000001010001000,
  0b1000101010001001,
];
const SNARE = [
  0b0000100000001000,
  0b0000100000001001,
  0b0000100010001010,
];
const HAT = [
  0b1010101010101010,
  0b1011101010111010,
  0b1111111111111111,
];
/** Bass rhythms. Driving eighths at rest, sixteenth-note gallops when it gets loud. */
const BASS = [
  0b1000100010001000,
  0b1010100010101000,
  0b1010101010101010,
  0b1011101010111010,
];

const bit = (pattern: number, step: number) => (pattern >> (15 - step)) & 1;

/** A1 = 55Hz is the root octave; everything is expressed in semitones above it. */
const hz = (semi: number) => 55 * Math.pow(2, semi / 12);

export class Music {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly padGain: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private readonly padOsc: OscillatorNode[] = [];
  private readonly subOsc: OscillatorNode;
  private readonly leadDelay: DelayNode;
  private readonly drumBus: GainNode;

  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private running = false;
  private muted = false;

  /** 0..1, what the game asked for, and what we are actually playing. */
  private target = 0;
  private level = 0;
  private mood: Mood = "menu";

  /** Pattern indices for the current phrase, re-rolled every eight bars. */
  private prog = 0;
  private kick = 0;
  private snare = 0;
  private hat = 0;
  private bass = 0;
  /** One bar in eight is allowed to drop out, so the loop breathes. */
  private breakBar = -1;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 1;
    this.drumBus.connect(this.out);

    // The pad is permanent: three detuned saws and a sub, retuned on chord changes.
    // Rebuilding it per chord would be four node graphs every two bars for a sound that
    // is supposed to be continuous.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 400;
    this.padFilter.Q.value = 3;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0001;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.out);

    for (const [semi, detune] of [[12, -7], [12, 8], [19, 4]] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz(semi);
      o.detune.value = detune;
      o.connect(this.padFilter);
      o.start();
      this.padOsc.push(o);
    }
    this.subOsc = ctx.createOscillator();
    this.subOsc.type = "sine";
    this.subOsc.frequency.value = hz(0);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.55;
    this.subOsc.connect(subGain);
    subGain.connect(this.padGain);
    this.subOsc.start();

    // A dotted-eighth-ish echo on the lead only. One delay line for the whole score.
    this.leadDelay = ctx.createDelay(1);
    this.leadDelay.delayTime.value = 0.27;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2600;
    this.leadDelay.connect(damp);
    damp.connect(fb);
    fb.connect(this.leadDelay);
    damp.connect(this.out);

    this.roll();
  }

  // ---------------------------------------------------------------- public API

  start() {
    if (this.running) return;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.12;
    this.step = 0;
    this.padGain.gain.setTargetAtTime(0.09, this.ctx.currentTime, 1.4);
    // A 25ms poll with a 140ms lookahead: the standard WebAudio scheduling shape, and
    // the only one that survives the main thread stalling on a physics spike.
    this.timer = setInterval(this.tick, 25) as unknown as number;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.padGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
  }

  /** 0 = idle drone, 1 = everything playing at once. Smoothed internally. */
  setIntensity(v: number) {
    this.target = clamp(v, 0, 1);
  }

  get intensity() {
    return this.level;
  }

  /**
   * The menu and the results card get a ceiling rather than a different score, so the
   * transition into gameplay is the arrangement opening up rather than a track change.
   */
  setMood(m: Mood) {
    this.mood = m;
  }

  setMuted(m: boolean) {
    this.muted = m;
  }

  /** A short harmonic flourish over the top of whatever is currently playing. */
  stinger(kind: "win" | "lose" | "reward") {
    if (!this.running || this.muted) return;
    const t = this.ctx.currentTime + 0.02;
    const root = PROGRESSIONS[this.prog][0];
    const notes = kind === "lose"
      ? [24, 20, 17, 12]
      : kind === "reward"
        ? [24, 28, 31, 36]
        : [24, 31, 36, 40];
    notes.forEach((n, i) => {
      const semi = kind === "lose" ? n : n + root;
      this.pluck(t + i * 0.11, hz(semi), 0.55, kind === "lose" ? "triangle" : "square", 0.5);
    });
  }

  dispose() {
    this.stop();
    for (const o of this.padOsc) o.stop();
    this.subOsc.stop();
  }

  // ---------------------------------------------------------------- sequencer

  /** Re-rolls the arrangement for the next eight-bar phrase. */
  private roll() {
    const r = () => Math.random();
    this.prog = (r() * PROGRESSIONS.length) | 0;
    // Density follows intensity, with one step of slack either way so two phrases at the
    // same intensity are never identical.
    const d = this.level;
    const pickBy = (arr: readonly unknown[]) =>
      clamp(Math.round(d * (arr.length - 1) + (r() - 0.5)), 0, arr.length - 1);
    this.kick = pickBy(KICK);
    this.snare = pickBy(SNARE);
    this.hat = pickBy(HAT);
    this.bass = pickBy(BASS);
    this.breakBar = d < 0.55 && r() < 0.6 ? 7 : -1;
  }

  private get bpm() {
    const ceiling = this.mood === "combat" ? 1 : 0.45;
    return 90 + Math.min(this.level, ceiling) * 56;
  }

  private tick = () => {
    if (!this.running) return;
    const ctx = this.ctx;
    // The context clock freezes while suspended (hidden tab). Snapping the cursor
    // forward on resume stops the scheduler from firing a hundred backlogged steps.
    if (ctx.currentTime > this.nextTime + 1) this.nextTime = ctx.currentTime + 0.05;

    this.level += (this.target - this.level) * 0.05;
    const cap = this.mood === "combat" ? 1 : this.mood === "menu" ? 0.4 : 0.3;
    const lvl = Math.min(this.level, cap);

    // Pad follows intensity continuously — it is the one layer that never switches on
    // or off, so it carries the "something is happening" signal between the layers.
    const now = ctx.currentTime;
    this.padGain.gain.setTargetAtTime(0.07 + lvl * 0.06, now, 0.5);
    this.padFilter.frequency.setTargetAtTime(
      340 + lvl * 1500 + Math.sin(now * 0.21) * 120, now, 0.35,
    );

    const horizon = now + 0.14;
    while (this.nextTime < horizon) {
      if (!this.muted) this.play(this.step, this.nextTime, lvl);
      this.nextTime += 60 / this.bpm / 4;
      this.step++;
      if (this.step % 128 === 0) this.roll();
    }
  };

  /** One sixteenth. Everything about the arrangement is decided here. */
  private play(step: number, t: number, lvl: number) {
    const s = step % 16;
    const bar = (step >> 4) % 8;
    const cell = (step >> 5) % 4;
    const root = PROGRESSIONS[this.prog][cell];
    const quiet = bar === this.breakBar;

    if (s === 0) {
      // Chord change lands on the bar. The pad glides rather than jumps, which is what
      // keeps a hard-cut progression from sounding like a tape splice.
      const base = [root + 12, root + 12, root + 19];
      this.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(hz(base[i]), t, 0.08));
      this.subOsc.frequency.setTargetAtTime(hz(root), t, 0.08);
    }

    if (lvl > 0.05 && !quiet && bit(KICK[this.kick], s)) {
      this.hit("kick", t, 0.75 + lvl * 0.25);
    }
    if (lvl > 0.45 && bit(SNARE[this.snare], s)) {
      this.hit(lvl > 0.72 ? "snare" : "clap", t, 0.34 + lvl * 0.2);
    }
    if (lvl > 0.32 && !quiet && bit(HAT[this.hat], s)) {
      // Alternating accents stop a straight sixteenth hat from sounding like a buzz.
      this.hit("hat", t, (s % 4 === 0 ? 0.3 : 0.16) * (0.6 + lvl));
    }
    if (lvl > 0.8 && s === 14 && bar % 2 === 1) {
      this.hit("tom", t, 0.4);
      this.hit("tom", t + 60 / this.bpm / 8, 0.36);
    }

    if (lvl > 0.16 && !quiet && bit(BASS[this.bass], s)) {
      // Root most of the time, with the fifth and the flat seventh as passing notes —
      // enough movement to be a line, little enough to never fight the impacts.
      const degree = s === 0 ? 0 : s % 8 === 6 ? 4 : s % 12 === 10 ? 6 : 0;
      this.bassNote(t, hz(root + SCALE[degree]), 0.2 + lvl * 0.22, 60 / this.bpm / 4);
    }

    if (lvl > 0.6 && s % 2 === 0) {
      // A four-note figure over two bars, transposed by the chord. Sparse on purpose:
      // the lead is a garnish, and anything busier competes with the destruction.
      const idx = (step >> 1) % 8;
      if (idx === 0 || idx === 3 || idx === 5) {
        const degree = idx === 0 ? 0 : idx === 3 ? 2 : 4;
        this.pluck(t, hz(root + 24 + SCALE[degree]), 0.1 + (lvl - 0.6) * 0.3, "square", 0.28);
      }
    }
  }

  // ------------------------------------------------------------------- voices

  private hit(id: "kick" | "snare" | "hat" | "tom" | "clap", t: number, gain: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = drum(this.ctx, id);
    // Percussion is the one place a fixed sample is obvious, so every hit is detuned a
    // little. Free variation for the cost of a float.
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.drumBus);
    src.start(t);
  }

  private bassNote(t: number, freq: number, gain: number, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.value = freq * 0.5;
    o2.detune.value = 6;

    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 7;
    // The filter sweep *is* the bass sound: a static lowpass on a saw is a drone, a
    // per-note decaying one is a plucked synth bass.
    f.frequency.setValueAtTime(freq * 9, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(90, freq * 2), t + dur * 1.2);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.5);

    o.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(this.out);
    o.start(t);
    o2.start(t);
    o.stop(t + dur * 1.6);
    o2.stop(t + dur * 1.6);
  }

  private pluck(t: number, freq: number, gain: number, type: OscillatorType, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.leadDelay);
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
