import type { GameCtx } from "../core/types";
import type { Ragdoll } from "../entities/ragdoll";
import { clamp, rand, v, type V } from "../core/math";
import { G, ig } from "../core/physics";
import { sfx } from "./audio";
import { anchorAt, canMark } from "./decals";
import { kill as juiceKill } from "./juice";

/**
 * Everything that happens to a body after it stops being a body.
 *
 * The rule is that force decides how messy the result is. An ordinary killing blow
 * leaves a corpse and a spreading pool; a rocket, a car or a two-tonne anvil takes
 * the skeleton apart, and the pieces are real rigid bodies that keep tumbling,
 * bleeding and piling up where they land.
 */

/** Limbs a full-detail biped can lose, roughly outside-in. */
const BIPED_LIMBS = [
  "armFrontLo", "armBackLo", "footFront", "footBack",
  "shinFront", "shinBack", "armFrontUp", "armBackUp",
  "thighFront", "thighBack",
];
/** The seven-body version. */
const LITE_LIMBS = ["armFront", "armBack", "legFront", "legBack"];

/**
 * A wet burst of blood, thrown along `dir`. Deliberately over-committed: two layers
 * of droplets at different speeds and sizes, plus a fine mist that hangs in the air.
 */
export function bloodBurst(
  game: GameCtx, at: V, dir: V | undefined, amount: number, color = "#c0263a",
  velX = 0, velY = 0,
) {
  const n = clamp(Math.round(amount), 3, 90);
  game.particles.blood(at.x, at.y, n, dir, 11, color);
  game.particles.blood(at.x, at.y, Math.round(n * 0.55), dir, 22, color);
  // A body that is already moving throws its blood downrange rather than straight out.
  // A third of the carrier's velocity: enough to lean the burst visibly, not so much
  // that the spray outruns the corpse it came from.
  if (velX !== 0 || velY !== 0) {
    game.particles.spray(at.x, at.y, Math.max(2, n >> 2), velX, velY, 2, color, 0.5, velX / 3, velY / 3);
  }
  // Fine mist: small and fast-fading, the part that reads as spray rather than dots.
  // It still falls at a decent clip — mist that hangs around too long stops looking
  // like blood in the air and starts looking like blood stuck in the air.
  for (let i = 0; i < Math.round(n * 0.5); i++) {
    const a = rand(0, Math.PI * 2);
    game.particles.emit("blood", at.x, at.y, {
      vx: Math.cos(a) * rand(0.5, 3.5), vy: Math.sin(a) * rand(0.5, 3.5) + 1,
      maxLife: rand(0.35, 0.9), size: rand(0.03, 0.08),
      drag: 1.8, gravity: -17, color,
    });
  }
}

/**
 * Drops a pool of blood on whatever surface is below the wound.
 *
 * Raycasting down is what keeps pools *on* things: bleed out on a rooftop and the
 * pool is on the roof, not on the ground forty metres under it.
 */
export function bloodPool(game: GameCtx, at: V, radius: number, color = "#8e1220") {
  const hit = game.physics.rayCast(at, v(0, -1), 9, ig(G.SENSOR, G.TERRAIN | G.BLOCK));
  if (!hit) return;
  const x = hit.point.x;
  const y = hit.point.y + 0.06;
  // Anchored to the surface it landed on, so blood spilt on a wall goes down with the
  // wall instead of hanging in the air once the building comes apart.
  game.decals.blood(x, y, radius, color, anchorAt(hit.owner, hit.body, x, y));
}

/**
 * Throws blood *downrange* and paints it on whatever stops it.
 *
 * A pool under the wound says a body bled here. A streak up the wall behind it says the
 * round went through, which is a different and better sentence. Raycast along the throw
 * so the mark lands on real geometry — and only on geometry that will still be there,
 * which is what `canMark` is for.
 */
export function bloodSplatter(game: GameCtx, at: V, dir: V, reach = 4, color = "#8e1220") {
  const l = Math.hypot(dir.x, dir.y);
  if (l < 1e-6) return;
  const d = v(dir.x / l, dir.y / l);
  const hit = game.physics.rayCast(at, d, reach, ig(G.SENSOR, G.TERRAIN | G.BLOCK));
  if (!hit || !canMark(hit.owner)) return;
  const x = hit.point.x - d.x * 0.05;
  const y = hit.point.y - d.y * 0.05;
  game.decals.splatter(x, y, d.x, d.y, rand(0.3, 0.7), color, anchorAt(hit.owner, hit.body, x, y));
}

/**
 * Takes limbs off a skeleton in proportion to how hard it was hit.
 *
 * `damage` is the size of the blow relative to what the body could take: 1 is exactly
 * lethal, 4 is a direct rocket, 60+ is standing under the nuke. Below 1.2 nothing comes
 * off — an ordinary kill should still leave a recognisable corpse — only genuine
 * overkill takes the head, and only a detonation takes everything.
 *
 * @returns how many parts were removed.
 */
export function severLimbs(game: GameCtx, r: Ragdoll, damage: number): number {
  if (r.disposed) return 0;
  const over = damage / Math.max(1, r.maxHp);
  if (over < 1.2) return 0;

  const want = over >= 9 ? 99 : over >= 4 ? 4 : over >= 2.6 ? 3 : over >= 1.7 ? 2 : 1;
  const pool = (r.has("armBack") ? LITE_LIMBS : BIPED_LIMBS).filter((n) => r.joints.has(n));
  // Shuffled so repeated overkills don't always take the same arm first.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (over >= 2.4 && Math.random() < 0.55 && r.joints.has("head")) pool.unshift("head");

  let cut = 0;
  const color = r.splatColor;
  const c = r.center();
  const vel = r.velocity();
  for (const name of pool) {
    if (cut >= want) break;
    const p = r.sever(name);
    if (!p) continue;
    cut++;
    bloodBurst(game, p, undefined, 26, color, vel.x, vel.y);
    bloodPool(game, p, rand(0.5, 1.1), color);
    // Bone shards leave along the axis the limb was torn off, i.e. out from the pelvis,
    // rather than in a ball — a limb that came off has a direction and should show it.
    game.particles.spray(p.x, p.y, 5, p.x - c.x, p.y - c.y, 5, "#e8dcc4", 0.8, vel.x * 0.3, vel.y * 0.3);
    bloodSplatter(game, p, vel, 4, "#8e1220");
  }

  if (cut > 0) {
    // One curve for every violent thing in the game — see `fx/juice`. Dismemberment is
    // graded on the same overkill ratio that decided how many limbs came off, so the
    // response and the damage can never disagree about how bad it was.
    juiceKill(game, c, over, vel.x, vel.y, color);
    sfx.splat();
    sfx.gib();
  }
  return cut;
}

/**
 * Per-frame bleeding from open wounds. Called by whatever owns the ragdoll, since the
 * skeleton itself has no update of its own.
 */
export function bleed(game: GameCtx, r: Ragdoll, dt: number) {
  if (r.severedBones.size === 0 || r.disposed || !r.enabled) return;
  r.bleedTimer -= dt;
  if (r.bleedTimer > 0) return;
  r.bleedTimer = rand(0.05, 0.13);

  for (const name of r.severedBones) {
    const b = r.bones.get(name);
    if (!b) continue;
    const t = b.body.translation();
    const rot = b.body.rotation();
    const half = b.shape === "ball" ? b.hw * 0.8 : b.hh - (b.shape === "capsule" ? b.hw : 0);
    // The wound sits at the bone's proximal (+Y) end, which is where it was cut.
    const wx = t.x - Math.sin(rot) * half;
    const wy = t.y + Math.cos(rot) * half;
    game.particles.blood(wx, wy, 2, v(0, -1), 2.5, r.splatColor);
    if (Math.random() < 0.12) bloodPool(game, v(wx, wy), rand(0.25, 0.6), "#8e1220");
  }
}
