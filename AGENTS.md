# AGENTS.md

_Standing instructions for AI coding agents in this repo._

<!-- OMNI-MEMORY:START — auto-generated; edit outside this block only -->
## Project memory (OmniMemory)

_Auto-generated 2026-08-25 13:34 · 73 verified memories · default branch `main`._

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
- queue-operation: The front-end looks bad. plus, the levels are honestly not that attractive or big. i want you to give the game more character.  `[baa3cdae052f]`
- queue-operation: commit and push directly to main. let's work more tomorrow  `[8e26e266c9ef]`

**API map**
- assistant: The subsoil is now the worst thing on screen. Let me make it recede, and put some life in the empty sky.  `[e3fecf6e5fdf]`
- assistant: Let me get the game running so I can actually see what the user is seeing.  `[6cea6577af43]`

<!-- OMNI-MEMORY:END -->
