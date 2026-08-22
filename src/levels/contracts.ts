import { v } from "../core/math";
import type { GameCtx } from "../core/types";
import { combat } from "../entities/enemy";
import { Pickup } from "../entities/pickup";
import { STORY_ASSETS } from "../ui/story";
import { progress } from "../ui/progress";
import type { Builder } from "./builder";
import type { LevelDef, LevelInfo } from "./types";

/**
 * The contracts — the story campaign.
 *
 * A different shape to the old `campaign.ts` missions, which are "clear the map with a
 * loadout". These are jobs handed out by something that does not explain itself, and
 * each one gives the player exactly one new capability at the end of it. Contract one
 * gives the jetpack, which is why contract one is the level that takes it away.
 */

const PACK = "GandalfHardcore FREE Platformer Assets";
const FLOOR = `${PACK}/Floor Tiles1.png`;
const HOUSE = `${PACK}/House Tiles.png`;
const DECOR = `${PACK}/Decor.png`;
const OTHER = `${PACK}/Other Tiles1.png`;
const FURNACE = `${PACK}/Pixel Art Furnace and Sawmill.png`;
const BG = `${PACK}/GandalfHardcore Background layers/Normal BG`;

const CONTRACT1_ASSETS: readonly string[] = [
  ...STORY_ASSETS,
  FLOOR, HOUSE, DECOR, OTHER, FURNACE,
  `${PACK}/Tree1.png`, `${PACK}/Tree3.png`, `${PACK}/Tree4.png`,
  `${PACK}/Birch1.png`, `${PACK}/Birch2.png`, `${PACK}/Large Pine Tree.png`,
  `${PACK}/Tall Grass.png`, `${PACK}/Weeping Willow1.png`,
  `${BG}/Background Castle .png`,
];

// ---------------------------------------------------------------------------
// Contract I — Tilbury Row
// ---------------------------------------------------------------------------

/**
 * The first job, and the tutorial for a weapon that is deliberately awkward.
 *
 * Three constraints shape every metre of this map, and they are all consequences of the
 * story rather than decoration on top of it:
 *
 * **No jetpack.** So the level is flat. Every fight happens on one plane, every cover
 * position is reachable on foot, and there is nothing above two metres that matters.
 * The one raised firing step is jumpable. A player who never presses the jump key
 * misses nothing.
 *
 * **Grenades only.** A ~22m lob against 15m rifles, so the player out-ranges the map by
 * about seven metres — but only if they stand still long enough to aim, which is
 * exactly the tension the whole contract runs on. Every engagement is built around one
 * piece of cover at roughly grenade range from the next group.
 *
 * **A two-second fuse.** So the map is full of things a grenade can be rolled *behind*:
 * doorways, barricades, the gap under the mill. Direct hits work; the interesting
 * shots are the ones that do not need to be direct.
 *
 * The difficulty runs in four beats — a lone sentry, a house, a barricade with powder,
 * then the mill — and the enemy's reach grows by about three metres per beat while
 * yours stays fixed.
 */
function buildTilbury(_game: GameCtx, b: Builder): LevelInfo {
  const G0 = 0;

  // Short, inaccurate, and slow to notice you. The first contract is not where the
  // player learns that stickmen shoot straight.
  b.defaultCombat = combat({
    behavior: "sentry", gun: "smg", range: 15, spread: 0.22, interval: 0.8, reaction: 1.1,
  });

  const floor = b.sheet(FLOOR);
  const house = b.sheet(HOUSE);
  const decor = b.sheet(DECOR);
  const other = b.sheet(OTHER);
  const furnace = b.sheet(FURNACE);

  b.skin(b.ground(55, G0 - 3, 240, 6), { sheet: floor, tx: 0, ty: 0 });

  // ------------------------------------------------------------- scenery helpers
  const oak = (path: string, x: number, s = 1, z = 2) =>
    b.prop({ sheet: b.sheet(path), tx: 0, ty: 0, tw: 8, th: 6.5, x, y: G0, scale: s, z, sway: 0.012 });
  const birch = (path: string, x: number, s = 1) =>
    b.prop({ sheet: b.sheet(path), tx: 0, ty: 0, tw: 2.5, th: 3.5, x, y: G0, scale: s, z: 2, sway: 0.02 });
  const grass = (x: number, z = 12) =>
    b.prop({ sheet: b.sheet(`${PACK}/Tall Grass.png`), tx: 0, ty: 0, tw: 3, th: 1, x, y: G0, z });
  const bush = (x: number, cell: number) =>
    b.prop({ sheet: decor, tx: cell, ty: 4, tw: 1, th: 1, x, y: G0, z: 12 });
  const rock = (x: number) => b.prop({ sheet: decor, tx: 1, ty: 5, tw: 1, th: 1, x, y: G0, z: 2 });
  /** A crate or barrel that can be shot. `mat` decides whether it is cover or a bomb. */
  const crate = (x: number, y: number, cell: number, mat: "wood" | "explosive") =>
    b.spriteBlock({ sheet: decor, tx: cell, ty: 0, x, baseY: y, material: mat });

  // ------------------------------------------------------------- 1. the approach
  // Nothing can reach the spawn. The player gets to throw two or three grenades at a
  // stationary target before anything shoots back, which is the entire grenade lesson:
  // it arcs, it bounces, and it goes off two seconds late.
  oak(`${PACK}/Tree1.png`, -32, 1.05);
  birch(`${PACK}/Birch1.png`, -27, 1.1);
  grass(-30);
  bush(-24, 0);

  crate(-20, G0, 0, "wood");
  crate(-20, G0 + 1, 0, "wood");
  crate(-18.7, G0, 2, "wood");

  // One sentry, alone, sixteen metres out — inside a grenade's reach and just outside
  // his own. He is the tutorial, and he is meant to be killed from safety.
  b.enemy("grunt", -6, G0, -1);
  b.prop({ sheet: decor, tx: 9, ty: 6, tw: 1, th: 2, x: -10, y: G0, z: 2 });

  // ------------------------------------------------------------- 2. the first house
  // A cottage with the crew inside it. The doorway is the shot: a grenade rolled
  // through the gap kills both without touching the frontage.
  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 4, baseY: G0, material: "brick" });
  b.enemy("grunt", 5.5, G0, -1);
  b.enemy("grunt", 8.2, G0, -1);
  b.enemy("guard", 12.5, G0, -1, { behavior: "patrol", patrol: 5, gun: "smg", range: 17, spread: 0.18 });
  crate(11.2, G0, 2, "wood");
  bush(0.5, 1);
  grass(15);

  // ------------------------------------------------------------- 3. the barricade
  // Powder against a plank wall, with the crew standing behind both. The intended shot
  // is the barrels, and the level says so by putting them at the near end.
  for (let i = 0; i < 6; i++) {
    b.spriteBlock({
      sheet: other, tx: i % 4, ty: 6, x: 22 + i * 0.98, baseY: G0 + Math.floor(i / 3),
      material: "wood", anchored: true,
    });
  }
  crate(20.5, G0, 2, "explosive");
  crate(20.5, G0 + 1, 2, "explosive");
  crate(21.6, G0, 2, "explosive");

  b.enemy("grunt", 26, G0, -1);
  b.enemy("guard", 29, G0, -1);
  b.enemy("grunt", 32, G0, -1, { behavior: "patrol", patrol: 6, gun: "smg", range: 18, spread: 0.16 });
  // The first shotgun on the map. Lethal up close, harmless at grenade range — a
  // punishment for closing the distance rather than for standing off.
  b.enemy("guard", 35, G0, -1, { behavior: "hunter", gun: "shotgun", range: 14, speed: 2.2 });
  oak(`${PACK}/Tree3.png`, 38, 1.1);
  rock(18);

  // ------------------------------------------------------------- 4. the row
  // Two cottages with a raised step between them. The step is the only high ground on
  // the map, it is one jump, and standing on it puts the far cottage in range.
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 44, baseY: G0, material: "brick" });
  b.enemy("grunt", 45.5, G0, -1);
  b.enemy("guard", 48.5, G0, -1, { gun: "rifle", range: 20, spread: 0.11, interval: 1.2 });

  b.ledge(54, G0 + 1.6, 6, 1.0);
  b.enemy("grunt", 54, G0 + 1.6, -1);
  crate(57.5, G0, 0, "wood");
  crate(57.5, G0 + 1, 0, "wood");

  b.spriteWall({ sheet: house, tx: 1, ty: 0, cols: 5, rows: 7, x: 62, baseY: G0, material: "brick" });
  b.enemy("grunt", 63.5, G0, -1);
  b.enemy("grunt", 66.5, G0, -1);
  b.enemy("guard", 69, G0, -1, { behavior: "patrol", patrol: 5, gun: "rifle", range: 21, spread: 0.12 });
  crate(71, G0, 2, "explosive");
  crate(71, G0 + 1, 2, "explosive");
  birch(`${PACK}/Birch2.png`, 74, 1.0);
  grass(60);
  bush(52, 2);

  // ------------------------------------------------------------- 5. the mill
  // The end of the row: a three-storey stack with the foreman on the roof of the lower
  // block. Powder at both feet, because the answer to a building is its foundations.
  b.spriteWall({ sheet: house, tx: 1, ty: 2, cols: 5, rows: 5, x: 84, baseY: G0, material: "concrete" });
  b.spriteWall({ sheet: house, tx: 8, ty: 0, cols: 5, rows: 7, x: 84, baseY: G0 + 5, material: "brick" });
  crate(82.4, G0, 2, "explosive");
  crate(82.4, G0 + 1, 2, "explosive");
  crate(90, G0, 2, "explosive");
  crate(90, G0 + 1, 2, "explosive");

  b.enemy("guard", 80, G0, -1, { gun: "rifle", range: 22, spread: 0.1, interval: 1.1 });
  b.enemy("grunt", 87, G0 + 5, -1);
  b.enemy("guard", 93, G0, -1, { behavior: "hunter", gun: "shotgun", range: 14, speed: 2.3 });

  // An animated furnace beside the mill, so the site reads as industrial rather than
  // residential — the pack's own six-frame loop, no new machinery.
  b.prop({ sheet: furnace, tx: 0, ty: 0, tw: 2, th: 2, x: 96, y: G0, scale: 1.1, z: 2, frames: 6, fps: 8 });

  // ------------------------------------------------------------- 6. the yard
  // Last group, and the only boss on the map. Deliberately in the open with powder
  // beside him: the player has had five minutes of practice and this is the exam.
  b.spriteWall({ sheet: decor, tx: 11, ty: 4, cols: 2, rows: 2, x: 102, baseY: G0, material: "brick" });
  b.enemy("boss", 108, G0, -1, { gun: "rifle", range: 24, spread: 0.09, interval: 1.0 });
  b.enemy("guard", 105, G0, -1);
  b.enemy("guard", 112, G0, -1, { behavior: "patrol", patrol: 6, gun: "smg", range: 19, spread: 0.15 });
  crate(110, G0, 2, "explosive");
  crate(110, G0 + 1, 2, "explosive");

  oak(`${PACK}/Weeping Willow1.png`, 118, 1.05);
  grass(115, 22);
  rock(100);

  return {
    spawn: v(-26, G0 + 1.2),
    bounds: { min: -45, max: 132 },
    enemies: b.enemies,
    groundY: G0,

    /**
     * The reward beat.
     *
     * The mission deliberately does *not* end when the last hostile drops. Ending there
     * would put the jetpack behind a results card, where it would be a line of text
     * among six other lines of text. Instead the map goes quiet, the pack drops into the
     * yard in a column of light, and the player has to walk over and pick it up — which
     * makes it the last thing that happens in the contract instead of the fourth.
     */
    onCleared(game, complete) {
      const x = 122;
      game.particles.popup(x, G0 + 4.2, "SOMETHING LANDED", "#5ec8ff", 1.2);
      game.add(new Pickup(game, {
        x, y: G0, label: "JETPACK",
        onTake() {
          // Both halves, in this order: the run gets the pack immediately, and the save
          // gets it for good. Granting only the second would make the prompt below a
          // lie for the four seconds the player can actually act on it.
          game.equipJetpack();
          progress.grantJetpack();
          game.flash(0.5, "#5ec8ff");
          game.hitstop(0.12);
          game.particles.popup(x, G0 + 3, "JETPACK ACQUIRED", "#ffd23f", 1.6);
          game.particles.popup(x, G0 + 1.8, "HOLD SPACE TO FLY", "#f4f1e8", 1.8);
          Pickup.collected();
        },
        // Four seconds of sky before the results card. The contract took the jetpack
        // away for its whole length; the payoff is being allowed to leave the ground,
        // and that has to happen while the player is still holding the controls.
        linger: 4,
        then: complete,
      }));
    },
  };
}

export const CONTRACT_1: LevelDef = {
  id: "contract1",
  kind: "campaign",
  name: "Tilbury Row",
  tagline: "Six houses. Nobody told the occupants.",
  briefing: "Bring down the row. You have grenades and legs — nothing else, yet.",
  theme: "grove",
  gravity: -26,
  tags: ["CONTRACT I", "GRENADES ONLY", "NO JETPACK"],
  accent: "#8fae56",
  order: 1,
  allowGod: false,
  lives: 3,
  loadout: ["grenade"],
  noJetpack: true,
  intro: "awakening",
  assets: CONTRACT1_ASSETS,
  build: buildTilbury,
};

/** The story campaign, in order. One entry for now; the shape is here for the rest. */
export const CONTRACTS: readonly LevelDef[] = [CONTRACT_1];
