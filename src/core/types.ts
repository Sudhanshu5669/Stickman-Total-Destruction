import type { Camera } from "./camera";
import type { Physics } from "./physics";
import type { Particles } from "../fx/particles";
import type { Ctx } from "../render/draw";
import type { Theme } from "../render/theme";
import type { V } from "./math";

/** Anything that lives in the world, ticks, and draws. */
export interface Actor {
  dead: boolean;
  /** Lower draws first. Background props ~ -10, terrain 0, props 10, characters 20, fx 30. */
  z?: number;
  update(dt: number): void;
  draw(ctx: Ctx): void;
  /** Must release every Rapier body/joint the actor owns. */
  destroy(): void;
  /**
   * Centre used for off-screen culling. Omit it and the actor is always drawn —
   * correct for wide static terrain, wrong for the hundreds of blocks in a level.
   */
  cullPos?(): V;
  /** Radius around `cullPos()` that must be off-screen before the actor is skipped. */
  cullRadius?: number;
  /** Implemented by anything corrosive weather can eat: blocks, characters. */
  takeAcid?(amount: number): void;
}

/**
 * The slice of the game the entities are allowed to touch. Keeping it an interface
 * means entity modules never import `Game`, which would be a cycle.
 */
export interface GameCtx {
  readonly physics: Physics;
  readonly particles: Particles;
  readonly camera: Camera;
  /** Palette of the world currently loaded. */
  readonly theme: Theme;
  /** Seconds since the level started, scaled by slow-motion. */
  readonly time: number;

  add<T extends Actor>(actor: T): T;
  /** Awards points and floats a label at `at`. */
  award(points: number, at?: V, label?: string): void;
  /** Freezes the simulation briefly — the single biggest "this hit hard" cue. */
  hitstop(seconds: number): void;
  slowmo(seconds: number, scale?: number): void;
  /** Full-screen colour flash, used by explosions and the nuke. */
  flash(strength: number, color?: string): void;
  /** Registers destruction for the combo meter. */
  reportDestruction(kind: "block" | "enemy" | "structure", at: V): void;
  /** Panics every stickman within `radius` — called after every explosion. */
  alertEnemiesNear(at: V, radius: number): void;
  /** Spawns a physical rubble chunk, subject to the global debris cap. */
  spawnDebris(x: number, y: number, size: number, color: string, vel: V): void;
  /**
   * Everything that can be damaged — blocks, enemies, the player. **Index 0 is always
   * the player**, so hazards can give it priority over the round-robin sampling they
   * use for the rest of the world. Also used by attract-mode AI to find targets.
   */
  damageables(): readonly Actor[];
}
