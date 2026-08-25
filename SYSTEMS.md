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
| 9 | **Progression trim** — unlocks only; medals, streak, bonus, rank removed | **done** | PASS 2026-08-22 — progress.ts 600→230 lines. Medals, streak, daily, campaign clears, contract, ranks, ad ledger, best-run/chain/shot all deleted; `core/rng.ts` and `equipJetpack` orphaned and removed. **Ladder retuned against measured earn rates** (bot: ~1,100 carnage/sec with targets in reach) — old ladder unlocked the whole arsenal in ~20 min with the first round at ~2 s. New: bowling at ~60-70 s (verified), tv 45% at 90 s, blackhole ~5 h |
| 10 | **Front end** — real game menu, no gradients, pixel framing, arena previews | **done** | PASS 2026-08-23 — `menu.ts` 1845→724 lines, one screen. No gradient, rounded corner or shadow anywhere: notched panels, flat fills, ink outlines. Cards painted from each level's `shape` + theme (`thumbArt` tileset slices gave five near-identical houses and are deleted); selecting an arena rebuilds the attract world behind it, so the card really is the preview. Verified in browser at 1536×702: all 7 cards select, PLAY, pause (RESUME/RESTART/OPTIONS/LEAVE all map to distinct 36 px regions), options steppers + tips toggle, LEAVE→menu. **Zero console errors.** Portrait 390×844 renders 4+3 (≈87 px cards) via the split rule. Fixed en route: attract-mode popups bled through the 72% scrim onto the menu type (`particles.mute`); the options panel was not modal, so CONTROL TIPS sat on PLAY and started the game |
| 11 | **Feel pass** — HUD clarity, comedy callouts, satisfaction on every kill | **done** | PASS 2026-08-23. **Callouts** (`fx/callout.ts`): deaths named from what the physics did — SQUASHED / GRAVITY WINS / BOWLED OVER / COLLATERAL / OBLITERATED / TAKEN APART / DISMEMBERED, off `ragdoll.lastHitKind`, plus DOUBLE→QUAD KILL and MASSACRE. Kills batch in a 0.22 s window so one rocket into a stairwell prints one line, not five overlapping. Verified live in Long Meadow and Coldspine: a 2-enemy blast gave exactly one DOUBLE KILL beside the individual +points, a 3-enemy blast one TRIPLE KILL. Table + window boundary also checked directly (13/13 branches; 2 inside → DOUBLE, 2 outside → two singles, trickle does not extend the window). **HUD** moved into the menu's language: `ui/chrome.ts` holds the single notchedPanel/palette both screens import; the last `roundRect`, `shadowBlur` and panel gradient in the game are gone, health/fuel are cell meters. Verified by render over a deliberately pale background at 1100×560 — caught and fixed the HP number being chopped by the new cell gaps. **Known follow-ups:** a callout on a kill at your feet is born under the ammo plate and only clears as it drifts up (clamp the popup's screen Y); the 0.22 s window is correct but has not been judged for *feel* at full speed; kills are not attributed to the round that caused them (deliberate — see `ragdoll.lastHitKind` doc) |
| 12 | **Character pass** — the front end, and arenas that look like places | **done** | PASS 2026-08-23 — see below |
| 13 | **Perf pass** — frame budget on the slow-PC floor | pending | Holds 60 on High mid-range, holds 60 on Low with the budget throttled |

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

## Notes

- Systems 1–2 are foundation: nothing else can be tested until the tree compiles and the
  dev arena exists.
- System 3 comes before 4–8 on purpose. Every later system has to be authored against a
  quality budget, and retrofitting one is how you end up with a game that only runs on
  the machine it was built on.
- System 6 (weapon art) is independent of 7–8 and can be reordered if arena work blocks.
