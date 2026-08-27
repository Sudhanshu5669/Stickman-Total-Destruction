# Stickman Total Destruction

A 2D ragdoll destruction sandbox. You are a stickman with a gun that fires things a gun
has no business firing — chickens, sedans, grand pianos, passenger jets, live elephants,
other stickmen — at buildings full of stickmen, and everything is simulated.

Nothing in this game is animated. Every collapse, every flop, every tumbling wreck is
solved by the physics engine at runtime.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build  ->  dist/, ready to zip and upload
npm run preview    # serve the built dist/ locally
npm run typecheck  # tsc --noEmit on its own
```

## The loop

Pick an arena. Break it. Watch the physics engine solve the consequences. Go again.

There is **one mode** — an arena picker — and that is the whole structure. No story, no
missions, no lives, no win screen, nothing to read. The previous build's campaign,
contracts, endless and daily modes were torn out on purpose (the "Sandbox Reset"; see
`GAME_SPEC.md`, which is the source of truth for design).

Whatever arena is selected in the menu plays itself behind the menu, driven by the same
character and physics you are about to control — the preview *is* the thumbnail.

## The seven arenas

Deliberately not seven corridors — each is a different shape of fight, and none of them
can be read from the spawn or finished from one firing position (300–420 m each).

| Arena | Shape | Twist |
| --- | --- | --- |
| **Proving Ground** | Open range | Daylight sandbox. Crates, houses, a skyline, range markers. Learn the arsenal here. |
| **Long Meadow** | Wide valley | Artillery country — a mill on a far rise, a plank causeway over flooded pasture, a redoubt in the open. |
| **Ironhold** | Vertical | A gatehouse, a curtain wall, a twelve-storey keep. One load-bearing decision brings the tower down. |
| **The Quarry** | Bowl | An enclosed pit fought in the round. Haul road, crushing floor, a second and deeper cut, spoil tips. |
| **The Drift** | Islands | A chain of platforms over a drop at one-third gravity. You jump higher, every round carries farther, and the ground is optional. |
| **Grid City** | City street | Dense and tall, from the City Tiles pack. Intersection, low-rise strip, a construction site, an elevated road, one landmark tower. |
| **Coldspine** | Winter fortress | Layered terraces up a ridge — outer wall, bell tower, citadel behind its gate. Stone shrugs off the light rounds. |

Every arena has hostile stickmen in it. An enemy is unarmed unless the arena hands it a
`CombatSpec`, and the armed ones take cover, react to their building coming apart, and
coordinate loosely — see *Enemy AI* below. Dying costs you nothing but the walk back;
respawn is automatic.

## Controls

| Input | Action |
| --- | --- |
| `A` / `D` | Move |
| `Space` | Jump — **hold while airborne to fly the jetpack** |
| Mouse | Aim |
| Left click | Fire (hold for automatic rounds) |
| `1` / `3`, `Q` / `E`, wheel | Step back / forward through the ammo list |
| `S` | Crouch |
| `R` | Go limp (toggle full ragdoll) |
| `G` | God mode (invincible, infinite jetpack) |
| `F` | Restart the arena |
| `Esc` / `P` | Pause — Resume / Restart / Options / Leave |
| `M` | Mute the music |
| `F3` | Debug overlay (fps, bodies, particles) |

In the menu: `←` `→` choose, `Enter` play, `Esc` back, or click a card and then PLAY.

**There is no controls screen.** `src/ui/coach.ts` teaches one control at a time, in
game, beside the stickman, led by a picture rather than prose, and dismissed by *doing
the thing* — a player who never touches the jetpack never gets a jetpack lesson. It can
be switched off from the pause menu (`CONTROL TIPS`). Screenshake and music each have a
four-step control there too (`OFF`/`LOW`/`MEDIUM`/`FULL`) — screenshake because motion
sickness is not a matter of taste, music because somebody is playing this where they
should not be. Both persist.

**Touch.** `src/ui/touch.ts` draws an on-screen pad — a move stick, an aim/fire thumb, a
jump button and a pause corner. It is inert until a real touch arrives and auto-enables
on coarse-pointer devices.

**Recoil is a movement tool.** The heavy rounds kick hard enough to launch you across
the map. Firing an elephant while standing still will put you on your back.

**The jetpack** holds ~2.5 seconds of burn (infinite in god mode) and refills only once
you are back on the ground, so it is a traversal and rescue tool rather than free
flight. Thrust is expressed as *net* acceleration on top of the world's gravity, so the
pack handles identically on Earth and on The Drift instead of being feeble on one and
uncontrollable on the other. It cuts out while you are knocked down.

## The arsenal

21 rounds, all defined as data in `src/weapons/ammo.ts`, **all unlocked from a fresh
save**:

Chicken Cannon · Rocket Launcher · Sedan Slinger · Jetliner Blaster · Elephant Gun ·
Human Resources (fires screaming ragdolls) · Anvil Express · Grand Finale (a piano,
which plays a chord when it lands) · Cold Storage (flash-freezes whatever it touches) ·
Party Supplies (ties balloons to whatever it hits — see *Buoyancy*) · Tow Cable (a
barbed harpoon on a winch — see *The winch*) · Perfect Game (bowling ball) · Melon
Repeater · Buzzsaw Barrage · Static Discharge · Barrel Roll · Tactical Regret (a nuke) ·
Singularity (a black hole) · Hydro Cannon (a hose — puts out fires, douses anything
flammable) · Flamethrower (sets fires; wet targets won't catch) · Frag Grenade

Weapons are **hand-authored pixel art**, generated once at boot into offscreen canvases
from per-pixel source data in the repo (`render/pixel.ts` holds the buffer and the
ramps; `render/gunart.ts` and `render/ammoart.ts` share them so guns and rounds cannot
drift apart). Creature rounds stay bone-drawn ragdolls on purpose.

## Progression

There isn't any, and that is deliberate. Every round is in your hands from the first
launch — priced at zero in `src/ui/progress.ts`. A sandbox that withholds its toys is
just a shorter sandbox, and the reason to go back into an arena you already flattened is
the round you have not fired at it yet.

Lifetime **carnage** is earned by destroying things, banked in `localStorage`, and shown
on the menu and the HUD — a score, not a currency. Firing a round for the very first
time pays a one-off first-strike bounty, once per round, because 21 rounds are only an
arsenal if you actually try them.

The cost column in `progress.ts` is kept rather than deleted, so re-pricing a round is a
one-number edit: set a cost above zero and the unlock bar and the loadout gate wake back
up unchanged.

Adding a new round is a single object literal in `ammo.ts` — no new classes. The bar for
one is *does it claim a verb the engine can already do that nothing else owns* (Party
Supplies claims buoyancy, the Tow Cable claims a directed pull); a re-skin of an
existing behaviour does not qualify.

## Audio

**Music, by the game's author.** Two liquid drum-and-bass tracks live in
`src/Assets/music` as `Liquid DnB Synthxx 1.mp3` (the menu) and `Liquid DnB Synthxx
2.mp3` (the arenas). Nothing names them in code — `src/fx/audio.ts` globs the folder,
gives the first track to the menu and rotates the arenas through the rest, so adding a
third is dropping an MP3 in the folder and nothing else. They crossfade over ~2 s on a
mood change, each track holding its own playhead so bouncing between the menu and a
fight sounds continuous.

Streamed through `<audio>` rather than decoded into WebAudio: a 3–4 MB MP3 decoded up
front is several seconds of silence at boot and tens of megabytes resident on a phone.

**MUSIC** is a four-step control in the options panel (`OFF`/`LOW`/`MEDIUM`/`FULL`, with
a real OFF) and `M` still mutes. Both persist.

Sound **effects** are stubbed: `audio.ts` keeps all ~70 effect call sites as no-op
methods, so reinstating a mix later is a one-file change. The call sites are correct —
they mark the exact moments the game believes are worth hearing.

## Layout

```
src/
  core/        math, input, camera, physics wrapper, shared types
  entities/    ragdoll, player, enemy, block/terrain/debris, projectile, bullet, pickup
  weapons/     ammo registry, the gun
  render/      draw helpers, stickman + creature renderers, pixel-art gun/ammo/balloon,
               backdrop, themes, sprite sheets
  fx/          juice (unified impact curve), particles, decals, gore, callouts,
               fire / fluid / solids / buoyancy / tow, music player (effects stubbed)
  levels/      structure builder, the seven arenas, seeded dressing, level types
  ai/          attract-mode driver
  ui/          HUD, menu, progress store, in-game coach, settings, quality, touch, chrome
  platform/    the CrazyGames SDK integration (portal.ts), and the seam that keeps it optional
  Assets/      the bundled art packs and the music
```

A level is a `LevelDef` (`src/levels/types.ts`): a palette (`Theme`), a gravity value,
and a `build()` that lays out structures with `Builder`. Adding an eighth arena means
adding one file and one entry in `src/levels/index.ts` — no engine changes.

## How it works

**Physics: Rapier 2D** (Rust → WebAssembly). Chosen over Matter.js / Planck for joint
stability and raw throughput — this game routinely has 900 bodies and 250+ joints live.
`@dimforge/rapier2d-compat` inlines the WASM as base64, so the build is a single
self-contained JS file with zero extra network requests. **Do not** migrate to
`@dimforge/rapier2d` (separate `.wasm`) — the compat package exists precisely to avoid
bundler `.wasm` misconfiguration, and it costs load-time size the game does not need.

**Ragdolls** (`entities/ragdoll.ts`) are data-driven skeletons: a list of bones with
positions, sizes and revolute joints with angle limits. Four skeletons ship — full
biped (13 bodies, player and bosses), lite biped (7 bodies, crowds and stickman ammo),
quadruped (elephants) and chicken.

Three non-obvious things make the ragdolls behave, and all three are load-bearing:

1. **Self-collision filtering.** Adjacent limbs overlap by design. Rapier does not
   filter jointed bodies, so each ragdoll carries a `selfGroup` id and a physics hook
   drops same-skeleton contact pairs. Without it the solver fights the joints and the
   body buzzes.
2. **The root's rotation is pinned while a character is under control.** Springs and
   torques cannot reliably stand a limp 70 kg skeleton up off the floor. Pinning the
   pelvis angle makes "upright" true by construction and the joint limits carry it to
   the rest of the body. Release it and the character is instantly, completely floppy.
   (`lockRotations` only clears the inverse inertia, so any leftover angular velocity
   keeps integrating — it must be zeroed at the same time.)
3. **Controller forces scale with whole-body mass.** The pelvis is ~13 kg of a ~70 kg
   body; a ride spring scaled by pelvis mass sags half a metre and collapses.

**Input timing.** Edge-triggered input (key presses, clicks, wheel) is latched by the
DOM handlers and consumed by the **fixed simulation step**, never by the render frame.
Clearing edges per rendered frame throws presses away unread on any display faster than
the 60 Hz sim, and during hitstop and slow-motion. If you touch `Game.frame` /
`Game.simulate`, keep `input.consumeEdges()` inside the accumulator loop. Pause is the
one exception — handled at frame rate, because while paused no simulation step exists to
consume it.

**Destruction** (`entities/block.ts`) is stacks of ordinary rigid bodies with
per-material health. Blocks spawn *anchored* — static bodies — and convert to dynamic
the moment anything disturbs them. This is what lets a 16-storey tower stand at all
(loose stacks topple from solver noise within a second) and keeps ~800 idle bodies
nearly free. Collapse still cascades naturally. Impact damage is computed from relative
approach speed and reduced mass, in kilojoules; material constants live in one table.

**"If you can shoot it, it is a rigid body wearing a square of the tileset"**
(`Builder.spriteWall` / `spriteBlock`). `render/sprites.ts` reads a sheet's own alpha to
decide which cells get a body, so a house's sloped roof comes out of the artwork rather
than a hand-written table.

**Enemy AI** (`entities/enemy.ts`). Armed enemies share one brain and differ only in
what they do with their feet: `sentry` holds its spot, `patrol` paces a beat, `hunter`
closes to a standoff distance and strafes. Acquisition is a real raycast
(`Physics.lineOfSight`), so a wall is genuinely cover. Difficulty is carried by three
numbers — `spread`, `interval`, `range` — so tuning is data, not behaviour. While it has
line of sight an enemy paints a laser from its muzzle to you: the fairness valve.

Their bullets (`entities/bullet.ts`) are **not** rigid bodies. At 80 m/s a real
projectile tunnels or forces CCD on dozens of bodies, so a bullet marches a segment per
step and raycasts along it — exact at any speed, one query per bullet per frame, drawn
as a stretched tracer.

**Buoyancy** (`fx/buoyancy.ts`) is what Party Supplies leaves behind. A cluster of
balloons is tied to a `PhysOwner` and the owner's net gravity scale becomes
`1 - (balloons * LIFT_KG) / mass` — lift as *a mass one balloon can carry* rather than a
force, which is both physically right (buoyancy is displaced-air weight, scaling with
gravity as the object's weight does) and right for this game (a force tuned on Earth is a
different weapon on The Drift). Ascent is clamped to 2.8 m/s, tuned against the camera:
the frame sees ~10 m above the player and the whole joke is watching a thing go up and
come back down. Time, fire and blast all pop balloons, and the player can cause all
three. Balloons never hold Rapier handles across frames — an empty `PhysOwner.eachBody`
visit is the signal to drop the cluster.

**The winch** (`fx/tow.ts`) is the Tow Cable's whole idea: it pulls against real mass.
`REEL_FORCE / mass` capped at `REEL_ACCEL_CAP` per body, and the *shortfall* decides how
hard the line yanks you back. A stickman or a loose crate comes at you head-first; a car
or a laden pillar is too heavy to reel, so the reaction wins and you are dragged into
the building; a wall is pure reaction — a grappling zip, and the only way to cross a
Drift chasm under your own power. It never holds a Rapier handle across frames either.

**Game feel** (`fx/juice.ts`) is one curve, `Magnitude` (0..1), that every violent event
is expressed on — hitstop, camera trauma/punch/kick, screen flash, slow-motion and
particle burst all come off the same table.
`fromEnergy`/`fromOverkill`/`fromExplosion`/`fromCollapse`/`fromFall` turn what a call
site knows into a magnitude; `hit()`/`kill()`/`collapse()`/`explosion()` apply it.
Screenshake is Perlin noise, and trauma is squared before it becomes pixel amplitude — a
documented motion-sickness trigger, so it is also a four-step player setting.

**Performance.** Two things dominate and both are handled: characters far from the camera
leave the simulation entirely (`Ragdoll.setEnabled`), and off-screen actors are culled
before drawing. A **Quality setting** (Low / Medium / High, auto-detected floor) cuts the
effects budget without cutting the game — decals off at Low, fewer background layers,
particle caps lowered. The device floor is a 4 GB-RAM Chromebook holding frame.

## CrazyGames

`src/platform/portal.ts` is the SDK integration, written so nothing in it is
load-bearing: every entry point resolves to a harmless default when the SDK is absent,
slow, or throws, so the same build runs on CrazyGames, on a plain web host, on a dev
server and from `file://`.

- **Loading brackets** (`loadingStart` / `loadingStop`) wrap the initial load, so the
  portal knows when it may run its own pre-roll.
- **Gameplay brackets** (`gameplayStart` / `gameplayStop`) bound *actual play* — they
  open on entering an arena and close on pause, ad, and return to menu.
- **`happytime`** fires when a round is unlocked.
- **A midgame interstitial** plays on every third restart, and nowhere else — never on
  death. There is no rewarded ad: an arena has no fail state, so there is nothing to
  revive and nothing to reward.

The SDK `<script>` in `index.html` is loaded from CrazyGames' CDN, ahead of the game
module and deliberately not awaited — a blocked or 404ing script costs a short delay on
the portal and nothing anywhere else.

See `CRAZYGAMES.md` for the submission checklist and asset list.

## Tuning

Almost all feel lives in three places:

- `entities/player.ts` → `TUNE` — movement, balance, recoil transfer, knockdown thresholds.
- `entities/block.ts` → `MATERIALS` — density, toughness, fragility, points per material.
- `weapons/ammo.ts` — every round's speed, recoil, cooldown, mass and payload.

`F3` shows fps, body count and particle count. `window.game` is exposed for console
poking.

## Asset licensing

- **Music** — original work by the game's author. All rights reserved to the author;
  free to use within this game.
- **Art** — the *GandalfHardcore* FREE Platformer Assets and City Tiles packs (see the
  `READ ME.txt` in each folder under `src/Assets`). The pack licence permits use in
  commercial and non-commercial games and modification as needed; it prohibits
  reselling, repackaging or redistributing the assets on their own, and AI-training use.
  Only the sprites the game actually references are kept in the tree.
