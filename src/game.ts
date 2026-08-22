import { Camera } from "./core/camera";
import { Input } from "./core/input";
import { Physics, type ImpactEvent, type PhysOwner } from "./core/physics";
import type { Actor, GameCtx } from "./core/types";
import { Particles } from "./fx/particles";
import { Decals, anchorAt, canMark } from "./fx/decals";
import { WaterSim } from "./fx/fluid";
import { FireSim } from "./fx/fire";
import { SolidField } from "./fx/solids";
import { sfx } from "./fx/audio";
import { Background } from "./render/background";
import { THEMES, type Theme } from "./render/theme";
import { rgba, type Ctx } from "./render/draw";
import { Player } from "./entities/player";
import { Enemy, alertNearby, resetSquad } from "./entities/enemy";
import { Block, Debris } from "./entities/block";
import { Hud, type HudState } from "./ui/hud";
import { Menu, type MenuAction } from "./ui/menu";
import { progress } from "./ui/progress";
import { TouchControls } from "./ui/touch";
import { Coach, type CoachInput } from "./ui/coach";
import { settings } from "./ui/settings";
import { quality } from "./ui/quality";
import { portal } from "./platform/portal";
import { primeKeyLabels } from "./core/keylabel";
import { preload } from "./render/sprites";
import { fromEnergy, hit as juiceHit, kill as juiceKill, resetJuice } from "./fx/juice";
import { DemoDriver } from "./ai/demo";
import { Builder } from "./levels/builder";
import { LEVELS, LEVEL_ASSETS, levelById } from "./levels";
import type { LevelDef, LevelInfo } from "./levels/types";
import { clamp, damp, lerp, rand, v, type V } from "./core/math";
import { Bullet } from "./entities/bullet";
import { AMMO_BY_ID } from "./weapons/ammo";
import { CreatureProjectile, RigidProjectile } from "./entities/projectile";
import type { TargetRef } from "./core/types";

const STEP = 1 / 60;
const MAX_STEPS = 5;
/** Pixels per metre at rest; the camera pulls out from here as the action speeds up. */
const BASE_ZOOM = 40;
/** Earth-normal gravity, the baseline other worlds are expressed against. */
const BASE_GRAVITY = -26;
/** Attract mode reloads on this cadence so the demo never runs out of things to break. */
const DEMO_RELOAD = 52;

/**
 * There are two states and no third.
 *
 * The build this replaced also had a `story` mode for cutscenes and an `outcome` that
 * could be won or lost. An arena cannot be won — there is no objective — and it cannot
 * be lost — dying costs you nothing but the walk back. Deleting both is most of the
 * reason the game is no longer confusing to look at.
 */
export type Mode = "menu" | "playing";

export class Game implements GameCtx {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  readonly input: Input;
  readonly camera = new Camera();
  readonly particles = new Particles();
  readonly decals = new Decals();
  readonly water = new WaterSim();
  readonly fire = new FireSim(this);
  /**
   * One shared snapshot of nearby collision geometry, rebuilt once per physics step
   * and read by both particle sims. See `SolidField` for why it exists.
   */
  private readonly solids = new SolidField();
  readonly hud = new Hud();
  readonly menu = new Menu();
  readonly background = new Background();
  readonly coach = new Coach();

  physics!: Physics;
  player!: Player;
  level!: LevelInfo;
  levelDef: LevelDef = LEVELS[0];
  theme: Theme = THEMES.day;

  mode: Mode = "menu";
  private demo: DemoDriver | null = null;
  private demoAge = 0;

  /** Hostiles put down this session. Presentation only — nothing gates on it. */
  private kills = 0;

  private actors: Actor[] = [];
  private pending: Actor[] = [];
  private drawList: Actor[] = [];
  /** Rebuilt during reaping; index 0 is always the player. See `damageables()`. */
  private damageList: Actor[] = [];

  time = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private fps = 60;

  /** Real-time seconds of frozen simulation left (hit-stop). */
  private hitstopLeft = 0;
  private slowmoLeft = 0;
  private slowmoScale = 1;

  private flashStrength = 0;
  private flashColor = "#ffffff";

  score = 0;
  private displayScore = 0;
  combo = 0;
  private comboTimer = 0;
  private comboMax = 0;
  blocksDestroyed = 0;

  /** On-screen controls; inert until a real touch arrives. */
  readonly touch: TouchControls;

  // ------------------------------------------------------------- session bookkeeping
  /** Rounds this session's carnage has bought, drained as each one is announced. */
  private unlockedThisRun: string[] = [];

  paused = false;
  showDebug = false;
  /** Session-level cheat: kept across respawns, restarts and level changes. */
  private godMode = false;
  private hintAlpha = 1;
  private running = false;
  /**
   * Snapshot of `input.mousePressed` taken before this frame's fixed step can consume
   * it. The coach reads this instead of `input.mouseDown` because a fast click or tap
   * can complete (pointerdown then pointerup) before a single rAF callback runs, so by
   * the time `coachInput()` is built `mouseDown` has already gone back to false even
   * though the shot fired — `mousePressed` is the edge that survives that race.
   */
  private firedEdgeThisFrame = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.input = new Input(canvas);
    this.touch = new TouchControls(canvas, this.input);
    if (TouchControls.shouldEnable()) this.input.touchMode = true;
  }

  // ------------------------------------------------------------------ setup

  async init() {
    // Tell the portal we are loading *before* the 2MB physics blob, and that we are
    // done once the first world exists — this bracket is what it uses to decide when
    // it may run its own pre-roll, and a missing one is a common submission rejection.
    //
    // Detection runs alongside the physics load rather than before it. Off-portal
    // there is no SDK to find, and making every itch/dev/standalone boot sit through
    // that timeout before it even starts loading would be paying the portal's cost
    // everywhere except the portal.
    portal.loadingStart();
    // Cosmetic and asynchronous: nothing below waits on it, and every label it feeds
    // has a working fallback until it lands.
    primeKeyLabels();
    const detected = portal.init();
    // Tilesets download alongside the physics blob, which is several times their size,
    // so in practice they cost nothing wall-clock. Awaited rather than fired and
    // forgotten because `Builder.spriteWall` reads the artwork's own alpha to decide
    // where to put rigid bodies — building a level before the sheet decodes would give
    // it a solid rectangle where the roof should slope.
    const art = preload(LEVEL_ASSETS);
    await Physics.load();
    await detected;
    await art;
    this.enterMenu();
    portal.loadingStop();
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  /**
   * Builds a world. The level definition owns gravity, palette and any hazard, so
   * switching worlds rebuilds the physics world rather than mutating the live one.
   */
  private loadLevel(def: LevelDef) {
    for (const a of this.actors) a.destroy();
    this.actors.length = 0;
    this.pending.length = 0;
    this.damageList.length = 0;
    this.particles.clear();
    this.decals.clear();
    this.water.clear();
    this.fire.clear();
    // These hold owners from the world about to be thrown away.
    this.wet.clear();

    // Contacts and the enemy roster must not survive into a world that no longer
    // exists — a stale sighting would have the new level's garrison walk to a spot
    // the player stood in on the old one.
    resetSquad();

    this.levelDef = def;
    this.theme = THEMES[def.theme] ?? THEMES.day;
    this.physics = new Physics(def.gravity);
    // Falling debris should float on a low-gravity world too.
    this.particles.gravityScale = def.gravity / BASE_GRAVITY;
    // Water falls under the world's own gravity, so Mars pours in slow motion.
    this.water.gravity = def.gravity;

    const builder = new Builder(this, this.theme);
    this.level = def.build(this, builder);
    this.flushPending();

    this.player = this.add(new Player(this, this.input, this.level.spawn.x, this.level.spawn.y));
    this.flushPending();
    // You carry what you have earned, everywhere. Nothing confiscates a round any more.
    this.player.weapon.setLoadout(null);
    this.player.setGod(this.godMode);

    if (def.hazard) {
      this.add(def.hazard(this));
      this.flushPending();
    }

    this.camera.pos = v(this.level.spawn.x, this.level.spawn.y + 2);
    this.camera.targetZoom = BASE_ZOOM;
    this.camera.update(0.016, true);

    this.score = 0;
    this.displayScore = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboMax = 0;
    this.blocksDestroyed = 0;
    this.kills = 0;
    this.time = 0;
    this.hitstopLeft = 0;
    this.slowmoLeft = 0;
    this.slowmoScale = 1;
    this.accumulator = 0;
    // A fresh run starts unpenalised — a nuke fired at the end of the last one must
    // not eat the first spectacular moment of this one.
    resetJuice();
  }

  /**
   * Banks whatever the current run earned before it is torn down, so quitting to the
   * menu mid-run still counts. `recordDistance` only ever moves the record forward,
   * making a double call from `finish()` harmless.
   */
  /**
   * Pays whatever the current run has earned into the permanent record.
   *
   * Called on every exit from a run — the result card, quitting to the menu, and
   * starting anything else — because a run does not have to *end* to have counted.
   * The playground has no win or lose condition at all, so if banking only happened
   * on `finish()` the one mode built for grinding the arsenal would be the one mode
   * that never paid out.
   *
   * Banking is by delta rather than by total, which is what makes it safe to call
   * repeatedly: a revive banks on death, keeps playing, and banks only the difference
   * at the real end instead of charging the first half of the run twice.
   */
  private bankRun() {
    if (this.mode !== "playing") return;

    const delta = Math.floor(this.score) - this.bankedScore;
    if (delta > 0) {
      this.bankedScore = Math.floor(this.score);
      this.unlockedThisRun.push(...progress.addCarnage(delta));
      // Announced where it happened, over whatever just paid for it.
      if (this.mode === "playing" && this.player) this.announceUnlocks(this.player.pos);
    }

  }

  /** Score already paid into carnage this run, so banking twice cannot double-charge. */
  private bankedScore = 0;

  /** Drops the player into an arena. There is no prologue and nothing to unlock first. */
  startLevel(def: LevelDef) {
    this.enterLevel(def);
  }

  private enterLevel(def: LevelDef) {
    this.bankRun();
    this.mode = "playing";
    this.demo = null;
    this.paused = false;
    this.hintAlpha = 1;
    this.bankedScore = 0;
    this.unlockedThisRun = [];
    this.loadLevel(def);
    // Standard kit, always. Every arena is built around being able to fly.
    this.player.hasJetpack = true;
    this.coach.begin();
    portal.gameplayStart();
    this.player.control = null;
    this.canvas.style.cursor = "none";
    // The click that pressed PLAY must not also pull the trigger on frame one.
    this.input.consumeEdges();
    sfx.levelUp();
  }

  /** Returns to the start menu, where the selected world plays itself. */
  enterMenu() {
    this.bankRun();
    portal.gameplayStop();
    this.touch.release();
    this.mode = "menu";
    this.paused = false;
    this.loadLevel(this.menu.previewLevel);
    this.demo = new DemoDriver(this);
    this.demo.reset(this.level.spawn);
    this.player.control = this.demo.control;
    // The demo is a showcase, not a fair fight — it shouldn't die mid-attract.
    this.player.ragdoll.invulnerable = true;
    this.demoAge = 0;
    this.canvas.style.cursor = "default";
  }

  /**
   * Replays the current level.
   *
   * The interstitial lives here rather than on death, and it is awaited before the
   * rebuild so the ad never plays over a live world. Dying and pressing the button
   * again is the impulse the whole mode runs on; putting a commercial in the middle
   * of it is the most reliable way to end a session instead of extending it.
   */
  restart() {
    if (this.restarting) return;
    this.restarting = true;
    const def = this.levelDef;
    this.adBreak()
      .then(() => this.startLevel(def))
      .finally(() => {
        this.restarting = false;
      });
  }

  /** Latched across the ad await, so a held key cannot queue two level loads. */
  private restarting = false;

  /** Shows an interstitial if one is due. Resolves immediately when it is not. */
  private async adBreak() {
    this.restartsSinceAd++;
    if (!portal.available || this.restartsSinceAd < 3) return;
    this.restartsSinceAd = 0;
    portal.gameplayStop();
    await portal.midgame();
  }

  /** Restarts since the last interstitial — one every third try, not every try. */
  private restartsSinceAd = 0;

  reset() {
    if (this.mode === "menu") this.enterMenu();
    else this.restart();
  }

  // ------------------------------------------------------------ GameCtx impl

  add<T extends Actor>(actor: T): T {
    this.pending.push(actor);
    return actor;
  }

  award(points: number, at?: V, label?: string) {
    const mult = this.comboMultiplier;
    const gained = Math.round(points * mult);
    this.score += gained;
    if (at) {
      this.particles.popup(at.x, at.y + 0.8, label ?? `+${gained}`, mult > 1.4 ? "#ffd23f" : "#f4f1e8", 0.5 + Math.min(0.4, gained / 900));
    }
  }

  /**
   * Chain multiplier, on a square root rather than a straight line.
   *
   * Linear made the top of the curve the only part worth anything: 0.14 per link meant
   * a 37-chain for the 6x cap and, far worse, 1.14x for the *second* link — so the
   * ordinary five-to-ten chain that makes up almost every destruction in the game paid
   * essentially nothing, and the player never learned the mechanic existed.
   *
   * A square root front-loads it. The fourth link has already doubled the score, which
   * is early enough to be felt and therefore learned, and the curve keeps climbing
   * instead of flattening — a tower that takes eighty blocks with it is still worth
   * more than one that takes forty. The 8x ceiling needs a 129-chain and exists only to
   * bound the arithmetic; nothing but a genuine massacre reaches it.
   *
   *   chain    2     3     4     5     8    10    20    40    75   129
   *   mult   1.62  1.88  2.07  2.24  2.64  2.86  3.70  4.87  6.33  8.00
   */
  get comboMultiplier() {
    return clamp(1 + 0.62 * Math.sqrt(Math.max(0, this.combo - 1)), 1, 8);
  }

  hitstop(seconds: number) {
    this.hitstopLeft = Math.max(this.hitstopLeft, Math.min(seconds, 0.22));
  }

  slowmo(seconds: number, scale = 0.35) {
    this.slowmoLeft = Math.max(this.slowmoLeft, seconds);
    this.slowmoScale = Math.min(this.slowmoScale, scale);
  }

  flash(strength: number, color = "#ffffff") {
    if (strength > this.flashStrength) {
      this.flashStrength = Math.min(1.6, strength);
      this.flashColor = color;
    }
  }

  alertEnemiesNear(at: V, radius: number) {
    alertNearby(this.level.enemies, at, radius);
  }

  spawnDebris(x: number, y: number, size: number, color: string, vel: V) {
    this.add(new Debris(this, x, y, size, size * rand(0.6, 1.1), color, vel, rand(5, 9)));
  }

  damageables(): readonly Actor[] {
    return this.damageList;
  }

  /**
   * The player as the AI sees it. Suppressed in attract mode: the demo driver is
   * invulnerable and being shot at by a level full of gunners would look absurd.
   */
  target(): TargetRef | null {
    if (this.mode !== "playing" || !this.player) return null;
    const p = this.player;
    return {
      aimPos: p.chest,
      pos: p.pos,
      alive: !p.isDown,
      down: p.isLimp || p.isDown,
      // The player's ragdoll carries a self-damage discount so your own rocket blast
      // doesn't kill you at the range the whole game is played at. Incoming fire is
      // not self-damage, so the discount is divided back out here — god mode and
      // death handling still run normally inside `takeDamage`.
      hurt: (amount, point) => p.ragdoll.takeDamage(amount / Math.max(0.05, p.ragdoll.damageScale), point),
      shove: (imp) => p.ragdoll.applyImpulse(imp),
    };
  }

  reportDestruction(kind: "block" | "enemy" | "structure", at: V) {
    if (kind === "block") this.blocksDestroyed++;
    this.combo++;
    this.comboMax = Math.max(this.comboMax, this.combo);
    this.comboTimer = 1;
    if (kind === "enemy") {
      // Unified impact curve — see fx/juice.ts. A kill is never allowed to land
      // softer than the crate next to it.
      juiceKill(this, at);
      this.kills++;
    }
    // First callout at 5 lands inside an ordinary collapse, so the chain mechanic is
    // taught on the first building the player brings down rather than never.
    if (this.combo === 5 || this.combo === 10 || this.combo === 20 || this.combo === 35
      || this.combo === 50 || this.combo === 75 || this.combo === 100) {
      this.particles.popup(at.x, at.y + 2, `${this.combo} CHAIN!`, "#ffd23f", 0.95);
      sfx.levelUp();
    }
  }

  // ------------------------------------------------------------------ loop

  private frame = (now: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);

    const rawDt = Math.min(0.25, (now - this.lastFrame) / 1000) || 0;
    this.lastFrame = now;
    this.fps = lerp(this.fps, rawDt > 0 ? 1 / rawDt : 60, 0.1);
    // Sampled before anything below can consumeEdges() it away — see the field doc.
    this.firedEdgeThisFrame = this.input.mousePressed;

    this.resize();
    // Thumbs are read before anything consumes input, so a touch and the step that
    // acts on it land on the same frame — same contract as the keyboard.
    this.touch.update(rawDt);
    this.handleFrameKeys();
    this.updateAudio(rawDt);

    this.menu.lastMouse.x = this.input.mouse.x;
    this.menu.lastMouse.y = this.input.mouse.y;

    if (this.mode === "menu") {
      this.menu.update(rawDt);
      this.handleMenuInput();
      this.simulate(rawDt);
    } else if (this.paused) {
      this.handlePauseInput();
    } else {
      this.simulate(rawDt);
    }

    // Anything the sim didn't consume (paused, or a frame with no fixed step in menu
    // mode) is dropped here so edges can't pile up across states.
    if (this.mode !== "playing" || this.paused) this.input.consumeEdges();

    this.render(rawDt);
  };

  private simulate(rawDt: number) {
    // Hit-stop and slow-motion both run on real time so they last a fixed wall-clock
    // duration no matter how slowed the world is.
    let scale = 1;
    if (this.hitstopLeft > 0) {
      this.hitstopLeft -= rawDt;
      scale = 0;
    } else if (this.slowmoLeft > 0) {
      this.slowmoLeft -= rawDt;
      scale = this.slowmoScale;
      if (this.slowmoLeft <= 0) this.slowmoScale = 1;
    }

    // Aiming is sampled per rendered frame rather than per simulation step. During
    // slow-motion the sim runs at a third of the display rate, and an aim that only
    // moved on sim steps visibly lags the crosshair.
    this.player.syncAim();

    this.accumulator += rawDt * scale;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      this.fixedUpdate(STEP);
      // Edges belong to the step that saw them. If no step runs this frame — a
      // 120Hz display, hitstop, slow-motion — they stay latched for the next one
      // instead of being thrown away unread.
      if (this.mode === "playing") this.input.consumeEdges();
      this.accumulator -= STEP;
      steps++;
    }
    // Falling badly behind: drop the backlog rather than spiralling.
    if (steps === MAX_STEPS) this.accumulator = 0;

    this.background.update(rawDt);
    this.particles.update(rawDt * (scale > 0 ? Math.max(scale, 0.25) : 0.02));

    this.displayScore = Math.round(damp(this.displayScore, this.score, 9, rawDt));
    this.flashStrength = Math.max(0, this.flashStrength - rawDt * 3.4);
    if (this.mode === "playing" && this.input.engaged) {
      this.hintAlpha = Math.max(0, this.hintAlpha - rawDt * 0.7);
    }
    if (this.mode === "playing") this.coach.update(rawDt, this.coachInput());

    if (this.comboTimer > 0) {
      // 2.38s, up from 1.61s. At the old rate a player firing the artillery could not
      // chain two shots at all — the plane's own cooldown is 2.3s — so the rounds with
      // the most spectacle were the ones least able to build a multiplier. This also
      // survives the pause between a tower's first break and the cascade hitting the
      // ground. The nuke and black hole still fall outside it, and should: they each
      // generate a hundred-link chain unaided and need no bridge.
      this.comboTimer -= rawDt * 0.42;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.combo = 0;
      }
    }

    if (this.demo) {
      this.demoAge += rawDt;
      this.demo.update(rawDt, this.player, this.level.bounds);
      // Rebuild once the demo has flattened enough of the level to get boring.
      if (this.demoAge > DEMO_RELOAD) this.enterMenu();
    }

    this.updateCamera(rawDt);
  }

  // ------------------------------------------------------------------ session

  /**
   * Pays the session into the permanent record and announces anything it bought.
   *
   * This replaces the whole outcome/result-card apparatus. There is no win, no loss, no
   * lives and no card, because an arena has no objective to succeed or fail at — so the
   * only moment worth marking is the one where carnage turns into a new round to fire,
   * and that is worth marking *immediately*, in the world, over the thing you just broke.
   */
  private announceUnlocks(at: V) {
    if (!this.unlockedThisRun.length) return;
    for (const id of this.unlockedThisRun) {
      const a = AMMO_BY_ID.get(id);
      this.particles.popup(at.x, at.y + 3.2, `UNLOCKED — ${(a?.name ?? id).toUpperCase()}`, "#ffd23f", 1.1);
    }
    this.unlockedThisRun = [];
    this.player.weapon.setLoadout(null);
    this.flash(0.25, "#ffd23f");
    portal.happytime();
  }

  equipJetpack() {
    this.player.hasJetpack = true;
  }

  private fixedUpdate(dt: number) {
    this.time += dt;
    if (this.mode === "playing") this.handleSimKeys();
    this.flushPending();

    this.physics.step(dt);
    this.dispatchImpacts(this.physics.impacts);

    for (const a of this.actors) {
      if (!a.dead) a.update(dt);
    }

    this.stepElements(dt);
    this.clampPlayerToBounds();
    this.reapAndCap();
  }

  /**
   * Water, fire and the marks they leave.
   *
   * Order matters. The solid snapshot is taken after the rigid step so both sims see
   * where the world actually is this frame; water runs before fire so a jet aimed
   * into a blaze has already arrived when the flames look for something to boil; and
   * the accumulated fluid pressure is flushed into the rigid bodies at the end, to be
   * integrated by the *next* physics step.
   */
  private stepElements(dt: number) {
    const cam = this.camera.pos;
    const busy = this.water.count > 0 || this.fire.count > 0;
    if (busy) this.solids.rebuild(this.physics, cam.x, cam.y, 78, 78);

    this.water.update(dt, this.solids, cam.x, cam.y, this.soak);
    this.fire.update(dt, this.solids, this.water, cam.x, cam.y);
    if (busy) this.solids.flush();

    // Soaking dries out on its own, so a doused building becomes flammable again.
    for (const o of this.wet) {
      const next = (o.soaked ?? 0) - dt * 0.12;
      if (next <= 0) {
        o.soaked = 0;
        this.wet.delete(o);
      } else {
        o.soaked = next;
      }
    }
    this.decals.update(dt);
  }

  /** Everything currently carrying water, so it can be dried off over time. */
  private readonly wet = new Set<PhysOwner>();

  /**
   * One droplet landed on something. Bound once rather than allocated per frame —
   * the fluid solver calls this thousands of times a second.
   */
  private soak = (owner: PhysOwner, x: number, y: number, solid: number) => {
    // Wet patches go on surfaces only, and ride the block they landed on — a splash
    // mark left behind by a stickman who walked off is a mark floating in mid-air.
    if (Math.random() < 0.004 && canMark(owner)) {
      this.decals.wet(x, y, rand(0.3, 0.8), anchorAt(owner, this.solids.bodies[solid], x, y));
      sfx.splash(0.5);
    }
    // Only things that can burn need tracking; the ground stays wet-looking either way.
    if (owner.flammability === undefined) return;
    owner.soaked = Math.min(1.5, (owner.soaked ?? 0) + 0.06);
    this.wet.add(owner);
    this.fire.douse(owner, 0.06);
  };

  private flushPending() {
    if (!this.pending.length) return;
    for (const a of this.pending) this.actors.push(a);
    this.pending.length = 0;
  }

  /**
   * Impacts are delivered to both parties. Anything violent also gets a generic
   * spark/dust burst and a nudge to the camera, on top of whatever the entity does.
   */
  private dispatchImpacts(impacts: readonly ImpactEvent[]) {
    for (const e of impacts) {
      e.a?.onImpact?.(e.b, e.energy, e.point, e.normal);
      e.b?.onImpact?.(e.a, e.energy, e.point, v(-e.normal.x, -e.normal.y));

      const kj = e.energy / 1000;
      if (kj < 6) continue;
      // One curve for how hard everything hits, so a rifle round and a tower coming
      // down are distinguishable instead of every impact inventing its own numbers.
      juiceHit(this, e.point, fromEnergy(kj), e.normal.x, e.normal.y);
    }
  }

  private clampPlayerToBounds() {
    const p = this.player.pos;
    const { min, max } = this.level.bounds;
    if (p.x < min || p.x > max) {
      const pelvis = this.player.ragdoll.bone("pelvis").body;
      const target = clamp(p.x, min, max);
      const dv = (target - p.x) * 6 - pelvis.linvel().x;
      pelvis.applyImpulse(v(dv * pelvis.mass() * 0.4, 0), true);
    }
  }

  /** Removes dead actors, enforces population caps and rebuilds the damageable list. */
  private reapAndCap() {
    let rigid = 0;
    let creatures = 0;
    let debris = 0;
    let bullets = 0;
    const write: Actor[] = [];
    // Contract: the player is index 0 so hazards can always reach it.
    const damage: Actor[] = [this.player];

    // Walk newest-first so the oldest of each type are the ones over the cap.
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      if (a.dead) {
        a.destroy();
        continue;
      }
      if (a instanceof RigidProjectile) {
        if (++rigid > CAPS.rigidProjectiles) {
          a.destroy();
          continue;
        }
      } else if (a instanceof CreatureProjectile) {
        if (++creatures > CAPS.creatures) {
          a.destroy();
          continue;
        }
      } else if (a instanceof Debris) {
        if (++debris > Math.min(CAPS.debris, quality.maxDebris)) {
          a.destroy();
          continue;
        }
      } else if (a instanceof Bullet) {
        // Cheap, but a firing line of a dozen SMGs still adds up.
        if (++bullets > CAPS.bullets) {
          a.destroy();
          continue;
        }
      } else if (a instanceof Block || a instanceof Enemy) {
        damage.push(a);
      }
      write.push(a);
    }
    write.reverse();
    this.actors = write;
    this.damageList = damage;
  }

  private updateCamera(dt: number) {
    // Read at the point trauma is consumed rather than added, so a setting change is
    // never mid-flight — a slider dragged to OFF kills the shake on the very next frame.
    this.camera.shakeIntensity = settings.shake;
    const p = this.player.ragdoll.dead ? this.player.ragdoll.center() : this.player.pos;

    // The crosshair's offset from the centre of the screen, -1..1, +Y up.
    //
    // Screen space on purpose — see `Camera.follow`. It also means touch gets this for
    // free: the aim thumb writes into `input.mouse` in the same pixel coordinates the
    // mouse does, so dragging the right thumb toward the edge of a phone screen looks
    // downrange exactly as shoving a cursor there does.
    const halfW = Math.max(1, this.camera.viewW / 2);
    const halfH = Math.max(1, this.camera.viewH / 2);
    const aimX = clamp((this.input.mouse.x - halfW) / halfW, -1, 1);
    const aimY = clamp((halfH - this.input.mouse.y) / halfH, -1, 1);
    this.camera.follow(p, aimX, aimY, dt);

    const speed = this.player.ragdoll.speed();
    this.camera.autoZoom(speed + this.player.launchBoost * 14, dt, BASE_ZOOM);
    this.camera.update(dt);
  }

  /**
   * The parts of the audio director that run every rendered frame regardless of mode
   * — decaying the music's excitement, keeping the listener at the camera so panning
   * and distance attenuation track it, muting for a portal ad, and picking the mood.
   */
  private updateAudio(rawDt: number) {
    sfx.update(rawDt);
    sfx.setAdPlaying(portal.adPlaying);
    const half = this.camera.visibleHalf();
    sfx.listener(this.camera.pos.x, this.camera.pos.y, half.x);
    sfx.setMood(this.mode !== "playing" ? "menu" : "combat");
  }

  // ------------------------------------------------------------------ input

  /** Frame-rate controls: pause, and menu navigation keys. */
  private handleFrameKeys() {
    // An ad owns the screen; the game must not react to anything behind it.
    if (portal.adPlaying) return;
    const pause = this.input.pressed("KeyP", "Backspace") || this.touch.pausePressed;
    this.touch.pausePressed = false;
    if (this.mode === "playing" && pause) {
      // Back out of the options panel first — it is drawn over the pause menu, and
      // unpausing straight through it leaves the game running with the panel armed.
      if (this.paused && this.menu.closeOptions()) {
        sfx.ui(false);
        this.input.consumeEdges();
        return;
      }
      this.paused = !this.paused;
      this.canvas.style.cursor = this.paused ? "default" : "none";
      if (this.paused) this.touch.release();
      // The portal's gameplay bracket has to bound *actual play*, not the whole time
      // the level is loaded. It suppresses interruptions between the two calls, so
      // leaving it open across a pause both mis-reports our engagement and throws away
      // the one window the portal is allowed to use.
      if (this.paused) portal.gameplayStop();
      else portal.gameplayStart();
      sfx.ui(!this.paused);
      this.input.consumeEdges();
    }
  }

  private handleMenuInput() {
    const m = this.menu;
    if (this.input.pressed("ArrowRight", "KeyD")) {
      m.moveSelection(1);
      sfx.ui(true);
      this.enterMenu();
    } else if (this.input.pressed("ArrowLeft", "KeyA")) {
      m.moveSelection(-1);
      sfx.ui(false);
      this.enterMenu();
    } else if (this.input.pressed("Enter", "NumpadEnter", "Space")) {
      this.applyMenuAction(m.confirm());
      return;
    } else if (this.input.pressed("Backspace")) {
      m.back();
      return;
    }

    if (this.input.mousePressed) {
      this.applyMenuAction(m.click(this.input.mouse.x, this.input.mouse.y));
    } else {
      m.hover(this.input.mouse.x, this.input.mouse.y);
    }
  }

  /** Every route out of the front end funnels through here. */
  private applyMenuAction(a: MenuAction) {
    switch (a.kind) {
      case "play":
        this.startLevel(a.level);
        break;
      case "select":
        // Re-enter the menu so the attract mode swaps to the arena just picked: the
        // preview *is* the thumbnail, so selecting has to rebuild the world behind it.
        this.enterMenu();
        break;
      default:
        break;
    }
  }

  private handlePauseInput() {
    if (!this.input.mousePressed) {
      this.menu.hover(this.input.mouse.x, this.input.mouse.y);
      return;
    }
    const a = this.menu.click(this.input.mouse.x, this.input.mouse.y);
    switch (a.kind) {
      case "resume":
        this.paused = false;
        this.canvas.style.cursor = "none";
        sfx.ui(true);
        break;
      case "restart":
        this.restart();
        break;
      case "quit":
        this.enterMenu();
        break;
      default:
        break;
    }
  }

  /** Invincibility cheat. Announces itself over the player so the state is never a mystery. */
  private toggleGod() {
    this.godMode = !this.godMode;
    this.player.setGod(this.godMode);
    const c = this.player.pos;
    this.particles.popup(
      c.x, c.y + 2.2,
      this.godMode ? "GOD MODE ON" : "GOD MODE OFF",
      this.godMode ? "#ffd23f" : "#f4f1e8",
      0.85,
    );
    sfx.ui(this.godMode);
  }

  /** Runs inside the fixed step, so these edges are consumed exactly once. */
  private handleSimKeys() {
    if (this.input.pressed("KeyM")) sfx.toggleMute();
    if (this.input.pressed("F3", "Backquote")) this.showDebug = !this.showDebug;
    if (this.input.limpPressed()) this.player.toggleRagdoll();
    if (this.input.pressed("KeyG")) this.toggleGod();
    // Reset last: it replaces `this.player`, so nothing after it may touch the old one.
    if (this.input.pressed("KeyF")) this.restart();
  }

  // ------------------------------------------------------------------ render

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private render(dt: number) {
    const ctx = this.ctx;
    // Work in CSS pixels everywhere: the backing store is DPR-scaled, but a base
    // transform of `dpr` means camera zoom, HUD sizes and mouse coords all agree.
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Resample the aim against the camera we are about to draw with.
    //
    // `simulate()` syncs the aim at the top, before `updateCamera()` runs, so that
    // sample is unprojected through *last* frame's camera — the gun ends up pointing
    // where the cursor was relative to the previous view while the crosshair is drawn
    // against the current one. The camera moves every frame (follow, aim lead, zoom),
    // so that is a permanent offset that grows with how fast the view is moving.
    this.camera.setViewport(w, h);
    this.player.syncAim();

    this.background.draw(ctx, this.camera, w, h, this.theme);

    ctx.save();
    this.camera.apply(ctx, w, h);
    ctx.lineJoin = "round";

    // Cull first, then sort: a big level is mostly off-screen blocks, and drawing
    // them is far more expensive than the physics that keeps them asleep.
    this.drawList.length = 0;
    for (const a of this.actors) {
      if (a.dead) continue;
      if (a.cullPos && !this.camera.isVisible(a.cullPos(), a.cullRadius ?? 2)) continue;
      this.drawList.push(a);
    }
    this.drawList.sort((x, y) => (x.z ?? 10) - (y.z ?? 10));

    // Marks sit under everything: blood is on the floor, not on the characters.
    this.decals.draw(ctx);
    for (const a of this.drawList) a.draw(ctx);
    this.particles.draw(ctx);
    this.water.draw(ctx);
    // Flames last and additive, so they light everything they are in front of.
    this.fire.draw(ctx);
    if (this.mode === "playing") this.player.drawTrajectory(ctx);
    ctx.restore();

    this.background.drawHaze(ctx, w, h, this.theme);

    if (this.flashStrength > 0.01) {
      ctx.fillStyle = rgba(this.flashColor, clamp(this.flashStrength, 0, 1) * 0.75);
      ctx.fillRect(0, 0, w, h);
    }

    if (this.mode === "menu") {
      this.menu.draw(ctx, w, h, sfx.muted);
      return;
    }

    this.hud.draw(ctx, w, h, this.hudState(), dt);

    if (this.paused) {
      this.menu.drawPause(ctx, w, h, this.levelDef.name);
      return;
    }

    this.coach.draw(ctx, w, h, this.camera, this.player.chest);
    this.hud.drawCrosshair(
      ctx,
      this.input.mouse.x,
      this.input.mouse.y,
      clamp(Math.min(w, h) / 780, 0.62, 1.35),
      this.player.weapon.ammo.tint,
      this.player.weapon.cooldownFrac,
    );
    this.touch.draw(ctx, w, h, true);
  }

  /** What the coach needs to know about this frame. See `ui/coach.ts`. */
  private coachInput(): CoachInput {
    return {
      live: !this.paused && !this.player.isDown,
      firing: this.input.mouseDown || this.firedEdgeThisFrame,
      moveX: this.input.moveX,
      ammoIndex: this.player.weapon.index,
      ammoCount: this.player.weapon.list.length,
      jetThrottle: this.player.jetThrottle,
      limp: this.player.isLimp,
      touch: this.input.touchMode,
    };
  }

  private hudState(): HudState {
    // Count over the level's own roster (a few dozen) rather than filtering every
    // actor in the world (several hundred) once per frame.
    let alive = 0;
    for (const e of this.level.enemies) if (!e.ragdoll.dead) alive++;
    return {
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      fuel: this.player.fuelFrac,
      jetThrottle: this.player.jetThrottle,
      score: this.score,
      displayScore: this.displayScore,
      combo: this.combo,
      comboTimer: this.comboTimer,
      comboMax: this.comboMax,
      enemiesLeft: alive,
      enemiesTotal: this.level.enemies.length,
      blocksDestroyed: this.blocksDestroyed,
      weapon: this.player.weapon,
      down: this.player.isDown,
      respawnIn: this.player.respawnIn,
      time: this.time,
      fps: this.fps,
      god: this.godMode,
      showDebug: this.showDebug,
      bodies: this.physics.bodyCount,
      particles: this.particles.active,
      muted: sfx.muted,
      paused: this.paused,
      hintAlpha: this.hintAlpha,
      levelName: this.levelDef.name,
      kills: this.kills,
    };
  }
}

/**
 * Soft limits — oldest entries are retired once exceeded, so perf degrades gracefully.
 *
 * These are the *authored* ceilings. Debris is additionally capped by the quality tier
 * (see `ui/quality.ts`): it is the only one of the four that is purely decorative once
 * it has come to rest, so it is the only one a slow machine may have less of. Cutting
 * live projectiles or bullets instead would change what the game does, not how it looks.
 */
const CAPS = {
  rigidProjectiles: 90,
  creatures: 42,
  debris: 200,
  bullets: 160,
};

export { levelById };
