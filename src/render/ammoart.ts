/**
 * The ammunition, drawn as pixel art.
 *
 * System 6 rebuilt the guns as pixel art and stopped there, which left the
 * game firing smooth vector cars out of chunky pixel cannons. At rest that is a small
 * inconsistency; in motion it is the loudest thing on screen, because the payload is
 * the object the camera follows. A pixel gun that spits an anti-aliased jetliner reads
 * as two games spliced together.
 *
 * So every round now comes from the same buffer, the same six rules and the same
 * material ramps as the gun that fires it — see `render/pixel.ts`, which states them —
 * and the accent patch on each gun is literally the colour of the thing that comes out
 * of it.
 *
 * ## What is here and what is not
 *
 * The fifteen *rigid* payloads: rocket, car, jetliner, anvil, piano, fridge, bowling
 * ball, watermelon, sawblade, television, nuke, singularity, barrel, grenade, balloons.
 * Plus five
 * icon-only glyphs for the rounds that have no rigid body of their own — the three
 * creature rounds and the two continuous ones — so the ammo wheel is one art set with
 * no vector holdouts in it.
 *
 * The creature rounds themselves (chicken, elephant, stickman) are deliberately *not*
 * here. They are ragdolls: what you see is drawn bone by bone off the simulated
 * skeleton in `render/creatures.ts`, so the flop is never faked. Baking them into
 * sprites would mean throwing that away, and the stick figure is the game's signature
 * read — it is the one thing in the frame that should not be pixel art.
 *
 * ## Sizing
 *
 * Every sprite is authored at `ART_PPM` pixels per metre, like the guns (rule 6), and
 * each entry records `bodyW`: how many of its pixels the *physics box* spans. Drawing
 * scales by `w / bodyW`, so the art tracks the collider — retune a car to three metres
 * in `weapons/ammo.ts` and the sprite follows, still with square pixels.
 */

import type { Ctx } from "./draw";
import {
  ART_PPM, INK, Px, RAMPS, blitPixels, ramp, shadeHex, type Ramp3,
} from "./pixel";
import { paintBalloon, partyRamp } from "./balloonart";

const TAU = Math.PI * 2;

interface AmmoArt {
  /** Grid size in art pixels. Bigger than the collider wherever art overhangs it. */
  grid: [number, number];
  /** The pixel that sits on the projectile's centre — where the physics origin is. */
  origin: [number, number];
  /** Art pixels spanned by the collider's width, i.e. `cfg.w * ART_PPM`. */
  bodyW: number;
  /** Animated sprites bake one canvas per frame. */
  frames?: number;
  fps?: number;
  /** Skips the ink outline. Only for things made of light (rule 5). */
  noOutline?: boolean;
  /** Solid pass. Outlined afterwards. */
  draw(p: Px, f: number): void;
  /** Emissive pass, run after the outline so light spills over the ink, not under it. */
  glow?(p: Px, f: number): void;
}

// Payload colours. Named here rather than inline so a round's gun accent (`AmmoDef
// .tint`) and its sprite can never drift apart.
const C = {
  rocketBody: "#e8eef7",
  rocketNose: "#e8433a",
  car: "#e04b3a",
  plane: "#eef2f8",
  livery: "#2f6fd0",
  anvil: "#4a515c",
  piano: "#1d2027",
  ivory: "#f6f3ec",
  fridge: "#dfe4ea",
  bowling: "#241f3d",
  melon: "#3f8f3a",
  blade: "#c9d2de",
  tvCase: "#2b303c",
  screen: "#7fd0e8",
  nuke: "#4c525c",
  hazard: "#ffd23f",
  void: "#8a5cff",
  barrel: "#e8433a",
  olive: "#4a5a32",
  glass: "#2c4a63",
  chicken: "#fdfbf2",
  elephant: "#8d8f99",
  stick: "#38404f",
  water: "#4fc3f7",
} as const;

/** Paints `c` only over pixels that already exist — decals that cannot spill. */
function decal(p: Px, x: number, y: number, w: number, h: number, c: string) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (p.get(x + i, y + j) !== null) p.set(x + i, y + j, c);
    }
  }
}

/** One raised fastener: lit pixel over dark. The set's shared "this is built" mark. */
function rivet(p: Px, x: number, y: number, s: Ramp3 = RAMPS.steel) {
  p.set(x, y, s[2]);
  p.set(x, y + 1, s[0]);
}

/**
 * A soft mass in three values: dark rim, mid body, highlight up and to the left.
 *
 * `ball` is for things that are actually spherical. This is for the ones that are only
 * roughly round — an animal's barrel of a body — where a true sphere gradient looks
 * inflated rather than heavy.
 */
function blob(p: Px, cx: number, cy: number, rx: number, ry: number, s: Ramp3) {
  p.ellipse(cx, cy, rx, ry, s[0]);
  p.ellipse(cx - rx * 0.08, cy - ry * 0.12, rx * 0.9, ry * 0.86, s[1]);
  p.ellipse(cx - rx * 0.3, cy - ry * 0.32, rx * 0.44, ry * 0.4, s[2]);
}

/** A pane: dark glass, a warm sill and one diagonal specular streak. */
function pane(p: Px, x: number, y: number, w: number, h: number, sill = true) {
  p.rect(x, y, w, h, C.glass);
  p.row(x, y, w, shadeHex(C.glass, -0.3));
  if (sill) p.row(x, y + h - 1, w, "#ffcf7a");
  for (let i = 0; i < Math.min(w, h) * 0.9; i++) {
    p.set(x + 1 + i, y + h - 2 - i, shadeHex(C.glass, 0.45));
    p.set(x + 2 + i, y + h - 2 - i, shadeHex(C.glass, 0.3));
  }
}

const ART: Record<string, AmmoArt> = {
  /**
   * Nose-right, because that is the way physics fires it. The old vector rocket was
   * authored nose-up and rotated at draw time, which is one more thing to get wrong.
   */
  rocket: {
    grid: [48, 14], origin: [27, 7], bodyW: 37, frames: 3, fps: 24,
    draw: (p) => {
      const body = ramp(C.rocketBody, -0.3, 0.35);
      // Fins first, so the airframe covers their roots.
      p.tri(17, 3, 6, 0, 6, 5, RAMPS.steel[0]);
      p.tri(17, 11, 6, 14, 6, 9, RAMPS.steel[0]);
      p.tube(5, 4, 6, 7, "gunmetal");           // motor bell
      p.tube(9, 2, 26, 11, body);               // airframe
      p.tube(29, 2, 3, 11, ramp("#2f3846"));    // payload band
      p.cone(35, 7, 11, 11, 1, ramp(C.rocketNose, -0.35, 0.4));
      p.rect(13, 4, 2, 7, C.rocketNose);        // stripe
      rivet(p, 20, 4);
      rivet(p, 20, 9);
    },
    // Pilot flame. Emissive, so it is drawn past the ink instead of inside it.
    glow: (p, f) => {
      const len = [5, 3, 4][f];
      for (let i = 0; i < len; i++) {
        const h = Math.max(1, 9 - i * 2);
        const c = i < 1 ? "#fff2c2" : i < 3 ? "#ffb03a" : "#ff6a1e";
        for (let j = 0; j < h; j++) p.soft(4 - i, 7 - (h >> 1) + j, c);
      }
    },
  },

  /** Two and a half tonnes of pre-owned sedan, in profile. */
  car: {
    grid: [136, 56], origin: [68, 28], bodyW: 134,
    draw: (p) => {
      const body = ramp(C.car);
      const roof = ramp(shadeHex(C.car, -0.12));
      // Wheels go down first: the body drawn over them cuts the arches for free.
      for (const wx of [34, 104]) {
        p.ball(wx, 45, 10, ramp("#1b1e26", -0.4, 0.55));
        p.ball(wx, 45, 4.6, ramp("#8d95a3"));
        p.disc(wx, 45, 1.8, "#4a515c");
      }
      // Greenhouse: two raked pillars and a roof between them.
      p.tri(28, 26, 45, 6, 45, 26, roof[1]);
      p.rect(45, 6, 55, 20, roof[1]);
      p.tri(100, 6, 113, 26, 100, 26, roof[1]);
      p.row(45, 6, 55, roof[2]);
      p.tube(3, 26, 131, 18, body);             // lower body
      p.row(6, 29, 124, shadeHex(C.car, 0.4));  // shoulder line
      pane(p, 33, 10, 30, 15);                  // rear glass
      pane(p, 69, 10, 34, 15);                  // windscreen
      p.col(66, 27, 16, shadeHex(C.car, -0.5)); // door shut
      p.rect(64, 32, 5, 2, RAMPS.steel[2]);     // handle
      // Bumpers, then lamps with their own bloom.
      p.tube(1, 34, 4, 8, "steel");
      p.tube(131, 34, 4, 8, "steel");
      p.ellipse(129, 32, 3, 4, "#fff3cf");
      p.ellipse(129, 32, 1.6, 2.4, "#ffffff");
      p.ellipse(6, 32, 2.6, 4, "#ff6b5a");
      // Sill shadow, so the car sits on the road rather than floating over it.
      p.row(8, 43, 120, shadeHex(C.car, -0.55));
    },
    glow: (p) => {
      for (let y = 26; y < 40; y++) for (let x = 133; x < 136; x++) p.soft(x, y, "#ffe9a855");
    },
  },

  /**
   * Eleven metres of narrow-body airliner, and the biggest sprite in the game.
   *
   * The fuselage is built column by column off a silhouette function rather than out of
   * rectangles and cones. At this length a straight-line taper reads as a chamfered
   * brick — the whole reason a jet looks like a jet is that the nose and the tail cone
   * are *curves*, and three hundred pixels is more than enough to show that.
   */
  plane: {
    grid: [352, 180], origin: [176, 88], bodyW: 352,
    draw: (p) => {
      const body = ramp(C.plane, -0.24, 0.28);
      const wing = ramp(shadeHex(C.plane, -0.2), -0.3, 0.28);
      // Half-height and centreline of the fuselage at each station along its length.
      const hull = (x: number): [number, number] => {
        if (x >= 296) {                              // nose: elliptical, drooping
          const f = (x - 296) / 56;
          return [41.5 * Math.sqrt(Math.max(0, 1 - f * f * 0.975)), 88 + f * f * 5];
        }
        if (x <= 64) {                               // tail: underside sweeps up
          const g = (64 - x) / 64;
          return [41.5 - 30 * g * g, 88 + 22 * g * g];
        }
        return [41.5, 88];
      };
      // Wing and stabiliser first: the fuselage laid over them hides the roots, which
      // is what makes them look attached instead of stuck on.
      p.quad([[256, 118], [128, 178], [66, 178], [196, 126]], wing[1]);
      p.quad([[256, 118], [246, 124], [190, 130], [196, 126]], wing[0]);
      p.quad([[74, 116], [102, 122], [58, 150], [20, 150]], wing[1]);
      p.tube(168, 134, 52, 22, "steel", 3);          // engine pod
      p.rect(216, 136, 4, 18, RAMPS.gunmetal[0]);    // intake shadow
      p.rect(168, 138, 3, 14, RAMPS.steel[2]);
      p.quad([[110, 52], [56, 6], [30, 6], [16, 52]], C.livery);   // tail fin
      p.quad([[96, 50], [58, 16], [42, 16], [34, 50]], shadeHex(C.livery, 0.25));
      for (let x = 0; x < 352; x++) {                 // the airframe itself
        const [hh, cy] = hull(x);
        if (hh < 1) continue;
        const top = Math.round(cy - hh), bot = Math.round(cy + hh);
        for (let y = top; y <= bot; y++) p.set(x, y, body[1]);
        const b = Math.max(1, Math.round(hh * 0.22));
        for (let i = 0; i < b; i++) p.set(x, top + i, body[2]);
        for (let i = 0; i < b + 2; i++) p.set(x, bot - i, body[0]);
      }
      // Livery: one stripe down the whole length, clipped to whatever is under it.
      decal(p, 0, 104, 352, 9, C.livery);
      decal(p, 0, 113, 352, 2, shadeHex(C.livery, -0.35));
      // Cabin windows, most of them dark. The scattered lit ones are what stop a row
      // of identical dots reading as perforations.
      for (let i = 0; i < 24; i++) {
        const x = 62 + i * 11;
        if (p.get(x, 76) === null || p.get(x + 3, 82) === null) continue;
        const lit = i === 3 || i === 8 || i === 9 || i === 17 || i === 22;
        p.rect(x, 78, 3, 4, lit ? "#ffd98f" : "#28303d");
      }
      p.quad([[316, 74], [340, 84], [332, 94], [312, 88]], "#26303f");  // flight deck
      p.rect(314, 72, 18, 2, shadeHex("#26303f", 0.5));
      p.rect(96, 62, 2, 26, shadeHex(C.plane, -0.35));   // door seams
      p.rect(274, 62, 2, 26, shadeHex(C.plane, -0.35));
      decal(p, 292, 122, 26, 3, RAMPS.gunmetal[0]);      // gear door
      decal(p, 150, 124, 30, 3, RAMPS.gunmetal[0]);
    },
  },

  /** Top-heavy on purpose: flat face, horn to the right, splayed base. */
  anvil: {
    grid: [32, 24], origin: [16, 12], bodyW: 32,
    draw: (p) => {
      const s = ramp(C.anvil, -0.45, 0.4);
      p.cone(25, 6, 7, 7, 2, s);                // horn
      p.tube(1, 3, 25, 6, s);                   // face
      p.pillar(9, 9, 13, 7, s);                 // waist
      p.tube(5, 16, 21, 4, s);                  // foot
      p.tube(2, 19, 27, 4, s);
      p.row(3, 3, 20, shadeHex(C.anvil, 0.7));  // struck-bright top face
      p.rect(7, 4, 2, 2, shadeHex(C.anvil, -0.7)); // hardy hole
      rivet(p, 6, 20);
      rivet(p, 24, 20);
    },
  },

  /** A concert grand, lid propped. The only payload with a keyboard on it. */
  piano: {
    grid: [78, 72], origin: [39, 48], bodyW: 77,
    draw: (p) => {
      const s = ramp(C.piano, -0.5, 0.4);
      p.quad([[6, 27], [21, 5], [65, 9], [73, 27]], s[1]);   // propped lid
      p.stroke(21, 5, 65, 9, s[2], 1);
      p.stroke(6, 27, 21, 5, s[2], 1);
      p.stroke(24, 9, 26, 27, RAMPS.brass[1], 2);            // prop stick
      p.tube(4, 27, 70, 23, s);                              // case
      p.rect(8, 39, 62, 2, s[0]);                            // fallboard
      p.rect(8, 41, 62, 8, C.ivory);                         // keys
      p.row(8, 41, 62, "#ffffff");
      p.row(8, 48, 62, shadeHex(C.ivory, -0.3));
      for (let i = 1; i < 22; i++) {
        if (i % 7 === 3 || i % 7 === 0) continue;
        p.rect(8 + i * 3 - 1, 41, 2, 5, INK);
      }
      for (const lx of [10, 58]) {                           // legs
        p.pillar(lx, 50, 6, 17, s);
        p.rect(lx - 1, 66, 8, 3, s[0]);
      }
      p.pillar(35, 52, 4, 12, s);                            // pedal lyre
      p.rect(33, 63, 8, 2, RAMPS.brass[1]);
      rivet(p, 12, 30, s);
      rivet(p, 66, 30, s);
    },
  },

  /** An appliance, not a weapon. Reads as one at any size. */
  fridge: {
    grid: [32, 64], origin: [16, 32], bodyW: 30,
    draw: (p) => {
      const s = ramp(C.fridge, -0.28, 0.35);
      p.pillar(1, 1, 30, 62, s);
      p.row(1, 1, 30, "#ffffff");
      p.row(1, 62, 30, shadeHex(C.fridge, -0.4));
      p.row(1, 17, 30, shadeHex(C.fridge, -0.32));   // freezer door seam
      p.rect(24, 5, 2, 9, RAMPS.steel[1]);           // handles
      p.rect(24, 22, 2, 24, RAMPS.steel[1]);
      p.col(24, 5, 9, RAMPS.steel[2]);
      p.col(24, 22, 24, RAMPS.steel[2]);
      p.rect(2, 6, 1, 4, shadeHex(C.fridge, -0.45)); // hinges
      p.rect(2, 24, 1, 4, shadeHex(C.fridge, -0.45));
      p.rect(6, 28, 4, 2, "#e8433a");                // magnets, because of course
      p.rect(13, 36, 3, 2, C.hazard);
      p.rect(7, 44, 3, 2, C.water);
      for (let i = 0; i < 3; i++) p.row(4, 56 + i * 2, 24, shadeHex(C.fridge, -0.25));
    },
  },

  /** Fourteen pounds of resin. Three fingers, one specular. */
  bowling: {
    grid: [18, 18], origin: [9, 9], bodyW: 18,
    draw: (p) => {
      p.ball(9, 9, 9, ramp(C.bowling, -0.55, 0.75));
      // Each hole gets a lit upper lip. Without it a dark hole in a near-black ball is
      // invisible, and the round loses the one detail that says "bowling".
      for (const [hx, hy] of [[11.5, 5.5], [13.5, 9], [11.5, 12.5]] as const) {
        p.disc(hx, hy, 1.9, shadeHex(C.bowling, 0.55));
        p.disc(hx, hy + 0.4, 1.5, "#0b0a14");
      }
      p.set(5, 4, "#ffffff");
      p.set(6, 4, shadeHex(C.bowling, 0.85));
      p.set(5, 5, shadeHex(C.bowling, 0.85));
    },
  },

  /** Meridian stripes that converge at the poles, or it reads as a striped disc. */
  watermelon: {
    grid: [20, 20], origin: [10, 10], bodyW: 20,
    draw: (p) => {
      p.ball(10, 10, 10, ramp(C.melon, -0.4, 0.45));
      const dark = shadeHex(C.melon, -0.35);
      for (let y = 0; y < 20; y++) {
        const t = (y + 0.5 - 10) / 10;
        const s = Math.sqrt(Math.max(0, 1 - t * t));
        for (const k of [-2, -1, 0, 1, 2]) {
          const x = Math.round(9.5 + k * 3.3 * s);
          for (let i = 0; i < 2; i++) if (p.get(x + i, y) !== null) p.set(x + i, y, dark);
        }
      }
      p.rect(9, 0, 2, 2, RAMPS.wood[1]);   // stem
    },
  },

  /** Flat, not spherical — a blade lit on its rim, with twelve teeth. */
  sawblade: {
    grid: [28, 28], origin: [14, 14], bodyW: 27,
    draw: (p) => {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const b = a + 0.34;
        p.tri(
          14 + Math.cos(a) * 13.6, 14 + Math.sin(a) * 13.6,
          14 + Math.cos(a - 0.2) * 9, 14 + Math.sin(a - 0.2) * 9,
          14 + Math.cos(b) * 9.4, 14 + Math.sin(b) * 9.4,
          RAMPS.steel[1],
        );
      }
      p.disc(14, 14, 10, RAMPS.steel[1]);
      p.arc(14, 14, 9.2, -2.95, -1.2, 2, RAMPS.steel[2]);   // lit upper-left rim
      p.arc(14, 14, 9.2, 0.2, 1.9, 2, RAMPS.steel[0]);      // shadowed lower-right
      for (let i = 0; i < 3; i++) {                          // lightening slots
        const a = (i / 3) * TAU + 0.5;
        p.disc(14 + Math.cos(a) * 6.4, 14 + Math.sin(a) * 6.4, 1.6, RAMPS.steel[0]);
      }
      p.disc(14, 14, 4, "#e8433a");
      p.arc(14, 14, 3.4, -2.9, -1.3, 1, shadeHex("#e8433a", 0.4));
      p.disc(14, 14, 1.5, "#2f3846");
    },
  },

  /** The only payload that emits light. Two static frames, so the screen lives. */
  tv: {
    grid: [38, 40], origin: [19, 26], bodyW: 35, frames: 2, fps: 9,
    draw: (p, f) => {
      p.stroke(17, 14, 7, 1, RAMPS.steel[2], 1);            // rabbit ears
      p.stroke(21, 14, 32, 3, RAMPS.steel[2], 1);
      p.set(7, 0, RAMPS.steel[2]);
      p.set(32, 2, RAMPS.steel[2]);
      p.tube(1, 13, 36, 26, ramp(C.tvCase, -0.4, 0.35));    // cabinet
      p.rect(3, 16, 26, 20, shadeHex(C.tvCase, -0.55));     // bezel
      p.rect(4, 17, 24, 18, C.screen);
      // Rolling static bands, plus a corner glare so the glass reads as glass.
      for (let i = 0; i < 5; i++) {
        p.rect(4, 17 + ((i * 4 + f * 2) % 18), 24, 2, shadeHex(C.screen, 0.5));
      }
      p.tri(5, 18, 13, 18, 5, 26, shadeHex(C.screen, 0.75));
      p.disc(33, 20, 2.2, RAMPS.plastic[2]);                // dials
      p.disc(33, 26, 2.2, RAMPS.plastic[2]);
      p.set(33, 19, "#ffffff");
      for (let y = 0; y < 4; y++) {                          // speaker grille
        for (let x = 0; x < 3; x++) p.set(31 + x * 2, 30 + y * 2, RAMPS.plastic[0]);
      }
      rivet(p, 3, 14);
      rivet(p, 34, 14);
    },
  },

  /** Stubby, finned, hazard-striped, and blinking. Short because it is not about range. */
  nuke: {
    grid: [56, 24], origin: [27, 12], bodyW: 51, frames: 2, fps: 6,
    draw: (p, f) => {
      const s = ramp(C.nuke, -0.4, 0.35);
      p.tri(17, 4, 3, 0, 3, 6, RAMPS.steel[0]);     // fins
      p.tri(17, 20, 3, 24, 3, 18, RAMPS.steel[0]);
      p.tube(2, 2, 40, 20, s);
      p.cone(42, 12, 12, 20, 4, s);
      for (const x of [12, 20, 28, 36]) p.tube(x, 2, 3, 20, ramp(C.hazard, -0.4, 0.3));
      p.tube(40, 2, 2, 20, ramp(shadeHex(C.nuke, -0.35)));  // warhead collar
      // The "oh no" light, on a slow blink.
      p.disc(8, 12, 3, f ? "#ff3b2e" : "#5c1f1a");
      p.arc(8, 12, 3.4, -3.2, 3.2, 1.2, shadeHex(C.nuke, -0.6));
      if (f) p.set(7, 11, "#ffd0c8");
      rivet(p, 17, 4);
      rivet(p, 17, 18);
    },
  },

  /**
   * The one payload with no surface. A black disc, three arcs of infalling matter and
   * a banded halo — all of it drawn past the ink, because light does not get outlined.
   */
  blackhole: {
    grid: [96, 96], origin: [48, 48], bodyW: 35, frames: 6, fps: 14,
    draw: (p) => {
      p.disc(48, 48, 13, "#08060f");
      p.arc(48, 48, 13.6, -3.2, 3.2, 1.4, "#2a1a52");
    },
    glow: (p, f) => {
      const spin = (f / 6) * TAU;
      for (let i = 0; i < 3; i++) {
        const r = 19 + i * 7;
        const a0 = spin * (1 + i * 0.35) + i * 2.1;
        p.arc(48, 48, r, a0, a0 + 2.3, 3, i === 1 ? "#c9a8ff" : C.void);
        p.arc(48, 48, r, a0 + 3.2, a0 + 4.6, 2, shadeHex(C.void, -0.25));
      }
      // Banded halo. Quantised into five steps on purpose — a smooth falloff would be
      // the one soft gradient in a game made of hard pixels.
      const steps = ["", "18", "2c", "44", "60"];
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 96; x++) {
          const d = Math.hypot(x + 0.5 - 48, y + 0.5 - 48);
          if (d > 46 || d < 13) continue;
          const k = Math.floor((1 - d / 46) * 5);
          if (k <= 0) continue;
          p.soft(x, y, C.void + steps[Math.min(4, k)]);
        }
      }
    },
  },

  /** Red barrel. You know how this goes. */
  barrel: {
    grid: [28, 40], origin: [14, 20], bodyW: 26,
    draw: (p) => {
      const s = ramp(C.barrel, -0.45, 0.35);
      p.pillar(1, 3, 26, 34, s);
      p.ellipse(14, 4, 13, 3.4, shadeHex(C.barrel, 0.25));   // lid, seen slightly above
      p.ellipse(14, 36, 13, 3, shadeHex(C.barrel, -0.45));
      p.rect(1, 11, 26, 2, shadeHex(C.barrel, -0.55));       // hoops
      p.rect(1, 28, 26, 2, shadeHex(C.barrel, -0.55));
      p.pillar(1, 17, 26, 7, ramp(C.hazard, -0.4, 0.3));     // hazard band
      p.disc(14, 20, 3, "#1b1e26");
      p.disc(14, 20, 1.4, C.barrel);
      p.disc(8, 4, 2.4, RAMPS.rust[0]);                      // bung
      p.set(20, 24, RAMPS.rust[1]);                          // rust specks
      p.set(6, 32, RAMPS.rust[1]);
      p.set(7, 33, RAMPS.rust[0]);
    },
  },

  /**
   * The first round in the game, and the only one that is dangerous *after* it lands.
   * Drawn with a lit fuse so a live grenade on the ground is legible at a glance while
   * the player decides whether to be somewhere else.
   */
  grenade: {
    grid: [16, 24], origin: [7, 16], bodyW: 13, frames: 3, fps: 18,
    draw: (p) => {
      p.rect(4, 6, 6, 3, RAMPS.gunmetal[1]);      // fuse assembly
      p.row(4, 6, 6, RAMPS.gunmetal[2]);
      p.rect(9, 3, 2, 8, RAMPS.steel[1]);         // spoon
      p.col(9, 3, 8, RAMPS.steel[2]);
      p.arc(12, 4, 2.2, -3.2, 3.2, 1, RAMPS.brass[2]);   // pin ring
      p.ball(7, 16, 6.7, ramp(C.olive, -0.45, 0.4));
      // Fragmentation grooves, clipped to the shell.
      for (const y of [13, 18]) for (let x = 0; x < 16; x++) {
        if (p.get(x, y) !== null) p.set(x, y, shadeHex(C.olive, -0.5));
      }
      for (const x of [4, 10]) for (let y = 9; y < 24; y++) {
        if (p.get(x, y) !== null) p.set(x, y, shadeHex(C.olive, -0.5));
      }
    },
    glow: (p, f) => {
      const r = [1.6, 2.6, 1.1][f];
      const hot = f === 1 ? "#fff0b8" : "#ff8a2c";
      p.disc(7, 2, r, hot);
      p.soft(4, 1, "#ffb14a");
      if (f !== 2) p.soft(11, 0, "#ffd88a");
    },
  },

  // ---------------------------------------------------------------------------
  // Icon-only glyphs. The creature rounds are ragdolls in the world (see the file
  // header) and the two continuous rounds have no body at all, but the ammo wheel
  // still has to show every round in one style.
  // ---------------------------------------------------------------------------

  chicken: {
    grid: [28, 26], origin: [14, 13], bodyW: 28,
    draw: (p) => {
      const s = ramp(C.chicken, -0.25, 0.6);
      p.tri(7, 10, 0, 3, 8, 16, s[1]);                 // tail
      p.stroke(12, 20, 11, 25, "#f0a63c", 2);          // legs
      p.stroke(16, 20, 17, 25, "#f0a63c", 2);
      p.set(9, 25, "#f0a63c"); p.set(19, 25, "#f0a63c");
      p.rect(16, 8, 5, 6, s[1]);                       // neck
      p.ball(12, 15, 7.5, s);                          // body
      p.ball(20, 7, 4.6, s);                           // head
      p.ellipse(11, 16, 4.5, 3, shadeHex(C.chicken, -0.16));
      p.arc(11, 16, 4, 0.2, 2.6, 1, shadeHex(C.chicken, -0.3));
      p.tri(24, 5, 28, 8, 24, 10, "#f0a63c");          // beak
      p.rect(19, 1, 2, 2, "#e0402f");                  // comb
      p.rect(21, 2, 2, 2, "#e0402f");
      p.rect(21, 10, 2, 3, "#e0402f");                 // wattle
      p.set(21, 6, INK);
    },
  },

  /**
   * The whole animal, not a portrait. A head close-up at this size is a grey blob with
   * a pipe on it; a body with four legs under it and a trunk hanging off the front is
   * an elephant from across the room.
   */
  elephant: {
    grid: [38, 30], origin: [19, 15], bodyW: 38,
    draw: (p) => {
      const s = ramp(C.elephant, -0.32, 0.3);
      p.stroke(3, 11, 0, 7, s[0], 1);                  // tail
      // Far legs in the shadow tone, near legs in the body tone: four grey posts in a
      // row are a crate, two pairs at two depths are an animal standing on them.
      for (const [lx, far] of [[5, 1], [11, 0], [18, 1], [24, 0]] as const) {
        const t = far ? ramp(shadeHex(C.elephant, -0.28)) : s;
        p.pillar(lx, 17, 4, 11, t);
        p.rect(lx - 1, 27, 6, 2, t[0]);                // feet
      }
      blob(p, 14, 12, 11, 8, s);                       // body
      blob(p, 26, 13, 7, 7, s);                        // head
      p.ellipse(23, 12, 4, 6.5, shadeHex(C.elephant, -0.2));  // ear
      p.arc(23, 12, 3.6, 1.1, 4.5, 1, shadeHex(C.elephant, -0.5));
      p.stroke(31, 16, 33, 22, s[1], 4);               // trunk, hanging and curling
      p.stroke(33, 22, 30, 27, s[1], 3);
      p.stroke(30, 16, 32, 21, s[2], 1);
      p.stroke(29, 19, 35, 17, "#f0ece0", 2);          // tusk
      p.set(28, 11, INK);
      p.set(28, 12, INK);
    },
  },

  /**
   * Thin limbs and a flailing pose. Thick limbs at right angles read as a gingerbread
   * man; what makes this one a *stickman* is that it is mid-tumble, which is also the
   * only state the round is ever in.
   */
  stickman: {
    grid: [24, 30], origin: [12, 15], bodyW: 24,
    draw: (p) => {
      const s = ramp(C.stick, -0.45, 0.35);
      p.stroke(12, 10, 11, 19, s[1], 3);               // torso
      p.stroke(12, 12, 3, 7, s[1], 2);                 // arms, up and back
      p.stroke(12, 12, 21, 6, s[1], 2);
      p.stroke(11, 19, 4, 27, s[1], 2);                // legs, splayed
      p.stroke(11, 19, 18, 28, s[1], 2);
      p.set(3, 6, s[1]); p.set(21, 5, s[1]);
      p.ball(12, 5, 4, s);
    },
  },

  water: {
    grid: [30, 24], origin: [15, 12], bodyW: 30,
    draw: (p) => {
      p.tube(0, 9, 6, 6, "steel");                     // nozzle
      p.arc(15, 27, 18, -2.65, -1.15, 4, C.water);     // the jet
      p.arc(15, 27, 19.6, -2.6, -1.3, 1.4, shadeHex(C.water, 0.45));
      p.ball(25, 6, 2.6, ramp(C.water, -0.35, 0.5));   // spray
      p.ball(27, 13, 1.8, ramp(C.water, -0.35, 0.5));
      p.ball(20, 2, 1.5, ramp(C.water, -0.35, 0.5));
    },
  },

  /**
   * A bunch of five on a steel clamp, authored pointing *right*.
   *
   * The round carries `steer`, so the body turns to face its own velocity and the
   * clamp leads while the balloons stream out behind it. That is the whole reason this
   * is a horizontal sprite rather than the vertical bunch you would draw first: a
   * bouquet flying sideways looks like a mistake, a bunch being dragged by its weight
   * looks like it is going somewhere.
   *
   * The balloons themselves come from `render/balloonart.ts`, which is also what the
   * buoyancy sim draws once they have been tied to something — so the fistful you fire
   * and the balloons you end up looking at are the same shape at the same pixel size.
   */
  balloon: {
    grid: [48, 40], origin: [40, 20], bodyW: 13, frames: 6, fps: 9,
    draw: (p, f) => {
      const CX = 38, CY = 20;
      const bunch = [
        { x: 11, y: 3, rx: 7, h: 18, c: 0 },
        { x: 24, y: 1, rx: 6, h: 15, c: 1 },
        { x: 6, y: 18, rx: 6.5, h: 17, c: 2 },
        { x: 19, y: 17, rx: 7, h: 18, c: 3 },
        { x: 29, y: 12, rx: 5.5, h: 14, c: 4 },
      ];
      // Each balloon jostles on its own phase. In step they read as one object on a
      // spring; out of step they read as five things tied together, which is the point.
      const wob = bunch.map((_, i) => {
        const a = (f / 6) * TAU + i * 1.27;
        return { dx: Math.round(Math.sin(a) * 1.2), dy: Math.round(Math.cos(a * 0.8) * 1.4) };
      });

      // Strings first: the balloons paint over their own knots, so a string can never
      // be seen crossing the latex it is tied to.
      for (let i = 0; i < bunch.length; i++) {
        const b = bunch[i];
        const kx = b.x + wob[i].dx, ky = b.y + b.h + wob[i].dy;
        const mx = (kx + CX) / 2, my = (ky + CY) / 2 + 2.5;
        p.stroke(kx, ky, mx, my, INK);
        p.stroke(mx, my, CX - 4, CY, INK);
      }

      for (let i = 0; i < bunch.length; i++) {
        const b = bunch[i];
        paintBalloon(p, b.x + wob[i].dx, b.y + wob[i].dy, b.rx, b.h, partyRamp(b.c));
      }

      // The clamp. Blunt, heavy and obviously metal — it is the half of this round that
      // has to survive hitting a wall, and at thirteen pixels the contrast against five
      // soft shapes is what makes the silhouette readable at all.
      p.tube(CX - 7, CY - 3, 11, 7, "steel");
      p.cone(CX + 4, CY, 5, 7, 3, RAMPS.gunmetal, 1);
      p.rect(CX - 2, CY - 5, 3, 3, RAMPS.brass[1]);
      p.set(CX - 2, CY - 5, RAMPS.brass[2]);
      rivet(p, CX - 5, CY - 1);
      rivet(p, CX + 1, CY - 1);
    },
  },

  /**
   * Made of light, so it gets no ink at all — the HUD's own rim carries it instead.
   *
   * Built as nested tongues off one silhouette curve: blunt at the nozzle, fattest a
   * third of the way along, drawn to a point at the tip, and licking on a wave. Three
   * concentric triangles is what a flame looks like to a spreadsheet, not to an eye.
   */
  flamethrower: {
    grid: [30, 22], origin: [15, 11], bodyW: 30, noOutline: true, frames: 3, fps: 12,
    draw: (p, f) => {
      const ph = (f / 3) * TAU;
      const tongue = (len: number, amp: number, c: string) => {
        for (let i = 0; i < len; i++) {
          const t = i / (len - 1);
          const hh = amp * Math.pow(1 - t, 0.75) *
            (0.42 + 0.58 * Math.sin(Math.min(1, t * 3.4) * (Math.PI / 2)));
          const cy = 11 + Math.sin(t * 3.6 + ph) * (1.5 + t * 1.4);
          for (let j = -Math.round(hh); j <= Math.round(hh); j++) p.set(1 + i, cy + j, c);
        }
      };
      tongue(29, 9, "#e8431f");
      tongue(21, 5.6, "#ff9b2f");
      tongue(12, 2.8, "#ffe9a8");
    },
  },
};

/**
 * Rasterised payloads: one array of frames per id, built on first use and never
 * rebuilt. An array rather than a `${id}#${frame}` map because this is called once per
 * projectile per frame and a key string per call is an allocation for nothing.
 */
const cache = new Map<string, (HTMLCanvasElement | undefined)[]>();
/** Frame-0 ink bounds per id, for fitting a sprite into a square icon slot. */
const boundsCache = new Map<string, { x: number; y: number; w: number; h: number }>();

export const hasAmmoArt = (id: string) => id in ART;

function frameOf(art: AmmoArt, t: number) {
  if (!art.frames || art.frames < 2) return 0;
  return Math.floor(t * (art.fps ?? 12)) % art.frames;
}

function sprite(id: string, f: number): HTMLCanvasElement | null {
  const art = ART[id];
  if (!art) return null;
  let frames = cache.get(id);
  if (!frames) cache.set(id, (frames = new Array(art.frames ?? 1)));
  const hit = frames[f];
  if (hit) return hit;
  const p = new Px(art.grid[0], art.grid[1]);
  art.draw(p, f);
  if (!art.noOutline) p.outline();
  art.glow?.(p, f);
  if (f === 0) boundsCache.set(id, p.bounds());
  return (frames[f] = p.toCanvas());
}

/** Frame-0 ink bounds, baking frame 0 if the sprite has only been seen mid-animation. */
function boundsOf(id: string) {
  let b = boundsCache.get(id);
  if (!b) {
    sprite(id, 0);
    b = boundsCache.get(id);
  }
  return b;
}

/**
 * Draws a payload in the world, its collider centred on the local origin.
 *
 * `w` is the collider width in metres; the sprite scales off it so art and physics
 * cannot drift apart, and `h` is ignored on purpose — pixels stay square (rule 6).
 */
export function drawAmmoProp(ctx: Ctx, id: string, w: number, t: number) {
  const art = ART[id];
  if (!art) return;
  const s = sprite(id, frameOf(art, t));
  if (!s) return;
  blitPixels(ctx, s, art.origin[0], art.origin[1], w / art.bodyW);
}

/**
 * Draws a payload centred in a `size`-wide box, for the ammo wheel and the HUD.
 *
 * Fitted to the sprite's ink bounds rather than to its grid, so the black hole's wide
 * halo and the rocket's exhaust do not shrink the thing you are meant to recognise.
 */
export function drawAmmoIcon(ctx: Ctx, id: string, size: number, t: number) {
  const art = ART[id];
  if (!art) return;
  const s = sprite(id, frameOf(art, t));
  if (!s) return;
  const b = boundsOf(id) ?? { x: 0, y: 0, w: s.width, h: s.height };
  const k = size / Math.max(b.w, b.h);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(1, -1);
  ctx.drawImage(s, b.x, b.y, b.w, b.h, (-b.w * k) / 2, (-b.h * k) / 2, b.w * k, b.h * k);
  ctx.restore();
}

/** The raw sprite, for contact sheets and other tooling. */
export function ammoSprite(id: string, t = 0): HTMLCanvasElement | null {
  const art = ART[id];
  return art ? sprite(id, frameOf(art, t)) : null;
}

export { ART_PPM };
