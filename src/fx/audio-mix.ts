import { clamp, type V } from "../core/math";

/**
 * The mix bus and the voice allocator.
 *
 * Two problems live here and they are the same problem. A tower coming down fires
 * hundreds of contact events in a frame; if every one of them builds a node graph the
 * CPU dies, and if every one of them reaches the output the result is a wall of noise
 * where nothing is legible. So every one-shot in the game has to be *granted* a voice
 * before it may make a sound, and the allocator is allowed to say no.
 *
 * The graph:
 *
 *   voice -> lowpass -> panner -> category bus -.
 *                                                +-> duck -> master -> limiter -> out
 *                            ambience (2 combs) -'
 *   big bus ------------------------------------------> master   (never ducked)
 *   music -> musicGain -> musicDuck --------------------> master
 *
 * The lowpass and panner are per-voice because distance has to dull *and* place each
 * sound individually; everything downstream is shared, so the whole mix is a fixed
 * handful of nodes no matter how loud the level gets.
 */

export type Cat = "impact" | "weapon" | "voice" | "ui" | "big";

/**
 * Per-category concurrency. These deliberately sum to more than the pool: the pool is
 * the CPU budget, and the per-category caps only exist to stop one kind of sound
 * starving all the others — twelve simultaneous bricks must not silence the scream.
 */
const CAPS: Record<Cat, number> = { impact: 12, weapon: 6, voice: 5, ui: 3, big: 4 };

/**
 * Minimum spacing between two sounds sharing a key. Identical samples fired a
 * millisecond apart do not sound twice as loud, they comb-filter into a buzz, and this
 * is the cheapest place to prevent it — before any node is created.
 */
const GAP: Record<Cat, number> = { impact: 0.028, weapon: 0.018, voice: 0.06, ui: 0.045, big: 0.05 };

/** How much a category is worth when something has to be thrown away. */
const PRIORITY: Record<Cat, number> = { impact: 1, weapon: 1.15, voice: 1.3, ui: 1.6, big: 3 };

/** Total concurrent one-shots. 24 is the usual sweet spot; the low-end floor is a Chromebook. */
const POOL = 24;

/** Under this a voice is inaudible beneath the rest of the mix, so it never starts. */
const CULL = 0.006;

/** A newcomer must be this much stronger than a sounding voice to take its slot. */
const STEAL_MARGIN = 0.8;

export class Slot {
  readonly input: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly out: AudioNode;
  /** Envelope nodes feeding this slot, so a steal can fade the old voice out cleanly. */
  private readonly attached: GainNode[] = [];

  cat: Cat = "impact";
  /** Perceived importance while sounding: level * priority. Drives stealing. */
  score = 0;
  startAt = 0;
  until = 0;
  private bus: AudioNode | null = null;
  private panner: StereoPannerNode | null = null;

  constructor(ctx: AudioContext) {
    this.input = ctx.createGain();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 20000;
    this.input.connect(this.lp);
    // Safari shipped StereoPanner late enough that a fallback is still cheaper than a
    // support matrix; without it the game is mono, which is a degradation, not a break.
    const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
    if (pan) {
      this.lp.connect(pan);
      this.out = pan;
      this.panner = pan;
    } else {
      this.out = this.lp;
    }
  }

  /** Connect an envelope node into this voice. Always a GainNode so a steal can fade it. */
  attach(g: GainNode) {
    g.connect(this.input);
    this.attached.push(g);
  }

  /** @internal */
  arm(bus: AudioNode, gain: number, cutoff: number, pan: number, now: number, dur: number) {
    if (this.bus !== bus) {
      this.out.disconnect();
      this.out.connect(bus);
      this.bus = bus;
    }
    this.input.gain.cancelScheduledValues(now);
    this.input.gain.setValueAtTime(gain, now);
    this.lp.frequency.setValueAtTime(cutoff, now);
    if (this.panner) this.panner.pan.setValueAtTime(pan, now);
    this.startAt = now;
    this.until = now + dur;
  }

  /**
   * Hands the slot to a louder sound.
   *
   * The outgoing voice is faded on its *own* envelope rather than on the shared slot
   * gain, so the newcomer can start on the same tick with no click and no crossfade
   * bookkeeping. Its oscillators keep running into a silent gain until their own stop
   * time — a few nodes doing nothing for 200ms is far cheaper than the alternative.
   */
  private evict(now: number) {
    for (const g of this.attached) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.setTargetAtTime(0.00001, now, 0.004);
    }
    this.attached.length = 0;
  }

  /** @internal */
  reset(now: number) {
    if (this.attached.length) this.evict(now);
  }
}

export interface Grant {
  cat: Cat;
  /** Key sounds sharing a retrigger window — usually sound name plus material. */
  key: string;
  /** 0..1 intended loudness before distance. Also what the allocator ranks it by. */
  level: number;
  /** Seconds the voice occupies its slot. */
  dur: number;
  /** World position, or null for a non-diegetic sound (UI, music stingers). */
  at?: V | null;
  /** Multiplies the category priority. A kill outranks a pebble. */
  priority?: number;
  /** Scales the retrigger gap; sounds that are *meant* to stack pass < 1. */
  gap?: number;
}

export class Mixer {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** Continuous sources (jetpack, hose, flamethrower) live here — they are not pooled. */
  readonly loopBus: GainNode;
  readonly musicBus: GainNode;

  private readonly duck: GainNode;
  private readonly musicDuck: GainNode;
  private readonly buses: Record<Cat, GainNode>;
  private readonly slots: Slot[] = [];
  private readonly last = new Map<string, number>();

  /** Listener state, pushed once a frame by the game. */
  private lx = 0;
  private ly = 0;
  private half = 24;

  private duckUntil = 0;

  constructor(ctx: AudioContext, volume: number, musicVolume: number) {
    this.ctx = ctx;

    // Brick-wall-ish final stage. The nuke and a hundred bricks now share one ceiling,
    // which is the whole point of having a mix: loud things stay loud by pushing the
    // rest down rather than by clipping the output.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -7;
    limiter.knee.value = 6;
    limiter.ratio.value = 18;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.16;

    // Last line of defence: a soft saturator, so anything that still gets past the
    // limiter's attack rounds over instead of tearing.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
    }
    shaper.curve = curve;
    shaper.oversample = "2x";

    this.master = ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(limiter);
    limiter.connect(shaper);
    shaper.connect(ctx.destination);

    this.duck = ctx.createGain();
    this.duck.connect(this.master);
    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = musicVolume;
    this.musicBus.connect(this.musicDuck);

    const make = (dest: AudioNode) => {
      const g = ctx.createGain();
      g.connect(dest);
      return g;
    };
    this.buses = {
      impact: make(this.duck),
      weapon: make(this.duck),
      voice: make(this.duck),
      ui: make(this.duck),
      // The big bus bypasses the duck: the thing doing the ducking must not duck itself.
      big: make(this.master),
    };
    this.loopBus = make(this.duck);

    // A pair of short combs through one lowpass. Not a reverb — it is a *size* cue, and
    // at six nodes total it costs nothing while making every impact sound like it
    // happened somewhere rather than inside the speaker.
    const send = ctx.createGain();
    send.gain.value = 0.14;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 1900;
    for (const time of [0.037, 0.0591]) {
      const d = ctx.createDelay(0.2);
      d.delayTime.value = time;
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      send.connect(d);
      d.connect(fb);
      fb.connect(d);
      d.connect(tone);
    }
    tone.connect(wet);
    wet.connect(this.duck);
    this.buses.impact.connect(send);
    this.buses.big.connect(send);
  }

  get now() {
    return this.ctx.currentTime;
  }

  /**
   * Where the camera is looking, in world metres. `halfWidth` is half the visible span,
   * so attenuation is expressed in screens rather than in metres and stays correct as
   * the camera zooms out during a rampage.
   */
  listener(x: number, y: number, halfWidth: number) {
    this.lx = x;
    this.ly = y;
    this.half = Math.max(6, halfWidth);
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.now, 0.01);
  }

  setMusicVolume(v: number) {
    this.musicBus.gain.setTargetAtTime(v, this.now, 0.05);
  }

  /**
   * Pulls everything else down so one event owns the moment, then lets it back up.
   *
   * `amount` is how far down (0..1), `hold` how long it stays there before the release.
   * Music ducks harder than SFX because a nuke should silence the soundtrack, not fight it.
   */
  duckAll(amount: number, hold: number) {
    const now = this.now;
    const end = now + hold;
    if (end < this.duckUntil) return;
    this.duckUntil = end;
    const a = clamp(amount, 0, 0.95);
    const sfxTo = 1 - a * 0.75;
    const musicTo = 1 - a;
    for (const [node, to] of [[this.duck, sfxTo], [this.musicDuck, musicTo]] as const) {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(to, now + 0.012);
      node.gain.setValueAtTime(to, end);
      node.gain.setTargetAtTime(1, end, 0.16 + hold * 0.3);
    }
  }

  /**
   * Asks for a voice.
   *
   * Returns null — meaning "do not make this sound at all" — when it retriggered too
   * fast, when distance put it below the audibility floor, or when everything currently
   * sounding matters more than it does. Callers must handle null; that is the contract
   * that keeps the node count bounded.
   */
  acquire(g: Grant): Slot | null {
    const now = this.now;
    const key = g.cat + g.key;
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < GAP[g.cat] * (g.gap ?? 1)) return null;

    let gain = 1;
    let pan = 0;
    let cutoff = 20000;
    if (g.at) {
      const dx = g.at.x - this.lx;
      const dy = g.at.y - this.ly;
      // Distance in screens, not metres: one screen away is "off to the side", three
      // screens away is "somewhere across the level".
      const n = Math.hypot(dx, dy) / (this.half * 1.1);
      gain = 1 / (1 + n * n * 1.35);
      pan = clamp(dx / this.half, -1, 1) * 0.7;
      // Air absorbs treble long before it absorbs level, so distant hits go dull as well
      // as quiet. This one filter is most of what sells depth.
      if (n > 0.55) cutoff = clamp(19000 / (1 + (n - 0.55) * 5.5), 600, 20000);
    }

    const level = g.level * gain;
    if (level < CULL) return null;
    const score = level * PRIORITY[g.cat] * (g.priority ?? 1);

    let free: Slot | null = null;
    let inCat = 0;
    let weakCat: Slot | null = null;
    let weakAny: Slot | null = null;
    let weakCatScore = Infinity;
    let weakAnyScore = Infinity;

    for (const s of this.slots) {
      if (s.until <= now) {
        if (!free) free = s;
        continue;
      }
      // Age discount: a voice most of the way through its tail is nearly free to take.
      const remaining = (s.until - now) / Math.max(0.03, s.until - s.startAt);
      const eff = s.score * (0.4 + 0.6 * remaining);
      if (eff < weakAnyScore) {
        weakAnyScore = eff;
        weakAny = s;
      }
      if (s.cat !== g.cat) continue;
      inCat++;
      if (eff < weakCatScore) {
        weakCatScore = eff;
        weakCat = s;
      }
    }

    let slot: Slot | null = null;
    if (inCat >= CAPS[g.cat]) {
      // At the category cap the replacement has to come from inside the category, or
      // the cap means nothing.
      if (weakCat && weakCatScore < score * STEAL_MARGIN) slot = weakCat;
    } else if (free) {
      slot = free;
    } else if (this.slots.length < POOL) {
      slot = new Slot(this.ctx);
      this.slots.push(slot);
    } else if (weakAny && weakAnyScore < score * STEAL_MARGIN) {
      slot = weakAny;
    }
    if (!slot) return null;

    slot.reset(now);
    slot.cat = g.cat;
    slot.score = score;
    slot.arm(this.buses[g.cat], gain, cutoff, pan, now, g.dur);
    this.last.set(key, now);
    return slot;
  }

  /** Voices currently sounding — surfaced for the debug overlay. */
  get active() {
    const now = this.now;
    let n = 0;
    for (const s of this.slots) if (s.until > now) n++;
    return n;
  }
}
