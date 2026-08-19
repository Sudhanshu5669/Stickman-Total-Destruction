export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export interface V {
  x: number;
  y: number;
}

export const v = (x = 0, y = 0): V => ({ x, y });

export const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Frame-rate independent exponential smoothing. `rate` is roughly "units of catch-up per second". */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-rate * dt));

/** Maps `n` from [inLo,inHi] into [outLo,outHi], clamped at both ends. */
export function remap(n: number, inLo: number, inHi: number, outLo: number, outHi: number) {
  if (inHi === inLo) return outLo;
  return clamp(outLo + ((n - inLo) / (inHi - inLo)) * (outHi - outLo), Math.min(outLo, outHi), Math.max(outLo, outHi));
}

export const smoothstep = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/**
 * The source every helper below draws from.
 *
 * Swappable so the daily challenge can build its world from a seeded stream — see
 * `core/rng`. Everything that shapes a *level* goes through these helpers; per-frame
 * effects call `Math.random` directly and are deliberately left out of the seeded
 * stream, since their call count depends on frame rate and would desync the seed.
 */
let source: () => number = Math.random;

/** Replaces the random source. Returns the undo, which callers must always run. */
export function setRandomSource(fn: () => number): () => void {
  const prev = source;
  source = fn;
  return () => {
    source = prev;
  };
}

export const rand = (lo = 0, hi = 1) => lo + source() * (hi - lo);
export const randi = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
export const randSign = () => (source() < 0.5 ? -1 : 1);
export const chance = (p: number) => source() < p;
export const pick = <T,>(arr: readonly T[]): T => arr[(source() * arr.length) | 0];

/** Gaussian-ish spread, tighter around 0 than a flat random. */
export const randSpread = (amount: number) => (source() + source() - 1) * amount;

/** Deterministic hash -> [0,1). Handy for per-object "hand drawn" jitter that doesn't crawl. */
export function hash01(n: number) {
  let x = Math.sin(n * 127.1) * 43758.5453;
  x -= Math.floor(x);
  return x;
}

export const len = (a: V) => Math.hypot(a.x, a.y);
export const len2 = (a: V) => a.x * a.x + a.y * a.y;
export const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: V, b: V) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;

export function norm(a: V, scale = 1): V {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-9 ? v(0, 0) : v((a.x / l) * scale, (a.y / l) * scale);
}

export const fromAngle = (a: number, m = 1): V => v(Math.cos(a) * m, Math.sin(a) * m);

export function rot(a: V, ang: number): V {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return v(a.x * c - a.y * s, a.x * s + a.y * c);
}

/** Shortest signed delta between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export const angleLerp = (a: number, b: number, t: number) => a + angleDelta(a, b) * t;
export const angleDamp = (a: number, b: number, rate: number, dt: number) =>
  a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));
