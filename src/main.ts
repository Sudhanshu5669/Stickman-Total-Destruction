import { Game } from "./game";
import { sfx } from "./fx/audio";

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
const boot = document.getElementById("boot");
const bootErr = document.getElementById("boot-err");

function fail(err: unknown) {
  console.error(err);
  if (bootErr) bootErr.textContent = err instanceof Error ? err.message : String(err);
  boot?.classList.remove("gone");
}

async function start() {
  if (!canvas) throw new Error("canvas #game missing");

  const t0 = performance.now();
  const game = new Game(canvas);
  await game.init();
  // Portals rank on engagement and players bounce on slow loads, so the one number
  // worth keeping an eye on goes in the console rather than in a profiler session.
  console.info(`[boot] ready in ${Math.round(performance.now() - t0)}ms`);

  // Browsers only allow audio after a real gesture, so arm it on the first input.
  const unlock = () => sfx.unlock();
  addEventListener("pointerdown", unlock, { once: false });
  addEventListener("keydown", unlock, { once: false });

  boot?.classList.add("gone");
  setTimeout(() => boot?.remove(), 600);

  // Handy while iterating on tuning values from the console.
  (window as unknown as { game: Game }).game = game;
}

start().catch(fail);
