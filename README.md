# Stickman Ascension

A 2D ragdoll destruction sandbox. You are a stickman with a gun that fires things a gun
should not be able to fire — chickens, sedans, grand pianos, passenger jets, live
elephants, other stickmen — at buildings full of stickmen, and everything is simulated.

Nothing in this game is animated. Every collapse, every flop, every tumbling wreck is
solved by the physics engine at runtime.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/, ready to zip and upload
```

## Worlds

Pick one from the start menu — the selected world plays itself behind the menu, driven by
the same character and physics you're about to control.

| World | Twist |
| --- | --- |
| **Test Range** | Daylight sandbox. Crates, houses and a skyline. Learn the arsenal here. |
| **Blackthorn Keep** | Night siege. Curtain walls, gatehouse, crenellated towers and a keep. Stone shrugs off the light rounds. |
| **Xenoform Basin** | Hive world under corrosive rain. Anything with open sky above it takes damage — including you. Roofs are real cover. |
| **Ares Colony** | Mars at roughly a third gravity. You jump ~4.6m instead of ~1.7m, and every round carries about three times as far. |

## Controls

| Input | Action |
| --- | --- |
| `A` / `D` | Move |
| `Space` | Jump — **hold while airborne to fly the jetpack** |
| Mouse | Aim |
| Left click | Fire (hold for automatic rounds) |
| `1`–`9`, `Q` / `E`, wheel | Switch ammo |
| `S` | Crouch |
| `R` | Go limp (toggle full ragdoll) |
| `G` | God mode (toggle invincibility) |
| `F` | Restart the level |
| `Esc` / `P` | Pause — Resume / Restart / Main Menu |
| `M` | Mute |
| `F3` | Debug overlay (fps, bodies, particles) |

In the menu: `←` `→` choose world, `Enter` play, or click a card and then **PLAY**.

**Recoil is a movement tool.** The heavy rounds kick hard enough to launch you across the
map. Firing an elephant while standing still will put you on your back.

**The jetpack** holds ~2.5 seconds of burn and refills only once you are back on the
ground, so it is a traversal and rescue tool rather than free flight. A full tank lifts
you about 25 m — enough to reach most rooftops, and enough to save you after a shot throws
you off a tower. Thrust is expressed as *net* acceleration on top of the world's gravity,
so the pack handles identically on Earth and on Mars instead of being feeble on one and
uncontrollable on the other. It cuts out while you are knocked down.

## The arsenal

18 rounds, all defined as data in `src/weapons/ammo.ts`:

Chicken Cannon · Rocket Launcher · Sedan Slinger · Jetliner Blaster · Elephant Gun ·
Human Resources (fires screaming ragdolls) · Anvil Express · Grand Finale (a piano, which
plays a chord when it lands) · Cold Storage · Perfect Game (bowling ball) · Melon Repeater ·
Buzzsaw Barrage · Porcelain Throne · Static Discharge · Barrel Roll ·
Nana Nailgun · Tactical Regret (a nuke, 3 rounds) · Singularity (a black hole, 3 rounds)

Adding a new one is a single object literal — no new classes:

```ts
{
  id: "safe", name: "Safe Deposit", tagline: "Contents: gravity.",
  tint: "#4a515c",
  count: 1, spread: 0.04, speed: 30, speedVar: 2, cooldown: 0.6,
  recoil: 13, heft: 0.8, auto: true, reserve: -1, muzzle: 1.2,
  spawn: makeRigid(rigid({
    shape: "box", w: 1.1, h: 1.3, density: 800,
    impactSound: "metal", draw: P.drawAnvil, points: 30,
  })),
}
```

`makeCreature` instead of `makeRigid` gives you a jointed, flailing, screaming version of
the same thing.

## Layout

```
src/
  core/        math, input, camera, physics wrapper, shared types
  entities/    ragdoll, player, enemy, block/terrain/debris, projectile
  weapons/     ammo registry, the gun
  render/      draw helpers, stickman + creature renderers, prop art, backdrop, themes
  fx/          particle pool, procedural WebAudio
  levels/      structure builder, the four worlds, weather hazards
  ai/          attract-mode driver
  ui/          HUD, start menu + pause menu
```

A world is a `LevelDef` (`src/levels/types.ts`): a palette (`Theme`), a gravity value, a
`build()` that lays out structures with `Builder`, and an optional hazard. Adding a fifth
world means adding one file and one entry in `src/levels/index.ts` — no engine changes.

## How it works

**Physics: Rapier 2D** (Rust → WebAssembly). Chosen over Matter.js / Planck for joint
stability and raw throughput — this game routinely has 900 bodies and 250+ joints live.
`@dimforge/rapier2d-compat` inlines the WASM as base64, so the build is a single
self-contained JS file with zero extra network requests.

**Ragdolls** (`entities/ragdoll.ts`) are data-driven skeletons: a list of bones with
positions, sizes and revolute joints with angle limits. Four skeletons ship — full biped
(13 bodies, for the player and bosses), lite biped (7 bodies, for crowds and stickman
ammo), quadruped (elephants) and chicken.

Three non-obvious things make the ragdolls behave, and all three are load-bearing:

1. **Self-collision filtering.** Adjacent limbs overlap by design. Rapier does not filter
   jointed bodies, so each ragdoll carries a `selfGroup` id and a physics hook drops
   same-skeleton contact pairs. Without it the solver fights the joints and the body buzzes.

2. **The root's rotation is pinned while a character is under control.** Springs and
   torques cannot reliably stand a limp 70 kg skeleton up off the floor — the ground
   contacts absorb the correction and the controller saturates face-down. Pinning the
   pelvis angle makes "upright" true by construction and the joint limits carry it to the
   rest of the body. Release it and the character is instantly, completely floppy. (Note:
   `lockRotations` only clears the inverse inertia, so any leftover angular velocity keeps
   integrating — it must be zeroed at the same time.)

3. **Controller forces scale with whole-body mass.** The pelvis is ~13 kg of a ~70 kg body;
   a ride spring scaled by pelvis mass sags half a metre and collapses.

**Input timing.** Edge-triggered input (key presses, clicks, wheel) is latched by the DOM
handlers and consumed by the **fixed simulation step**, never by the render frame. This is
not a detail — clearing edges per rendered frame throws presses away unread on any display
faster than the 60 Hz sim (half of them at 120 Hz, three quarters at 240 Hz) and during
hitstop and slow-motion, when the sim deliberately runs slower than the display. If you
touch `Game.frame` / `Game.simulate`, keep `input.consumeEdges()` inside the accumulator
loop. Pause is the one exception: it is handled at frame rate, because while paused no
simulation step exists to consume it.

**Destruction** (`entities/block.ts`) is stacks of ordinary rigid bodies with per-material
health. Blocks spawn *anchored* — static bodies — and convert to dynamic the moment
anything disturbs them. This is what lets a 16-storey tower stand at all (loose stacks
topple from solver noise within a second) and keeps ~800 idle bodies nearly free. Collapse
still cascades naturally: a freed block falls, knocks its anchored neighbour loose, and the
failure propagates.

Impact damage is computed from relative approach speed and reduced mass, in kilojoules.
Material constants live in one table in `entities/block.ts`.

**Audio** is synthesised at runtime — no audio files at all. Clucks, elephant
trumpets, explosions and the piano chord are all oscillators and filtered noise
(`fx/audio.ts`).

**Performance.** Two things dominate and both are handled: characters far from the camera
leave the simulation entirely (`Ragdoll.setEnabled`), and off-screen actors are culled
before drawing. Measured on the sandbox level: ~1 ms simulation and ~5 ms render at rest,
~14 ms total mid-rampage with 340 awake bodies.

## Tuning

Almost all feel lives in three places:

- `entities/player.ts` → `TUNE` — movement, balance, recoil transfer, knockdown thresholds.
- `entities/block.ts` → `MATERIALS` — density, toughness, fragility, points per material.
- `weapons/ammo.ts` — every round's speed, recoil, cooldown, mass and payload.

`F3` shows fps, body count and particle count. `window.game` is exposed for console
poking.

## Known gaps / next steps

- **No objectives or progression.** Four worlds, but each is a sandbox — nothing to
  complete. `levels/builder.ts` has the pieces (towers, houses, walls, pyramids, bridges,
  catwalks, battlements, domes, spires, hives) to author more quickly.
- **Bundle size** is 837 KB gzipped, nearly all of it Rapier's base64-inlined WASM.
  Switching to `@dimforge/rapier2d` (separate `.wasm` file) would cut that meaningfully and
  parse faster, at the cost of needing a WASM plugin in the build.
- **No mobile/touch controls**, and no CrazyGames SDK integration (ads, highscores) yet.
- Enemies are hazards, not threats — they panic and die but never shoot back.
