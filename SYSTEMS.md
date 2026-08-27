# Systems — Sandbox Reset

Build checklist for the 2026-08-22 teardown. Derived from `GAME_SPEC.md`.
Strict order, one at a time, each verified in a real browser before the next starts.

Status: `pending` · `building` · `testing` · `done`

| # | System | Status | Test notes |
|---|--------|--------|------------|
| 1 | **Purge** — delete all levels, story, campaign, contracts, endless, daily; silence all audio | **done** | PASS 2026-08-22 — `tsc` clean, `vite build` clean, boots to menu, Proving Ground loads (7 enemies, 194 bodies, 60fps), chicken cannon fires, pause + options work, **zero console errors** |
| 2 | **Dev arena** — persistent QA harness level with every material, prop and enemy type | **done** | PASS 2026-08-22 — six bands verified in browser: all 12 materials, tower/house/wall/pyramid, scatter/teeter/explosives, `spriteWall` cottage renders its gable from artwork alpha, all 3 enemy kinds + 3 behaviours with cover, range markers at 80/90/100/110. 305 bodies, 60fps, zero console errors. **Baseline visible width ≈ 26 m** — the number System 4 has to beat |
| 3 | **Quality settings** — Low/Med/High effect budget, auto-detected floor, wired through every fx sim | **done** | PASS 2026-08-22 — identical burst spawns 240 / 168 / 81 at HIGH / MEDIUM / LOW. Under sustained load both tiers saturate *exactly* at cap (1400 / 380) and never above. Decals off at LOW, bg layers 4→2, sway off. EFFECTS row live in options |
| 4 | **Camera** — wider frame, hard aim-lead, spectacle retune | **done** | PASS 2026-08-22 — measured on the range markers. Visible width **26.4 m → 35.4 m** (+34%). Reach ahead when aiming **~18.8 m → 25.8 m** (+37%); up 11.2→13.4 m; down held to −6 m on purpose. Phones unaffected by the frame change (width floor binds) but gain lead. Whole 6-storey tower now fits while aiming at its roof |
| 5 | **Enemy AI** — cover, awareness, collapse reaction, loose coordination, retreat | **done** | PASS 2026-08-22 — traced state machine: engage → cover → crouch (eye 1.06→0.63, `seen=0`) → peek → fire → stand. Squad blackboard verified: one sentry's contact switched all 4 other gunners to `search`, incl. a sniper 56 m away. Cover search rejects inside-geometry and unreachable spots. Sim cost 0.56 ms/step with 9 enemies + 315 bodies |
| 6 | **Weapon pixel art** — hand-authored sprites for all 19 rounds, guns *and* payloads | **done** | PASS 2026-08-22 — all 19 guns rasterise and draw crisp in-hand at gameplay zoom. Contact sheet at `/gunsheet.html` (dev-only, not in dist). Procedural path kept as fallback. **Approved by user 2026-08-22.** 2026-08-23: the *ammunition* redrawn to match — pixel guns were still firing vector props, which is the seam you notice first because the payload is what the camera follows. `render/pixel.ts` now holds the buffer, the six rules and the ramps; `render/gunart.ts` and the new `render/ammoart.ts` share them, so guns and rounds cannot drift apart. 14 rigid payloads + 5 icon-only glyphs; `render/props.ts` is a naming layer over it. One pixel size everywhere (32 px/m), so the jetliner is a 352-px sprite rather than a small one with big pixels. Creature rounds stay bone-drawn ragdolls on purpose. **Verified headlessly** (browser extension was offline): sprites rasterised to PNG and inspected, and the world/HUD blit maths checked against every collider — each sprite lands centred on its box at the right span. `tsc` + `vite build` clean. **Not yet seen in a running browser** |
| 7 | **Builder extensions** — the primitives the six arena shapes need | **done** | PASS 2026-08-22 — `groundSpan`/`skinnedGround`/`shelf` (edge-based, kills the centre-vs-corner trap), `basin`, `scaffold`, `islands`, `cityBlock`. All verified in harness band 7. Themes `autumn`, `winter`, `city` added from the packs' own backdrops |
| 8 | **Six arenas** — vertical, bowl, islands, city, valley, winter fortress | **done** | PASS 2026-08-22 — all 7 load with solid spawns, **0 enemies fall out of the world**. Bodies/enemies/ms-per-step: proving 390/15/1.08 · meadow 341/17/1.37 · spire 280/15/0.77 · pit 186/15/2.93 · drift 300/16/0.53 · downtown 830/19/4.03 · coldspine 523/19/1.11. AI cost cut from ~40% to ~9% of sim by throttling LOS to 20 Hz and caching failed cover searches. Grid City trimmed 1236→830 bodies |
| 9 | **Progression trim** — unlocks only; medals, streak, bonus, rank removed | **done** | PASS 2026-08-22 — progress.ts 600→230 lines. Medals, streak, daily, campaign clears, contract, ranks, ad ledger, best-run/chain/shot all deleted; `core/rng.ts` and `equipJetpack` orphaned and removed. **Ladder retuned against measured earn rates** (bot: ~1,100 carnage/sec with targets in reach) — old ladder unlocked the whole arsenal in ~20 min with the first round at ~2 s. New: bowling at ~60-70 s (verified), tv 45% at 90 s, blackhole ~5 h. **Superseded 2026-08-25:** every rung is priced at zero — the whole arsenal is unlocked from a fresh save and carnage is a score, not a currency |
| 10 | **Front end** — real game menu, no gradients, pixel framing, arena previews | **done** | PASS 2026-08-23 — `menu.ts` 1845→724 lines, one screen. No gradient, rounded corner or shadow anywhere: notched panels, flat fills, ink outlines. Cards painted from each level's `shape` + theme (`thumbArt` tileset slices gave five near-identical houses and are deleted); selecting an arena rebuilds the attract world behind it, so the card really is the preview. Verified in browser at 1536×702: all 7 cards select, PLAY, pause (RESUME/RESTART/OPTIONS/LEAVE all map to distinct 36 px regions), options steppers + tips toggle, LEAVE→menu. **Zero console errors.** Portrait 390×844 renders 4+3 (≈87 px cards) via the split rule. Fixed en route: attract-mode popups bled through the 72% scrim onto the menu type (`particles.mute`); the options panel was not modal, so CONTROL TIPS sat on PLAY and started the game |
| 11 | **Feel pass** — HUD clarity, comedy callouts, satisfaction on every kill | **done** | PASS 2026-08-23. **Callouts** (`fx/callout.ts`): deaths named from what the physics did — SQUASHED / GRAVITY WINS / BOWLED OVER / COLLATERAL / OBLITERATED / TAKEN APART / DISMEMBERED, off `ragdoll.lastHitKind`, plus DOUBLE→QUAD KILL and MASSACRE. Kills batch in a 0.22 s window so one rocket into a stairwell prints one line, not five overlapping. Verified live in Long Meadow and Coldspine: a 2-enemy blast gave exactly one DOUBLE KILL beside the individual +points, a 3-enemy blast one TRIPLE KILL. Table + window boundary also checked directly (13/13 branches; 2 inside → DOUBLE, 2 outside → two singles, trickle does not extend the window). **HUD** moved into the menu's language: `ui/chrome.ts` holds the single notchedPanel/palette both screens import; the last `roundRect`, `shadowBlur` and panel gradient in the game are gone, health/fuel are cell meters. Verified by render over a deliberately pale background at 1100×560 — caught and fixed the HP number being chopped by the new cell gaps. **Known follow-ups:** a callout on a kill at your feet is born under the ammo plate and only clears as it drifts up (clamp the popup's screen Y); the 0.22 s window is correct but has not been judged for *feel* at full speed; kills are not attributed to the round that caused them (deliberate — see `ragdoll.lastHitKind` doc) |
| 12 | **Character pass** — the front end, and arenas that look like places | **done** | PASS 2026-08-23 — see below |
| 13 | **Perf pass** — frame budget on the slow-PC floor | pending | Holds 60 on High mid-range, holds 60 on Low with the budget throttled |
| 14 | **Party Supplies** — the buoyancy round | **done** | PASS 2026-08-26 — see below |
| 15 | **Tow Cable** — the pull round (harpoon + winch) | **done** | PASS 2026-08-27 — see below |

## System 12 — the character pass

The complaint was "the front end looks bad, the levels are not attractive or big, give
the game more character". All three were true and they had the same root: the *systems*
were built and the *content density* was not.

**The world.**

- **Seasons.** `Floor Tiles1/2.png` draw one autotile three times over — green at row 0,
  autumn at 6, snow at 12 — and every arena took the default. Ironhold laid summer turf
  under an autumn sky; Coldspine ran a bright green stripe across a snowfield. The row is
  now on the *theme* (`Theme.groundRow`), so an arena declares its world once.
- **Skinning.** `shelf`, `basin` and `islands` built raw untextured terrain, so the
  Quarry's terraces and the whole Drift island chain were flat grey-brown boxes in
  arenas made otherwise of painted artwork. They all take the theme's ground skin now.
- **Density.** `levels/dressing.ts` + `Builder.dress` — a seeded bulk scatter of the
  pack's `Decor.png`, which was in the repo and almost unused. Long Meadow ran 216 m on
  about 25 hand-placed props; a screen and a half held a tent, a tree and forty metres
  of nothing. Every arena is now dressed by band, seeded on world X so scenery never
  shuffles between loads. **Zero new rigid bodies** — measured against the System 8
  baselines, every arena's body count is unchanged to within five.
- **Sky.** `Builder.sky`. The painted backdrops switch the procedural sky off and nothing
  replaced it, so five arenas ran a third of the frame as one flat colour while
  `cloud1-6`, `birds1-4` and `sun.png` sat unreferenced.
- **Under the ground.** A flat near-black slab was a third of every frame. `drawStrata`
  steps it darker with depth with beds and buried stones; the backdrop's own subsurface
  got the same treatment, which matters most in the Quarry where it *is* the pit wall.
  The Drift opts out entirely (`voidBelow`) — it is a chain over a drop, and painting
  soil a metre under the islands took the drop away.
- **Structures.** `scaffold` gained cladding; Ironhold's twelve-storey centrepiece and
  Coldspine's watchtowers were bare grey lattices. `BlockSkin.tile` repeats a cell
  instead of stretching it, so a six-metre slab is clad at the artwork's own scale.
- **Framing.** `FRAME_UP_MAX` was binding at every desktop zoom, so the horizon sat
  across the middle of the screen and the dead ground took the space the sky and the
  buildings wanted. `LevelDef.frameUp` lets the Quarry frame level — it is a hole, and
  the default bias put the hole off the bottom of the screen.

**Two real bugs found on the way.** `Input` initialised the aim point to
`clientWidth / 2` in the constructor, when the canvas is usually still 0x0 — so the
opening frames of every session aimed at the top-left corner and the camera led hard
after it. And the shot harness starved `requestAnimationFrame` under
`--virtual-time-budget`, so every framing judgement made from a screenshot before that
was fixed was measuring the harness, not the game.

**The front end.** Rebuilt as two solid bands and a window. The old screen laid a 72%
scrim over the whole viewport and floated painted thumbnails on it — which wasted the
attract world (a real fight, in the real arena, muted to a grey wash) and had those
thumbnails competing with the thing they were previews of. The arena now plays almost
unscrimmed between the bands, the cards are name plates, the whole screen repaints in
the selected arena's accent, and `drawMascot` puts the stickman and a chicken on the
game's own title screen holding a real sprite out of `render/gunart.ts`. The procedural
ridge bands are drawn as a pixel staircase so the one arena still on that path stopped
reading as a different game.

**Verified** headlessly (the browser extension was offline again): all seven arenas load
with zero console errors, the menu holds at 1600x900, 1280x620 and a 504-wide window
where the picker splits 4 + 3, the pause screen is intact, `tsc` and `vite build` are
clean, and `shot.html` stays out of the bundle. **Not yet judged at full speed by a
human.**

## The scale pass — every arena to Proving Ground size

The complaint after System 12 was narrower than the one before it: *"only the first
level is vast and good. I want all levels to be increased in scale like that."* It was
right. The Proving Ground ran 289 m and eight distinct bands; the six shipping arenas ran
128–212 m and three or four set-pieces, so all six could be read from the spawn and
finished from one firing position. They are now 300–420 m, and none of them can.

What each one gained, in the language of its own shape rather than by stretching it:

| arena | was | now | added |
|-------|-----|-----|-------|
| Long Meadow | 212 m, 5 pieces | 406 m | a mill on a second rise, a plank causeway over a flooded meadow, a redoubt on bare pasture |
| Ironhold | 132 m, 2 towers | 306 m | a gatehouse and curtain wall, a ward of two keeps linked by catwalks, a working foundry |
| The Quarry | 128 m, 1 bowl | 306 m | a haul road in, a crushing floor, a second and deeper cut, the spoil tips |
| The Drift | 180 m, 8 islands | ~380 m | 18 islands in three legs, with a fortified anchor mesa between each |
| Grid City | 164 m, 6 towers | 352 m | an intersection, a low-rise strip, a construction site, an elevated road, one landmark tower |
| Coldspine | 192 m, 3 lines | 416 m | two more terraces: the ridge with the bell tower, and the citadel behind its gate |

**The invariant that mattered was density, not total.** Bodies per metre are essentially
unchanged — Grid City actually *fell*, 5.1/m to 4.3/m — so what is on screen at any
moment costs what it always did, and the totals grew only because the worlds did.
Measured cost per fixed step on an idle sim, by process wall clock over 3000 steps
(headless freezes `performance.now`, so it cannot be timed from inside the page):

proving 373b/0.31 ms · meadow 745b/0.93 · spire 837b/1.20 · pit 549b/1.70 ·
drift 937b/0.45 · downtown 1600b/1.80 · coldspine 1153b/0.74

Grid City more than doubled its body count for about 25% more sim cost, which is what
sleeping islands and camera culling are for. Every number is far inside the frame budget.

**Builder work this needed.** `castleTower`, `battlement`, `gate` and `wall` gained the
same optional `clad` that `scaffold` got in System 12 — two unclad twenty-metre keeps in
Ironhold's new ward were exactly the "physics test scene in the middle of painted
artwork" problem that pass had already fixed once. `shot.html` gained `?y=`: pinning the
camera's X alone leaves it at the *player's* height, so Coldspine's citadel — thirty
metres above the spawn — photographed as an empty sky.

**Verified** headlessly for all seven arenas: `tsc` and `vite build` clean, every new
set-piece photographed and checked for enemies standing on nothing (two found and fixed —
a sentry on Grid City's landmark facade with no floor under him, and Long Meadow's
causeway gunners spawned 0.4 m inside the planks), world edges pushed out of frame at
every spawn. **Not yet judged at full speed by a human.**

## System 14 — Party Supplies

The first new round since the Sandbox Reset, and the reason the spec's "no new ammo
types" non-goal was amended rather than ignored: the arsenal's nineteen rounds shared
about eleven physical behaviours, so the shortage was verbs, not content. This one claims
**buoyancy**, which nothing else did.

**What it is.** A bunch of balloons on a steel clamp. It staples itself to whatever it
hits plus everything within 2.4 m, and those things go up, hang, and come back down as
the balloons pop.

**The three decisions worth keeping.**

- **Lift is a mass, not a force.** Net gravity scale is `1 - (balloons * LIFT_KG) / mass`.
  A force tuned at -26 is a different weapon on The Drift at -9 — the same trap
  `TUNE.jetNetAccel` was written to avoid — and a mass ratio is also what real buoyancy
  is, since displaced-air weight scales with gravity exactly as the object's does.
- **The ascent cap is tuned against the camera.** The frame sees about 10 m above the
  player. At the 7 m/s this started on, a floated wall cleared the top of the screen in
  a second and a half and spent four seconds out of sight before the wreckage came back,
  which throws away the entire payoff. 2.8 m/s against the pop schedule peaks at ~8 m.
  It reads better too: a balloon that leaps is a launch, a balloon that drifts is a
  balloon.
- **Nothing holds a Rapier handle across frames.** `PhysOwner.eachBody` (new, one method,
  implemented by `Block`, `Ragdoll` and `RigidProjectile`) yields nothing once an owner's
  bodies are gone, so an empty visit *is* the signal to drop the cluster rather than
  something to defend against. `Ragdoll` guards on `disposed`, not `dead`, on purpose: a
  dead stickman is still a pile of live bodies and balloons tied to one should keep
  lifting it.

**Four bugs found and fixed while testing, all of them by looking rather than reasoning.**

1. The balloon shading normalised sideways against the *local* half-width, so every row
   ran the full -1..1 and the two-pixel-wide crown got the same terminator as the
   equator. The whole top flooded to the light value and the sprite read as a teardrop.
   Fixed by shading a sphere and clipping it to the balloon, which is the care `Px.ball`
   already documents.
2. Neighbours were given half a bunch, on the theory that the block actually struck
   should lift first. In a wall that is exactly backwards: one block floating at a
   quarter of a fall cannot raise the four courses on top of it, so the round decorated
   a wall and nothing moved.
3. The velocity cap was a proportional shave, which against a constant acceleration
   settles wherever the two balance — measured 3.3 m/s against a cap of 2.8. Hard clamp
   instead; it does not make ragdolls buzz, because every bone in a cluster is clamped to
   the same number on the same step so the joints have no differential to fight.
4. `popNear` ran *after* the attach in `onImpact`, so the round popped the balloons it
   had just tied on. It only appeared to work because a fresh tether's anchor was still
   at the world origin — which was itself the bug underneath, and is now resolved at
   attach time.

**Verified in a real browser** (Playwright, `index.html` rather than `shot.html` — the
harness pins the camera every 8 ms and any framing judgement made through it is measuring
the harness, which this file has been caught by before). Full arc photographed at six
points: lift → apex → pop → tumble → smash, ending in a x2 CHAIN and 2 blocks smashed
from the *fall*, which is where the round's real score comes from. Flamethrower on a
floating wall: 45 balloons → 29 → 5 → 0, wall lands. Rocket into one: 44 → 2 in a single
blast. Ragdoll target: 6 balloons across 6 distinct bones, still shooting at the player
on the way up. 60 fps with 48 balloons live and 390 bodies; zero console errors in every
run. `tsc` and `vite build` clean.

**Not yet judged at full speed by a human.**

## System 15 — Tow Cable

The second round since the Sandbox Reset, and it clears the amended non-goal's bar the
same way Party Supplies did: it claims a verb — **pull** — that nothing else owns. The
black hole drags everything within a radius toward a point for a few seconds and then
lets go; the Tow Cable is a directed line onto *one* body that you aim, and it holds.

**What it is.** A barbed harpoon on a winch. The head buries in the first thing it
touches; the winch then hauls that thing back toward your hand for 0.7 s.

**The one decision that is the whole round: the winch pulls against real mass.**
`fx/tow.ts` applies `REEL_FORCE / mass` capped at `REEL_ACCEL_CAP`, per body, and the
*shortfall* — how much of the cap the target failed to use — is what decides how hard
the line yanks you the other way. So:

- a stickman, a chair, a loose crate — light, the winch wins, they come at you
  head-first and flailing;
- a car, a concrete slab, a laden pillar — too heavy to reel, so the reaction wins and
  you are dragged off your feet into the building;
- a wall — nothing to reel, pure reaction, which is a grappling zip and the only way to
  cross a Drift chasm under your own power.

**Built to the Party Supplies template.** New sim in `fx/`, wired into `GameCtx` /
`Game` exactly as `balloons` is (`clear` on world rebuild, `update` after the balloon
step, `draw` after the balloon draw). It never holds a Rapier handle across frames:
every step it re-resolves the anchor body through `PhysOwner.eachBody`, and an owner
that yields nothing (reeled a stickman into a wall hard enough to gib him) is the signal
to cut the line. The winch is a force loop, not a joint — Rapier joint creation isn't
even wrapped in `core/physics`, and everything jointed in this game is a ragdoll built
once. `Game` gains `towOrigin()` (the hand) and `towReact()` (a velocity change onto the
player ragdoll) as the cable's two ends.

**Not the harpoon's job:** anchored blocks are `disturb()`-ed on the bite so the winch
has a free body to pull, closing speed on a reeled body is capped so a chair does not
arrive as a bullet, and the cable snaps past `SNAP_STRETCH` so a runaway target does not
tow the whole level.

**Three bugs found and fixed while testing, all by instrumenting rather than reasoning.**

1. **The harpoon shattered its own anchor.** At 240 kg/m³ it carried ~88 kJ and one-shot
   whatever it hit, so `hook()` kept getting a dead owner and fell through to the
   static-world branch — a grapple onto a hole where a wall used to be. Dropped to
   ~5 kg (density 26); it now chips glass and nothing else.
2. **The bite never fired.** `onImpact` gated the hook on impact energy, but a 5 kg body
   into a wall is fully arrested by the solver *before* the collision event is drained,
   so the energy read back as 58 J. Since `onImpact` only fires on a real started
   contact above the 2.2 m/s floor anyway, the gate was removed: a harpoon that has
   touched anything has arrived.
3. **`resist` was assumed, not measured.** A one-metre block wedged under four courses
   of wall has a small mass, so `REEL_FORCE / mass` said "reels freely" and the shooter
   felt almost nothing while the block went nowhere. Added a *stall* reading — how far
   short of the target the gap is actually closing — and `resist` is now the larger of
   the two. A body that won't come, for any reason, pulls you off your feet (`Player
   .yankOffFeet`, a one-off knockdown so `locomotion` stops braking the pull).

**Verified in a real browser** (Playwright, `index.html`; the shot harness pins the
camera and lies about framing, and this repo has been caught by that before). Telemetry
across a dozen runs in the Proving Ground: a hooked enemy ragdoll reels ~5 m toward the
shooter with its bones hitting 14 m/s; a wall block wedged in a stack does not come, and
the shooter is instead hauled 1.9–2.8 m into the wall and knocked limp; the cable and a
buried head draw from muzzle to anchor and track the anchor bone every step; switching
arena mid-reel clears the sim (`tow.count → 0`); `tsc` and `vite build` clean; **zero
console errors** in every run.

**Not yet judged at full speed by a human** — in particular the grapple-zip strength on
solid terrain (the "cross a Drift chasm under your own power" use) and the feel of the
0.85 s reel window.

## Notes

- Systems 1–2 are foundation: nothing else can be tested until the tree compiles and the
  dev arena exists.
- System 3 comes before 4–8 on purpose. Every later system has to be authored against a
  quality budget, and retrofitting one is how you end up with a game that only runs on
  the machine it was built on.
- System 6 (weapon art) is independent of 7–8 and can be reordered if arena work blocks.
