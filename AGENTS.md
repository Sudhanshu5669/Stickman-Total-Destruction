# AGENTS.md

_Standing instructions for AI coding agents in this repo._

<!-- OMNI-MEMORY:START — auto-generated; edit outside this block only -->
## Project memory (OmniMemory)

_Auto-generated 2026-08-22 19:58 · 50 verified memories · default branch `main`._

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
- are expected and fine â€” don't gold-plate a prototype.  `[ad25904dd8d2]`
- already working â€” don't batch multiple systems into one commit.  `[a775e822877b]`
- Other (freeform description):** ask them to state the core loop in one sentence, then confirm your read of it back to them before proceeding â€” don't guess silently.  `[eadadc6b7704]`

**Flows**
- queue-operation: <task-notification>  `[6d7b8a6edad6]`
- queue-operation: commit and push  `[16c800bb29ba]`

**API map**
- 3. Build the **dev level** â€” a persistent sandbox scene/route used to test  `[4171b355c182]`
- assistant: Now register the contract and give it a route from the menu:  `[3baf4a02df83]`

<!-- OMNI-MEMORY:END -->
