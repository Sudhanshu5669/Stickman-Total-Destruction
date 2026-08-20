# Stickman Total Destruction — Retention Overhaul

_Living working document. Owned by the Creative Director (lead agent). Every worker reads
this before starting; the Director updates it after every wave._

**Status:** Wave 1 complete and audited. Wave 2 (Director integration) mostly complete —
every worker's dead/unwired hook is now live in `src/game.ts`. Remaining: a full manual
playtest pass (T10), the tech-debt items in T11, and T13. See section 11.
**Last updated:** 2026-08-20 (Wave 2 session)

---

## 1. Why this document exists

The game went to test and **~90% of players left within the first 10 minutes**, with reviews
too vague to act on. This document is the single source of truth for the overhaul: the
diagnosis, who owns which files, what has been decided, and what is still open. If a
session is lost, a new Director should be able to read this file and resume without
re-deriving anything.

---

## 2. Diagnosis (Director's cold playthrough — measured, not assumed)

The game is **not** short of content and is **not** badly engineered. The codebase is
genuinely strong: Rapier2D physics, data-driven ragdolls, ~900 bodies at 60fps, 18 weapons,
3 modes, 6 campaign missions, 211 endless chunks, procedural audio, and a CrazyGames SDK
integration with correctly-placed ads. The destruction, once you reach it, is very
satisfying — an anvil into a stickman gives +100, a blood geyser, hitstop and screenshake,
and it lands well.

**The problem is that almost nobody reaches it.** Evidence from a fresh
`localStorage`-cleared playthrough:

| # | Finding | Evidence |
|---|---|---|
| 1 | **Nothing to shoot at spawn.** | Player spawns at `x=-30`. Nearest stickman at `x=18` — 48 m away. The camera window is ~40 m wide, so zero targets are on screen at t=0. First real structure (the tower) is at `x=64`, 94 m away. |
| 2 | **22 seconds of walking produced score 0** — no enemy seen, nothing destroyed. | Held move-right from spawn and measured. |
| 3 | **The hero screen is an empty field.** | The attract-mode demo behind the main menu starts at the same dead spawn. 10+ seconds of empty grass is the first thing every new player sees. |
| 4 | **Three menu screens before a single shot.** | Title, then mode select, then world select, then PLAY. |
| 5 | **First frame of play is a 9-line keyboard manual.** | The CONTROLS card covers the screen and only fades once the player provides input. |
| 6 | **Reward curve is invisible.** | Chicken into a crate = **+5**. First unlock = **1,200 carnage** (~240 crate hits). Ladder tops out at 280,000. |
| 7 | **Combo ceiling is unreachable.** | `1 + (combo-1)*0.14` capped at 6x, so max multiplier needs a **37-chain**. |
| 8 | **Ragdolls are too small to read.** | Stickman is under 10% of screen height at zoom ~38 px/m. The ragdoll flailing is the product and it is illegible. |
| 9 | **Dead composition.** | Bottom ~35% of the frame is flat empty ground; much of the top is empty sky. `autoZoom` only ever zooms *out*, never in. |
| 10 | **Muted, low-contrast palette.** | Grey-blue hills on grey-blue sky, flat green ground. Nothing pops at thumbnail size. Plus a visible sky-coloured seam at the bottom of the viewport. |
| 11 | **The name does not sell the game.** | On-screen title is "STICKMAN ASCENSION — a ragdoll destruction sandbox". The marketing name is **Stickman Total Destruction**. |

**One-line verdict:** this is not a content problem or an engineering problem. It is a
**first-90-seconds problem** and a **presentation problem**.

---

## 3. Non-negotiable constraints

- **STAKEHOLDER LOCK — ragdolls and stickmen must not be changed or replaced.** They are the
  identity of the game. `src/entities/ragdoll.ts` and `src/render/creatures.ts` are off
  limits. Everything else is fair game. We make the ragdolls *read better and hit harder*;
  we do not turn them into something else.
- **No external assets, no network requests.** All art is procedural Canvas2D, all audio is
  synthesised WebAudio, the WASM is inlined. This is an architectural win (the game runs
  from a single self-contained file) and it stays.
- **60fps with hundreds of awake bodies.** Compose and tune **desktop-first** — contrary to
  the assumption this project started with, CrazyGames is often *desktop*-leaning in our
  biggest markets (US ~65% desktop, India ~74%), and mobile-heavy only in some regions. But
  the device floor is low: 4 GB-RAM Chromebook-class hardware must run smoothly, and mobile
  must work well even if it is not the majority.
- **`npx tsc --noEmit` must be green at all times.** Baseline was green before wave 1.
- **`src/entities/**` and `src/core/physics.ts` are frozen** for this overhaul unless the
  Director changes them. The physics is good; the framing of it is not.

---

## 4. File ownership map — STRICT, ONE OWNER PER FILE

This is the mechanism that stops workers overwriting each other. **A worker edits only the
files in its own row.** If a worker needs a change in a file it does not own, it must NOT
make it — it reports the change precisely (current code, then replacement) and the Director
applies it.

| Worker | Role | Owns (exclusive write access) |
|---|---|---|
| **Director** (lead) | Integration, wiring, review, playtest | `src/game.ts`, `src/main.ts`, `README.md`, `OVERHAUL.md`, `AGENTS.md` |
| **W1** | Research analyst | *nothing — read-only, report only* |
| **W2** | Level design / cold open | all of `src/levels/`, plus `src/ai/demo.ts` |
| **W3** | Game feel & FX | `src/core/camera.ts`, `src/fx/particles.ts`, `src/fx/decals.ts`, `src/fx/gore.ts`, new `src/fx/juice.ts` |
| **W4** | Art direction | `src/render/theme.ts`, `src/render/background.ts`, `src/render/props.ts`, `src/render/draw.ts`, new files under `src/render/` |
| **W5** | UI / UX & onboarding | `src/ui/hud.ts`, `src/ui/menu.ts`, `src/ui/touch.ts`, `index.html`, new files under `src/ui/` (e.g. `coach.ts`) |
| **W6** | Economy & arsenal | `src/ui/progress.ts`, `src/weapons/ammo.ts`, `src/weapons/weapon.ts`, new files under `src/weapons/` |
| **W7** | Audio direction | `src/fx/audio.ts`, and new files under `src/fx/` whose names begin with `audio` |

**Deliberately unowned / frozen:** all of `src/entities/` (stakeholder lock plus stability),
`src/core/` except `camera.ts`, `src/render/creatures.ts` (stakeholder lock),
`src/fx/fire.ts`, `src/fx/fluid.ts`, `src/fx/solids.ts`, `src/platform/portal.ts`.

**`src/game.ts` is the contended hub and the Director owns it alone.** Every worker that
needs a hook there specifies it; the Director wires it. This is the single most important
rule in this document — it is what prevents parallel agents from deleting and rewriting
each other's work.

---

## 5. Task board

### Wave 1 — dispatched, in flight

| ID | Worker | Task | Status |
|---|---|---|---|
| T1 | W1 | Research: CrazyGames platform rules and ranking; portal retention benchmarks; FTUE patterns; competitive teardown; game-feel literature with concrete numbers; tech options; non-scummy meta-retention | **DONE** — findings in section 9; corrections relayed to W2-W7 |
| T2 | W2 | Cold open: re-author spawns so a populated, destructible set piece is in frame at t=0 in all four worlds; no dead walks longer than a few seconds; author chain-reaction/domino set-ups; front-load endless chunks; fix the attract demo so it is destroying something within 1s | **DONE** — audited (section 11); confirmed live in a browser smoke test |
| T3 | W3 | Framing and juice: tighter, biased camera so ragdolls read; bidirectional autoZoom; a "frame the spectacle" API; `fx/juice.ts` mapping magnitude to hitstop/slowmo/trauma/punch/flash/burst; heavier particles, gore and decals; screenshake discipline | **DONE** — code was complete but `juice.ts` was dead (never imported outside a comment) and `settings.shake` was never read by the camera. Both wired by the Director in Wave 2; see section 11. |
| T4 | W4 | Art direction: rebuild all four palettes with a deliberate value/saturation structure so black stickman silhouettes pop; parallax background with depth cueing; kill the dead flat ground; fix the bottom-of-viewport sky seam; polish props and ammo icons; recommend the hero/thumbnail frame | **DONE** — audited (section 11) |
| T5 | W5 | UX: collapse path-to-play to a single PLAY; replace the controls manual with a teach-by-doing coach (`src/ui/coach.ts`); rebrand to STICKMAN TOTAL DESTRUCTION including the boot screen; reframe the locked arsenal as anticipation rather than deprivation; HUD hierarchy and mobile scaling; redesign the results card around "one more go" | **DONE** — the controls wall was removed but `Coach` was never instantiated, so nothing taught controls at all. Wired by the Director in Wave 2 and confirmed live (the FIRE prompt appears and dismisses correctly). |
| T6 | W6 | Economy: retune the unlock ladder so the first unlock lands in 60-90s and rewards land every 20-30s; rebalance per-payload `points`; recommend a new combo curve; add reward texture (medals, milestones, first-kill bonuses, daily/streak); arsenal redundancy audit; save migration | **DONE** — audited (section 11). `progress.scoreRun()` (medals/streak/best-run bonus) was built but never called from `finish()`; wired by the Director in Wave 2, plus a small medals/streak render added to the result card. |
| T7 | W7 | Audio: layered, energy-scaled impact sounds per material; master limiter; **voice limiting and pooling** (a collapsing tower fires hundreds of events per frame); distance attenuation, panning and ducking; procedural generative soundtrack that reacts to combo (`src/fx/audio-music.ts`); suspend on hidden tab | **DONE** — the mixer/pool/limiter/tab-suspend are self-contained and worked already. `sfx.update`, `sfx.setAdPlaying`, `sfx.listener` and `sfx.setMood` were never called from `game.ts`, so the music never reacted, positional audio was pinned to world origin, and ads didn't mute the game. All four wired by the Director in Wave 2; see section 11. |

### Director's own completed work (does not block on workers)

| ID | Task | Status |
|---|---|---|
| D1 | **Portal compliance fix — pause now brackets the gameplay window.** `handleFrameKeys()` toggled `paused` without calling `portal.gameplayStop()` / `gameplayStart()`. The bracket is supposed to bound *actual play*; leaving it open across a pause both mis-reports engagement to the platform and wastes the one window the portal may use to interrupt. Fixed in `src/game.ts`. | **DONE** |
| D2 | **Bundle-size check against the 20 MB gate.** Production bundle is 2.34 MB raw / **~848 KB gzipped**. We are at ~4% of the mobile-homepage eligibility gate. Confirms the README's "bundle size is the top known gap" is **wrong** — it is a non-issue and needs no work. | **DONE** |
| D3 | **Boot-time check against the 10 s gate.** Cold boot measured at **677 ms**. Comfortably compliant; no work needed. | **DONE** |
| D4 | **`happytime()` audit.** Two call sites only (campaign win, and a new unlock). Both are genuine milestones, which is the correct sparing usage. No change needed. | **DONE** |
| D5 | **Player controller review.** `TUNE` in `entities/player.ts` is thoughtful and well-documented (7.4 m/s run, 0.1 s to top speed, net-accel jetpack). Movement feel is **not** a retention problem. Staying frozen. | **DONE** |

### Wave 2 — Director, after wave 1 lands

| ID | Task | Status |
|---|---|---|
| T8 | Integrate every worker's requested `game.ts` hook (juice API, coach API, music intensity, combo curve, scoring) | **DONE** — see section 11 for the full list of what was wired |
| T9 | Full typecheck, production build, bundle-size check | **DONE** — `tsc --noEmit` clean; build is 2.3 MB raw / ~896 KB gzipped (~4.5% of the 20 MB gate) |
| T10 | Director playtest pass: cold-start timing (target — **something destroyed within 5 seconds**), 10-minute session, mobile viewport, campaign, endless, daily | **PARTIAL** — automated Playwright smoke tests confirm the boot screen, attract-mode demo, PLAY flow, coach prompt, juice/particles, combo curve and a full result card (subtitle, medals, best-run record, unlock banner) all work with zero console errors (section 11). Still needed: a real human playtest of a full 10-minute session, the mobile/touch viewport, campaign/endless/daily specifically, and the streak banner (needs a multi-day save to trigger). |
| T11 | Act on W1's tech recommendations (bundle size, renderer, perf); scope decided once the report lands | **Still deferred, unchanged.** Bundle size is closed (non-issue). The batched-particle-renderer prototype (section 9.4) is a post-retention-fix decision — not attempted this session; current bundle/perf headroom does not demand it yet. |
| T12 | Update `README.md` and the `AGENTS.md` project memory to match the new design | **PARTIAL.** `README.md` rewritten to match: retitled, 18-round arsenal corrected, new Progression section (unlock ladder, medals, streak, ranks), the coach and shake setting documented, `fx/juice.ts` and the audio director documented, Known Gaps section updated. `AGENTS.md`'s memory block is auto-generated by a separate `omni-memory` tool ("edit outside this block only") and that tool is not available in this session — it still says the combo cap is 6× (now 8×, on a square-root curve). Needs a human or an `omni-memory remember` pass, not a hand edit. |
| T13 | CEO demo build and before/after presentation | Not started. |

---

## 6. Target metrics for the overhaul

These are what we are actually trying to move. Wave 2 playtesting checks them.

### 6a. CrazyGames' own published success bar — this is the real scoreboard

A new game on CrazyGames goes through a "Basic Launch" test period (7-21 days, min. 500
plays) and must hit these to advance to Full Launch with monetisation. **These are the
numbers we are actually judged on**, and they are far more useful than generic mobile-app
retention figures (which measure installed, account-based audiences and do not apply).

| Metric | CrazyGames success threshold |
|---|---|
| **1-minute conversion** (still playing at 60 s) | **80%+** |
| **Average session length** | **10+ minutes** |
| **D1 retention** | **10-15%** |
| Load time | under 10 s |
| Build size | under 20 MB |

CrazyGames explicitly diagnoses a sub-80% 1-minute conversion as *slow load or confusing
onboarding*. That is precisely our failure. **1-minute conversion is our north star.**

Note: our own "90% quit in 10 minutes" is internal test data with no external portal-specific
benchmark to compare against — track against the table above instead.

### 6b. Our own before/after targets

| Metric | Now (measured) | Target |
|---|---|---|
| Time from page load to first destruction | ~25 s+ (3 menus + a 22 s walk) | **under 10 s** |
| Targets on screen at t=0 | 0 | **many** |
| Time to first weapon unlock | ~240 crate hits — effectively never | **60-90 s** |
| Reward cadence in the first session | sparse | **every 20-30 s** |
| Attract-mode time to first explosion | 10 s+ | **under 1 s** |
| Interactions from cold load to firing | 3 clicks plus a long walk | **1** |

---

## 7. How to resume this work in a new session

1. Read this file top to bottom. It is the whole brief.
2. Run `npx tsc --noEmit` to confirm the tree is green, and `git status` / `git log` to see
   what has landed since this file was last updated.
3. Check section 5 for the first task not marked done.
4. **Re-dispatch workers by role using the ownership map in section 4.** Worker agent IDs do
   not survive a session; the ownership map does, and it is the part that matters. Give any
   new worker: the diagnosis (section 2), the constraints (section 3), its exclusive file
   list (section 4), and the rule that it must never edit `src/game.ts`.
5. The Director integrates. Workers never touch `src/game.ts`.

---

## 8. Decisions log

_Append here as decisions are made, so they are never re-litigated._

- **2026-08-19** — Diagnosis is retention across the first 90 seconds, not a shortage of
  content. We are not adding more weapons or more campaign missions as a primary fix; 18
  rounds is plenty. (This matches a note already in the project memory.)
- **2026-08-19** — `src/game.ts` is Director-owned and single-writer, to prevent the
  overwrite loops that come from parallel agents sharing an integration hub.
- **2026-08-19** — Ragdolls and stickmen are locked by stakeholders. Interpreted as: keep the
  ragdoll physics and the black-stickman identity intact, and improve everything around them.
- **2026-08-19** — The game is to be retitled **Stickman Total Destruction** on screen, to
  match marketing.
- **2026-08-19** — **Do not switch physics engines.** Rapier remains the strongest 2D web
  choice in 2026. Jolt benchmarks ~2x faster on large scenes but a swap is a multi-week,
  high-risk rewrite of a launched game. Not justified for retention work.
- **2026-08-19** — **Keep `rapier2d-compat`; do not migrate to bare `@dimforge/rapier2d`.**
  The README lists bundle size as the top "known gap" — it is a **non-issue**. We are at
  ~837 KB gzipped against a 20 MB mobile-homepage eligibility gate. We have enormous
  headroom. Loading is not our bottleneck and migrating risks load-time regressions from
  bundler `.wasm` misconfiguration. **This closes a long-standing README item.**
- **2026-08-19** — **Premise corrected: CrazyGames is NOT predominantly mobile.** It is often
  desktop-leaning in our biggest markets (US ~65% desktop, India ~74% desktop), mobile-heavy
  only in some regions (Turkey, Colombia). Design desktop-first, support mobile well. The
  device floor is still low — 4 GB-RAM Chromebook class must run smoothly. This correction
  was relayed to W3, W4, W5 and W7, who had been briefed on the wrong premise.
- **2026-08-19** — **No near-miss mechanics.** Simulated/rigged near-misses are gambling
  psychology — they work by making failure misread as progress. We use transparent,
  skill-based comparisons instead ("you beat your best by 3", ghost runs). Ethical line,
  and it holds even though the manipulative version demonstrably works.
- **2026-08-19** — **Screenshake must be user-controllable** (slider or toggle). Documented
  motion-sickness trigger and a standard accessibility expectation; especially necessary
  because W3 is significantly increasing shake.
- **2026-08-20** — **Wave 2 ran as a single Director session, not a second parallel wave.**
  A green typecheck after wave 1 was not proof the work was integrated — three of six
  worker deliverables were complete on disk but never wired into `game.ts`. Verified this
  by dispatching one read-only audit subagent against the actual task briefs before
  writing any code, and let it finish before doing any integration work that depended on
  its findings. See section 11.
- **2026-08-20** — **Medal/streak/best-run bonus is folded into the single "CARNAGE
  EARNED" number rather than given its own compartment on the result card.** The number
  was already the headline; a separate "+bonus" line would make it a subtraction problem
  for the player to do in their head. A small text banner was added for the medal
  name(s) and the streak, since those are worth naming even though their carnage is
  already counted above.
- **2026-08-20** — **Explosions and structure collapses were left on their own
  hand-authored camera/particle numbers instead of being switched to
  `juice.explosion()`/`juice.collapse()`.** Both already work and are tuned;
  `entities/projectile.ts` is a frozen file, and a purely cosmetic unification wasn't
  worth the risk of touching it outside a dedicated pass. `Camera.frameSpectacle` stays
  unused until that pass happens.
- **2026-08-20** — **No new leaderboard board for longest-chain/biggest-hit**, even
  though `progress.recordChain()` now actually runs. Submitting to a board that isn't
  configured on the CrazyGames dashboard is either a silent no-op or an error we can't
  see from the repo — that configuration has to happen on the platform side first.

---

## 9. Research findings (W1) — the parts we are acting on

Full report was delivered to the Director; this is the actionable residue. Everything here
has been relayed to the relevant worker.

### 9.1 CrazyGames platform requirements (these are rules, not opinions)

- **"Land new users in gameplay immediately, maximum ONE additional click."** Our single-PLAY
  funnel is literally their written requirement.
- **Onboarding must "prioritize visuals over text... implemented in gameplay and skippable."**
  A wall of tutorial text is a stated **rejection risk**. Our 9-line CONTROLS card is exactly
  the thing they reject.
- Guest play must be default; never auto-trigger a login prompt.
- **The game must mute its own audio during video ads.** Submission-compliance item; assigned
  to W7 with a `portal.adPlaying` hook for the Director to wire.
- `happytime()` triggers a platform celebration overlay — use it on genuine milestones only;
  overuse burns it. **Director TODO: audit our two current call sites.**
- Midgame ads: max 1 per 3 min, at natural breaks, never combined with a watch-to-continue
  at the same beat. Our existing placement (on restart, never on death, one in three) is
  already correct — do not regress it.
- Rewarded ads: label with the exact reward, never chain two ads for one reward, cap ~5/day
  with diminishing returns in-session.

### 9.2 Competitive teardown

- **Universal pattern:** every successful title in our genre (People Playground, Kick the
  Buddy, Mutilate-a-Doll 2, Ragdoll Show) puts an interactive object *and* a ragdoll on
  screen with zero preamble. "Instant tool, zero setup, immediate destruction."
- **Kick the Buddy's loop is the model to copy:** destruction itself pays currency, and the
  next unlock is always kept one-to-two sessions away with a visible, partly-filled bar.
- **Physics unpredictability is the documented "one more go" engine** for Happy Wheels and
  Turbo Dismount — a retry must feel like a new roll, not a repeat. Design for outcome
  *variance*, not just spectacle. (Relayed to W2 as a level-design instruction.)
- **Trap to avoid:** People Playground and MaD2 get away with goal-less sandbox because they
  have hundreds of tools. That is a large-content strategy we are not pursuing — our
  playground needs authored pacing instead.
- **Direct competitors already live on CrazyGames:** Stickman Destruction 3 Heroes, Stickman
  Annihilation 2, Turbo Dismounting. Several top-ranked games in the ragdoll tag are
  **multiplayer** (Basket Random, Who Dies Last?) — we are not, so our single-player
  spectacle must work harder. Cheap proxy: async leaderboards (we already have SDK support
  in `src/platform/portal.ts`).

### 9.3 Game feel — sourced numbers

- **Hitstop scales with impact magnitude**, fighting-game convention — near-zero (~16 ms) for
  light hits up to ~200 ms as an upper bound for our most spectacular impacts. Our existing
  0.22 s clamp in `game.ts` is about right; build the curve under it.
- **Screenshake: use Perlin/simplex noise, not random jitter.** Random reads as flicker,
  coherent noise reads as physical. Our `trauma²` scaling is already correct and stays.
  (Canonical source: Squirrel Eiserloh, GDC 2016, "Juicing Your Cameras With Math".)
- **Drive everything off ONE unified `impactMagnitude`** — hitstop, trauma, punch, flash,
  particle count *and* audio layering. W3 owns producing it, W7 consumes the same value so
  sound and picture scale together.
- Score/damage popups: spawn on the exact impact frame (any delay severs the cause-effect
  read), drift up, fade over 0.6-1.2 s. Keep audio within ~15-20 ms of picture.
- Chromatic aberration: 1-3 px, spike for a few frames on big impacts, always paired with
  shake. Achievable on Canvas2D via a 3x drawImage channel-offset trick.
- Canonical references: Nijman *The Art of Screenshake* (Vlambeer 2013); Jonasson & Purho
  *Juice It or Lose It* (GDC 2012); Swink *Game Feel* (2008); Eiserloh (GDC 2016).

### 9.4 Technology verdict

- **Physics: keep Rapier, keep `rapier2d-compat`.** See decisions log. Bundle size is a
  non-issue and the README's "known gap" on it is wrong.
- **Rendering: Canvas2D's per-draw-call overhead is likely our real frame ceiling**, more so
  than the physics step, at ~900 bodies plus particle overdraw. PixiJS v8 batches tens of
  thousands of sprites where Canvas2D cannot. **Recommendation: if we do this at all, prototype a
  batched renderer for the particle/gib layer ONLY, keeping Canvas2D for UI and background.**
  Deferred to T11 — this is a post-retention-fix decision, not part of wave 1. In the
  meantime W3 and W4 have been told to budget draw calls and overdraw carefully.
- **OffscreenCanvas + Worker: viable but sequence it AFTER any batching work, not before.**
  Real pitfalls — Safari `getContext` returning null in workers, postMessage becoming its own
  bottleneck without Transferables, worker-lifecycle leaks on scene reset. CrazyGames still
  treats Safari as supported-but-fragile, so this adds risk we cannot currently afford.
- **WebAudio: fixed pool of ~16-32 voices with voice stealing** (kill oldest/quietest) and
  priority weighting so kill and explosion sounds always win a slot. Assigned to W7.

### 9.5 Meta-retention

- Unlock horizon always one-to-two sessions away, with a permanently visible partial bar.
- Daily streaks work (loss-aversion), **but must include a grace/freeze day** or they read as
  punitive and drive churn.
- Async leaderboards as the cheap competitive hook. Candidate metrics: biggest single-shot
  damage, longest chain. W6 to propose; Director to wire submission.

### 9.6 Open / unverified

- CrazyGames' exact featuring algorithm weighting is proprietary — the engagement-metric
  list is directionally true, not a formula.
- Our "90% quit in 10 minutes" has no external portal benchmark; use the section 6a table.
- Live gzip figure for `rapier2d-compat` was not re-confirmed (Bundlephobia rate-limited).
  **Director TODO in T9: check the real production build size against the 20 MB gate.**

---

## 10. Incident log — wave 1 interruption (2026-08-20)

**What happened.** All six implementation workers (W2-W7) were terminated simultaneously
mid-edit by an account-level spend limit. This was an infrastructure failure, not a problem
with any worker's output. The limit later reset and all six were resumed from their own
transcripts, so no work was lost and none was redone.

**State of the tree at the moment of interruption** — recorded because it shows how well the
ownership model held up under an abrupt stop:

- 14 files modified, 4 new files created, every one of them inside its owner's lane.
- **Zero cross-owner collisions.** No worker had touched a file belonging to another.
- Typecheck showed only **5 errors across 2 files**, all of them the ordinary
  half-finished-edit kind:
  - `src/fx/particles.ts` referenced a `randSpread` helper not yet defined (W3).
  - `src/ui/menu.ts` had an unused `SHAKE_LABELS` import and a `blurb` field referenced
    before being added to `ModeCard` (W5).
- Every other worker's files compiled clean.

**Why this matters for the record.** A six-way parallel edit surviving a hard stop with two
trivially-repairable files is the ownership map in section 4 doing its job. Had `src/game.ts`
been shared, this would have been a merge disaster instead of a five-minute fix.

### Resume protocol — use this if workers are interrupted again

1. `git status --short` and `npx tsc --noEmit` first. Do not resume anyone until you know
   how bad it is.
2. Attribute each typecheck error to its owning worker via section 4.
3. Resume each worker with a message that: (a) states the interruption was infrastructure,
   not their fault, (b) tells them **not to redo completed work** and that their edits are
   intact on disk, (c) quotes their own specific typecheck errors verbatim, (d) lists what
   remains from their brief, (e) re-states their file ownership, since other workers are
   editing concurrently.
4. Warn any worker who was mid-rewrite of a file to **re-read that file** before continuing
   rather than assuming its state.
5. Do not resume a worker into a tree broken by a *different* worker — fix or wait first.

### Where each worker was when it stopped

| Worker | Last action before termination | Resumed with |
|---|---|---|
| W2 levels | "Now Mars." | finish `mars.ts`, then `ai/demo.ts` (attract mode — highest value remaining), `chunks.ts`/`endless.ts`, `campaign.ts` |
| W3 feel | "Now the draw path: culling, the `glint` kind, and the popup punch curve." | fix `randSpread`, then `decals.ts`, `gore.ts`, `juice.ts` |
| W4 art | mid-rewrite of `background.ts` around baked layer strips | finish baked strips, dead ground, bottom seam, `props.ts`, thumbnail rec |
| W5 UI | "Now the confirm/expand logic and click absorption" | fix both errors, then `hud.ts`, `touch.ts`, `index.html` rebrand |
| W6 economy | "Now the ammo point retune." | finish `ammo.ts` points, reward texture, combo curve rec, leaderboard metrics |
| W7 audio | "Writing the DSP/baking layer first." | finish DSP/mix, impact rebuild, voice pooling, music, ad-mute, tab suspend |

**Note on resuming:** worker agent IDs are session-scoped. If the *session* is lost rather
than the workers, they cannot be resumed — re-dispatch by role from section 4 instead, and
give each new worker the diagnosis (section 2), constraints (section 3), its file list
(section 4), and the never-touch-`game.ts` rule.

---

## 11. Wave 2 session (2026-08-20) — audit and Director integration

**Context.** This session picked up after the incident in section 10, working under a
different process constraint from wave 1: at most one implementation subagent running at
a time (instead of six parallel workers), so that a subagent whose output could change an
implementation decision is always let finish before anything downstream depends on it.
Everything in this section was either a single read-only audit subagent's findings,
verified against the actual code, or the Director's own direct edits — there was no
second wave of parallel workers.

### 11.1 What was found

`git status` was clean and `npx tsc --noEmit` was already green at the start of this
session — the prior session's wave-1 work (all of T2-T7) had, in fact, landed and been
committed (`e8181cb "overhauling"`), despite this document's task board still reading "in
flight". A single audit subagent was dispatched to verify each worker's deliverable
against its brief, file:line, rather than trusting that a green typecheck meant the work
was functionally complete.

**Verdict:** T2, T4 and T6 were genuinely done. T3, T5 and T7 were **built correctly but
never wired into `src/game.ts`**, which only the Director may edit (section 4). Concretely:

- `src/fx/juice.ts` (348 lines, the unified magnitude → hitstop/trauma/punch/kick/flash/
  slowmo/burst curve) was imported nowhere outside a code comment. `game.ts` was still
  running its own pre-existing hand-rolled impact numbers.
- `settings.shake` (the four-step screenshake control, already fully built and wired in
  the pause menu UI) was never read by `game.ts`, so the slider changed stored state with
  zero gameplay effect. (`Camera.shakeIntensity`, the exact field built for this, already
  existed and was already correctly threaded through trauma/punch/kick — it just needed
  `game.ts` to set it.)
- `src/ui/coach.ts` (`Coach`, the teach-by-doing onboarding system replacing the old
  9-line controls card) was never instantiated anywhere. The controls card was removed
  and nothing replaced it — a real onboarding regression, not just a missed enhancement.
- `sfx.setAdPlaying()`, `sfx.excite()`/`sfx.update()` (music intensity), `sfx.listener()`
  (positional audio) and `sfx.setMood()` were never called from `game.ts`. Ads did not
  mute the game; the generative soundtrack never reacted to combat and, because
  `update()` was never called to decay it, would only ever climb; positional audio was
  pinned to world origin `(0,0)` forever instead of tracking the camera.
- `progress.scoreRun()` (medals, daily streak with a grace day, and a best-run bonus —
  the "reward texture" from T6's brief) was fully implemented but never called from
  `finish()`, and `ResultCard`/`drawResult()` had nowhere to show it even if it had been.
- `ResultCard.subtitle` — real, already-authored copy ("Out of lives. They are still
  standing.", "Same world for everybody today...") — was built into every result card and
  never once drawn.

### 11.2 What the Director wired, all in `src/game.ts` unless noted

- **Juice.** `dispatchImpacts()` now calls `juiceHit(this, e.point, fromEnergy(kj), ...)`
  instead of hand-rolled dust/spark/trauma numbers. `reportDestruction()`'s enemy-kill
  path now calls `juiceKill(this, at)` instead of a flat `hitstop(0.045)` /
  `addTrauma(0.16)`. `resetJuice()` is called on every level load so a fresh run isn't
  penalised by the previous run's slow-motion cooldown.
- **Shake setting.** `updateCamera()` now sets `this.camera.shakeIntensity = settings.shake`
  every frame, read at the point trauma is consumed (per that field's own doc comment).
- **Coach.** `Game.coach = new Coach()`; `.begin()` on every `startLevel()`; `.update()`
  every frame while playing, fed by a new `coachInput()` that assembles live/firing/moveX/
  ammo index & count/jetThrottle/limp/touch from existing public state (no changes needed
  to `entities/player.ts` or `core/input.ts` — everything the coach needs was already
  public); `.draw()` alongside the crosshair, anchored on `player.chest`.
- **Audio director.** A new `updateAudio(rawDt)`, called every rendered frame regardless
  of mode: `sfx.update(rawDt)` (decay), `sfx.setAdPlaying(portal.adPlaying)`,
  `sfx.listener(camera.pos.x, camera.pos.y, camera.visibleHalf().x)`, and
  `sfx.setMood(...)` mapped from menu/outcome/playing state to the `"menu"/"combat"/
  "result"` moods `audio-music.ts` already implements.
- **Medals/streak/best-run.** `finish()` now builds a `RunStats` and calls
  `progress.scoreRun()` once, after `bankRun()`, per that function's own contract. The
  bonus is folded straight into `this.earned` so the result card's one big carnage number
  stays honest without needing a second line to explain it. `bestDelta > 0` sets
  `record: "NEW BEST RUN"` (reusing the field/draw code that already existed for it).
  `ResultCard` gained `medals?`/`streak?` fields; `Menu.drawResult()` gained a small text
  banner for them (medal names + the first medal's detail line, then the streak, in the
  same visual language as the existing record/rank line) — a **new, small UI addition**,
  the one piece of this wave that wasn't purely wiring an existing hook.
- **Subtitle.** `Menu.drawResult()` now actually draws `r.subtitle` under the title.
- **Deliberately not done:** `entities/projectile.ts`'s explosion camera/particle code was
  left as its own hand-authored numbers rather than switched to `juice.explosion()` —
  it works, and rewriting a frozen entities file for a cosmetic-only unification wasn't
  worth the risk this session. This means `Camera.frameSpectacle` ("look at that") is
  still never called. No new leaderboard board was added for longest-chain/biggest-hit —
  `progress.recordChain()` now actually runs (via `scoreRun`), but submitting it needs a
  board configured on the CrazyGames dashboard first, which is outside this repo.

### 11.3 Verification

`npx tsc --noEmit` clean. Production build: 2.3 MB raw / ~896 KB gzipped. A Playwright
smoke test (dev server + headless Chromium, `playwright@1.62.1` installed ad hoc via
`npm install --no-save`, not added to `package.json`) drove the actual game: boot →
attract-mode demo already destroying a populated tower at t=0 → click PLAY → fire the
Chicken Cannon repeatedly. Confirmed live and working, zero console errors the whole run:
the single-PLAY menu, the coach's FIRE prompt appearing then correctly dismissing after
the first shot, heavy particle/gore feedback on impact, the new square-root combo curve
climbing (screenshots showed x38, x41 chains), and score/HUD updating correctly.

A second smoke test forced a finish (`window.game.finish("lost")`, exposed by `main.ts`,
called after a real run had accumulated score/blocks/kills/chain) to render an actual
result card end to end. Confirmed clean: the subtitle now shows ("Out of lives. They are
still standing."), `NEW BEST RUN` shows in green, the medal banner shows
(`DEMOLITIONIST · TOTAL COLLAPSE · BODY COUNT`, detail line `35 blocks down`) with no
overlap against the "3 NEW ROUNDS UNLOCKED" banner below it, and the stat chips and
next-unlock bar are unaffected. The streak banner correctly did not show (not the first
run of a new day) — a multi-day streak render is still unverified.

**Not verified this session:** mobile/touch viewport, a full campaign playthrough, daily
mode, and the streak banner specifically (needs a save with `day` set to yesterday to
trigger `touchStreak()` returning non-null) — worth a manual check before shipping.

### 11.4 For the next session

1. Do the manual playtest T10 still calls for: a full 10-minute session, mobile viewport,
   campaign start-to-finish, endless, and the daily mode. In particular, actually finish
   a run and look at the result card — confirm the medals/streak banner reads well and
   doesn't collide with the unlock banner or stat chips when several are shown at once.
2. T11 (batched particle renderer) is still open and still correctly low-priority.
3. T12: get a human (or the `omni-memory` tool) to refresh `AGENTS.md`'s memory block —
   the 6× combo cap it states is now stale (8×, square-root curve).
4. T13: CEO demo build, once the manual playtest above is clean.
