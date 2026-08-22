# Game Spec

_Rewritten 2026-08-22 for the **Sandbox Reset** — a deliberate teardown of the story,
campaign, contracts and endless modes in favour of one thing done properly: a funny,
satisfying destruction sandbox. This file is the source of truth. Everything it
contradicts in git history is intentionally dead._

## Core loop

You are a stickman with a gun that fires things a gun has no business firing — chickens,
sedans, pianos, elephants, other stickmen — into an arena full of hostile stickmen and
buildings that are made of real rigid bodies. You pick an arena, you break it, you watch
the physics engine solve the consequences, and the mess pays carnage. Carnage buys the
next absurd round, which is a new reason to go back into an arena you already flattened.

There is no story, no mission, no fail state, and nothing to read. The loop is
**pick → break → laugh → unlock → go again.**

## Genre

Ragdoll physics destruction sandbox. Nothing layered on top of that.

## Platform target

Both, desktop-first. The device floor is low and non-negotiable: a 4 GB-RAM Chromebook
must hold frame. Every system in this build is authored against that floor, and a
**Quality setting (Low / Medium / High)** exists specifically so the effects budget can
be cut without cutting the game.

## Art approach

**Pixel art, from the bundled asset packs.** This is the single biggest change from the
previous spec, which locked the game to procedural Canvas2D shapes.

- Arena geometry, terrain, props and backdrops are built from the four bundled packs
  (`src/Assets`): GandalfHardcore FREE Platformer Assets (Normal / Autumn / Winter
  background sets), GandalfHardcore City Tiles, Character Asset Pack, Hp bar. Nothing is
  fetched over the network; the packs ship in the bundle.
- **If you can shoot it, it is a rigid body wearing a square of the tileset**
  (`Builder.spriteWall` / `spriteBlock`). Sprites are a material, not wallpaper.
- Weapons are **hand-authored pixel art**, generated once at boot into offscreen
  canvases from per-pixel source data held in the repo — not vector shapes, and not
  fetched art. If this does not reach a professional bar, the user supplies sprites and
  the same draw path consumes them unchanged.
- The stickman stays pure black vector against the pixel art. That contrast is the
  identity: the one thing you control is the one thing drawn in a different language, so
  it never gets lost in the scenery.

## Audio

**There is none.** Every sound effect and every music cue is removed. `src/fx/audio.ts`
remains as a silent no-op facade with the same method surface so the 73 call sites stay
put and audio can be reinstated later as a one-file change. The volume and mute controls
are gone from the UI.

## Scope

Full small game, being **rebuilt**, not extended. The previous build's retention
machinery (medals, daily streak, best-run bonus, leaderboard placing, coach prompts tied
to missions) is cut. What survives is the physics, the ragdoll, the arsenal, and the
unlock ladder.

## Genre-specific answers

- **Modes: none.** One front end — an arena picker — and that is the entire structure.
  Campaign, Contracts, Endless and Daily are deleted, not disabled.
- **Front end** must read as *a game*, not a website. No gradients, no card-grid web
  layout, no drop shadows standing in for design. Pixel-art framing, a hard palette,
  chunky type, and an arena preview you can actually recognise.
- **Six arenas, mixed shapes**, deliberately not six corridors:
  1. **Vertical** — a tower you climb and topple.
  2. **Bowl** — an enclosed pit, fought in the round.
  3. **Islands** — a chain of platforms over a drop, gravity is the weapon.
  4. **City street** — dense, tall, from the City Tiles pack.
  5. **Open valley** — the wide horizontal one, for artillery play.
  6. **Winter fortress** — layered walls and a keep, the Winter BG set.
- **Camera:** must see meaningfully farther than the previous 13.5 m frame, and must
  lead hard toward where the player is aiming, so long-range shots are aimed at
  something visible rather than at off-screen faith.
- **Enemy AI must be smarter.** The previous three behaviours (sentry / patrol / hunter)
  are a floor, not a ceiling: enemies need to take cover, react to their building coming
  apart, coordinate loosely, retreat when losing, and stop being target practice that
  stands still while a piano lands on it.
- **Progression: unlocks only.** Carnage buys ammo types on a tuned ladder. Medals,
  daily streak, best-run bonus and rank are removed.
- **Tone: funny and satisfying, never confusing.** Comedy comes from the physics and the
  absurdity of the arsenal, surfaced with short readable callouts — not from written
  jokes, and not from a narrator.

## Explicit non-goals

- **Ragdoll/stickman core identity is locked.** `entities/ragdoll.ts` and
  `render/creatures.ts` are not to be replaced by sprite characters. The pixel-art pivot
  covers the *world*, not the *cast*.
- No physics engine swap (Rapier stays).
- No story, no cutscenes, no narrator, no mission briefings. `ui/story.ts` is deleted.
- No audio, until the user decides what audio should be.
- No new ammo types. Nineteen is plenty; the problem was never a content shortage.
- No near-miss or rigged-failure mechanics.
