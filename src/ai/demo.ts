import { blankControl, type Player, type PlayerControl } from "../entities/player";
import { clamp, pick, rand, v, type V } from "../core/math";
import type { GameCtx } from "../core/types";

/**
 * Rounds the demo favours, best first.
 *
 * Resolved against the player's *current* loadout rather than the global arsenal — see
 * `pickRound`. The menu backdrop runs on whatever a given save has unlocked, and a new
 * save has five rounds, so the list has to degrade to what is actually carried instead
 * of assuming everything is available.
 */
const SHOWCASE = [
  // `balloon` sits high on purpose. It is the one round whose effect keeps developing
  // for six seconds after the shot, which is exactly the shape a menu backdrop wants —
  // the other favourites are over in a second and a half.
  "rocket", "car", "balloon", "elephant", "piano", "plane", "sawblade", "barrel",
  "stickman", "chicken", "watermelon", "anvil", "tv", "bowling",
];

/**
 * The round the attract loop opens with. The menu's first second is the only one every
 * single player sees, so it is spent on something that leaves a crater — and the list
 * is ordered so that a brand-new save (chicken, watermelon, anvil, barrel, rocket)
 * still finds the rocket rather than falling through to the chicken.
 */
const OPENERS = ["rocket", "car", "elephant", "piano", "plane", "barrel"];

/** Width of the density buckets the demo reasons about — roughly one set-piece. */
const BUCKET = 7;

/** How far out the demo likes its targets: far enough to watch the round travel. */
const IDEAL_RANGE = 22;

/** Longest the attract mode is ever allowed to go without pulling the trigger. */
const MAX_SILENCE = 1.8;

/** A worthwhile place to shoot: where the stuff is, and how far up to hit it. */
interface Cluster {
  x: number;
  y: number;
  /** Damageables in the bucket. Density is what separates a set-piece from a rock. */
  count: number;
}

/**
 * Attract-mode driver.
 *
 * Fills the same `PlayerControl` a human would, so the demo stickman is the real
 * character running the real physics — not a scripted animation.
 *
 * It aims at *density* rather than at individual blocks. Sampling the damageable list
 * uniformly, which is what this used to do, spends most of its shots on whichever lone
 * crate the sampler happened to hit, and a menu backdrop where nothing visibly falls
 * over is the same as no backdrop at all. Bucketing the world by position and shooting
 * the fullest bucket means every shot lands on a structure, and aiming a quarter of the
 * way up its height means the structure comes down instead of being chipped.
 */
export class DemoDriver {
  readonly control: PlayerControl = blankControl();

  private roamTarget = 0;
  private roamTimer = 0;
  private aimPoint: V = v(0, 0);
  private targetTimer = 0;
  private ammoTimer = 0;
  private fireTimer = 0;
  private burstLeft = 0;
  private jumpTimer = rand(2, 5);
  /** Seconds of jetpack burn left in the current hop. */
  private flyLeft = 0;
  /** Smoothed aim so the gun sweeps between targets instead of snapping. */
  private aimSmooth: V = v(0, 0);
  /** Which way the demo is currently working through the level. */
  private forward: 1 | -1 = 1;
  /** True until the opening round has been chosen, so the loop starts loud. */
  private opening = true;
  /** Seconds since the last shot, so the backdrop can never fall silent. */
  private sinceShot = 0;

  constructor(private readonly game: GameCtx) {}

  reset(from: V) {
    this.forward = 1;
    this.opening = true;
    this.sinceShot = 0;
    this.burstLeft = 0;
    // Pick the opening target before the first frame rather than aiming at a fixed
    // offset and hoping. The level is fully built by the time the menu constructs us,
    // so there is no reason for the first shot of the attract loop to be a guess.
    const open = this.pickTarget(from);
    this.aimPoint = open ? v(open.x, open.y) : v(from.x + 16, from.y + 3);
    this.aimSmooth = v(this.aimPoint.x, this.aimPoint.y);
    this.roamTarget = this.aimPoint.x - IDEAL_RANGE;
    this.targetTimer = rand(0.9, 1.5);
    this.ammoTimer = 0;
    // Long enough for the weapon swap to land on the player's next update, short
    // enough that the menu is already firing before anyone has read the title.
    this.fireTimer = 0.25;
  }

  update(dt: number, player: Player, bounds: { min: number; max: number }) {
    const c = this.control;
    const pos = player.pos;
    this.sinceShot += dt;

    // --- target selection ---------------------------------------------------
    // Retarget early if the trigger has gone quiet: it means whatever we were aiming
    // at is gone, or was never worth shooting.
    this.targetTimer -= dt;
    if (this.targetTimer <= 0 || this.sinceShot > MAX_SILENCE) {
      this.targetTimer = rand(1.1, 2.4);
      const found = this.pickTarget(pos);
      if (found) {
        this.aimPoint = v(found.x, found.y);
        this.forward = found.x >= pos.x ? 1 : -1;
        // Stand off from the set-piece rather than walking into it, so the round has
        // room to arc and the collapse happens in frame rather than on top of us.
        this.roamTarget = clamp(found.x - this.forward * IDEAL_RANGE, bounds.min + 12, bounds.max - 12);
        this.roamTimer = rand(3, 6);
      }
    }

    // --- roaming ------------------------------------------------------------
    this.roamTimer -= dt;
    if (this.roamTimer <= 0) {
      this.roamTimer = rand(3, 7);
      // Turn around near the far end so the demo works the level rather than pinning
      // itself against a wall.
      if (pos.x > bounds.max - 45) this.forward = -1;
      else if (pos.x < bounds.min + 45) this.forward = 1;
      this.roamTarget = clamp(pos.x + this.forward * rand(16, 40), bounds.min + 12, bounds.max - 12);
    }
    const dx = this.roamTarget - pos.x;
    c.moveX = Math.abs(dx) < 1.5 ? 0 : Math.sign(dx);

    // Jump, and sometimes hold it to show the jetpack off.
    this.jumpTimer -= dt;
    if (this.jumpTimer <= 0) {
      this.jumpTimer = rand(2.5, 6);
      c.jumpPressed = true;
      this.flyLeft = Math.random() < 0.55 ? rand(0.9, 2.2) : 0;
    }
    this.flyLeft = Math.max(0, this.flyLeft - dt);
    c.jumpHeld = this.flyLeft > 0;

    // Sweep toward the target and add a slow wander so it never looks locked on.
    const rate = 1 - Math.exp(-4.5 * dt);
    this.aimSmooth.x += (this.aimPoint.x - this.aimSmooth.x) * rate;
    this.aimSmooth.y += (this.aimPoint.y - this.aimSmooth.y) * rate;
    const t = this.game.time;
    c.aimWorld = v(
      this.aimSmooth.x + Math.sin(t * 1.7) * 1.2,
      this.aimSmooth.y + Math.cos(t * 2.3) * 0.8,
    );

    // --- weapon -------------------------------------------------------------
    this.ammoTimer -= dt;
    if (this.ammoTimer <= 0) {
      this.ammoTimer = rand(3.5, 7);
      const idx = this.pickRound(player, this.opening);
      this.opening = false;
      if (idx >= 0) c.selectAmmo = idx;
      this.burstLeft = 0;
    }

    const ammo = player.weapon.ammo;
    this.fireTimer -= dt;
    if (this.burstLeft > 0) {
      // Mid-burst: hold for automatics, re-press for everything else.
      c.fireHeld = ammo.auto;
      if (!ammo.auto && this.fireTimer <= 0) {
        c.firePressed = true;
        this.sinceShot = 0;
        this.fireTimer = ammo.cooldown + rand(0.15, 0.5);
        this.burstLeft--;
      } else if (ammo.auto && this.fireTimer <= 0) {
        this.burstLeft = 0;
        c.fireHeld = false;
        this.fireTimer = rand(0.6, 1.4);
      }
    } else {
      c.fireHeld = false;
      // The silence clause: whatever the cadence says, the backdrop starts a new burst
      // if it has been quiet. A menu that pauses reads as a menu that has crashed.
      if (this.fireTimer <= 0 || this.sinceShot > MAX_SILENCE) {
        // Automatics get a timed hold; heavy rounds get a few deliberate shots.
        this.burstLeft = ammo.auto ? 1 : Math.round(rand(1, 3));
        this.fireTimer = ammo.auto ? rand(0.7, 1.6) : 0;
        if (ammo.auto) {
          c.fireHeld = true;
          this.sinceShot = 0;
        }
      }
    }
  }

  /**
   * Resolves a showcase id to a slot in the player's **own** ammo list.
   *
   * `PlayerControl.selectAmmo` indexes `Weapon.list`, which is the loadout, not the
   * global arsenal. Indexing the arsenal instead — as this did — is silently wrong for
   * anyone who has not unlocked everything: `select()` takes the index modulo a shorter
   * list, so a fresh save asking for the piano got the anvil and a request for the
   * sawblade got a watermelon. That is worst precisely for a first-time player, whose
   * menu is the one this exists to sell.
   */
  private pickRound(player: Player, opening: boolean): number {
    const list = player.weapon.list;
    if (opening) {
      // Ordered preference, so the opening shot is the loudest thing actually carried.
      for (const id of OPENERS) {
        const i = list.findIndex((a) => a.id === id);
        if (i >= 0) return i;
      }
      return -1;
    }
    const carried = SHOWCASE.filter((id) => list.some((a) => a.id === id));
    if (!carried.length) return list.length ? (Math.random() * list.length) | 0 : -1;
    return list.findIndex((a) => a.id === pick(carried));
  }

  /**
   * Finds the densest worthwhile pile of world within reach.
   *
   * One pass over the damageable list, bucketed by position: a bucket holding forty
   * blocks is a tower, a bucket holding two is debris, and the demo should always be
   * shooting the tower. The aim height is a quarter of the way up the bucket's contents
   * because that is where a structure fails — hitting the top of a tower removes a
   * storey, hitting the bottom removes the tower.
   */
  private pickTarget(from: V): Cluster | null {
    const list = this.game.damageables();
    if (list.length < 2) return null;

    const buckets = new Map<number, { sx: number; lo: number; hi: number; n: number }>();
    // Index 0 is always the player. Shooting yourself is not a showcase.
    for (let i = 1; i < list.length; i++) {
      const a = list[i];
      if (a.dead || !a.cullPos) continue;
      const p = a.cullPos();
      const k = Math.floor(p.x / BUCKET);
      const b = buckets.get(k);
      if (!b) buckets.set(k, { sx: p.x, lo: p.y, hi: p.y, n: 1 });
      else {
        b.sx += p.x;
        b.lo = Math.min(b.lo, p.y);
        b.hi = Math.max(b.hi, p.y);
        b.n++;
      }
    }

    let best: Cluster | null = null;
    let bestScore = -Infinity;
    for (const b of buckets.values()) {
      const cx = b.sx / b.n;
      const d = Math.abs(cx - from.x);
      if (d < 5 || d > 62) continue;
      const ahead = Math.sign(cx - from.x) === this.forward ? 1 : 0.4;
      const fit = 1 - Math.abs(d - IDEAL_RANGE) / 62;
      // Jitter keeps a run of attract loops from playing out identically.
      const score = b.n * ahead * fit + rand(0, 2);
      if (score > bestScore) {
        bestScore = score;
        best = { x: cx, y: b.lo + (b.hi - b.lo) * 0.25, count: b.n };
      }
    }
    return best;
  }
}
