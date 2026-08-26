import type { Actor, GameCtx } from "../core/types";
import { rand, type V } from "../core/math";
import {
  CreatureProjectile, RigidProjectile, defaultConfig,
  type CreatureConfig, type ProjectileConfig,
} from "../entities/projectile";
import { BIPED_LITE, CHICKEN, QUADRUPED } from "../entities/ragdoll";
import { drawBiped, drawChicken, drawQuadruped } from "../render/creatures";
import * as P from "../render/props";
import { sfx } from "../fx/audio";

export interface AmmoDef {
  id: string;
  name: string;
  /** One-liner shown under the ammo name in the HUD. */
  tagline: string;
  tint: string;
  /** Projectiles per trigger pull. */
  count: number;
  /** Half-angle of the firing cone, radians. */
  spread: number;
  speed: number;
  speedVar: number;
  cooldown: number;
  /** Velocity change (m/s) kicked back into the shooter. Big ammo launches you. */
  recoil: number;
  /** 0..1 — drives muzzle flash size, screen shake and the firing sound. */
  heft: number;
  /** True = hold the trigger. */
  auto: boolean;
  /** Rounds carried; -1 is unlimited. */
  reserve: number;
  /** Distance from the hand the projectile appears at, in metres. */
  muzzle: number;
  /**
   * Fires discrete objects. Omitted by continuous weapons, which use `stream`.
   */
  spawn?(game: GameCtx, pos: V, dir: V, facing: 1 | -1): Actor;
  /**
   * Continuous ammo: called every frame the trigger is held instead of spawning
   * projectiles, with the frame's `dt` so emission rates stay frame-rate independent.
   * The hose and the flamethrower feed the fluid and flame sims through this.
   */
  stream?(game: GameCtx, muzzle: V, dir: V, dt: number, facing: 1 | -1): void;
  /** Continuous weapons get a nozzle instead of a barrel. */
  nozzle?: boolean;
  onFire?(game: GameCtx): void;
}

const rigid = (over: Partial<ProjectileConfig>): ProjectileConfig => ({ ...defaultConfig(), ...over });

const makeRigid = (cfg: ProjectileConfig) =>
  (game: GameCtx, pos: V, dir: V): Actor =>
    new RigidProjectile(game, cfg, pos, dir, Math.atan2(dir.y, dir.x));

const makeCreature = (cfg: CreatureConfig) =>
  (game: GameCtx, pos: V, dir: V, facing: 1 | -1): Actor =>
    new CreatureProjectile(game, cfg, pos, dir, facing);

/**
 * The arsenal. Every entry is pure data plus a spawn closure, so adding a new
 * ridiculous round is a single object literal — no new classes, no new systems.
 *
 * **On `points`.** A payload's score is balanced on *points per second of sustained
 * fire* — `points * count / cooldown` — not on the per-shot number, because the two
 * come apart by two orders of magnitude across this list: the chicken cannon empties
 * twenty-three birds a second and the black hole fires once every five. Balanced the
 * naive way, a satisfying number on the chicken is a hundred times the correct one.
 *
 * The bands are: ~180/s for the free teaching rounds, ~250-300/s through the early
 * unlocks, ~375-480/s for the heavy artillery and ~900-1000/s for the two apocalypse
 * rounds. That is what makes a nuke read as `+4,000` and a chicken as `+8` while the
 * grind rate stays sane, and it is why the per-shot numbers below look wildly
 * inconsistent until you divide by the fire rate.
 *
 * These are the *garnish*, not the meal — most of a run's score comes from the blocks
 * the payload knocks down (`MATERIALS` in `entities/block.ts`), which is correct: the
 * game is about the building coming down, not about the object that hit it.
 */
export const AMMO: AmmoDef[] = [
  {
    id: "chicken",
    name: "Chicken Cannon",
    tagline: "Free range. Terminal velocity.",
    tint: "#fdfbf2",
    count: 3, spread: 0.17, speed: 33, speedVar: 6, cooldown: 0.13,
    recoil: 1.1, heft: 0.16, auto: true, reserve: -1, muzzle: 0.9,
    spawn: makeCreature({
      spec: CHICKEN, scale: 1, massScale: 1, flail: 1.5, hp: 16,
      voice: () => sfx.cluck(), voiceInterval: 0.55,
      splatColor: "#e05a4a", points: 8, bonusDamage: 2,
      draw: (ctx, r) => drawChicken(ctx, r),
    }),
  },
  {
    id: "rocket",
    name: "Rocket Launcher",
    tagline: "The classic. Still undefeated.",
    tint: "#ff8a4c",
    count: 1, spread: 0.02, speed: 26, speedVar: 0, cooldown: 0.5,
    recoil: 6, heft: 0.6, auto: true, reserve: -1, muzzle: 1.1,
    onFire: () => sfx.rocketLaunch(),
    spawn: makeRigid(rigid({
      shape: "box", w: 1.15, h: 0.34, density: 95,
      gravityScale: 0.22, thrust: 62, thrustTime: 2.4, steer: 7,
      trail: "fire", angularDamping: 2, restitution: 0.05,
      explode: { radius: 6.6, force: 26, damage: 260, minEnergy: 0.4 },
      draw: P.drawRocket, points: 150, life: 9,
    })),
  },
  {
    id: "car",
    name: "Sedan Slinger",
    tagline: "Pre-owned. Not for long.",
    tint: "#e04b3a",
    count: 1, spread: 0.05, speed: 38, speedVar: 3, cooldown: 0.9,
    recoil: 15, heft: 0.9, auto: false, reserve: -1, muzzle: 2.6,
    spawn: makeRigid(rigid({
      // ~2.6 tonnes. At the old density it was lighter than the anvil, bounced off
      // brick and skidded to a stop — a two-tonne sedan should not be a lawn dart.
      shape: "box", w: 4.2, h: 1.7, density: 365,
      friction: 0.45, restitution: 0.02, angularDamping: 0.03,
      // Fires on the wreck rather than the first tap, so it ploughs through a wall
      // before going up instead of detonating against the very first thing it grazes.
      explode: { radius: 6.4, force: 26, damage: 300, minEnergy: 45 },
      bonusDamage: 70,
      impactSound: "metal", draw: P.drawCar, points: 400,
    })),
  },
  {
    id: "plane",
    name: "Jetliner Blaster",
    tagline: "Now boarding: everyone. Destination: that tower.",
    tint: "#2f6fd0",
    count: 1, spread: 0.02, speed: 36, speedVar: 0, cooldown: 2.3,
    recoil: 30, heft: 1, auto: false, reserve: -1, muzzle: 6.5,
    onFire: () => sfx.jetEngine(),
    spawn: makeRigid(rigid({
      shape: "box", w: 11, h: 2.6, density: 58,
      gravityScale: 0.34, thrust: 24, thrustTime: 4, lift: 0.055, steer: 1.1,
      trail: "smoke", trailColor: "#c9d2de", angularDamping: 1.4,
      explode: { radius: 12.5, force: 32, damage: 460, minEnergy: 45 },
      impactSound: "metal", draw: P.drawPlane, points: 1400, life: 16,
    })),
  },
  {
    id: "elephant",
    name: "Elephant Gun",
    tagline: "Literally. Mind the recoil.",
    tint: "#8d8f99",
    count: 1, spread: 0.04, speed: 31, speedVar: 2, cooldown: 1.35,
    recoil: 34, heft: 1, auto: false, reserve: -1, muzzle: 3.4,
    onFire: () => sfx.trumpet(),
    spawn: makeCreature({
      spec: QUADRUPED, scale: 2.3, massScale: 1.5, flail: 0.75, hp: 420,
      voice: () => sfx.trumpet(), voiceInterval: 1.6,
      splatColor: "#b03a4a", points: 650, bonusDamage: 45,
      draw: (ctx, r) => drawQuadruped(ctx, r, { body: "#8d8f99", dark: "#767884" }),
    }),
  },
  {
    id: "stickman",
    name: "Human Resources",
    tagline: "Ragdolls firing ragdolls. As nature intended.",
    tint: "#1b1e26",
    count: 2, spread: 0.2, speed: 30, speedVar: 5, cooldown: 0.45,
    recoil: 5, heft: 0.5, auto: true, reserve: -1, muzzle: 1.9,
    spawn: makeCreature({
      spec: BIPED_LITE, scale: 1, massScale: 1, flail: 1.9, hp: 55,
      voice: () => sfx.scream(), voiceInterval: 1.1,
      splatColor: "#c0263a", points: 60, bonusDamage: 8,
      draw: (ctx, r) => drawBiped(ctx, r, { ink: "#38404f", fill: "#38404f" }),
    }),
  },
  {
    id: "anvil",
    name: "Anvil Express",
    tagline: "Physics does the rest.",
    tint: "#4a515c",
    count: 1, spread: 0.03, speed: 31, speedVar: 2, cooldown: 0.5,
    recoil: 12, heft: 0.8, auto: true, reserve: -1, muzzle: 1.1,
    spawn: makeRigid(rigid({
      shape: "box", w: 1.0, h: 0.72, density: 950,
      restitution: 0.03, friction: 0.9, angularDamping: 0.04,
      impactSound: "metal", draw: P.drawAnvil, points: 90, bonusDamage: 12,
    })),
  },
  {
    id: "piano",
    name: "Grand Finale",
    tagline: "Plays a chord on impact. Once.",
    tint: "#1d2027",
    count: 1, spread: 0.04, speed: 29, speedVar: 2, cooldown: 0.8,
    recoil: 14, heft: 0.85, auto: false, reserve: -1, muzzle: 1.8,
    spawn: makeRigid(rigid({
      // 1.08 tonnes. At the old density a concert grand five times the anvil's volume
      // weighed less than it did and bounced off brick, which made the round a joke
      // with no punchline — it has to land like furniture, not like a prop.
      shape: "box", w: 2.4, h: 1.5, density: 300,
      restitution: 0.06, angularDamping: 0.06,
      impactSound: "piano", draw: P.drawPiano, points: 300, bonusDamage: 10,
    })),
  },
  {
    id: "fridge",
    name: "Cold Storage",
    tagline: "Freezes whatever it touches. Then it only takes one more hit.",
    tint: "#dfe4ea",
    count: 1, spread: 0.05, speed: 33, speedVar: 3, cooldown: 0.55,
    recoil: 10, heft: 0.7, auto: true, reserve: -1, muzzle: 1.5,
    spawn: makeRigid(rigid({
      shape: "box", w: 0.95, h: 1.95, density: 195,
      restitution: 0.08, freeze: { radius: 1.9 },
      impactSound: "glass", draw: P.drawFridge, points: 130,
    })),
  },
  /**
   * The only round in the arsenal that makes the level *lighter*.
   *
   * Deliberately weak on contact — 19 kg of latex does no damage worth the name — and
   * priced instead on what happens afterwards, which is not scored here at all: the
   * blocks it floats do their own scoring when they come down. Balloons stack on a
   * target that is already carrying some, so a concrete wall too heavy for one bunch
   * goes up on the second, and you can see how close it is by counting them. The
   * numbers behind that curve are in `fx/buoyancy.ts`.
   *
   * `steer` is not decoration: the sprite is a bunch being dragged by a clamp and it is
   * authored pointing right, so the body has to face its own velocity or the round
   * flies sideways through the level like a thrown bouquet.
   */
  {
    id: "balloon",
    name: "Party Supplies",
    tagline: "Ties balloons to it. Gravity takes the afternoon off.",
    tint: "#f0508a",
    count: 1, spread: 0.05, speed: 34, speedVar: 2, cooldown: 0.55,
    recoil: 4, heft: 0.4, auto: true, reserve: -1, muzzle: 1.2,
    spawn: makeRigid(rigid({
      shape: "ball", w: 0.4, h: 0.4, density: 120,
      // Drag, not weight: a bunch of balloons should visibly lose its throw rather
      // than arcing like a stone, so the round has a real range you have to respect.
      gravityScale: 0.5, linearDamping: 0.28, restitution: 0.05, steer: 6,
      buoy: { balloons: 4, radius: 2.4, duration: 6 },
      impactSound: "thud", draw: P.drawBalloonBunch, points: 90, life: 9,
    })),
  },
  {
    id: "bowling",
    name: "Perfect Game",
    tagline: "Ten pins. Or one building.",
    tint: "#241f3d",
    count: 1, spread: 0.015, speed: 46, speedVar: 2, cooldown: 0.3,
    recoil: 7, heft: 0.5, auto: true, reserve: -1, muzzle: 0.9,
    spawn: makeRigid(rigid({
      shape: "ball", w: 0.56, h: 0.56, density: 900,
      restitution: 0.52, friction: 0.25, angularDamping: 0.02,
      impactSound: "ricochet", draw: P.drawBowling, points: 90, bonusDamage: 8,
    })),
  },
  {
    id: "watermelon",
    name: "Melon Repeater",
    tagline: "Extremely juicy consequences.",
    tint: "#3f8f3a",
    count: 4, spread: 0.19, speed: 31, speedVar: 6, cooldown: 0.34,
    recoil: 3, heft: 0.3, auto: true, reserve: -1, muzzle: 0.85,
    spawn: makeRigid(rigid({
      shape: "ball", w: 0.62, h: 0.62, density: 230,
      restitution: 0.16, splat: { color: "#e0455c", count: 22 },
      impactSound: "splat", draw: P.drawWatermelon, points: 15, life: 14,
    })),
  },
  {
    id: "sawblade",
    name: "Buzzsaw Barrage",
    tagline: "Ricochets. A lot.",
    tint: "#c9d2de",
    count: 2, spread: 0.11, speed: 52, speedVar: 5, cooldown: 0.4,
    recoil: 4, heft: 0.4, auto: true, reserve: -1, muzzle: 1.0,
    spawn: makeRigid(rigid({
      shape: "ball", w: 0.85, h: 0.85, density: 520,
      restitution: 0.66, friction: 0.03, gravityScale: 0.55, spin: 42,
      trail: "sparkle", trailColor: "#ffd23f",
      bonusDamage: 48, impactSound: "saw", draw: P.drawSawblade, points: 55, life: 12,
    })),
  },
  {
    id: "tv",
    name: "Static Discharge",
    tagline: "Five at once, straight down the hall.",
    // The one genuinely redundant round in the arsenal: two light boxes in a narrow
    // cone that splatter glass was a worse Melon Repeater, with no verb of its own.
    // Rebuilt as the close-range cone — five sets at a wide angle on a slow cycle — so
    // it owns the one job nothing else does: everything in front of you, right now.
    // Useless past fifteen metres, which is exactly what gives it an identity.
    tint: "#7fd0e8",
    count: 5, spread: 0.34, speed: 30, speedVar: 7, cooldown: 0.62,
    recoil: 8, heft: 0.5, auto: true, reserve: -1, muzzle: 1.0,
    spawn: makeRigid(rigid({
      shape: "box", w: 1.1, h: 0.82, density: 160,
      restitution: 0.12, splat: { color: "#9fe6f5", count: 20 },
      impactSound: "glass", draw: P.drawTv, points: 32,
    })),
  },
  {
    id: "barrel",
    name: "Barrel Roll",
    tagline: "Red barrel. You know how this goes.",
    tint: "#e8433a",
    count: 1, spread: 0.05, speed: 34, speedVar: 3, cooldown: 0.5,
    recoil: 7, heft: 0.6, auto: true, reserve: -1, muzzle: 1.1,
    spawn: makeRigid(rigid({
      shape: "box", w: 0.82, h: 1.2, density: 210,
      explode: { radius: 7.2, force: 25, damage: 230, minEnergy: 0.8 },
      draw: P.drawBarrel, points: 110,
    })),
  },
  {
    id: "nuke",
    name: "Tactical Regret",
    tagline: "Unlimited. Use them badly.",
    tint: "#ffd23f",
    count: 1, spread: 0.02, speed: 33, speedVar: 0, cooldown: 4.5,
    recoil: 26, heft: 1, auto: false, reserve: -1, muzzle: 1.6,
    spawn: makeRigid(rigid({
      shape: "box", w: 1.6, h: 0.62, density: 420,
      gravityScale: 0.62, steer: 3, trail: "smoke", trailColor: "#d6dbe4",
      explode: { radius: 34, force: 62, damage: 4000, minEnergy: 0.3, nuke: true },
      draw: P.drawNuke, points: 4000, life: 12,
    })),
  },
  {
    id: "blackhole",
    name: "Singularity",
    tagline: "Eats the level. Then itself.",
    tint: "#8a5cff",
    count: 1, spread: 0.02, speed: 20, speedVar: 0, cooldown: 5,
    recoil: 3, heft: 0.55, auto: false, reserve: -1, muzzle: 1.4,
    onFire: () => sfx.blackhole(),
    spawn: makeRigid(rigid({
      shape: "ball", w: 1.1, h: 1.1, density: 40,
      gravityScale: 0.04, linearDamping: 1.6, restitution: 0.1,
      trail: "void", attract: { radius: 24, strength: 340, duration: 3.6 },
      explode: { radius: 17, force: 44, damage: 700, minEnergy: 1e9 },
      impactSound: "none", draw: P.drawBlackhole, points: 5000, life: 14,
    })),
  },
  {
    id: "water",
    name: "Hydro Cannon",
    tagline: "A real fluid, simulated droplet by droplet. Hold it and watch the level flood.",
    tint: "#4fc3f7",
    // Continuous: no cooldown, no per-shot recoil worth the name. `count`/`speed` are
    // still filled in because the HUD and the aim preview read them.
    count: 0, spread: 0.05, speed: 38, speedVar: 0, cooldown: 0,
    recoil: 5.5, heft: 0.3, auto: true, reserve: -1, muzzle: 1.1, nozzle: true,
    stream: (game, muzzle, dir, dt) => {
      game.water.spray(muzzle, dir, dt, { speed: 38, spread: 0.05, rate: 260, life: 7 });
      // A jet this heavy blows a hole in a wall of flame as well as putting it out.
      game.particles.emit("smoke", muzzle.x, muzzle.y, {
        vx: dir.x * 4, vy: dir.y * 4, maxLife: 0.25, size: 0.16, grow: 1.2,
        drag: 3, color: "#bfe6ff",
      });
    },
  },
  {
    id: "flamethrower",
    name: "Flamethrower",
    tagline: "Sets the world alight, and the fire keeps going without you.",
    tint: "#ff7a29",
    count: 0, spread: 0.075, speed: 42, speedVar: 0, cooldown: 0,
    recoil: 2.5, heft: 0.35, auto: true, reserve: -1, muzzle: 1.15, nozzle: true,
    stream: (game, muzzle, dir, dt) => {
      game.fire.jet(muzzle, dir, dt, { speed: 42, spread: 0.075, rate: 150, life: 1.5 });
    },
  },
  /**
   * The frag grenade. The first round in the game and, for one contract, the only one.
   *
   * Listed *last* despite being first in the story. This array is the wheel order and
   * the default selection is index 0, so putting the story's opening round at the front
   * would quietly replace the chicken cannon as the thing every sandbox opens on. The
   * contract issues it by name through `loadout`, so its position here is free to serve
   * the sandboxes instead.
   *
   * Deliberately the *hardest* round to use well, which is why it goes first. It is
   * lobbed rather than fired, so range is a function of how far above the target you
   * aim; it bounces, so a bad angle sends it back at you; and the two-second fuse means
   * a hit is a prediction rather than a reaction. Learn those three things and every
   * ballistic round later in the arsenal is already understood.
   *
   * Unlimited, because a player still learning the arc must not also be rationing. The
   * one-second cooldown is what paces it — you get roughly one considered throw per
   * engagement, not a stream.
   */
  {
    id: "grenade",
    name: "Frag Grenade",
    tagline: "Two seconds. Aim high.",
    tint: "#8fae56",
    // 24 m/s under -26 gravity is a ~22m throw at the best angle. That is deliberately
    // just longer than the reach of everything shooting at you in the first contract:
    // the player out-ranges the map by a couple of metres, so closing the distance is a
    // choice rather than the only option.
    count: 1, spread: 0.015, speed: 24, speedVar: 0, cooldown: 1.0,
    recoil: 1.4, heft: 0.34, auto: false, reserve: -1, muzzle: 0.85,
    spawn: makeRigid(rigid({
      shape: "ball", w: 0.42, h: 0.42, density: 260,
      // Lively enough to roll through a doorway, damped enough not to skitter away.
      restitution: 0.42, friction: 0.5, angularDamping: 0.6, gravityScale: 1,
      fuse: 2.0,
      // A full-speed direct hit carries ~13 kJ, so the 8 kJ threshold detonates a clean
      // shot on contact while a lob or a bounce keeps cooking. That split is the whole
      // weapon: hit them and it goes off now, miss and you have two seconds of a live
      // grenade rolling somewhere — including back down a slope at you.
      explode: { radius: 5.4, force: 19, damage: 210, minEnergy: 8 },
      draw: P.drawGrenade, points: 90, life: 6, impactSound: "metal",
    })),
  },
];

export const AMMO_BY_ID = new Map(AMMO.map((a) => [a.id, a]));

/** Random muzzle-velocity jitter so bursts never come out as a rigid fan. */
export const speedFor = (a: AmmoDef) => a.speed + rand(-a.speedVar, a.speedVar);
