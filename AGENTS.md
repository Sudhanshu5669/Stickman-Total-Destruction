# AGENTS.md

_Standing instructions for AI coding agents in this repo._

<!-- OMNI-MEMORY:START — auto-generated; edit outside this block only -->
## Project memory (OmniMemory)

_Auto-generated 2026-08-20 00:59 · 27 verified memories · default branch `main`._

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
- What I'd skip: more weapons and more campaign missions. You don't have a content problem â€” 18 weapons is plenty. You have a *pacing* problem, in that all of it is free immediately.  `[44c0b53bc57d]`
- Aim angle must be measured from the muzzle (Player.hand / Enemy.hand), not the chest or torso: the gun is drawn there, fires there and previews there, so any other pivot yields a shot line parallel to the crosshair that misses by a constant ~0.56m at every range. Player.updateAim eases the pivot back to the shoulder inside 2.4m to avoid oscillation.  `[c58297d447ef]`
- Enemy bullet damage bypasses the player ragdoll damageScale (0.34 self-damage discount) by dividing it back out in Game.target().hurt - incoming fire is not self-damage.  `[df0a3c727355]`

**Flows**
- queue-operation: <task-notification>  `[739913679225]`
- Endless mode streams 211 pre-authored chunks from levels/chunks.ts via EndlessDirector, retiring actors behind the player through Builder.mark() and Builder.retire().  `[9ef9e82955e5]`

**API map**
- The combo multiplier goes up to 6Ã—, so chaining destruction is worth far more than picking things off â€” that's the intended fast route.  `[7a8b8a9c7c69]`
- One placement warning: put your midgame ad on *restart*, never on death. Death â†’ ad â†’ menu murders the "one more go" impulse, which is the only impulse that matters.  `[7966d20ad993]`

<!-- OMNI-MEMORY:END -->
