import { AMMO } from "../weapons/ammo";
import { blankControl, type Player, type PlayerControl } from "../entities/player";
import { clamp, dist, pick, rand, v, type V } from "../core/math";
import type { GameCtx } from "../core/types";

/** Rounds the demo favours — spectacular and readable at a glance. */
const SHOWCASE = [
  "chicken", "rocket", "car", "elephant", "stickman", "piano",
  "cow", "sawblade", "watermelon", "barrel", "anvil", "plane",
];

/**
 * Attract-mode driver.
 *
 * Fills the same `PlayerControl` a human would, so the demo stickman is the real
 * character running the real physics — not a scripted animation. It roams, picks
 * targets out of the world, swaps to a random showcase round and keeps firing.
 */
export class DemoDriver {
  readonly control: PlayerControl = blankControl();

  private roamTarget = 0;
  private roamTimer = 0;
  private aimPoint: V = v(0, 0);
  private targetTimer = 0;
  private ammoTimer = rand(0.5, 2);
  private fireTimer = 0;
  private burstLeft = 0;
  private jumpTimer = rand(2, 5);
  /** Seconds of jetpack burn left in the current hop. */
  private flyLeft = 0;
  /** Smoothed aim so the gun sweeps between targets instead of snapping. */
  private aimSmooth: V = v(0, 0);

  constructor(private readonly game: GameCtx) {}

  reset(from: V) {
    this.roamTarget = from.x + rand(10, 30);
    this.aimPoint = v(from.x + 12, from.y + 3);
    this.aimSmooth = v(this.aimPoint.x, this.aimPoint.y);
    this.burstLeft = 0;
    this.fireTimer = rand(0.3, 0.9);
  }

  update(dt: number, player: Player, bounds: { min: number; max: number }) {
    const c = this.control;
    const pos = player.pos;

    // --- roaming ------------------------------------------------------------
    this.roamTimer -= dt;
    if (this.roamTimer <= 0 || Math.abs(pos.x - this.roamTarget) < 3) {
      this.roamTimer = rand(3, 7);
      // Drift generally rightward through the level, then loop back near the end.
      const forward = pos.x > bounds.max - 60 ? -1 : 1;
      this.roamTarget = clamp(pos.x + forward * rand(14, 40), bounds.min + 20, bounds.max - 20);
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

    // --- target selection ---------------------------------------------------
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) {
      this.targetTimer = rand(1.1, 2.6);
      const found = this.pickTarget(pos);
      if (found) this.aimPoint = found;
    }

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
      const id = pick(SHOWCASE);
      const idx = AMMO.findIndex((a) => a.id === id);
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
        this.fireTimer = ammo.cooldown + rand(0.15, 0.5);
        this.burstLeft--;
      } else if (ammo.auto && this.fireTimer <= 0) {
        this.burstLeft = 0;
        c.fireHeld = false;
        this.fireTimer = rand(0.6, 1.4);
      }
    } else {
      c.fireHeld = false;
      if (this.fireTimer <= 0) {
        // Automatics get a timed hold; heavy rounds get a few deliberate shots.
        this.burstLeft = ammo.auto ? 1 : Math.round(rand(1, 3));
        this.fireTimer = ammo.auto ? rand(0.7, 1.6) : 0;
        if (ammo.auto) c.fireHeld = true;
      }
    }
  }

  /**
   * Picks something worth shooting: a standing enemy or an intact block ahead of the
   * character, biased toward things far enough away to make an arc worth watching.
   */
  private pickTarget(from: V): V | null {
    const list = this.game.damageables();
    if (list.length < 2) return null;

    let best: V | null = null;
    let bestScore = -Infinity;
    // Sample rather than scan: the list runs to hundreds of blocks.
    for (let i = 0; i < 26; i++) {
      const a = list[1 + ((Math.random() * (list.length - 1)) | 0)];
      if (!a || a.dead || !a.cullPos) continue;
      const p = a.cullPos();
      const d = dist(from, p);
      if (d < 6 || d > 55) continue;
      // Prefer targets ahead, high up, and a satisfying distance out.
      const ahead = Math.sign(p.x - from.x) === Math.sign(this.roamTarget - from.x) ? 1 : 0.35;
      const score = ahead * (1 + p.y * 0.09) * (1 - Math.abs(d - 26) / 55) + rand(0, 0.3);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }
}
