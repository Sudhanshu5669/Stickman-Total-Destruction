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
| 6 | **Weapon pixel art** — hand-authored sprites for all 19 rounds | **done** | PASS 2026-08-22 — all 19 rasterise and draw crisp in-hand at gameplay zoom. Contact sheet at `/gunsheet.html` (dev-only, not in dist). Procedural path kept as fallback. **Approved by user 2026-08-22** |
| 7 | **Builder extensions** — the primitives the six arena shapes need | **done** | PASS 2026-08-22 — `groundSpan`/`skinnedGround`/`shelf` (edge-based, kills the centre-vs-corner trap), `basin`, `scaffold`, `islands`, `cityBlock`. All verified in harness band 7. Themes `autumn`, `winter`, `city` added from the packs' own backdrops |
| 8 | **Six arenas** — vertical, bowl, islands, city, valley, winter fortress | **done** | PASS 2026-08-22 — all 7 load with solid spawns, **0 enemies fall out of the world**. Bodies/enemies/ms-per-step: proving 390/15/1.08 · meadow 341/17/1.37 · spire 280/15/0.77 · pit 186/15/2.93 · drift 300/16/0.53 · downtown 830/19/4.03 · coldspine 523/19/1.11. AI cost cut from ~40% to ~9% of sim by throttling LOS to 20 Hz and caching failed cover searches. Grid City trimmed 1236→830 bodies |
| 9 | **Progression trim** — unlocks only; medals, streak, bonus, rank removed | **done** | PASS 2026-08-22 — progress.ts 600→230 lines. Medals, streak, daily, campaign clears, contract, ranks, ad ledger, best-run/chain/shot all deleted; `core/rng.ts` and `equipJetpack` orphaned and removed. **Ladder retuned against measured earn rates** (bot: ~1,100 carnage/sec with targets in reach) — old ladder unlocked the whole arsenal in ~20 min with the first round at ~2 s. New: bowling at ~60-70 s (verified), tv 45% at 90 s, blackhole ~5 h |
| 10 | **Front end** — real game menu, no gradients, pixel framing, arena previews | pending | Reads as a game on desktop and mobile viewports; every route works |
| 11 | **Feel pass** — HUD clarity, comedy callouts, satisfaction on every kill | pending | A cold player understands what to do in 10 seconds without reading |
| 12 | **Perf pass** — frame budget on the slow-PC floor | pending | Holds 60 on High mid-range, holds 60 on Low with the budget throttled |

## Notes

- Systems 1–2 are foundation: nothing else can be tested until the tree compiles and the
  dev arena exists.
- System 3 comes before 4–8 on purpose. Every later system has to be authored against a
  quality budget, and retrofitting one is how you end up with a game that only runs on
  the machine it was built on.
- System 6 (weapon art) is independent of 7–8 and can be reordered if arena work blocks.
