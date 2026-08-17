import RAPIER from "@dimforge/rapier2d-compat";
import { clamp, dist, norm, v, type V } from "./math";

/**
 * Collision membership bits. Rapier packs interaction groups as
 * `(membership << 16) | filter`, so use `ig()` rather than writing them by hand.
 */
export const G = {
  TERRAIN: 1 << 0,
  BLOCK: 1 << 1,
  PLAYER: 1 << 2,
  ENEMY: 1 << 3,
  PROJECTILE: 1 << 4,
  DEBRIS: 1 << 5,
  SENSOR: 1 << 6,
} as const;

export const ALL = 0xffff;

export const ig = (membership: number, filter: number) =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

/** Debris is chatty and cheap — it ignores itself and the player so it never shoves them around. */
export const FILTER = {
  TERRAIN: ig(G.TERRAIN, ALL),
  BLOCK: ig(G.BLOCK, ALL),
  PLAYER: ig(G.PLAYER, ALL & ~G.DEBRIS),
  ENEMY: ig(G.ENEMY, ALL & ~G.DEBRIS),
  PROJECTILE: ig(G.PROJECTILE, ALL & ~G.DEBRIS),
  DEBRIS: ig(G.DEBRIS, G.TERRAIN | G.BLOCK),
};

/** What kind of thing a body belongs to, used to route impact damage. */
export type OwnerKind = "block" | "projectile" | "ragdoll" | "terrain" | "debris";

export interface PhysOwner {
  readonly kind: OwnerKind;
  /** Unique per ragdoll instance; parts sharing an id never collide with each other. */
  readonly selfGroup?: number;
  dead?: boolean;
  /**
   * @param energy Impact kinetic energy in joules-ish units (mass * v^2 / 2).
   */
  onImpact?(other: PhysOwner | null, energy: number, point: V, normal: V): void;
  takeDamage?(amount: number, point?: V, source?: PhysOwner | null): void;
  /**
   * "Something just happened near you." Anchored blocks use this to convert
   * themselves from static to dynamic so they can fall.
   */
  disturb?(): void;
}

export interface ImpactEvent {
  a: PhysOwner | null;
  b: PhysOwner | null;
  energy: number;
  speed: number;
  point: V;
  normal: V;
}

let nextSelfGroup = 1;
export const newSelfGroup = () => nextSelfGroup++;

export class Physics {
  world!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private hooks!: RAPIER.PhysicsHooks;

  /** colliderHandle -> owning gameplay object. */
  private owners = new Map<number, PhysOwner>();
  /** colliderHandle -> ragdoll instance id (0 = not part of a ragdoll). */
  private selfGroups = new Map<number, number>();

  /** Impacts collected during the last `step()`, drained by the game each frame. */
  readonly impacts: ImpactEvent[] = [];

  static async load() {
    await RAPIER.init();
  }

  constructor(gravityY = -26) {
    this.world = new RAPIER.World(v(0, gravityY));
    this.world.integrationParameters.numSolverIterations = 6;
    this.world.maxCcdSubsteps = 2;
    this.events = new RAPIER.EventQueue(true);

    const selfGroups = this.selfGroups;
    this.hooks = {
      // Adjacent limbs of one ragdoll overlap by design; letting them collide makes
      // the solver fight the joints and the whole body buzzes.
      filterContactPair(c1, c2) {
        const g1 = selfGroups.get(c1);
        if (g1 !== undefined && g1 === selfGroups.get(c2)) return null;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair(c1, c2) {
        const g1 = selfGroups.get(c1);
        return !(g1 !== undefined && g1 === selfGroups.get(c2));
      },
    };
  }

  // ---------------------------------------------------------------- registration

  register(collider: RAPIER.Collider, owner: PhysOwner) {
    this.owners.set(collider.handle, owner);
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (owner.selfGroup) {
      this.selfGroups.set(collider.handle, owner.selfGroup);
      collider.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    }
  }

  ownerOf(handle: number): PhysOwner | null {
    return this.owners.get(handle) ?? null;
  }

  /** Removes a body and every collider hanging off it, keeping the lookup maps tidy. */
  removeBody(body: RAPIER.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) {
      const h = body.collider(i).handle;
      this.owners.delete(h);
      this.selfGroups.delete(h);
    }
    this.world.removeRigidBody(body);
  }

  removeJoint(joint: RAPIER.ImpulseJoint) {
    this.world.removeImpulseJoint(joint, true);
  }

  // ---------------------------------------------------------------- simulation

  step(dt: number) {
    this.world.timestep = dt;
    this.impacts.length = 0;
    this.world.step(this.events, this.hooks);

    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owners.get(h1) ?? null;
      const b = this.owners.get(h2) ?? null;
      if (!a && !b) return;

      const c1 = this.world.getCollider(h1);
      const c2 = this.world.getCollider(h2);
      if (!c1 || !c2) return;
      const b1 = c1.parent();
      const b2 = c2.parent();

      // Relative approach speed at the contact drives everything: damage, sound,
      // particles. Deriving it ourselves is far easier to tune than raw solver forces.
      const v1 = b1 ? b1.linvel() : { x: 0, y: 0 };
      const v2 = b2 ? b2.linvel() : { x: 0, y: 0 };
      const rel = v(v1.x - v2.x, v1.y - v2.y);
      const speed = Math.hypot(rel.x, rel.y);
      if (speed < 2.2) return;

      const m1 = b1 && b1.isDynamic() ? b1.mass() : Infinity;
      const m2 = b2 && b2.isDynamic() ? b2.mass() : Infinity;
      // Reduced mass: a pebble hitting a wall carries the pebble's energy, not the wall's.
      const reduced = !isFinite(m1) ? m2 : !isFinite(m2) ? m1 : (m1 * m2) / (m1 + m2);
      if (!isFinite(reduced) || reduced <= 0) return;

      const p1 = c1.translation();
      const p2 = c2.translation();
      const point = v((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);

      this.impacts.push({
        a, b,
        energy: 0.5 * reduced * speed * speed,
        speed,
        point,
        normal: norm(v(p2.x - p1.x, p2.y - p1.y)),
      });
    });
  }

  // ---------------------------------------------------------------- queries

  /** Downward ground probe. Returns the hit distance, or `null` if nothing within `maxDist`. */
  groundRay(from: V, maxDist: number, exclude?: RAPIER.RigidBody): number | null {
    const ray = new RAPIER.Ray(from, v(0, -1));
    const hit = this.world.castRay(
      ray, maxDist, true,
      undefined, ig(G.PLAYER, G.TERRAIN | G.BLOCK),
      undefined, exclude,
    );
    return hit ? hit.timeOfImpact : null;
  }

  /** Every dynamic body whose origin sits within `radius` of `center`. */
  bodiesInRadius(center: V, radius: number): RAPIER.RigidBody[] {
    const found = new Set<RAPIER.RigidBody>();
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(center, 0, shape, (collider) => {
      const b = collider.parent();
      if (b && b.isDynamic()) found.add(b);
      return true;
    });
    return [...found];
  }

  /**
   * Every gameplay object whose collider overlaps a circle. The list is fully
   * materialised before returning, so callers may safely mutate the world with it.
   */
  ownersInRadius(center: V, radius: number): PhysOwner[] {
    const found = new Set<PhysOwner>();
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(center, 0, shape, (collider) => {
      const o = this.owners.get(collider.handle);
      if (o) found.add(o);
      return true;
    });
    return [...found];
  }

  /**
   * Collects every distinct body overlapping a circle, together with its owner and a
   * linear distance falloff.
   *
   * Rapier's query pipeline is **not re-entrant**: mutating the world (converting a
   * body to dynamic, removing it) or starting a second query from inside an
   * `intersectionsWith*` callback corrupts the traversal and silently drops hits.
   * Every radial effect therefore gathers first and acts afterwards.
   */
  private gatherInRadius(center: V, radius: number) {
    const shape = new RAPIER.Ball(radius);
    const seen = new Set<number>();
    const out: { body: RAPIER.RigidBody; owner: PhysOwner | null; falloff: number; pos: V }[] = [];

    this.world.intersectionsWithShape(center, 0, shape, (collider) => {
      const body = collider.parent();
      if (!body || seen.has(body.handle)) return true;
      seen.add(body.handle);
      const p = body.translation();
      out.push({
        body,
        owner: this.owners.get(collider.handle) ?? null,
        falloff: clamp(1 - dist(center, p) / radius, 0.05, 1),
        pos: v(p.x, p.y),
      });
      return true;
    });
    return out;
  }

  /**
   * Radial impulse + damage. Falloff is linear in distance, which reads as "punchy but fair";
   * inverse-square makes near-misses feel like nothing happened.
   *
   * Anchored blocks are disturbed *before* the impulse is computed, so a blast frees
   * them and throws them in the same frame instead of leaving a static hole in the wall.
   */
  explode(center: V, radius: number, force: number, damage: number, source?: PhysOwner | null) {
    const hits = this.gatherInRadius(center, radius);

    // Impulses are per body — every limb should get thrown. Damage is per *owner*:
    // a ragdoll is 13 bodies sharing one owner, and charging it once per bone made a
    // single rocket deal 13x damage and instantly kill anything with a skeleton.
    const damaged = new Map<PhysOwner, { falloff: number; pos: V }>();

    for (const hit of hits) {
      hit.owner?.disturb?.();
      if (hit.owner?.takeDamage) {
        const prev = damaged.get(hit.owner);
        if (!prev || hit.falloff > prev.falloff) {
          damaged.set(hit.owner, { falloff: hit.falloff, pos: hit.pos });
        }
      }

      const body = hit.body;
      if (!body.isDynamic()) continue;
      const dir = norm(v(hit.pos.x - center.x, hit.pos.y - center.y + 0.35));
      const m = body.mass();
      const f = force * hit.falloff * m;
      body.applyImpulse(v(dir.x * f, dir.y * f), true);
      // A touch of spin so debris tumbles instead of sliding out flat.
      body.applyTorqueImpulse((Math.random() - 0.5) * f * 0.09, true);
    }

    // Applied last: a death here can remove bodies we were still iterating over.
    for (const [owner, d] of damaged) {
      owner.takeDamage?.(damage * d.falloff, d.pos, source ?? null);
    }
  }

  /** Pulls everything toward a point — the black hole round. */
  attract(center: V, radius: number, strength: number, dt: number) {
    for (const hit of this.gatherInRadius(center, radius)) {
      // The singularity tears anchored masonry out of the walls too.
      hit.owner?.disturb?.();
      const body = hit.body;
      if (!body.isDynamic()) continue;
      const d = Math.max(0.6, dist(center, hit.pos));
      const dir = norm(v(center.x - hit.pos.x, center.y - hit.pos.y));
      const pull = (strength / d) * body.mass() * dt;
      body.applyImpulse(v(dir.x * pull, dir.y * pull), true);
    }
  }

  get bodyCount() {
    return this.world.bodies.len();
  }
}

export { RAPIER };
