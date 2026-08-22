# Systems — Sandbox Reset

Build checklist for the 2026-08-22 teardown. Derived from `GAME_SPEC.md`.
Strict order, one at a time, each verified in a real browser before the next starts.

Status: `pending` · `building` · `testing` · `done`

| # | System | Status | Test notes |
|---|--------|--------|------------|
| 1 | **Purge** — delete all levels, story, campaign, contracts, endless, daily; silence all audio | **done** | PASS 2026-08-22 — `tsc` clean, `vite build` clean, boots to menu, Proving Ground loads (7 enemies, 194 bodies, 60fps), chicken cannon fires, pause + options work, **zero console errors** |
| 2 | **Dev arena** — persistent QA harness level with every material, prop and enemy type | **done** | PASS 2026-08-22 — six bands verified in browser: all 12 materials, tower/house/wall/pyramid, scatter/teeter/explosives, `spriteWall` cottage renders its gable from artwork alpha, all 3 enemy kinds + 3 behaviours with cover, range markers at 80/90/100/110. 305 bodies, 60fps, zero console errors. **Baseline visible width ≈ 26 m** — the number System 4 has to beat |
| 3 | **Quality settings** — Low/Med/High effect budget, auto-detected floor, wired through every fx sim | pending | Low measurably cuts particle counts; no visual crash at any tier |
| 4 | **Camera** — wider frame, hard aim-lead, spectacle retune | pending | Can see the target being aimed at across the dev arena; no nausea, no lag |
| 5 | **Enemy AI** — cover, awareness, collapse reaction, loose coordination, retreat | pending | Enemies use cover, scatter when their floor dies, do not stand still to be hit |
| 6 | **Weapon pixel art** — hand-authored sprites for all 19 rounds | pending | Every round draws a distinct, crisp, unfiltered sprite at every zoom |
| 7 | **Builder extensions** — the primitives the six arena shapes need | pending | Each new primitive builds and collapses correctly in the dev arena |
| 8 | **Six arenas** — vertical, bowl, islands, city, valley, winter fortress | pending | Each loads, is visually distinct, is fully destructible, holds frame |
| 9 | **Progression trim** — unlocks only; medals, streak, bonus, rank removed | pending | Carnage accrues, unlocks fire, no dead UI left behind |
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
