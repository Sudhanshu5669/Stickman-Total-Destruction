/**
 * Offline sample synthesis.
 *
 * Impacts are the hot path — a collapsing tower can ask for a hundred in a frame — and
 * building a live oscillator/filter graph per hit is the single most expensive thing a
 * WebAudio game can do. So impacts are *baked*: each material/energy tier is rendered
 * once into an AudioBuffer by plain arithmetic on a Float32Array, and playing one costs
 * a BufferSource plus a gain instead of eight nodes and eight automation curves.
 *
 * Nothing here touches the audio graph, so it is all deterministic and testable, and the
 * bake happens lazily on first use of a material — a level that never spawns gold never
 * pays for gold.
 */

export type ImpactId =
  | "wood" | "brick" | "concrete" | "sandstone" | "stone" | "glass" | "ice" | "crystal"
  | "metal" | "gold" | "hull" | "explosive" | "flesh" | "biomass";

/** 0 = tap, 1 = solid hit, 2 = something structural giving way. */
export type Tier = 0 | 1 | 2;

/**
 * A material's acoustic fingerprint.
 *
 * The layering is the standard three-part impact recipe and each part does one job:
 * `tick` is the attack transient that tells you *when* it happened, `modes` are the
 * resonances that tell you *what* it is, `grit` is the debris/scrape that tells you it
 * broke, and `thump` is the sub that tells you how much it weighed. Change one layer and
 * only one property of the sound changes, which is what makes the table tunable.
 */
interface Voice {
  /** Modal resonances: [Hz, amplitude, decay seconds]. Inharmonic ratios read as metal. */
  modes: readonly (readonly [number, number, number])[];
  /** Attack transient — a very short band of noise. */
  tick: { freq: number; q: number; decay: number; gain: number };
  /** Rubble, splinters, shards. `sweep` is the end/start cutoff ratio over the tail. */
  grit: { freq: number; q: number; decay: number; gain: number; sweep: number };
  /** The chest layer: a sine dropping f0 -> f1. */
  thump: { f0: number; f1: number; decay: number; gain: number };
  /** Per-variant random detune of the modes, so repeats never phase-lock. */
  jitter: number;
}

const VOICES: Record<ImpactId, Voice> = {
  // Hollow, damped, a little splintery. Short everything.
  wood: {
    modes: [[186, 1, 0.09], [418, 0.5, 0.06], [792, 0.28, 0.042], [1260, 0.13, 0.03]],
    tick: { freq: 2300, q: 1.1, decay: 0.006, gain: 0.5 },
    grit: { freq: 1000, q: 0.8, decay: 0.06, gain: 0.3, sweep: 0.4 },
    thump: { f0: 150, f1: 66, decay: 0.08, gain: 0.5 },
    jitter: 0.09,
  },
  // Dry and dusty: barely any pitch, all transient and falling rubble.
  brick: {
    modes: [[132, 1, 0.05], [305, 0.36, 0.034]],
    tick: { freq: 1600, q: 0.9, decay: 0.005, gain: 0.55 },
    grit: { freq: 760, q: 0.7, decay: 0.17, gain: 0.5, sweep: 0.3 },
    thump: { f0: 112, f1: 44, decay: 0.14, gain: 0.9 },
    jitter: 0.12,
  },
  // Brick with more mass under it — lower, longer, more rubble.
  concrete: {
    modes: [[96, 1, 0.05], [212, 0.32, 0.03]],
    tick: { freq: 1250, q: 0.8, decay: 0.005, gain: 0.5 },
    grit: { freq: 540, q: 0.65, decay: 0.27, gain: 0.62, sweep: 0.26 },
    thump: { f0: 90, f1: 33, decay: 0.24, gain: 1.15 },
    jitter: 0.12,
  },
  // Crumbly: the grit layer dominates and the tone barely survives the attack.
  sandstone: {
    modes: [[118, 0.7, 0.04]],
    tick: { freq: 1400, q: 0.6, decay: 0.005, gain: 0.42 },
    grit: { freq: 900, q: 0.55, decay: 0.22, gain: 0.72, sweep: 0.22 },
    thump: { f0: 100, f1: 40, decay: 0.16, gain: 0.85 },
    jitter: 0.14,
  },
  stone: {
    modes: [[110, 1, 0.05], [258, 0.34, 0.032]],
    tick: { freq: 1450, q: 0.85, decay: 0.005, gain: 0.52 },
    grit: { freq: 640, q: 0.7, decay: 0.2, gain: 0.55, sweep: 0.28 },
    thump: { f0: 100, f1: 38, decay: 0.19, gain: 1 },
    jitter: 0.12,
  },
  // High, inharmonic, long — and almost no low end, because glass has no mass.
  glass: {
    modes: [[2620, 1, 0.24], [3910, 0.75, 0.19], [5340, 0.55, 0.14], [7180, 0.34, 0.1]],
    tick: { freq: 7200, q: 2.2, decay: 0.004, gain: 0.7 },
    grit: { freq: 4200, q: 0.6, decay: 0.32, gain: 0.42, sweep: 1.7 },
    thump: { f0: 210, f1: 96, decay: 0.05, gain: 0.14 },
    jitter: 0.2,
  },
  // Glass, but heavier and duller: it cracks rather than tinkles.
  ice: {
    modes: [[1420, 1, 0.13], [2260, 0.6, 0.1], [3380, 0.35, 0.07]],
    tick: { freq: 5200, q: 1.8, decay: 0.005, gain: 0.62 },
    grit: { freq: 2600, q: 0.7, decay: 0.2, gain: 0.4, sweep: 0.9 },
    thump: { f0: 170, f1: 70, decay: 0.09, gain: 0.4 },
    jitter: 0.16,
  },
  // Near-harmonic and long: crystal is the only material that rings a *note*, which is
  // what makes the alien world's most valuable block feel like a reward to break.
  crystal: {
    modes: [[1174, 1, 0.6], [1760, 0.6, 0.5], [2349, 0.42, 0.42], [3520, 0.24, 0.3]],
    tick: { freq: 6400, q: 2.4, decay: 0.004, gain: 0.55 },
    grit: { freq: 3800, q: 0.8, decay: 0.34, gain: 0.3, sweep: 1.5 },
    thump: { f0: 190, f1: 88, decay: 0.06, gain: 0.2 },
    jitter: 0.06,
  },
  // Clang: many inharmonic partials, decays measured in half-seconds.
  metal: {
    modes: [[418, 1, 0.55], [713, 0.68, 0.44], [1187, 0.48, 0.36], [1694, 0.32, 0.27], [2540, 0.2, 0.19]],
    tick: { freq: 3900, q: 1.5, decay: 0.005, gain: 0.6 },
    grit: { freq: 2200, q: 1.1, decay: 0.1, gain: 0.24, sweep: 0.7 },
    thump: { f0: 124, f1: 50, decay: 0.11, gain: 0.6 },
    jitter: 0.11,
  },
  // Soft, dense, expensive: a low dull clunk with a coin shimmer riding on top. Deliberately
  // not just "metal but quieter" — the payout block has to be identifiable by ear alone.
  gold: {
    modes: [[276, 1, 0.3], [468, 0.55, 0.24], [905, 0.3, 0.17], [3120, 0.26, 0.34], [4680, 0.14, 0.26]],
    tick: { freq: 5400, q: 2, decay: 0.005, gain: 0.4 },
    grit: { freq: 3000, q: 1.2, decay: 0.14, gain: 0.16, sweep: 1.2 },
    thump: { f0: 104, f1: 40, decay: 0.21, gain: 1.05 },
    jitter: 0.05,
  },
  // Pressurised panelling: oil-drum boom plus escaping air.
  hull: {
    modes: [[158, 1, 0.32], [307, 0.6, 0.26], [543, 0.38, 0.2], [880, 0.2, 0.14]],
    tick: { freq: 3000, q: 1.2, decay: 0.005, gain: 0.5 },
    grit: { freq: 5200, q: 0.5, decay: 0.28, gain: 0.34, sweep: 1.4 },
    thump: { f0: 108, f1: 42, decay: 0.2, gain: 0.9 },
    jitter: 0.1,
  },
  // A struck barrel that is obviously full of something it should not be.
  explosive: {
    modes: [[224, 1, 0.26], [352, 0.5, 0.2], [601, 0.28, 0.14]],
    tick: { freq: 3400, q: 1.4, decay: 0.005, gain: 0.55 },
    grit: { freq: 900, q: 0.9, decay: 0.16, gain: 0.3, sweep: 0.35 },
    thump: { f0: 132, f1: 27, decay: 0.26, gain: 1.25 },
    jitter: 0.09,
  },
  // Wet slap: no resonance at all, a downward-sweeping squelch, and real low weight.
  flesh: {
    modes: [[92, 0.6, 0.05]],
    tick: { freq: 820, q: 0.7, decay: 0.008, gain: 0.4 },
    grit: { freq: 470, q: 0.5, decay: 0.11, gain: 0.66, sweep: 0.2 },
    thump: { f0: 124, f1: 38, decay: 0.11, gain: 0.85 },
    jitter: 0.18,
  },
  // Flesh with a springy shell — the alien blocks bounce, so they should sound like it.
  biomass: {
    modes: [[168, 0.8, 0.11], [305, 0.35, 0.07]],
    tick: { freq: 1100, q: 0.9, decay: 0.007, gain: 0.42 },
    grit: { freq: 560, q: 0.6, decay: 0.14, gain: 0.5, sweep: 0.24 },
    thump: { f0: 136, f1: 44, decay: 0.13, gain: 0.8 },
    jitter: 0.15,
  },
};

/**
 * Per-tier scaling. The same voice table drives all three, so a tap and a tower collapse
 * are provably the same sound family: only length, low-end weight and pitch move.
 */
const TIERS = [
  { dur: 0.24, decay: 0.5, thump: 0.26, tick: 1.2, grit: 0.65, pitch: 1.14, variants: 3 },
  { dur: 0.52, decay: 1.0, thump: 1.0, tick: 1.0, grit: 1.0, pitch: 1.0, variants: 3 },
  { dur: 1.05, decay: 1.9, thump: 1.75, tick: 0.85, grit: 2.2, pitch: 0.85, variants: 2 },
] as const;

export const tierDuration = (t: Tier) => TIERS[t].dur;

// --------------------------------------------------------------------- primitives

/** Deterministic noise, so a given material/tier/variant always bakes the same sample. */
function lcg(seed: number) {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * One decaying sine, run as a two-pole resonator: three multiplies a sample instead of a
 * `Math.sin` call. A modal bank is most of the cost of a bake, and impacts have up to
 * five modes each.
 */
function addMode(out: Float32Array, sr: number, freq: number, amp: number, decay: number) {
  if (freq >= sr * 0.48) return;
  const w = (Math.PI * 2 * freq) / sr;
  const c = 2 * Math.cos(w);
  const k = Math.exp(-1 / Math.max(1, decay * sr));
  let y2 = 0;
  let y1 = Math.sin(w);
  let env = amp;
  for (let i = 0; i < out.length; i++) {
    out[i] += y2 * env;
    const y = c * y1 - y2;
    y2 = y1;
    y1 = y;
    env *= k;
    if (env < 1e-5) return;
  }
}

/**
 * Band-limited noise with an exponentially sweeping centre frequency — a state-variable
 * filter, coefficients refreshed every 64 samples so the sweep costs no trigonometry.
 */
function addNoise(
  out: Float32Array, sr: number, seed: number,
  freq: number, q: number, decay: number, gain: number, sweep: number, attack = 0,
) {
  const n = out.length;
  const rnd = lcg(seed);
  const k = Math.exp(-1 / Math.max(1, decay * sr));
  const damp = 1 / Math.max(0.5, q);
  const atk = Math.max(1, attack * sr);
  let low = 0;
  let band = 0;
  let env = gain;
  let f = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 63) === 0) {
      const fc = freq * Math.pow(sweep, i / n);
      f = 2 * Math.sin(Math.PI * Math.min(0.47, Math.max(0.0005, fc / sr)));
    }
    const input = rnd() * 2 - 1;
    low += f * band;
    const high = input - low - damp * band;
    band += f * high;
    out[i] += band * env * (i < atk ? i / atk : 1);
    env *= k;
    if (env < 1e-5) return;
  }
}

/** The weight layer: a sine gliding f0 -> f1, phase-accumulated so it never clicks. */
function addThump(out: Float32Array, sr: number, f0: number, f1: number, decay: number, gain: number) {
  const n = out.length;
  const k = Math.exp(-1 / Math.max(1, decay * sr));
  const span = Math.max(1, decay * sr);
  const ratio = f1 / f0;
  let ph = 0;
  let env = gain;
  for (let i = 0; i < n; i++) {
    const f = f0 * Math.pow(ratio, Math.min(1, i / span));
    ph += (Math.PI * 2 * f) / sr;
    out[i] += Math.sin(ph) * env;
    env *= k;
    if (env < 1e-5) return;
  }
}

/**
 * Normalise to a fixed peak and soft-clip.
 *
 * Baking every impact to the same peak is what makes the mix predictable: energy then
 * controls loudness through one gain the mixer can reason about, rather than through
 * whatever amplitude the layers happened to sum to.
 */
function finish(out: Float32Array, peak = 0.92) {
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i] < 0 ? -out[i] : out[i];
    if (a > max) max = a;
  }
  if (max <= 1e-6) return;
  const g = peak / max;
  // A few ms of fade-out: buffers are cut on a tier boundary, not on silence.
  const tail = Math.min(out.length, 220);
  const start = out.length - tail;
  for (let i = 0; i < out.length; i++) {
    let s = out[i] * g;
    if (i >= start) s *= (out.length - i) / tail;
    out[i] = Math.tanh(s * 1.25) * 0.8;
  }
}

// ------------------------------------------------------------------------- bank

const banks = new Map<string, AudioBuffer[]>();

/**
 * Every variant of one material at one energy tier, baked on first request.
 *
 * Several variants per bank is the cheapest possible fix for machine-gun repetition:
 * playback picks one at random and detunes it, so twenty bricks in a second never phase
 * into a single buzzing tone.
 */
export function impactBank(ctx: BaseAudioContext, id: ImpactId, tier: Tier): AudioBuffer[] {
  const key = `${id}${tier}`;
  const cached = banks.get(key);
  if (cached) return cached;

  const voice = VOICES[id];
  const t = TIERS[tier];
  const sr = ctx.sampleRate;
  const n = Math.ceil(t.dur * sr);
  const out: AudioBuffer[] = [];

  for (let vi = 0; vi < t.variants; vi++) {
    const seed = (id.charCodeAt(0) * 733 + id.length * 97 + tier * 31 + vi * 7919) | 0;
    const rnd = lcg(seed);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);

    for (const [f, a, dec] of voice.modes) {
      addMode(d, sr, f * t.pitch * (1 + (rnd() - 0.5) * voice.jitter), a, dec * t.decay);
    }
    const tk = voice.tick;
    addNoise(d, sr, seed + 11, tk.freq * t.pitch, tk.q, tk.decay, tk.gain * t.tick, 0.35);
    const gr = voice.grit;
    addNoise(d, sr, seed + 29, gr.freq, gr.q, gr.decay * t.grit, gr.gain, gr.sweep, 0.002);
    const th = voice.thump;
    addThump(d, sr, th.f0 * t.pitch, th.f1, th.decay * t.decay, th.gain * t.thump);
    finish(d);
    out.push(buf);
  }

  banks.set(key, out);
  return out;
}

/** Dropped on level change so a long session cannot grow an unbounded sample bank. */
export function clearBanks() {
  banks.clear();
}

// ------------------------------------------------------------------- percussion

export type DrumId = "kick" | "snare" | "hat" | "tom" | "clap";

const drums = new Map<string, AudioBuffer>();

/**
 * The kit, baked once. Music runs a note every ~100ms forever, so the drums are the one
 * part of the score that genuinely must not allocate a graph per hit.
 */
export function drum(ctx: BaseAudioContext, id: DrumId, seed = 0): AudioBuffer {
  const key = `${id}${seed}`;
  const cached = drums.get(key);
  if (cached) return cached;

  const sr = ctx.sampleRate;
  const dur = id === "kick" ? 0.42 : id === "tom" ? 0.34 : id === "snare" ? 0.24 : id === "clap" ? 0.22 : 0.07;
  const buf = ctx.createBuffer(1, Math.ceil(dur * sr), sr);
  const d = buf.getChannelData(0);

  switch (id) {
    case "kick":
      addThump(d, sr, 132, 41, 0.16, 1);
      addNoise(d, sr, seed + 3, 2400, 0.8, 0.004, 0.35, 0.4);
      break;
    case "tom":
      addThump(d, sr, 196, 92, 0.14, 0.9);
      addMode(d, sr, 210, 0.3, 0.12);
      addNoise(d, sr, seed + 5, 1800, 0.9, 0.005, 0.25, 0.5);
      break;
    case "snare":
      addMode(d, sr, 186, 0.5, 0.06);
      addMode(d, sr, 331, 0.32, 0.05);
      addNoise(d, sr, seed + 7, 2100, 0.55, 0.09, 0.85, 0.55);
      break;
    case "clap":
      // Three offset bursts: the smear is what separates a clap from a noise blip.
      for (let k = 0; k < 3; k++) {
        const off = Math.round(k * 0.008 * sr);
        addNoise(d.subarray(off), sr, seed + 13 + k, 1500, 0.6, 0.02 + k * 0.03, 0.6 - k * 0.12, 0.7);
      }
      break;
    default:
      addNoise(d, sr, seed + 17, 8200, 0.7, 0.016, 0.7, 0.8);
  }
  finish(d, id === "hat" ? 0.6 : 0.9);
  drums.set(key, buf);
  return buf;
}
