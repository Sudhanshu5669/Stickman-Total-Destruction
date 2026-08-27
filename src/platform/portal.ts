/**
 * The CrazyGames integration, and the seam that keeps it optional.
 *
 * The game has to run in four places — the CrazyGames player, a plain itch/web build,
 * a local dev server, and a file:// double-click — and only the first of those has an
 * SDK. So nothing here is allowed to be load-bearing: every entry point resolves to a
 * harmless default when the SDK is absent, slow, or throws. An ad that fails to load
 * must never be the reason a run cannot be restarted.
 *
 * The SDK's own surface is treated as untrusted for the same reason. Its shape has
 * changed across major versions, so every call is feature-detected and wrapped rather
 * than typed against a version we happen to have read the docs for.
 */

type Unknown = Record<string, unknown>;
type Fn = (...args: unknown[]) => unknown;

/**
 * How long to wait for the SDK global.
 *
 * Short on purpose. The SDK is a plain blocking `<script>` ahead of the module, so if
 * it is going to load at all the global exists before any of this runs — the poll is
 * only a safety net for an exotic load order. Waiting seconds here would put that
 * delay on every *non*-portal load, where the script simply is not there, which is the
 * one place a slow boot costs the most.
 */
const DETECT_TIMEOUT = 600;
/** Beyond this an ad has failed as far as the player is concerned. */
const AD_TIMEOUT = 12_000;

function sdkRoot(): Unknown | null {
  const cg = (globalThis as Unknown).CrazyGames as Unknown | undefined;
  const sdk = cg?.SDK as Unknown | undefined;
  return sdk ?? null;
}

/** Calls `path` on the SDK if it exists. Never throws; returns undefined on any failure. */
function call<T = unknown>(path: string, ...args: unknown[]): T | undefined {
  const sdk = sdkRoot();
  if (!sdk) return undefined;
  try {
    let ctx: Unknown = sdk;
    const parts = path.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const next = ctx[parts[i]] as Unknown | undefined;
      if (!next) return undefined;
      ctx = next;
    }
    const fn = ctx[parts[parts.length - 1]] as Fn | undefined;
    if (typeof fn !== "function") return undefined;
    return fn.apply(ctx, args) as T;
  } catch (e) {
    console.warn(`[portal] ${path} failed`, e);
    return undefined;
  }
}

/** The SDK returns promises on some calls and uses callbacks on others; this tells them apart. */
function isThenable(x: unknown): x is Promise<unknown> {
  return !!x && typeof (x as { then?: unknown }).then === "function";
}

/** Resolves to `fallback` rather than hanging forever if the SDK never calls back. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: T) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => done(fallback), ms);
    p.then((v) => {
      clearTimeout(timer);
      done(v);
    }).catch(() => {
      clearTimeout(timer);
      done(fallback);
    });
  });
}

export type AdResult = "watched" | "skipped" | "unavailable";

class Portal {
  /** True once we know an SDK is present. Everything reads this rather than probing. */
  available = false;
  /** Set while an ad is on screen, so the game can hold the simulation. */
  adPlaying = false;
  private ready = false;

  /**
   * Waits for the SDK to appear, then initialises it.
   *
   * Resolves either way — a missing SDK is the normal case off-portal, not an error.
   */
  async init(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    const found = await this.detect();
    if (!found) return;
    try {
      // v3 exposes an async init; older builds initialise themselves on load.
      const r = call<Promise<unknown>>("init");
      if (isThenable(r)) await withTimeout(r, DETECT_TIMEOUT, undefined);
      this.available = true;
      console.info("[portal] CrazyGames SDK ready");
    } catch (e) {
      console.warn("[portal] SDK init failed; running standalone", e);
    }
  }

  /** Polls for the SDK global, since the script tag loads async and may 404. */
  private detect(): Promise<boolean> {
    if (sdkRoot()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        if (sdkRoot()) return resolve(true);
        if (performance.now() - started > DETECT_TIMEOUT) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  // ------------------------------------------------------------------ loading

  /**
   * Brackets the initial load. The portal uses these to decide when it may show its
   * own loading ad, and getting them wrong is a common submission rejection.
   */
  loadingStart() {
    call("game.loadingStart");
  }

  loadingStop() {
    call("game.loadingStop");
  }

  /**
   * Brackets actual play. The portal suppresses interruptions between these, so they
   * have to bound real gameplay and not the menus.
   */
  gameplayStart() {
    call("game.gameplayStart");
  }

  gameplayStop() {
    call("game.gameplayStop");
  }

  /** "Something good just happened" — the portal may use it to time an interstitial. */
  happytime() {
    call("game.happytime");
  }

  // ------------------------------------------------------------------ ads

  /**
   * An interstitial, shown on restart and nowhere else.
   *
   * Deliberately *not* shown on death: an ad between dying and retrying is the single
   * most reliable way to end a session, because it interrupts the exact moment the
   * player wanted to press the button again. Restart is the right seam — the decision
   * to keep playing has already been made — and `Game.adBreak` only reaches here on
   * every third one.
   *
   * There is no rewarded/revive ad because the game has nothing to reward with: an
   * arena has no fail state, dying costs only the walk back, and respawn is automatic.
   * A leaderboard would need a board configured on the portal dashboard and a
   * score-submission moment the sandbox does not have.
   */
  async midgame(): Promise<AdResult> {
    if (!this.available) return "unavailable";
    this.adPlaying = true;
    try {
      return await withTimeout(
        new Promise<AdResult>((resolve) => {
          const callbacks = {
            adFinished: () => resolve("watched"),
            adError: () => resolve("unavailable"),
            adStarted: () => {},
          };
          const r = call<Promise<unknown>>("ad.requestAd", "midgame", callbacks);
          // Some versions return a promise instead of using the callbacks.
          if (isThenable(r)) {
            r.then(() => resolve("watched")).catch(() => resolve("unavailable"));
          } else if (r === undefined && !sdkRoot()) {
            resolve("unavailable");
          }
        }),
        AD_TIMEOUT,
        "unavailable",
      );
    } catch {
      return "unavailable";
    } finally {
      this.adPlaying = false;
    }
  }
}

export const portal = new Portal();
