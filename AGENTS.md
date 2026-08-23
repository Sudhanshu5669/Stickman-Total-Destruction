# AGENTS.md

_Standing instructions for AI coding agents in this repo._

<!-- OMNI-MEMORY:START — auto-generated; edit outside this block only -->
## Project memory (OmniMemory)

_Auto-generated 2026-08-23 22:24 · 70 verified memories · default branch `main`._

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
- queue-operation: commit and push directly to main. let's work more tomorrow  `[8e26e266c9ef]`
- queue-operation: show me a few ss of the front-end,  some levels, etc  `[fce6b28aee25]`

**API map**
- assistant: Capture keeps timing out on Coldspine's blizzard layer. The verification passed (`TRIPLE KILL`, 3 enemies, one blast) â€” let me get the picture on a lighter level.  `[d1796e7453d0]`
- assistant: Input has stopped reaching the page â€” likely a focus casualty of the DOM probe. Let me reload and retest the one remaining route.  `[38943b135670]`

<!-- OMNI-MEMORY:END -->
