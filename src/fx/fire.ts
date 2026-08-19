import { clamp, rand, type V } from "../core/math";
import type { Ctx } from "../render/draw";
import type { PhysOwner, Physics } from "../core/physics";
import type { Particles } from "./particles";
import { anchorAt, canMark, type Decals } from "./decals";
import type { SolidField } from "./solids";
import type { WaterSim } from "./fluid";
import { sfx } from "./audio";

/**
 * Combustion, as a simulation rather than an animation.
 *
 * Two halves that feed each other:
 *
 * - **Flame gas.** Thousands of hot puffs advected with buoyancy proportional to
 *   their own temperature, curl-ish turbulence and drag. They bounce and *slide*
 *   along geometry rather than stopping at it, which is what makes a jet of fire
 *   crawl up a wall and pool under a ceiling. Cooling turns them to smoke.
 * - **A heat ledger.** Every gameplay object the flames touch accumulates heat.
 *   Above its ignition point it catches, and from then on it burns on its own fuel:
 *   losing health, throwing its own flames, charring, and radiating heat into its
 *   neighbours so a fire actually spreads through a structure instead of stopping
 *   at whatever you aimed at.
 *
 * Water is the other half of the loop: droplets landing on an object dump its heat
 * and soak it against re-ignition, and flames that fly into standing water boil off
 * into steam, taking the water with them.
 */

export interface Burnable extends PhysOwner {
  flammability?: number;
  firePos?(): V;
  fireSize?: number;
  burning?: number;
  soaked?: number;
}

const MAX_FLAMES = 900;
/** Heat needed to catch. Reached in well under a second of direct flame. */
const IGNITE = 1;
/** Seconds a lit object burns before its fuel is spent. */
const FUEL = 9;
/**
 * Below this, an object simply cannot catch — no amount of flame lights a steel beam.
 * Everything above it (wood, flesh, biomass, explosive) burns readily.
 */
const MIN_FLAM = 0.2;

interface Burn {
  heat: number;
  alight: boolean;
  fuel: number;
  /** Countdown to the next radiant-spread query. */
  spread: number;
  emit: number;
}

export interface FireHost {
  readonly physics: Physics;
  readonly particles: Particles;
  readonly decals: Decals;
}

export class FireSim {
  count = 0;

  private readonly x = new Float32Array(MAX_FLAMES);
  private readonly y = new Float32Array(MAX_FLAMES);
  private readonly vx = new Float32Array(MAX_FLAMES);
  private readonly vy = new Float32Array(MAX_FLAMES);
  private readonly life = new Float32Array(MAX_FLAMES);
  private readonly maxLife = new Float32Array(MAX_FLAMES);
  /** 1 = white hot, 0 = spent. Drives colour, buoyancy and ignition power. */
  private readonly heat = new Float32Array(MAX_FLAMES);
  private readonly size = new Float32Array(MAX_FLAMES);
  private readonly seed = new Float32Array(MAX_FLAMES);

  private readonly burning = new Map<Burnable, Burn>();
  private emitCarry = 0;
  private sprite: HTMLCanvasElement | null = null;
  private roar = 0;
  private t = 0;

  constructor(private readonly host: FireHost) {}

  clear() {
    this.count = 0;
    this.burning.clear();
    this.emitCarry = 0;
  }

  // ------------------------------------------------------------------ sources

  /** Continuous jet from a flamethrower nozzle. */
  jet(origin: V, dir: V, dt: number, opts: { speed: number; spread: number; rate: number; life: number }) {
    this.emitCarry += opts.rate * dt;
    let n = Math.floor(this.emitCarry);
    if (n <= 0) return;
    this.emitCarry -= n;
    const base = Math.atan2(dir.y, dir.x);
    while (n-- > 0) {
      const a = base + rand(-opts.spread, opts.spread);
      const s = opts.speed * rand(0.75, 1.1);
      this.add(
        origin.x + rand(-0.1, 0.1), origin.y + rand(-0.1, 0.1),
        Math.cos(a) * s, Math.sin(a) * s,
        opts.life * rand(0.75, 1.2), 1, rand(0.28, 0.5),
      );
    }
    this.roar = 1;
  }

  /** A one-off gout — explosions, burning objects venting, barrels going up. */
  burst(x: number, y: number, n: number, speed: number, heat = 0.9) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = speed * rand(0.15, 1);
      this.add(x, y, Math.cos(a) * s, Math.sin(a) * s + 1.5, rand(0.5, 1.2), heat, rand(0.22, 0.55));
    }
  }

  private add(x: number, y: number, vx: number, vy: number, life: number, heat: number, size: number) {
    const i = this.count < MAX_FLAMES ? this.count++ : (Math.random() * MAX_FLAMES) | 0;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = this.maxLife[i] = life;
    this.heat[i] = heat;
    this.size[i] = size;
    this.seed[i] = Math.random() * 100;
  }

  // ------------------------------------------------------------------ heat

  /** Dumps heat into an object. Used by flame contact, explosions and radiant spread. */
  addHeat(owner: Burnable | null, amount: number) {
    if (!owner || owner.dead) return;
    const f = owner.flammability ?? 0;
    if (f < MIN_FLAM) return;
    const soak = owner.soaked ?? 0;
    if (soak > 0.05) {
      // Soaked things steam instead of catching. Boiling the water off costs the fire.
      owner.soaked = Math.max(0, soak - amount * 0.6);
      const p = owner.firePos?.();
      if (p && Math.random() < 0.25) this.host.particles.smoke(p.x, p.y, 1, 2.4, "#d8dee6");
      return;
    }
    let b = this.burning.get(owner);
    if (!b) {
      b = { heat: 0, alight: false, fuel: FUEL, spread: 0, emit: 0 };
      this.burning.set(owner, b);
    }
    b.heat += amount * f * 1.6;
    if (!b.alight && b.heat >= IGNITE) this.ignite(owner, b);
  }

  private ignite(owner: Burnable, b: Burn) {
    b.alight = true;
    b.fuel = FUEL * (0.6 + (owner.flammability ?? 0.5));
    owner.burning = 0.05;
    const p = owner.firePos?.();
    if (p) {
      this.burst(p.x, p.y, 8, 3.5);
      sfx.ignite();
    }
  }

  /** Douses an object — water landing on it, or the player rolling in a puddle. */
  douse(owner: Burnable | null, amount: number) {
    if (!owner) return;
    owner.soaked = Math.min(1.4, (owner.soaked ?? 0) + amount);
    const b = this.burning.get(owner);
    if (!b) return;
    b.heat -= amount * 5;
    if (b.heat <= 0) {
      if (b.alight) {
        const p = owner.firePos?.();
        if (p) {
          this.host.particles.smoke(p.x, p.y, 5, 3.2, "#dfe5ec");
          sfx.steam();
        }
      }
      owner.burning = 0;
      this.burning.delete(owner);
    }
  }

  isBurning(owner: Burnable) {
    return this.burning.get(owner)?.alight === true;
  }

  // ------------------------------------------------------------------ sim

  update(dt: number, solids: SolidField, water: WaterSim, camX: number, camY: number) {
    this.t += dt;
    this.roar = Math.max(0, this.roar - dt * 3);
    sfx.flamethrower(this.roar);
    this.stepFlames(dt, solids, water, camX, camY);
    this.stepBurning(dt);
  }

  private stepFlames(dt: number, solids: SolidField, water: WaterSim, camX: number, camY: number) {
    const p = this.host.particles;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      const t = this.life[i] / this.maxLife[i];
      if (this.life[i] <= 0 || Math.abs(this.x[i] - camX) > 110 || Math.abs(this.y[i] - camY) > 110) {
        if (this.life[i] <= 0 && Math.random() < 0.35) {
          p.smoke(this.x[i], this.y[i], 1, 1.6, "#565b66");
        }
        this.kill(i--);
        continue;
      }
      // Cools as it ages, and the cooler it gets the less it lifts.
      this.heat[i] = t * t;
      const hot = this.heat[i];

      // Buoyancy ramps in with age rather than applying from birth. Hot gas thrown at
      // 40 m/s does not climb while it is still travelling — only once it slows does it
      // rise. Lifting from the muzzle sent the whole jet sailing over anything more
      // than a few metres away, so you could never hit what the crosshair was on.
      const aged = 1 - t;
      const swirl = Math.sin(this.t * 6 + this.seed[i]) * 2.4 * hot * aged;
      this.vy[i] += (3 + hot * 18) * aged * aged * dt;
      this.vx[i] += swirl * dt;
      const drag = Math.exp(-1.25 * dt);
      this.vx[i] *= drag;
      this.vy[i] *= drag;

      const nx = this.x[i] + this.vx[i] * dt;
      const ny = this.y[i] + this.vy[i] * dt;

      // Water in the way boils off; both sides lose.
      if (water.count > 0 && water.densityAt(nx, ny) > 0.12) {
        water.evaporate(nx, ny, 0.6, 2);
        p.smoke(nx, ny, 2, 3.4, "#e2e8ef");
        this.kill(i--);
        continue;
      }

      if (solids.resolve(nx, ny, 0.16)) {
        const s = solids.hitIndex;
        const owner = solids.owners[s];
        this.addHeat(owner as Burnable | null, hot * dt * 3.2);
        // Slide along the surface rather than stopping dead: fire hugs what it hits.
        const dot = this.vx[i] * solids.hitNx + this.vy[i] * solids.hitNy;
        this.vx[i] = (this.vx[i] - dot * solids.hitNx) * 0.82;
        this.vy[i] = (this.vy[i] - dot * solids.hitNy) * 0.82 + 1.5;
        this.x[i] = nx + solids.hitNx * (solids.hitDepth + 0.02);
        this.y[i] = ny + solids.hitNy * (solids.hitDepth + 0.02);
        this.life[i] = Math.min(this.life[i], this.maxLife[i] * 0.7);
        // Scorch belongs on walls and ground. Charring a stickman who then walks
        // away just leaves a black smudge hanging in the air where he stood.
        if (hot > 0.6 && Math.random() < dt * 3 && canMark(owner)) {
          const bx = this.x[i];
          const by = this.y[i];
          this.host.decals.scorch(bx, by, rand(0.4, 0.9), anchorAt(owner, solids.bodies[s], bx, by));
        }
        continue;
      }
      this.x[i] = nx;
      this.y[i] = ny;
    }
  }

  private kill(i: number) {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
    this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
    this.heat[i] = this.heat[last]; this.size[i] = this.size[last];
    this.seed[i] = this.seed[last];
  }

  /** Ticks every object that is alight: damage, self-flames, radiant spread, burn-out. */
  private stepBurning(dt: number) {
    if (this.burning.size === 0) return;
    for (const [owner, b] of this.burning) {
      if (owner.dead) {
        owner.burning = 0;
        this.burning.delete(owner);
        continue;
      }
      // Heat bleeds away, so a glancing lick of flame never lights anything.
      b.heat = Math.max(0, b.heat - dt * (b.alight ? 0.1 : 1.4));
      if (!b.alight) {
        if (b.heat <= 0) this.burning.delete(owner);
        continue;
      }

      b.fuel -= dt;
      const p = owner.firePos?.();
      const size = owner.fireSize ?? 1;
      owner.burning = clamp(b.fuel / FUEL, 0, 1) * 0.4 + 0.6;

      if (b.fuel <= 0) {
        owner.burning = 0;
        this.burning.delete(owner);
        if (p) this.host.particles.smoke(p.x, p.y, 6, 2.6, "#6a7079");
        continue;
      }
      if (!p) continue;

      // Damage over time, sized so wood is gone in a few seconds and metal never lights.
      owner.takeDamage?.(dt * 30 * (owner.flammability ?? 0.5) * size, p, null);

      b.emit -= dt;
      if (b.emit <= 0) {
        b.emit = 0.05;
        this.add(
          p.x + rand(-size, size) * 0.5, p.y + rand(-size, size) * 0.4,
          rand(-1.2, 1.2), rand(1.5, 4.5),
          rand(0.4, 0.9), rand(0.6, 1), rand(0.18, 0.36) * (0.6 + size * 0.4),
        );
        if (Math.random() < 0.25) this.host.particles.smoke(p.x, p.y, 1, 2.2, "#4f545e");
      }

      // Radiant spread. One query per burning object every half second is affordable;
      // one per frame is not.
      b.spread -= dt;
      if (b.spread <= 0) {
        b.spread = rand(0.4, 0.7);
        const r = 1.6 + size * 1.4;
        for (const o of this.host.physics.ownersInRadius(p, r)) {
          if (o === owner) continue;
          this.addHeat(o as Burnable, 0.55);
        }
      }
    }
  }

  // ------------------------------------------------------------------ render

  /**
   * Additive blits of a cached radial sprite, tinted per particle by temperature.
   * Tinting a white sprite via a colour rectangle would need one offscreen pass per
   * flame, so instead three pre-tinted sprites are cross-faded by heat.
   */
  draw(ctx: Ctx) {
    if (this.count === 0) return;
    const s = this.blob();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.count; i++) {
      const t = clamp(this.life[i] / this.maxLife[i], 0, 1);
      const hot = this.heat[i];
      const r = this.size[i] * (0.6 + (1 - t) * 1.5);
      ctx.globalAlpha = clamp(t * 0.85, 0, 1) * (0.35 + hot * 0.65);
      const idx = hot > 0.66 ? 0 : hot > 0.33 ? 1 : 2;
      ctx.drawImage(s[idx], this.x[i] - r, this.y[i] - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  private blob(): HTMLCanvasElement[] {
    if (this.sprite) return this.tinted!;
    const stops: [string, string][] = [
      ["rgba(255,250,220,1)", "rgba(255,150,40,0)"],
      ["rgba(255,190,80,1)", "rgba(230,80,20,0)"],
      ["rgba(210,80,30,1)", "rgba(90,30,15,0)"],
    ];
    this.tinted = stops.map(([a, b]) => {
      const px = 32;
      const c = document.createElement("canvas");
      c.width = c.height = px;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
      grad.addColorStop(0, a);
      grad.addColorStop(0.5, a.replace(/,1\)$/, ",0.55)"));
      grad.addColorStop(1, b);
      g.fillStyle = grad;
      g.fillRect(0, 0, px, px);
      return c;
    });
    this.sprite = this.tinted[0];
    return this.tinted;
  }

  private tinted: HTMLCanvasElement[] | null = null;
}
