# CrazyGames submission

Everything needed to put **Stickman Total Destruction** on CrazyGames, and where it
lives in this repo.

## 1. Build the game

```bash
npm ci
npm run build          # tsc --noEmit && vite build  ->  dist/
```

`dist/` is the upload. Zip its **contents** (so `index.html` is at the root of the zip,
not inside a `dist/` folder):

```bash
cd dist && zip -r ../stickman-total-destruction.zip . && cd ..
```

### What the build looks like

| | |
| --- | --- |
| Entry | `dist/index.html` (relative asset paths — `vite.config.ts` sets `base: "./"`) |
| Total size | ~10 MB (well under the 50 MB first-load limit; also under the 20 MB mobile-homepage bar) |
| Largest files | two music MP3s (~3.7 MB each), the JS bundle (~2.4 MB / ~900 KB gzipped, Rapier WASM inlined) |
| Cold boot | < 1 s to the menu on a mid-range machine (10 s budget) |
| Network requests | none except the CrazyGames SDK — WASM is inlined, all art/audio is bundled |
| Console | clean (a `favicon.ico` 404 only appears when opened as a bare top-level page, never in the portal iframe; a data-URI icon is set in `index.html`) |

## 2. SDK integration — already done

`src/platform/portal.ts` wraps the SDK so nothing in it is load-bearing: every call
resolves to a harmless default when the SDK is absent, slow, or throws, so the same
build runs on the portal, on a plain web host, and locally.

- **SDK script**: `index.html` loads `https://sdk.crazygames.com/crazygames-sdk-v3.js`
  (v3), ahead of the game module, not awaited.
- **`SDK.init()`** — awaited during boot, alongside the physics load.
- **Loading brackets** — `game.loadingStart()` before the physics blob,
  `game.loadingStop()` once the first world exists.
- **Gameplay brackets** — `game.gameplayStart()` on entering an arena;
  `game.gameplayStop()` on pause, ad, and return to menu.
- **`game.happytime()`** — fired when a round is unlocked.
- **Midgame interstitial** — `ad.requestAd("midgame", …)` on every third arena restart,
  and nowhere else. Never on death.
- **No rewarded ad / leaderboard** — an arena has no fail state (dying costs only the
  walk back, respawn is automatic) and no score-submission moment, so there is nothing
  to revive or to post. If a board is ever wanted, `progress.ts` already tracks lifetime
  carnage locally; wiring `leaderboard.submitScore` would be a small change once a board
  exists on the dashboard.

Ads pause the game: `Game.updateAudio` mutes on `portal.adPlaying`, and
`handleFrameKeys` / `simulate` ignore input and freeze the sim while an ad is on screen.

### Two-stage launch

CrazyGames typically does a **Basic Launch** first (no SDK, they measure retention),
then invites you to **Full Launch** with the SDK. The SDK integration above is inert
without the portal, so the *same* `dist/` works for both — no separate build.

## 3. Store text

- **Name**: Stickman Total Destruction
- **Tagline**: Load a piano. Aim at a building. Pull.
- **Short description**:
  > A 2D ragdoll destruction sandbox. You're a stickman with a gun that fires chickens,
  > sedans, grand pianos, passenger jets and live elephants at buildings full of
  > stickmen — and every collapse is simulated, not animated. 21 rounds, all unlocked
  > from the start, seven arenas, nothing to grind.
- **Controls**: `A`/`D` move · `Space` jump, hold to fly the jetpack · mouse aim ·
  click to fire · `1`/`3` or wheel to change rounds · `R` go limp · `G` god mode.
  On phones: on-screen sticks.
- **Category**: Shooting / Sandbox / Physics
- **Tags**: stickman, ragdoll, destruction, physics, sandbox, explosion, funny

## 4. Cover images — `submission/covers/`

CrazyGames wants three, and overlays its own title + rating, so these carry **no text**.
Regenerate with `node submission/capture.mjs covers` (HUD is hidden for these).

| File | Size | Aspect |
| --- | --- | --- |
| `landscape-1920x1080.png` | 1920×1080 | 16:9 |
| `portrait-800x1200.png` | 800×1200 | 2:3 |
| `square-800x800.png` | 800×800 | 1:1 |

## 5. Screenshots — `submission/shots/`

Ten 1920×1080 gameplay frames across five arenas, plus `00-menu.png`. Upload at least
three that show real gameplay (not the menu). Regenerate with
`node submission/capture.mjs shots`.

## 6. Gameplay video — `submission/gameplay.mp4`

~40 s, 1920×1080, H.264, faststart, showing four arenas being taken apart. Built from a
real play session:

```bash
npm run preview &                          # serve dist/ on :4173
node submission/capture.mjs video          # -> submission/video-raw/*.webm
ffmpeg -i submission/video-raw/*.webm \
  -vf "scale=1920:1080,fps=30" -c:v libx264 -pix_fmt yuv420p -crf 20 \
  -movflags +faststart -an submission/gameplay.mp4
```

The capture is muted; if CrazyGames wants audio on the preview, mux one of the tracks
from `src/Assets/music` over it (`ffmpeg -i gameplay.mp4 -i "src/Assets/music/Liquid DnB
Synthxx 2.mp3" -c:v copy -c:a aac -shortest gameplay-audio.mp4`).

## 7. Pre-submit checklist

- [ ] `npm run build` clean, `dist/` zipped with `index.html` at the root
- [ ] Loads and plays in an incognito window from the zipped build (via a static server)
- [ ] Plays on a phone — on-screen controls work, text is legible, holds frame rate
- [ ] No console errors in the portal QA tool
- [ ] Three cover images, three+ screenshots, one gameplay video uploaded
- [ ] Store text filled in from §3
- [ ] Music confirmed as the author's own work (it is — see `README.md` § Asset licensing)

`submission/` is git-ignored; the media is generated, not committed.
