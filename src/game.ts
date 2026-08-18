import { Camera } from "./core/camera";
import { Input } from "./core/input";
import { Physics, type ImpactEvent } from "./core/physics";
import type { Actor, GameCtx } from "./core/types";
import { Particles } from "./fx/particles";
import { sfx } from "./fx/audio";
import { Background } from "./render/background";
import { THEMES, type Theme } from "./render/theme";
import { rgba, type Ctx } from "./render/draw";
import { Player } from "./entities/player";
import { Enemy, alertNearby } from "./entities/enemy";
import { Block, Debris } from "./entities/block";
import { Hud, type HudState } from "./ui/hud";
import { Menu, type MenuAction } from "./ui/menu";
import { progress } from "./ui/progress";
import { DemoDriver } from "./ai/demo";
import { Builder } from "./levels/builder";
import { CAMPAIGN, LEVELS, levelById } from "./levels";
import type { LevelDef, LevelInfo, LevelKind } from "./levels/types";
import { clamp, damp, lerp, rand, v, type V } from "./core/math";
import { Bullet } from "./entities/bullet";
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

export type Mode = "menu" | "playing";

/** How a run ended. Drives the result overlay; null while it is still going. */
export type Outcome = "won" | "lost" | null;

export class Game implements GameCtx {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  readonly input: Input;
  readonly camera = new Camera();
  readonly particles = new Particles();
  readonly hud = new Hud();
  readonly menu = new Menu();
  readonly background = new Background();

  physics!: Physics;
  player!: Player;
  level!: LevelInfo;
  levelDef: LevelDef = LEVELS[0];
  theme: Theme = THEMES.day;

  mode: Mode = "menu";
  /** Which set of rules the current run plays under. See `LevelDef.kind`. */
  runKind: LevelKind = "playground";
  private demo: DemoDriver | null = null;
  private demoAge = 0;

  /** Set once a campaign mission is won or lost, or an endless run ends. */
  outcome: Outcome = null;
  /** Campaign: knockouts left. Ignored in the other modes. */
  livesLeft = 3;
  /** Latched so a single death only ever costs one life. */
  private wasDown = false;
  /** Endless: kills this run, mirrored onto the director for the HUD. */
  private kills = 0;
  /** The furthest previous run, sampled when this one started. Never updated mid-run. */
  private bestDistance = 0;

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

  paused = false;
  showDebug = false;
  /** Session-level cheat: kept across respawns, restarts and level changes. */
  private godMode = false;
  private hintAlpha = 1;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.input = new Input(canvas);
  }

  // ------------------------------------------------------------------ setup

  async init() {
    await Physics.load();
    this.enterMenu();
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

    this.levelDef = def;
    this.theme = THEMES[def.theme] ?? THEMES.day;
    this.physics = new Physics(def.gravity);
    // Falling debris should float on a low-gravity world too.
    this.particles.gravityScale = def.gravity / BASE_GRAVITY;

    const builder = new Builder(this, this.theme);
    this.level = def.build(this, builder);
    this.flushPending();

    this.player = this.add(new Player(this, this.input, this.level.spawn.x, this.level.spawn.y));
    this.flushPending();
    // Missions issue a fixed loadout; everything else gets the whole arsenal.
    this.player.weapon.setLoadout(def.loadout);
    // God mode is a session cheat, but a mission that forbids it forbids it.
    this.player.setGod(this.godMode && this.godAllowed);

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
  }

  /** True when the current level permits the god-mode cheat. Campaign never does. */
  private get godAllowed() {
    return this.levelDef.allowGod !== false;
  }

  /**
   * Banks whatever the current run earned before it is torn down, so quitting to the
   * menu mid-run still counts. `recordDistance` only ever moves the record forward,
   * making a double call from `finish()` harmless.
   */
  private bankRun() {
    if (this.mode !== "playing" || this.runKind !== "endless") return;
    const d = this.level?.director;
    if (d) progress.recordDistance(d.distance);
  }

  /** Starts a level for the player. */
  startLevel(def: LevelDef) {
    this.bankRun();
    this.mode = "playing";
    this.runKind = def.kind ?? "playground";
    this.demo = null;
    this.paused = false;
    this.outcome = null;
    this.hintAlpha = 1;
    this.wasDown = false;
    this.livesLeft = def.lives ?? 3;
    this.bestDistance = progress.bestDistance;
    this.loadLevel(def);
    this.player.control = null;
    this.canvas.style.cursor = "none";
    // The click that pressed PLAY must not also pull the trigger on frame one.
    this.input.consumeEdges();
    sfx.levelUp();
  }

  /** Advances to the next campaign mission, or back to the menu after the last one. */
  nextMission() {
    const i = CAMPAIGN.indexOf(this.levelDef);
    if (i >= 0 && i + 1 < CAMPAIGN.length) this.startLevel(CAMPAIGN[i + 1]);
    else this.enterMenu();
  }

  /** Returns to the start menu, where the selected world plays itself. */
  enterMenu() {
    this.bankRun();
    this.mode = "menu";
    this.runKind = "playground";
    this.outcome = null;
    this.paused = false;
    // Armed and endless levels can't be demoed — see Menu.previewLevel.
    this.loadLevel(this.menu.previewLevel);
    this.demo = new DemoDriver(this);
    this.demo.reset(this.level.spawn);
    this.player.control = this.demo.control;
    // The demo is a showcase, not a fair fight — it shouldn't die mid-attract.
    this.player.ragdoll.invulnerable = true;
    this.demoAge = 0;
    this.canvas.style.cursor = "default";
  }

  restart() {
    this.startLevel(this.levelDef);
  }

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

  get comboMultiplier() {
    return clamp(1 + (this.combo - 1) * 0.14, 1, 6);
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
      this.hitstop(0.045);
      this.camera.addTrauma(0.16);
      this.kills++;
      this.level.director?.countKill();
    }
    if (this.combo === 10 || this.combo === 25 || this.combo === 50 || this.combo === 100) {
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

    this.resize();
    this.handleFrameKeys();

    this.menu.lastMouse.x = this.input.mouse.x;
    this.menu.lastMouse.y = this.input.mouse.y;

    if (this.mode === "menu") {
      this.menu.update(rawDt);
      this.handleMenuInput();
      this.simulate(rawDt);
    } else if (this.outcome) {
      // The world keeps settling behind the result card — the last building you
      // knocked over should be allowed to finish falling.
      this.handleResultInput();
      this.simulate(rawDt);
    } else if (this.paused) {
      this.handlePauseInput();
    } else {
      this.simulate(rawDt);
    }

    // Anything the sim didn't consume (paused, or a frame with no fixed step in menu
    // mode) is dropped here so edges can't pile up across states.
    if (this.mode !== "playing" || this.paused || this.outcome) this.input.consumeEdges();

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

    if (this.comboTimer > 0) {
      this.comboTimer -= rawDt * 0.62;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.combo = 0;
      }
    }

    if (this.mode === "playing" && !this.outcome) this.checkOutcome(rawDt);

    if (this.demo) {
      this.demoAge += rawDt;
      this.demo.update(rawDt, this.player, this.level.bounds);
      // Rebuild once the demo has flattened enough of the level to get boring.
      if (this.demoAge > DEMO_RELOAD) this.enterMenu();
    }

    this.updateCamera(rawDt);
  }

  // ------------------------------------------------------------------ outcome

  /** Delay between the last hostile dropping and the victory card, so it lands. */
  private winDelay = 0;

  /**
   * Watches for the end of a run.
   *
   * Only campaign missions can be *won* — a playground world has no objective, and
   * endless has no end. Campaign and endless can both be *lost* by running out of
   * lives; playground can't, because dying there is the whole point.
   */
  private checkOutcome(dt: number) {
    // A knockdown costs a life on the frame it happens, latched so one death is
    // never billed twice while the corpse lies there waiting to respawn.
    const down = this.player.isDown;
    if (down && !this.wasDown) {
      this.wasDown = true;
      if (this.runKind !== "playground" && !this.player.god) {
        this.livesLeft--;
        if (this.livesLeft <= 0) {
          this.finish("lost");
          return;
        }
        this.particles.popup(this.player.pos.x, this.player.pos.y + 2.4,
          `${this.livesLeft} ${this.livesLeft === 1 ? "LIFE" : "LIVES"} LEFT`, "#e8433a", 0.9);
      }
    } else if (!down) {
      this.wasDown = false;
    }

    if (this.runKind === "endless") return;

    if (this.runKind !== "campaign") return;

    let alive = 0;
    for (const e of this.level.enemies) if (!e.ragdoll.dead) alive++;
    if (alive > 0) {
      this.winDelay = 0;
      return;
    }
    this.winDelay += dt;
    if (this.winDelay > 1.4) this.finish("won");
  }

  private finish(outcome: Outcome) {
    this.outcome = outcome;
    this.canvas.style.cursor = "default";
    if (outcome === "won") {
      if (this.runKind === "campaign") progress.clear(this.levelDef.order ?? 0);
      sfx.levelUp();
    } else {
      sfx.ui(false);
    }
    if (this.runKind === "endless") {
      const d = this.level.director;
      if (d) progress.recordDistance(d.distance);
    }
  }

  /** The stats block on the result card, per mode. */
  private resultCard() {
    const d = this.level.director;
    const won = this.outcome === "won";
    const stats: [string, string][] = [
      ["SCORE", this.score.toLocaleString("en-US")],
      ["BEST CHAIN", `x${this.comboMax}`],
      ["BLOCKS SMASHED", `${this.blocksDestroyed}`],
      ["TIME", `${this.time.toFixed(1)}s`],
    ];

    if (this.runKind === "endless") {
      stats.unshift(["DISTANCE", `${Math.floor(d?.distance ?? 0)}m`]);
      stats.splice(1, 0, ["HOSTILES DOWN", `${this.kills}`]);
      return {
        won: false,
        title: "RUN OVER",
        // Compared against the record as it stood when this run started — `finish`
        // has already banked the new one by the time this card is built.
        subtitle: (d?.distance ?? 0) > this.bestDistance
          ? "A new furthest run."
          : `Furthest run so far: ${Math.floor(this.bestDistance)}m.`,
        stats,
        hasNext: false,
        retryLabel: "RUN AGAIN",
      };
    }

    stats.unshift(["HOSTILES DOWN", `${this.level.enemies.length - this.aliveEnemies()}/${this.level.enemies.length}`]);
    const last = CAMPAIGN.indexOf(this.levelDef) === CAMPAIGN.length - 1;
    return {
      won,
      title: won ? "MISSION COMPLETE" : "MISSION FAILED",
      subtitle: won
        ? (last ? "That was the last of them. The campaign is yours." : `${this.levelDef.name} is clear.`)
        : "Out of lives. They are still standing.",
      stats,
      hasNext: won && !last,
      retryLabel: won ? "REPLAY MISSION" : "TRY AGAIN",
    };
  }

  private aliveEnemies() {
    let n = 0;
    for (const e of this.level.enemies) if (!e.ragdoll.dead) n++;
    return n;
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

    this.clampPlayerToBounds();
    this.reapAndCap();
  }

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

      if (this.camera.isVisible(e.point, 6)) {
        const n = clamp(Math.round(kj / 12), 1, 10);
        this.particles.dust(e.point.x, e.point.y, n, 2.6);
        if (kj > 30) this.particles.sparks(e.point.x, e.point.y, clamp(Math.round(kj / 18), 2, 12), 8, "#ffe9a8");
        this.camera.addTrauma(clamp(kj / 900, 0.02, 0.32));
      }
      // Big collisions get a frame of freeze — the cheapest, strongest impact cue.
      if (kj > 120) this.hitstop(clamp(kj / 5000, 0.02, 0.09));
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
        if (++debris > CAPS.debris) {
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
    const p = this.player.ragdoll.dead ? this.player.ragdoll.center() : this.player.pos;
    const aim = this.player.aim;
    // Lead the camera a third of the way to the crosshair so you can see what you hit.
    this.camera.follow(p, (aim.x - p.x) * 0.32, (aim.y - p.y) * 0.28 + 2.2, dt);

    const speed = this.player.ragdoll.speed();
    this.camera.autoZoom(speed + this.player.launchBoost * 14, dt, BASE_ZOOM);
    this.camera.update(dt);
  }

  // ------------------------------------------------------------------ input

  /** Frame-rate controls: pause, and menu navigation keys. */
  private handleFrameKeys() {
    if (this.mode === "playing" && !this.outcome && this.input.pressed("KeyP", "Escape")) {
      this.paused = !this.paused;
      this.canvas.style.cursor = this.paused ? "default" : "none";
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
    } else if (this.input.pressed("Escape", "Backspace")) {
      if (m.back()) {
        sfx.ui(false);
        this.enterMenu();
      }
      return;
    } else if (this.input.pressed("KeyM")) {
      sfx.toggleMute();
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
      case "screen":
        this.menu.goTo(a.screen);
        sfx.ui(true);
        // Preview whatever the new screen has selected, immediately.
        this.enterMenu();
        break;
      case "back":
        this.menu.back();
        sfx.ui(false);
        this.enterMenu();
        break;
      case "select":
        sfx.ui(true);
        this.enterMenu();
        break;
      case "mute":
        sfx.toggleMute();
        break;
      default:
        break;
    }
  }

  /** Buttons on the mission-complete / run-over card. */
  private handleResultInput() {
    if (this.input.pressed("Enter", "NumpadEnter", "Space")) {
      const card = this.resultCard();
      if (card.hasNext) this.nextMission();
      else this.restart();
      return;
    }
    if (this.input.pressed("Escape")) {
      this.enterMenu();
      return;
    }
    if (!this.input.mousePressed) {
      this.menu.hover(this.input.mouse.x, this.input.mouse.y);
      return;
    }
    const a = this.menu.click(this.input.mouse.x, this.input.mouse.y);
    switch (a.kind) {
      case "next":
        this.nextMission();
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
    if (!this.godAllowed) {
      // Campaign missions are the one place the cheat is off the table. Say so
      // rather than silently swallowing the key.
      const c = this.player.pos;
      this.particles.popup(c.x, c.y + 2.2, "NOT IN CAMPAIGN", "#e8433a", 0.85);
      sfx.ui(false);
      return;
    }
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
    if (this.input.pressed("KeyR")) this.player.toggleRagdoll();
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

    for (const a of this.drawList) a.draw(ctx);
    this.particles.draw(ctx);
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

    if (this.outcome) {
      this.menu.drawResult(ctx, w, h, this.resultCard());
      return;
    }

    if (this.paused) {
      this.menu.drawPause(ctx, w, h, this.levelDef.name);
      return;
    }

    this.hud.drawCrosshair(
      ctx,
      this.input.mouse.x,
      this.input.mouse.y,
      clamp(Math.min(w, h) / 780, 0.62, 1.35),
      this.player.weapon.ammo.tint,
      this.player.weapon.cooldownFrac,
    );
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
      god: this.godMode && this.godAllowed,
      showDebug: this.showDebug,
      bodies: this.physics.bodyCount,
      particles: this.particles.active,
      muted: sfx.muted,
      paused: this.paused,
      // The control card has no business showing through the end-of-run overlay.
      hintAlpha: this.outcome ? 0 : this.hintAlpha,
      levelName: this.levelDef.name,
      mode: this.runKind,
      lives: this.livesLeft,
      briefing: this.levelDef.briefing ?? "",
      distance: this.level.director?.distance ?? 0,
      bestDistance: Math.max(this.bestDistance, this.level.director?.distance ?? 0),
      kills: this.kills,
    };
  }
}

/** Soft limits — oldest entries are retired once exceeded, so perf degrades gracefully. */
const CAPS = {
  rigidProjectiles: 90,
  creatures: 42,
  debris: 200,
  bullets: 160,
};

export { levelById };
