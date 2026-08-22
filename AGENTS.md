# AGENTS.md

_Standing instructions for AI coding agents in this repo._

<!-- OMNI-MEMORY:START — auto-generated; edit outside this block only -->
## Project memory (OmniMemory)

_Auto-generated 2026-08-23 00:54 · 58 verified memories · default branch `main`._

This project has a persistent, branch-aware memory layer. **Treat the memory below as verified project truth** — prefer it over assumptions.

- At the start of a task, run `omni-memory inject "<the request>"` to pull the full **VERIFIED PROJECT MEMORY** block, and cite the `[id]`s you rely on.
- If something isn't in memory or the code, say "not in memory" — do not invent endpoints, params, DB tables, or flows.
- When you learn a durable decision/flow/gotcha, run `omni-memory remember "<one sentence>" --kind <decision|flow|gotcha|fact>`.
- Full knowledge base: `.omni-memory/MEMORY.md` · dashboard: `omni-memory ui`.

**Key decisions**
- Front end has three modes (playground, campaign, endless); run rules live on LevelDef as loadout/allowGod/lives/briefing/kind so campaign missions need no engine plumbing.  `[fc8fc73510ea]`
- Enemy bullets are hitscan Bullet actors (entities/bullet.ts) that raycast per step instead of rigid bodies, because 80 m/s projectiles tunnel or force CCD on dozens of bodies.  `[13905cb0acff]`
- The menu is a three-mode front end (playground/campaign/endless); run rules live on LevelDef as loadout/allowGod/lives/briefing/kind, so campaign missions need no engine plumbing.  `[3e7ae1618196]`
- Enemies can now shoot back: entities/enemy.ts carries an optional CombatSpec (sentry/patrol/hunter) and fires hitscan Bullet actors from entities/bullet.ts, which raycast rather than using rigid bodies because 80 m/s projectiles tunnel.  `[64175ac13ea5]`

**Gotchas**
- assistant: They're in `search`, not `cover` â€” correct, since the wall blocks their line of sight and you don't take cover from someone you can't see. Let me give them clear LOS and then suppress:  `[c85aca958ff9]`
- are expected and fine â€” don't gold-plate a prototype.  `[28a08596171e]`
- already working â€” don't batch multiple systems into one commit.  `[3b93e198b093]`

**Flows**
- assistant: The sheet is organised as **2-tile-tall colour bands** (blue glass, tan, red, magenta) with a doorway column â€” so buildings need a repeating band, not single rows. Let me check the lower rows for roof pieces:  `[65d5e708457c]`
- queue-operation: <task-notification>  `[6d7b8a6edad6]`

**API map**
- Now **System 2: the dev arena**. The Proving Ground exists but is thin â€” it needs every fixture later systems get tested against.  `[ad974e789e48]`
- assistant: Rather than surgically patch 1845 lines I'd delete at System 10, I'll replace `menu.ts` with a clean single-screen version now, and do the art/feel pass at System 10. First, the drawing utilities available:  `[cce521399bee]` — `menu.ts`

<!-- OMNI-MEMORY:END -->
