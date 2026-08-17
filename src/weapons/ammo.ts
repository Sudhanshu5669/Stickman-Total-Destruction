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
  spawn(game: GameCtx, pos: V, dir: V, facing: 1 | -1): Actor;
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
      splatColor: "#e05a4a", points: 5, bonusDamage: 2,
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
      draw: P.drawRocket, points: 25, life: 9,
    })),
  },
  {
    id: "car",
    name: "Sedan Slinger",
    tagline: "Pre-owned. Not for long.",
    tint: "#e04b3a",
    count: 1, spread: 0.05, speed: 34, speedVar: 3, cooldown: 0.9,
    recoil: 15, heft: 0.9, auto: false, reserve: -1, muzzle: 2.6,
    spawn: makeRigid(rigid({
      shape: "box", w: 4.2, h: 1.7, density: 175,
      friction: 0.75, restitution: 0.1, angularDamping: 0.05,
      explode: { radius: 5.4, force: 18, damage: 170, minEnergy: 70 },
      impactSound: "metal", draw: P.drawCar, points: 45,
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
      impactSound: "metal", draw: P.drawPlane, points: 120, life: 16,
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
      splatColor: "#b03a4a", points: 90, bonusDamage: 45,
      draw: (ctx, r) => drawQuadruped(ctx, r, { body: "#8d8f99", dark: "#767884", kind: "elephant" }),
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
      splatColor: "#c0263a", points: 20, bonusDamage: 8,
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
      impactSound: "metal", draw: P.drawAnvil, points: 30, bonusDamage: 12,
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
      shape: "box", w: 2.4, h: 1.5, density: 135,
      restitution: 0.06, angularDamping: 0.06,
      impactSound: "piano", draw: P.drawPiano, points: 40, bonusDamage: 10,
    })),
  },
  {
    id: "fridge",
    name: "Cold Storage",
    tagline: "Still humming when it lands.",
    tint: "#dfe4ea",
    count: 1, spread: 0.05, speed: 33, speedVar: 3, cooldown: 0.55,
    recoil: 10, heft: 0.7, auto: true, reserve: -1, muzzle: 1.5,
    spawn: makeRigid(rigid({
      shape: "box", w: 0.95, h: 1.95, density: 195,
      restitution: 0.08, impactSound: "metal", draw: P.drawFridge, points: 22,
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
      impactSound: "ricochet", draw: P.drawBowling, points: 20, bonusDamage: 8,
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
      impactSound: "splat", draw: P.drawWatermelon, points: 10, life: 14,
    })),
  },
  {
    id: "cow",
    name: "Livestock Launcher",
    tagline: "Moo. Terminal moo.",
    tint: "#f2f2f2",
    count: 1, spread: 0.05, speed: 33, speedVar: 3, cooldown: 0.9,
    recoil: 18, heft: 0.85, auto: false, reserve: -1, muzzle: 2.0,
    onFire: () => sfx.moo(),
    spawn: makeCreature({
      spec: QUADRUPED, scale: 1.28, massScale: 1.0, flail: 1.1, hp: 190,
      voice: () => sfx.moo(), voiceInterval: 1.3,
      splatColor: "#c0263a", points: 45, bonusDamage: 22,
      draw: (ctx, r) => drawQuadruped(ctx, r, { body: "#f2f2f2", dark: "#d9d9d9", kind: "cow" }),
    }),
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
      bonusDamage: 48, impactSound: "saw", draw: P.drawSawblade, points: 18, life: 12,
    })),
  },
  {
    id: "toilet",
    name: "Porcelain Throne",
    tagline: "Flushed with power.",
    tint: "#f6f7f9",
    count: 1, spread: 0.06, speed: 37, speedVar: 4, cooldown: 0.4,
    recoil: 6, heft: 0.45, auto: true, reserve: -1, muzzle: 1.1,
    spawn: makeRigid(rigid({
      shape: "box", w: 1.0, h: 1.1, density: 185,
      restitution: 0.1, impactSound: "glass", draw: P.drawToilet, points: 14,
    })),
  },
  {
    id: "tv",
    name: "Static Discharge",
    tagline: "Nothing good was on anyway.",
    tint: "#7fd0e8",
    count: 2, spread: 0.15, speed: 35, speedVar: 5, cooldown: 0.4,
    recoil: 5, heft: 0.4, auto: true, reserve: -1, muzzle: 1.0,
    spawn: makeRigid(rigid({
      shape: "box", w: 1.1, h: 0.82, density: 160,
      restitution: 0.12, splat: { color: "#9fe6f5", count: 14 },
      impactSound: "glass", draw: P.drawTv, points: 12,
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
      draw: P.drawBarrel, points: 28,
    })),
  },
  {
    id: "granny",
    name: "Nana Nailgun",
    tagline: "She has been waiting for this.",
    tint: "#c8cdd6",
    count: 1, spread: 0.08, speed: 35, speedVar: 4, cooldown: 0.6,
    recoil: 9, heft: 0.6, auto: true, reserve: -1, muzzle: 1.3,
    spawn: makeRigid(rigid({
      shape: "box", w: 1.25, h: 1.25, density: 210,
      restitution: 0.3, angularDamping: 0.03,
      impactSound: "thud", draw: P.drawGrandmother, points: 35, bonusDamage: 20,
    })),
  },
  {
    id: "nuke",
    name: "Tactical Regret",
    tagline: "Three of them. Use them badly.",
    tint: "#ffd23f",
    count: 1, spread: 0.02, speed: 33, speedVar: 0, cooldown: 4.5,
    recoil: 26, heft: 1, auto: false, reserve: 3, muzzle: 1.6,
    spawn: makeRigid(rigid({
      shape: "box", w: 1.6, h: 0.62, density: 420,
      gravityScale: 0.62, steer: 3, trail: "smoke", trailColor: "#d6dbe4",
      explode: { radius: 34, force: 62, damage: 4000, minEnergy: 0.3, nuke: true },
      draw: P.drawNuke, points: 500, life: 12,
    })),
  },
  {
    id: "blackhole",
    name: "Singularity",
    tagline: "Eats the level. Then itself.",
    tint: "#8a5cff",
    count: 1, spread: 0.02, speed: 20, speedVar: 0, cooldown: 5,
    recoil: 3, heft: 0.55, auto: false, reserve: 3, muzzle: 1.4,
    onFire: () => sfx.blackhole(),
    spawn: makeRigid(rigid({
      shape: "ball", w: 1.1, h: 1.1, density: 40,
      gravityScale: 0.04, linearDamping: 1.6, restitution: 0.1,
      trail: "void", attract: { radius: 24, strength: 340, duration: 3.6 },
      explode: { radius: 17, force: 44, damage: 700, minEnergy: 1e9 },
      impactSound: "none", draw: P.drawBlackhole, points: 300, life: 14,
    })),
  },
];

export const AMMO_BY_ID = new Map(AMMO.map((a) => [a.id, a]));

/** Random muzzle-velocity jitter so bursts never come out as a rigid fan. */
export const speedFor = (a: AmmoDef) => a.speed + rand(-a.speedVar, a.speedVar);
