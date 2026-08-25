import type { GameCtx } from "../core/types";
import { clamp, norm, rand, v, type V } from "../core/math";
import { AMMO, AMMO_BY_ID, speedFor, type AmmoDef } from "./ammo";
import { jitterDir, muzzleSpawn } from "../entities/projectile";
import { at, disc, poly, rgba, roundBox, shade, type Ctx } from "../render/draw";
import { drawIcon } from "../render/props";
import { drawGunSprite, gunSprite, MUZZLE_X } from "../render/gunart";
import { sfx } from "../fx/audio";
import { progress } from "../ui/progress";

export interface FireResult {
  fired: boolean;
  /** Recoil impulse direction/magnitude in m/s, already pointing away from the target. */
  recoil: V;
  ammo: AmmoDef;
  /**
   * True for the hose and the flamethrower. Their recoil is already scaled by `dt`
   * and arrives every frame, so the shooter must not treat it as a discrete shot.
   */
  streaming: boolean;
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
  /**
   * Rounds already paid their first-use bounty, mirrored from storage at construction.
   *
   * The continuous weapons ask about this every frame the trigger is down, so the hot
   * path has to be a `Set` lookup — going to `localStorage` sixty times a second to be
   * told "no" would be the most expensive thing in the frame.
   */
  private readonly usedRounds: Set<string>;

  constructor() {
    for (const a of AMMO) if (a.reserve >= 0) this.reserves.set(a.id, a.reserve);
    this.usedRounds = progress.usedRounds();
  }

  /**
   * Pays a one-off bounty the first time each round is ever fired.
   *
   * Eighteen rounds is only an arsenal if the player tries them. Left alone, most
   * players find three they like in the first minute and never press `4` again, which
   * quietly deletes two thirds of the game — so curiosity gets paid for, once per round,
   * for as long as the save lives.
   *
   * The bounty goes through `award` rather than straight to carnage so it lands in the
   * run score, banks with everything else, and shows its true post-multiplier value; the
   * popup above it is what explains where the number came from.
   */
  private payFirstUse(game: GameCtx, a: AmmoDef, at: V) {
    if (this.usedRounds.has(a.id)) return;
    this.usedRounds.add(a.id);
    const bounty = progress.firstUse(a.id);
    if (bounty <= 0) return;
    game.particles.popup(at.x, at.y + 2.2, `FIRST STRIKE — ${a.name.toUpperCase()}`, "#ffd23f", 0.9);
    game.award(bounty, at);
    sfx.levelUp();
  }

  get ammo(): AmmoDef {
    return this.list[this.index] ?? this.list[0];
  }

  /**
   * Issues a loadout.
   *
   * `ids` are matched against the arsenal in the order given, so a mission controls
   * both *what* you carry and which key each round sits on. Unknown ids are skipped.
   *
   * With no list, you carry the whole arsenal — see `progress.ARSENAL`, where every
   * round is priced at zero. Nothing is withheld from a fresh save. Missions still pass
   * an explicit list, because a mission authored around three toys wants those three on
   * the number keys rather than the whole arsenal to scroll past.
   *
   * An empty result falls back to the full arsenal rather than leaving the player
   * with no gun at all — a corrupt save should not be unplayable.
   */
  setLoadout(ids: readonly string[] | null | undefined) {
    const wanted = ids ?? progress.unlockedWeapons();
    const picked = wanted.map((id) => AMMO_BY_ID.get(id)).filter((a): a is AmmoDef => !!a);
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
  fire(
    game: GameCtx, origin: V, aim: V, facing: 1 | -1,
    triggerHeld: boolean, triggerPressed: boolean, dt: number,
  ): FireResult {
    const a = this.ammo;
    const none: FireResult = { fired: false, recoil: v(0, 0), ammo: a, streaming: false };

    if (a.stream) return this.streamFire(game, a, origin, aim, facing, triggerHeld || triggerPressed, dt, none);
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

    for (let i = 0; i < a.count && a.spawn; i++) {
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
    this.payFirstUse(game, a, spawnAt);

    this.kick = 1;
    this.flash = 1;
    game.camera.addTrauma(0.1 + a.heft * 0.32);
    game.camera.addPunch(-a.heft * 0.035);
    game.particles.flash(spawnAt.x, spawnAt.y, 0.3 + a.heft * 0.8, "#fff2c2", 0.1);
    game.particles.sparks(spawnAt.x, spawnAt.y, Math.round(4 + a.heft * 16), 6 + a.heft * 14, "#ffd23f");
    game.particles.smoke(spawnAt.x, spawnAt.y, Math.round(2 + a.heft * 8), 1.5, "#8d95a3");

    return { fired: true, recoil: v(-dir.x * a.recoil, -dir.y * a.recoil), ammo: a, streaming: false };
  }

  /**
   * The continuous path: a hose, not a gun.
   *
   * There is no cooldown, no reserve and no per-shot presentation — the sim on the
   * other end of `stream` owns everything visible. What the weapon still owns is the
   * feel: a steady backward push (dt-scaled, so it is a force rather than a kick)
   * and a barrel that stays warm and shaking while the trigger is down.
   */
  private streamFire(
    game: GameCtx, a: AmmoDef, origin: V, aim: V, facing: 1 | -1,
    held: boolean, dt: number, none: FireResult,
  ): FireResult {
    if (!held) {
      this.streamHeat = Math.max(0, this.streamHeat - dt * 3);
      return none;
    }
    this.streamHeat = Math.min(1, this.streamHeat + dt * 5);
    const dir = norm(aim);
    const spawnAt = muzzleSpawn(origin, dir, a.muzzle);
    a.stream!(game, spawnAt, dir, dt, facing);
    this.payFirstUse(game, a, spawnAt);

    this.kick = Math.max(this.kick, 0.3 + Math.random() * 0.12);
    this.flash = Math.max(this.flash, 0.35);
    game.camera.addTrauma(dt * 0.35);
    return {
      fired: true,
      recoil: v(-dir.x * a.recoil * dt, -dir.y * a.recoil * dt),
      ammo: a,
      streaming: true,
    };
  }

  /** 0..1 while a continuous weapon is running; drives the nozzle glow. */
  streamHeat = 0;

  /**
   * Draws the gun in world space, rotated to `angle` and pivoted at the hand.
   *
   * Pixel art where there is art, procedural shapes where there is not. The fallback is
   * not dead code: it is what lets a nineteenth round be added and played with before
   * anybody has drawn it, and it is what would still be on screen if a future sprite
   * sheet failed to load.
   */
  draw(ctx: Ctx, hand: V, angle: number, time: number) {
    const a = this.ammo;
    const sprite = gunSprite(a.id, a.tint);
    if (sprite) {
      this.drawSprite(ctx, sprite, hand, angle, a.heft);
      return;
    }
    this.drawProcedural(ctx, hand, angle, time);
  }

  /**
   * The pixel-art path.
   *
   * Scale is driven by `heft` rather than fixed, so the chicken cannon still reads as a
   * carbine and the nuke launcher as shoulder-mounted artillery — the sprites carry the
   * character, `heft` carries the weight.
   */
  private drawSprite(ctx: Ctx, sprite: HTMLCanvasElement, hand: V, angle: number, heft: number) {
    const scale = 0.85 + heft * 0.55;
    const recoilShift = -this.kick * (0.1 + heft * 0.24);
    at(ctx, hand.x, hand.y, angle, () => {
      ctx.translate(recoilShift, 0);
      // 20 source pixels back from the muzzle end is where every grip in the set sits,
      // so the gun pivots in the hand rather than swinging from its own back end.
      drawGunSprite(ctx, sprite, 18, scale);

      if (this.flash > 0.02) {
        const f = this.flash;
        const mx = MUZZLE_X(scale);
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

  /** The original code-drawn gun. Kept as the fallback for any round without art. */
  private drawProcedural(ctx: Ctx, hand: V, angle: number, time: number) {
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

      // Continuous weapons carry their reservoir on the receiver and end in a wide
      // cone rather than a bore — you can tell what you are holding at a glance.
      if (a.nozzle) {
        disc(ctx, -len * 0.3, 0.2, 0.17, shade(a.tint, -0.35), "#171b23", 0.04);
        disc(ctx, -len * 0.12, 0.22, 0.14, shade(a.tint, -0.45), "#171b23", 0.04);
        const glow = this.streamHeat;
        poly(ctx, [
          [len * 0.7, -barrelR * 1.1], [len * 0.98, -barrelR * 2.4],
          [len * 0.98, barrelR * 2.4], [len * 0.7, barrelR * 1.1],
        ], shade(a.tint, -0.1), "#171b23", 0.045);
        if (glow > 0.02) {
          disc(ctx, len * 0.98, 0, (0.12 + glow * 0.16), rgba(a.tint, 0.35 + glow * 0.5), null);
        }
      }

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
    // The hose and the flamethrower produce their own effects continuously; a puff of
    // gunsmoke on top of a jet of water makes no sense.
    if (this.ammo.stream) return;
    if (this.kick < 0.25 || Math.random() > dt * 22) return;
    const len = 1.3 + this.ammo.heft;
    game.particles.smoke(hand.x + Math.cos(angle) * len, hand.y + Math.sin(angle) * len, 1, 1.1, "#9aa3b0");
  }

  /** Randomised barrel wobble used while the gun is hot; purely cosmetic. */
  swayAngle(time: number) {
    return Math.sin(time * 2.1) * 0.012 + this.kick * rand(-0.03, 0.03);
  }
}
