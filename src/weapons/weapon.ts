import type { GameCtx } from "../core/types";
import { clamp, norm, rand, v, type V } from "../core/math";
import { AMMO, AMMO_BY_ID, speedFor, type AmmoDef } from "./ammo";
import { jitterDir, muzzleSpawn } from "../entities/projectile";
import { at, disc, poly, rgba, roundBox, shade, type Ctx } from "../render/draw";
import { drawIcon } from "../render/props";
import { sfx } from "../fx/audio";

export interface FireResult {
  fired: boolean;
  /** Recoil impulse direction/magnitude in m/s, already pointing away from the target. */
  recoil: V;
  ammo: AmmoDef;
}

/**
 * The gun. Holds ammo selection, cooldown and reserves, and turns a trigger pull
 * into projectiles plus a recoil vector the shooter has to deal with.
 */
export class Weapon {
  index = 0;
  /**
   * The rounds this run actually issued, in HUD order. Defaults to everything;
   * campaign missions cut it down to the handful the mission is built around.
   * All selection, cycling and the HUD strip index into *this*, not `AMMO`.
   */
  list: readonly AmmoDef[] = AMMO;
  private cooldown = 0;
  /** Visual kick, decays fast; also drives the muzzle flash. */
  kick = 0;
  flash = 0;
  private reserves = new Map<string, number>();
  /** Set while the trigger is held so semi-auto ammo needs a re-press. */
  private triggerLatched = false;

  constructor() {
    for (const a of AMMO) if (a.reserve >= 0) this.reserves.set(a.id, a.reserve);
  }

  get ammo(): AmmoDef {
    return this.list[this.index] ?? this.list[0];
  }

  /**
   * Issues a loadout. `ids` are matched against the arsenal in the order given, so a
   * mission controls both *what* you carry and which key each round sits on. Unknown
   * ids are skipped; an empty result falls back to the full arsenal rather than
   * leaving the player with no gun at all.
   */
  setLoadout(ids: readonly string[] | null | undefined) {
    const picked = ids?.map((id) => AMMO_BY_ID.get(id)).filter((a): a is AmmoDef => !!a) ?? [];
    this.list = picked.length ? picked : AMMO;
    this.index = 0;
    this.cooldown = 0;
    this.refillAll();
  }

  get cooldownFrac() {
    return this.ammo.cooldown > 0 ? clamp(this.cooldown / this.ammo.cooldown, 0, 1) : 0;
  }

  rounds(id = this.ammo.id): number {
    const a = AMMO_BY_ID.get(id);
    if (!a) return 0;
    return a.reserve < 0 ? Infinity : this.reserves.get(id) ?? 0;
  }

  refillAll() {
    for (const a of AMMO) if (a.reserve >= 0) this.reserves.set(a.id, a.reserve);
  }

  select(i: number) {
    const n = ((i % this.list.length) + this.list.length) % this.list.length;
    if (n === this.index) return;
    this.index = n;
    this.cooldown = Math.min(this.cooldown, 0.18);
    sfx.ui(true);
  }

  cycle(dir: number) {
    this.select(this.index + Math.sign(dir));
  }

  update(dt: number, triggerHeld: boolean) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.kick = Math.max(0, this.kick - dt * 7);
    this.flash = Math.max(0, this.flash - dt * 14);
    if (!triggerHeld) this.triggerLatched = false;
  }

  /**
   * @param origin  Hand position in world space.
   * @param aim     Unit vector toward the crosshair.
   * @param facing  Which way the shooter is turned, for creature ammo orientation.
   */
  fire(game: GameCtx, origin: V, aim: V, facing: 1 | -1, triggerHeld: boolean, triggerPressed: boolean): FireResult {
    const a = this.ammo;
    const none: FireResult = { fired: false, recoil: v(0, 0), ammo: a };

    if (this.cooldown > 0) return none;
    // Auto weapons also honour `pressed`: a click shorter than one frame would
    // otherwise be swallowed entirely, which feels broken on fast mice.
    if (a.auto ? !triggerHeld && !triggerPressed : !triggerPressed) return none;
    if (!a.auto && this.triggerLatched) return none;

    const left = this.rounds();
    if (left <= 0) {
      sfx.ui(false);
      this.cooldown = 0.3;
      return none;
    }

    this.cooldown = a.cooldown;
    this.triggerLatched = true;
    if (a.reserve >= 0) this.reserves.set(a.id, left - 1);

    const dir = norm(aim);
    const spawnAt = muzzleSpawn(origin, dir, a.muzzle);

    for (let i = 0; i < a.count; i++) {
      const d = a.spread > 0 ? jitterDir(dir, a.spread) : dir;
      const speed = speedFor(a);
      const vel = v(d.x * speed, d.y * speed);
      // Fan multi-shot spawns slightly so they don't start life interpenetrating.
      const lateral = a.count > 1 ? (i - (a.count - 1) / 2) * 0.45 : 0;
      const p = v(spawnAt.x - d.y * lateral, spawnAt.y + d.x * lateral);
      game.add(a.spawn(game, p, vel, facing));
    }

    a.onFire?.(game);
    sfx.shoot(a.heft);

    this.kick = 1;
    this.flash = 1;
    game.camera.addTrauma(0.1 + a.heft * 0.32);
    game.camera.addPunch(-a.heft * 0.035);
    game.particles.flash(spawnAt.x, spawnAt.y, 0.3 + a.heft * 0.8, "#fff2c2", 0.1);
    game.particles.sparks(spawnAt.x, spawnAt.y, Math.round(4 + a.heft * 16), 6 + a.heft * 14, "#ffd23f");
    game.particles.smoke(spawnAt.x, spawnAt.y, Math.round(2 + a.heft * 8), 1.5, "#8d95a3");

    return { fired: true, recoil: v(-dir.x * a.recoil, -dir.y * a.recoil), ammo: a };
  }

  /** Draws the gun in world space, rotated to `angle` and pivoted at the hand. */
  draw(ctx: Ctx, hand: V, angle: number, time: number) {
    const a = this.ammo;
    const heft = a.heft;
    // Sized against a 1.84m stickman: the light guns read as carbines, the heavy ones
    // as absurd shoulder-mounted artillery, without swallowing the character.
    const len = 0.58 + heft * 0.62;
    const barrelR = 0.075 + heft * 0.12;
    const recoilShift = -this.kick * (0.1 + heft * 0.24);

    at(ctx, hand.x, hand.y, angle, () => {
      ctx.translate(recoilShift, 0);

      // Stock + receiver.
      roundBox(ctx, len * 0.5, 0.15, 0.04, "#3a4250", "#171b23", 0.04);
      ctx.save();
      ctx.translate(-len * 0.34, -0.07);
      ctx.rotate(0.35);
      roundBox(ctx, 0.26, 0.11, 0.04, "#2a3040", "#171b23", 0.035);
      ctx.restore();

      // Barrel — a wide bore for the ammo that has no business fitting in it.
      ctx.save();
      ctx.translate(len * 0.42, 0);
      roundBox(ctx, len * 0.62, barrelR * 2, barrelR * 0.5, "#4b5568", "#171b23", 0.045);
      // Flared muzzle.
      poly(ctx, [
        [len * 0.28, -barrelR * 1.25], [len * 0.4, -barrelR * 1.7],
        [len * 0.4, barrelR * 1.7], [len * 0.28, barrelR * 1.25],
      ], shade(a.tint, -0.15), "#171b23", 0.045);
      ctx.restore();

      // Ammo indicator drum on the side of the receiver.
      disc(ctx, -0.05, 0.14, 0.1, "#232a36", "#171b23", 0.035);
      ctx.save();
      ctx.translate(-0.05, 0.14);
      ctx.rotate(-angle); // keep the icon upright regardless of aim
      drawIcon(ctx, a.id, 0.16, time);
      ctx.restore();

      if (this.flash > 0.02) {
        const f = this.flash;
        const mx = len * 0.74;
        ctx.globalAlpha = f;
        poly(ctx, [
          [mx, 0], [mx + 0.5 + heft * 1.4, -0.22 - heft * 0.5],
          [mx + 0.28 + heft * 0.7, 0], [mx + 0.5 + heft * 1.4, 0.22 + heft * 0.5],
        ], "#fff2c2", null);
        disc(ctx, mx, 0, (0.16 + heft * 0.34) * f, rgba("#ffd23f", 0.9), null);
        ctx.globalAlpha = 1;
      }
    });
  }

  /** Little smoke curl from the barrel between shots. */
  emitIdleSmoke(game: GameCtx, hand: V, angle: number, dt: number) {
    if (this.kick < 0.25 || Math.random() > dt * 22) return;
    const len = 1.3 + this.ammo.heft;
    game.particles.smoke(hand.x + Math.cos(angle) * len, hand.y + Math.sin(angle) * len, 1, 1.1, "#9aa3b0");
  }

  /** Randomised barrel wobble used while the gun is hot; purely cosmetic. */
  swayAngle(time: number) {
    return Math.sin(time * 2.1) * 0.012 + this.kick * rand(-0.03, 0.03);
  }
}
