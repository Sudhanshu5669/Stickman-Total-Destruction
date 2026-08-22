import { RAPIER, type Physics, type PhysOwner, newSelfGroup, FILTER, ig, G, ALL } from "../core/physics";
import { clamp, rand, v, type V } from "../core/math";

export type BoneShape = "box" | "ball" | "capsule";

export interface BoneSpec {
  name: string;
  /** Centre in ragdoll-local space: origin at the feet, +X is the facing direction, +Y up. */
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: BoneShape;
  density?: number;
  parent?: string;
  /** Revolute anchor, also in ragdoll-local space. Omitted for the root bone. */
  jx?: number;
  jy?: number;
  /** Joint limits in radians, relative to the rest pose. */
  min?: number;
  max?: number;
  /** Bones are drawn as thick strokes; this is the stroke width in metres. */
  thick?: number;
  color?: string;
}

export interface RagdollSpec {
  name: string;
  /** Nominal height in metres, used to scale everything else. */
  height: number;
  bones: BoneSpec[];
  /** Rough total mass at scale 1, used to normalise densities. */
  mass: number;
}

export interface Bone {
  name: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** Half-extents (or radius in `.x` for balls), already scaled. */
  hw: number;
  hh: number;
  shape: BoneShape;
  thick: number;
  color: string;
  parent: Bone | null;
  /** Cut free of its parent. Renders a stump and keeps bleeding. */
  severed?: boolean;
}

export interface Joint {
  name: string;
  joint: RAPIER.RevoluteImpulseJoint;
  child: Bone;
  parent: Bone;
  min: number;
  max: number;
  /** Current motor target, in the same convention as the limits. */
  target: number;
  stiffness: number;
  damping: number;
}

export interface RagdollOptions {
  x: number;
  y: number;
  /** +1 faces right, -1 faces left. Mirrors the whole skeleton. */
  facing?: 1 | -1;
  scale?: number;
  angle?: number;
  /** Multiplies every bone density; 1 reproduces `spec.mass`. */
  massScale?: number;
  group?: number;
  filter?: number;
  linvel?: V;
  angvel?: number;
  ccd?: boolean;
  color?: string;
  /** Enables continuous soft-CCD, worth it for anything fired out of the gun. */
  bullet?: boolean;
}

/**
 * A jointed rigid-body skeleton. Both the player and every enemy/ammo creature use
 * this; the difference is only which controller drives the joint motors.
 *
 * Rapier does not filter collisions between jointed bodies, so every ragdoll gets a
 * `selfGroup` that `Physics` uses to drop same-skeleton contact pairs. Without it the
 * solver fights the joints and the whole body vibrates apart.
 */
export class Ragdoll implements PhysOwner {
  readonly kind = "ragdoll" as const;
  readonly selfGroup = newSelfGroup();

  readonly bones = new Map<string, Bone>();
  readonly boneList: Bone[] = [];
  readonly joints = new Map<string, Joint>();
  readonly jointList: Joint[] = [];
  readonly root: Bone;
  readonly scale: number;
  readonly facing: 1 | -1;
  readonly spec: RagdollSpec;

  hp = 100;
  maxHp = 100;
  dead = false;
  limp = false;
  /** Flash-frozen by the fridge round: goes limp and shatters on the next contact. */
  frozen = false;
  /** Cleared on the player — being one-shot by your own fridge is not a feature. */
  freezable = true;
  /** Set when the ragdoll's own bodies have been removed from the world. */
  disposed = false;

  /** Impact energy (kJ) absorbed for free — below this, bumps do nothing. */
  impactIgnore = 0.9;
  /** Damage per kJ of impact energy above `impactIgnore`. */
  impactFragility = 17;
  /** Flat damage this body deals to whatever it collides with. */
  bonusDamage = 0;
  splatColor = "#c0263a";
  /** Blocks damage entirely — used for the player's respawn grace period. */
  invulnerable = false;
  /**
   * Multiplies all incoming damage. The player runs well below 1: the whole game is
   * built around firing ordnance at close range, and taking full blast damage from
   * your own rocket makes the fun weapons unusable.
   */
  damageScale = 1;

  onDeath?: (self: Ragdoll) => void;
  onHurt?: (self: Ragdoll, amount: number, at: V) => void;

  // ------------------------------------------------------------------ gore/heat

  /** Bones cut free of the skeleton, by name. */
  readonly severedBones = new Set<string>();
  /** Size of the blow that last landed, so death can decide how messy it was. */
  lastDamage = 0;
  /**
   * What kind of thing landed that blow — the whole basis of the death callouts.
   *
   * The alternative was threading the *identity* of the killer through the physics
   * graph so a kill could name the round that did it. It isn't worth it: the spawn
   * closures in `weapons/ammo.ts` never see their own `AmmoDef`, so naming the round
   * would mean editing nineteen call sites to carry a string that the funniest half of
   * the callouts don't even use. Being crushed by masonry, dropped by the floor or
   * bowled over by another stickman are all *physics* outcomes, which is exactly where
   * the spec says the comedy is supposed to come from. See `fx/callout.ts`.
   */
  lastHitKind: PhysOwner["kind"] | null = null;
  /** Accumulates between blood drips from open wounds. */
  bleedTimer = 0;

  /** Flesh catches easily. Cleared on things that have no business burning. */
  flammability = 0.55;
  /** 0..1 alight, written by the fire sim; the renderer reads it for char and embers. */
  burning = 0;
  /** 0..1 soaked, written by the water sim. Soaked bodies will not light. */
  soaked = 0;

  firePos(): V {
    return this.center();
  }

  get fireSize() {
    return 0.75 * this.scale;
  }

  constructor(
    private readonly physics: Physics,
    spec: RagdollSpec,
    opts: RagdollOptions,
  ) {
    this.spec = spec;
    this.scale = opts.scale ?? 1;
    this.facing = opts.facing ?? 1;

    const s = this.scale;
    const f = this.facing;
    const ang = opts.angle ?? 0;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const group = opts.group ?? G.ENEMY;
    const filter = opts.filter ?? (ALL & ~G.DEBRIS);
    const massScale = opts.massScale ?? 1;

    // Ragdoll-local -> world. Mirroring happens before rotation so `facing` stays intuitive.
    const toWorld = (lx: number, ly: number): V => {
      const mx = lx * f * s;
      const my = ly * s;
      return v(opts.x + mx * cos - my * sin, opts.y + mx * sin + my * cos);
    };

    for (const b of spec.bones) {
      const p = toWorld(b.x, b.y);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y)
        .setRotation(ang)
        .setLinearDamping(0.06)
        .setAngularDamping(0.55)
        .setCcdEnabled(!!opts.ccd);
      if (opts.bullet) desc.setSoftCcdPrediction(1.5);
      if (opts.linvel) desc.setLinvel(opts.linvel.x, opts.linvel.y);
      if (opts.angvel) desc.setAngvel(opts.angvel);
      const body = this.physics.world.createRigidBody(desc);

      const hw = (b.w * s) / 2;
      const hh = (b.h * s) / 2;
      const shape = b.shape ?? "box";
      let cdesc: RAPIER.ColliderDesc;
      if (shape === "ball") {
        cdesc = RAPIER.ColliderDesc.ball(hw);
      } else if (shape === "capsule") {
        cdesc = RAPIER.ColliderDesc.capsule(Math.max(0.01, hh - hw), hw);
      } else {
        cdesc = RAPIER.ColliderDesc.cuboid(hw, hh);
      }
      cdesc
        .setDensity(Math.max(1, (b.density ?? 150) * massScale))
        .setFriction(0.85)
        .setRestitution(0.04)
        .setCollisionGroups(ig(group, filter));

      const collider = this.physics.world.createCollider(cdesc, body);
      const bone: Bone = {
        name: b.name,
        body,
        collider,
        hw,
        hh,
        shape,
        thick: (b.thick ?? Math.max(b.w, 0.06)) * s,
        color: b.color ?? opts.color ?? "#1b1e26",
        parent: null,
      };
      this.bones.set(b.name, bone);
      this.boneList.push(bone);
      this.physics.register(collider, this);
    }

    this.root = this.boneList[0];

    for (const b of spec.bones) {
      if (!b.parent || b.jx === undefined || b.jy === undefined) continue;
      const child = this.bones.get(b.name)!;
      const parent = this.bones.get(b.parent);
      if (!parent) continue;
      child.parent = parent;

      // Anchors are expressed in each body's own frame; since both bodies share the
      // ragdoll rotation at build time, the delta is just the mirrored local offset.
      const a1 = v((b.jx - specBone(spec, b.parent).x) * f * s, (b.jy - specBone(spec, b.parent).y) * s);
      const a2 = v((b.jx - b.x) * f * s, (b.jy - b.y) * s);

      const jd = RAPIER.JointData.revolute(a1, a2);
      // Mirroring flips the sign of every angle, so limits have to swap and negate.
      let min = b.min ?? -Math.PI * 0.9;
      let max = b.max ?? Math.PI * 0.9;
      if (f === -1) {
        const t = min;
        min = -max;
        max = -t;
      }
      jd.limitsEnabled = true;
      jd.limits = [min, max];

      const joint = this.physics.world.createImpulseJoint(jd, parent.body, child.body, true) as RAPIER.RevoluteImpulseJoint;
      const jref: Joint = { name: b.name, joint, child, parent, min, max, target: 0, stiffness: 0, damping: 0 };
      this.joints.set(b.name, jref);
      this.jointList.push(jref);
    }
  }

  // ------------------------------------------------------------------ posing

  /**
   * Drives a joint toward `angle` with a spring. High stiffness = a stiff, alive
   * limb; zero = pure ragdoll. This is the whole "active ragdoll" trick.
   */
  setMotor(name: string, angle: number, stiffness: number, damping: number) {
    const j = this.joints.get(name);
    if (!j || this.limp) return;
    const a = clamp(angle * this.facing, j.min, j.max);
    j.target = a;
    j.stiffness = stiffness;
    j.damping = damping;
    j.joint.configureMotorPosition(a, stiffness, damping);
  }

  /**
   * Pins the root bone's rotation.
   *
   * This is what actually keeps an active ragdoll on its feet. Springs and torques
   * cannot reliably stand a limp 70kg skeleton up off the floor — the contacts absorb
   * the correction and the controller saturates face-down. Pinning the pelvis angle
   * makes "upright" true by construction, and the joint limits (waist ±31°, hips)
   * carry it to the rest of the body. Everything above and below the pelvis still
   * simulates freely, so the character reads as a ragdoll, not a rigid puppet.
   *
   * Release it and the body is instantly, completely floppy.
   */
  lockRoot(locked: boolean) {
    this.rootLocked = locked;
    const body = this.root.body;
    // Zero the spin *before* locking. `lockRotations` only clears the inverse inertia,
    // so nothing can change the angular velocity afterwards — including anything that
    // would slow it down. Any leftover omega then integrates forever and the "locked"
    // body rotates at a constant rate, which looks exactly like the lock not working.
    if (locked) body.setAngvel(0, true);
    body.lockRotations(locked, true);
  }

  rootLocked = false;

  /** Cuts every motor: the body goes completely floppy. */
  goLimp() {
    if (this.limp) return;
    this.limp = true;
    if (this.rootLocked) this.lockRoot(false);
    for (const j of this.jointList) {
      j.stiffness = 0;
      j.damping = 0.4;
      j.joint.configureMotorPosition(j.target, 0, 0.4);
    }
    for (const b of this.boneList) {
      b.body.setAngularDamping(0.22);
      b.body.setLinearDamping(0.02);
    }
  }

  /**
   * Flash-freeze. The body locks up (limp, heavily damped) and turns brittle, so the
   * next thing that touches it takes it apart. Mirrors `Block.freeze`.
   */
  freeze() {
    if (this.frozen || !this.freezable || this.disposed) return;
    this.frozen = true;
    // Any contact the engine bothers to report (>2.2 m/s relative) is now lethal.
    this.impactIgnore = 0;
    this.impactFragility = 1e6;
    this.splatColor = "#d6f2ff";
    this.goLimp();
  }

  /** Re-enables motor control after a limp period (used by the player's get-up). */
  stiffen() {
    if (this.frozen) return;
    this.limp = false;
    for (const b of this.boneList) {
      b.body.setAngularDamping(0.55);
      b.body.setLinearDamping(0.06);
    }
  }

  // ------------------------------------------------------------------ queries

  bone(name: string) {
    return this.bones.get(name)!;
  }

  has(name: string) {
    return this.bones.has(name);
  }

  /** World position of a bone, optionally offset along the bone's own axes. */
  bonePos(name: string, ox = 0, oy = 0): V {
    const b = this.bones.get(name);
    if (!b) return v(0, 0);
    const t = b.body.translation();
    if (!ox && !oy) return v(t.x, t.y);
    const r = b.body.rotation();
    const c = Math.cos(r);
    const s = Math.sin(r);
    return v(t.x + ox * c - oy * s, t.y + ox * s + oy * c);
  }

  boneAngle(name: string) {
    return this.bones.get(name)?.body.rotation() ?? 0;
  }

  center(): V {
    let mx = 0;
    let my = 0;
    let m = 0;
    for (const b of this.boneList) {
      const bm = b.body.mass();
      const t = b.body.translation();
      mx += t.x * bm;
      my += t.y * bm;
      m += bm;
    }
    return m > 0 ? v(mx / m, my / m) : v(0, 0);
  }

  velocity(): V {
    let vx = 0;
    let vy = 0;
    let m = 0;
    for (const b of this.boneList) {
      const bm = b.body.mass();
      const lv = b.body.linvel();
      vx += lv.x * bm;
      vy += lv.y * bm;
      m += bm;
    }
    return m > 0 ? v(vx / m, vy / m) : v(0, 0);
  }

  totalMass() {
    let m = 0;
    for (const b of this.boneList) m += b.body.mass();
    return m;
  }

  speed() {
    const vel = this.velocity();
    return Math.hypot(vel.x, vel.y);
  }

  // ------------------------------------------------------------------ forces

  applyImpulse(imp: V, wake = true) {
    for (const b of this.boneList) {
      const m = b.body.mass();
      b.body.applyImpulse(v(imp.x * m, imp.y * m), wake);
    }
  }

  /**
   * Rotates the whole skeleton as if it were a single rigid body, at `alpha` rad/s².
   *
   * Applying an equivalent torque to the pelvis alone does **not** work: Rapier turns
   * that impulse into Δω using the pelvis's *own* inertia (~0.1 kg·m²), while the
   * torque needed to right a body is sized for the composite inertia (~23 kg·m²).
   * The pelvis ends up spinning a few hundred rad/s and tears the joints apart.
   *
   * Instead each bone gets its own torque impulse plus the linear impulse for
   * `alpha × r` about the centre of mass, which is exactly the motion of a rigid
   * body rotating at `alpha` — so the joints have nothing to fight.
   */
  applyAngularAccel(alpha: number, dt: number) {
    if (!alpha) return;
    const c = this.center();
    for (const b of this.boneList) {
      const body = b.body;
      const m = body.mass();
      body.applyTorqueImpulse(alpha * body.effectiveAngularInertia() * dt, true);
      const t = body.translation();
      // In 2D, alpha x r = (-alpha*ry, alpha*rx).
      const rx = t.x - c.x;
      const ry = t.y - c.y;
      body.applyImpulse(v(-alpha * ry * m * dt, alpha * rx * m * dt), true);
    }
  }

  /**
   * Removes the whole skeleton from the simulation without destroying it.
   *
   * A ragdoll is 7-13 bodies plus 6-12 joints, and joints are the expensive part of
   * the solver. A level with a few dozen characters spread over hundreds of metres
   * spends nearly all of its physics budget on ones nobody can see, so anything far
   * from the camera gets switched off entirely and switched back on when approached.
   */
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled || this.disposed) return;
    this.enabled = enabled;
    for (const b of this.boneList) b.body.setEnabled(enabled);
  }

  enabled = true;

  /** Kicks a single bone — used for recoil and for punching individual limbs. */
  impulseAt(boneName: string, imp: V) {
    const b = this.bones.get(boneName);
    if (!b) return;
    b.body.applyImpulse(imp, true);
  }

  wake() {
    for (const b of this.boneList) b.body.wakeUp();
  }

  // ------------------------------------------------------------------ damage

  /**
   * Kinetic damage. Energy arrives in joules; we work in kJ so the material numbers
   * stay in a readable range instead of five-digit tuning constants.
   */
  onImpact(other: PhysOwner | null, energy: number, point: V) {
    if (this.disposed) return;
    if (this.bonusDamage > 0 && other?.takeDamage) other.takeDamage(this.bonusDamage, point, this);
    if (this.dead) return;
    const kj = energy / 1000;
    if (kj <= this.impactIgnore) return;
    this.takeDamage((kj - this.impactIgnore) * this.impactFragility, point, other);
  }

  /**
   * Cuts one bone free of its parent, permanently.
   *
   * Removing the revolute joint is all it takes — the bone is already its own rigid
   * body, so it keeps simulating, keeps colliding and tumbles away under whatever
   * momentum took it off. Anything hanging below it (a hand on a severed forearm)
   * goes with it, still jointed, which is exactly right.
   *
   * @returns the world point the limb came off at, or null if there was nothing to cut.
   */
  sever(name: string): V | null {
    const j = this.joints.get(name);
    if (!j || this.disposed) return null;
    const t = j.child.body.translation();
    const pt = v(t.x, t.y);

    try {
      this.physics.removeJoint(j.joint);
    } catch {
      /* the joint went with a body already */
    }
    this.joints.delete(name);
    const i = this.jointList.indexOf(j);
    if (i >= 0) this.jointList.splice(i, 1);

    j.child.severed = true;
    this.severedBones.add(name);
    // Losing a limb costs the whole body its posture: nothing stands on one leg.
    if (this.rootLocked) this.lockRoot(false);
    this.goLimp();

    const m = j.child.body.mass();
    j.child.body.applyImpulse(v(rand(-4, 4) * m, rand(1, 6) * m), true);
    j.child.body.applyTorqueImpulse(rand(-1, 1) * m * 0.6, true);
    return pt;
  }

  takeDamage(amount: number, at?: V, source?: PhysOwner | null) {
    if (this.dead || this.disposed || this.invulnerable || amount <= 0) return;
    const dmg = amount * this.damageScale;
    if (dmg <= 0) return;
    this.lastDamage = dmg;
    // Only a blow that names its source overwrites the record. An explosion calls
    // `takeDamage` with no owner, and a nameless follow-up tick must not erase the
    // block that actually did the killing a frame earlier.
    if (source) this.lastHitKind = source.kind;
    this.hp -= dmg;
    this.onHurt?.(this, dmg, at ?? this.center());
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.goLimp();
      this.onDeath?.(this);
    }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    // Joints are removed implicitly with their bodies, but being explicit avoids
    // leaving dangling handles if a bone removal ever fails.
    for (const j of this.jointList) {
      try {
        this.physics.removeJoint(j.joint);
      } catch {
        /* already gone with its bodies */
      }
    }
    for (const b of this.boneList) this.physics.removeBody(b.body);
    this.bones.clear();
    this.joints.clear();
    this.boneList.length = 0;
    this.jointList.length = 0;
  }
}

function specBone(spec: RagdollSpec, name: string): BoneSpec {
  const b = spec.bones.find((x) => x.name === name);
  if (!b) throw new Error(`ragdoll "${spec.name}": unknown parent bone "${name}"`);
  return b;
}

// --------------------------------------------------------------------- specs

const SKIN = "#1b1e26";

/**
 * Full-detail biped: 13 bodies, 12 joints. Used for the player and hero enemies —
 * the extra elbow/knee/ankle segments are what make the flop read as a *person*.
 */
export const BIPED: RagdollSpec = {
  name: "biped",
  height: 1.84,
  mass: 72,
  bones: [
    { name: "pelvis", x: 0, y: 0.95, w: 0.24, h: 0.22, density: 250, thick: 0.16, color: SKIN },
    { name: "torso", x: 0, y: 1.28, w: 0.26, h: 0.46, density: 210, parent: "pelvis", jx: 0, jy: 1.06, min: -0.55, max: 0.55, thick: 0.19, color: SKIN },
    { name: "head", x: 0, y: 1.68, w: 0.31, h: 0.31, shape: "ball", density: 120, parent: "torso", jx: 0, jy: 1.52, min: -0.6, max: 0.6, thick: 0.31, color: SKIN },

    { name: "armBackUp", x: -0.03, y: 1.3, w: 0.09, h: 0.32, shape: "capsule", density: 120, parent: "torso", jx: -0.02, jy: 1.46, min: -2.9, max: 2.9, thick: 0.1, color: SKIN },
    { name: "armBackLo", x: -0.03, y: 1.0, w: 0.08, h: 0.3, shape: "capsule", density: 105, parent: "armBackUp", jx: -0.03, jy: 1.14, min: -2.5, max: 0.05, thick: 0.09, color: SKIN },
    { name: "armFrontUp", x: 0.03, y: 1.3, w: 0.09, h: 0.32, shape: "capsule", density: 120, parent: "torso", jx: 0.02, jy: 1.46, min: -2.9, max: 2.9, thick: 0.1, color: SKIN },
    { name: "armFrontLo", x: 0.03, y: 1.0, w: 0.08, h: 0.3, shape: "capsule", density: 105, parent: "armFrontUp", jx: 0.03, jy: 1.14, min: -2.5, max: 0.05, thick: 0.09, color: SKIN },

    { name: "thighBack", x: -0.06, y: 0.68, w: 0.115, h: 0.4, shape: "capsule", density: 175, parent: "pelvis", jx: -0.06, jy: 0.88, min: -1.5, max: 1.9, thick: 0.13, color: SKIN },
    { name: "shinBack", x: -0.06, y: 0.29, w: 0.1, h: 0.38, shape: "capsule", density: 145, parent: "thighBack", jx: -0.06, jy: 0.48, min: -0.05, max: 2.5, thick: 0.11, color: SKIN },
    { name: "footBack", x: 0.01, y: 0.05, w: 0.26, h: 0.1, density: 110, parent: "shinBack", jx: -0.06, jy: 0.1, min: -0.6, max: 0.75, thick: 0.1, color: SKIN },

    { name: "thighFront", x: 0.06, y: 0.68, w: 0.115, h: 0.4, shape: "capsule", density: 175, parent: "pelvis", jx: 0.06, jy: 0.88, min: -1.5, max: 1.9, thick: 0.13, color: SKIN },
    { name: "shinFront", x: 0.06, y: 0.29, w: 0.1, h: 0.38, shape: "capsule", density: 145, parent: "thighFront", jx: 0.06, jy: 0.48, min: -0.05, max: 2.5, thick: 0.11, color: SKIN },
    { name: "footFront", x: 0.13, y: 0.05, w: 0.26, h: 0.1, density: 110, parent: "shinFront", jx: 0.06, jy: 0.1, min: -0.6, max: 0.75, thick: 0.1, color: SKIN },
  ],
};

/**
 * 7-body biped. Visually near-identical at gameplay distance but roughly half the
 * solver cost, so crowds and stickman-ammo use this.
 */
export const BIPED_LITE: RagdollSpec = {
  name: "biped-lite",
  height: 1.84,
  mass: 70,
  bones: [
    { name: "pelvis", x: 0, y: 0.95, w: 0.24, h: 0.24, density: 260, thick: 0.16, color: SKIN },
    { name: "torso", x: 0, y: 1.29, w: 0.26, h: 0.46, density: 215, parent: "pelvis", jx: 0, jy: 1.07, min: -0.6, max: 0.6, thick: 0.19, color: SKIN },
    { name: "head", x: 0, y: 1.68, w: 0.31, h: 0.31, shape: "ball", density: 125, parent: "torso", jx: 0, jy: 1.52, min: -0.7, max: 0.7, thick: 0.31, color: SKIN },
    { name: "armBack", x: -0.03, y: 1.16, w: 0.09, h: 0.58, shape: "capsule", density: 115, parent: "torso", jx: -0.02, jy: 1.45, min: -2.9, max: 2.9, thick: 0.1, color: SKIN },
    { name: "armFront", x: 0.03, y: 1.16, w: 0.09, h: 0.58, shape: "capsule", density: 115, parent: "torso", jx: 0.02, jy: 1.45, min: -2.9, max: 2.9, thick: 0.1, color: SKIN },
    { name: "legBack", x: -0.06, y: 0.46, w: 0.12, h: 0.78, shape: "capsule", density: 165, parent: "pelvis", jx: -0.06, jy: 0.85, min: -1.5, max: 1.6, thick: 0.13, color: SKIN },
    { name: "legFront", x: 0.06, y: 0.46, w: 0.12, h: 0.78, shape: "capsule", density: 165, parent: "pelvis", jx: 0.06, jy: 0.85, min: -1.5, max: 1.6, thick: 0.13, color: SKIN },
  ],
};

/** Chassis for the elephant round. */
export const QUADRUPED: RagdollSpec = {
  name: "quadruped",
  height: 1.6,
  mass: 400,
  bones: [
    { name: "body", x: 0, y: 1.0, w: 1.5, h: 0.86, density: 260, thick: 0.86, color: "#8d8f99" },
    { name: "head", x: 0.98, y: 1.18, w: 0.62, h: 0.58, density: 220, parent: "body", jx: 0.7, jy: 1.1, min: -0.7, max: 0.5, thick: 0.58, color: "#8d8f99" },
    { name: "trunk", x: 1.3, y: 0.7, w: 0.18, h: 0.6, shape: "capsule", density: 130, parent: "head", jx: 1.24, jy: 0.98, min: -1.4, max: 1.4, thick: 0.19, color: "#8d8f99" },
    { name: "legFL", x: 0.5, y: 0.3, w: 0.22, h: 0.62, shape: "capsule", density: 200, parent: "body", jx: 0.5, jy: 0.6, min: -1.1, max: 1.1, thick: 0.24, color: "#7e808a" },
    { name: "legFR", x: 0.62, y: 0.3, w: 0.22, h: 0.62, shape: "capsule", density: 200, parent: "body", jx: 0.62, jy: 0.6, min: -1.1, max: 1.1, thick: 0.24, color: "#8d8f99" },
    { name: "legBL", x: -0.5, y: 0.3, w: 0.22, h: 0.62, shape: "capsule", density: 200, parent: "body", jx: -0.5, jy: 0.6, min: -1.1, max: 1.1, thick: 0.24, color: "#7e808a" },
    { name: "legBR", x: -0.62, y: 0.3, w: 0.22, h: 0.62, shape: "capsule", density: 200, parent: "body", jx: -0.62, jy: 0.6, min: -1.1, max: 1.1, thick: 0.24, color: "#8d8f99" },
    { name: "tail", x: -0.85, y: 1.1, w: 0.1, h: 0.4, shape: "capsule", density: 90, parent: "body", jx: -0.74, jy: 1.2, min: -1.6, max: 1.6, thick: 0.1, color: "#7e808a" },
  ],
};

/** Two-legged bird used for the chicken round. */
export const CHICKEN: RagdollSpec = {
  name: "chicken",
  height: 0.5,
  mass: 3.2,
  bones: [
    { name: "body", x: 0, y: 0.3, w: 0.34, h: 0.28, shape: "capsule", density: 60, thick: 0.3, color: "#fdfbf2" },
    { name: "head", x: 0.19, y: 0.45, w: 0.15, h: 0.15, shape: "ball", density: 50, parent: "body", jx: 0.13, jy: 0.38, min: -1.2, max: 1.2, thick: 0.15, color: "#fdfbf2" },
    { name: "legL", x: -0.03, y: 0.09, w: 0.05, h: 0.2, shape: "capsule", density: 40, parent: "body", jx: -0.03, jy: 0.19, min: -1.6, max: 1.6, thick: 0.05, color: "#f0a63c" },
    { name: "legR", x: 0.06, y: 0.09, w: 0.05, h: 0.2, shape: "capsule", density: 40, parent: "body", jx: 0.06, jy: 0.19, min: -1.6, max: 1.6, thick: 0.05, color: "#f0a63c" },
    { name: "wing", x: -0.04, y: 0.33, w: 0.24, h: 0.1, shape: "capsule", density: 30, parent: "body", jx: 0.04, jy: 0.35, min: -2.2, max: 2.2, thick: 0.1, color: "#efe7d2" },
  ],
};

export const RAGDOLL_FILTERS = FILTER;
