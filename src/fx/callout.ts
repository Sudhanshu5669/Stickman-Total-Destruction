import type { V } from "../core/math";
import type { OwnerKind } from "../core/physics";
import type { Particles } from "./particles";

/**
 * Death callouts — the game saying what just happened, in two words.
 *
 * ## Why this exists at all
 *
 * The spec asks for a tone that is "funny and satisfying, never confusing", and is
 * specific about where the funny comes from: *the physics and the absurdity of the
 * arsenal*, surfaced with short readable callouts — "not from written jokes, and not
 * from a narrator". So nothing in this file is a joke. Every line names a thing the
 * simulation actually did. "SQUASHED" is funny because a wall fell on someone, and the
 * word is only there so you know that is what you are looking at.
 *
 * That distinction decides the whole design. A callout is never invented and never
 * random: it is chosen from what the rigid bodies reported, which is why the table is
 * indexed by `OwnerKind` and by how many limbs came off rather than by a mood.
 *
 * ## Why kills are batched
 *
 * A rocket into a stairwell kills five stickmen inside one physics step. Five separate
 * popups land on the same twenty pixels, none of them readable, and the moment the
 * game most wants to celebrate is the moment it says the least. So kills are collected
 * for a beat and resolved once: five deaths becomes one MASSACRE, at the centre of the
 * five, and the screen is clearer *and* louder for it.
 *
 * The window is deliberately short. Long enough to swallow a single explosion or a
 * collapsing floor (both resolve well inside a tenth of a second), short enough that
 * two separate shots are never merged into a multi-kill the player did not earn.
 */
const GROUP_WINDOW = 0.22;

/**
 * How hard the game hit for one death, in the same 0..1 currency `fx/juice.ts` uses.
 * Only used to size the text, so a massacre reads bigger than a headshot.
 */
export interface KillFacts {
  at: V;
  /** What landed the killing blow, straight off the victim's ragdoll. */
  cause: OwnerKind | null;
  /** Limbs cut free by the blow. `severLimbs` already decided this. */
  severed: number;
  /** Size of the killing blow, raw ragdoll damage. */
  damage: number;
}

/** A callout, or null for "this one wasn't worth saying anything about". */
type Line = { text: string; color: string; size: number } | null;

const GOLD = "#ffd23f";
const CREAM = "#f4f1e8";
const RED = "#ff7a5c";

/**
 * Multi-kills. The only tier that scales with a count, so it is table-driven and
 * everything else is a decision.
 *
 * These stop at five on purpose. Past that the number stops being a thing you achieved
 * and starts being a thing the building did, and a ladder of ever-grander words for it
 * would be exactly the "written joke" the spec rules out.
 */
const MULTI: Record<number, string> = {
  2: "DOUBLE KILL",
  3: "TRIPLE KILL",
  4: "QUAD KILL",
};

/**
 * What to say about one death.
 *
 * Ordered by how surprising each fact is, not by how violent it is. Coming apart is
 * rarer than being crushed, which is rarer than being shot, so that is the order they
 * get to claim the line — otherwise every dismemberment would be reported as the
 * direct hit that caused it, which is the less interesting half of what happened.
 */
function single(f: KillFacts): Line {
  if (f.severed >= 2) return { text: "DISMEMBERED", color: RED, size: 0.92 };
  if (f.severed === 1) return { text: "TAKEN APART", color: RED, size: 0.86 };

  switch (f.cause) {
    case "block":
      // Killed by a piece of the building. This is the one the destruction sandbox
      // exists to produce, so it gets a line even though it is common.
      return { text: "SQUASHED", color: GOLD, size: 0.86 };
    case "terrain":
      // Nothing hit them; the floor did. Almost always a fall, occasionally a very
      // bad landing after being launched.
      return { text: "GRAVITY WINS", color: GOLD, size: 0.86 };
    case "ragdoll":
      // Hit by another stickman — either one you fired, or one you launched.
      return { text: "BOWLED OVER", color: GOLD, size: 0.86 };
    case "debris":
      return { text: "COLLATERAL", color: CREAM, size: 0.78 };
    case "projectile":
      // A clean hit from the round itself. Common enough that it only earns a line
      // when the blow was genuinely oversized — otherwise the "+points" popup that
      // every kill already draws is the whole story, and two lines of text on an
      // ordinary chicken is noise.
      return f.damage > 90 ? { text: "OBLITERATED", color: GOLD, size: 0.92 } : null;
    default:
      return null;
  }
}

/**
 * Collects kills, resolves them a beat later, and draws at most one line per beat.
 *
 * Owned by `Game`, ticked from the same place the particles are. Holding state here
 * rather than in `Game` keeps the batching rule and the words it produces in one file:
 * they are the same decision, and splitting them is how the window ends up tuned in one
 * file for a table that lives in another.
 */
export class Callouts {
  private pending: KillFacts[] = [];
  private timer = 0;

  /** Suppressed with the rest of the scoring text while the attract demo plays. */
  mute = false;

  /** Called once per enemy death. */
  kill(f: KillFacts) {
    if (this.mute) return;
    this.pending.push(f);
    // The window starts at the *first* kill of a group and is not extended by later
    // ones. Extending it lets a long collapse hold the callout back indefinitely, so
    // the line arrives after the event it is describing has finished.
    if (this.pending.length === 1) this.timer = GROUP_WINDOW;
  }

  update(dt: number, particles: Particles) {
    if (this.pending.length === 0) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.flush(particles);
  }

  /** Drops anything queued without drawing it — used when the world is torn down. */
  clear() {
    this.pending.length = 0;
    this.timer = 0;
  }

  private flush(particles: Particles) {
    const group = this.pending;
    const n = group.length;

    // The group's anchor is the mean of the deaths, so a multi-kill labels the event
    // rather than whichever body happened to be reported first.
    let x = 0;
    let y = 0;
    for (const f of group) {
      x += f.at.x;
      y += f.at.y;
    }
    x /= n;
    y /= n;

    const line = n >= 5
      ? { text: "MASSACRE", color: RED, size: 1.15 }
      : n > 1
        ? { text: MULTI[n], color: GOLD, size: 0.86 + n * 0.09 }
        : single(group[0]);

    this.pending = [];
    this.timer = 0;
    if (!line) return;

    // Sits above the "+points" popup `Game.award` already put on the same body, so the
    // two read as one stacked message instead of overprinting each other.
    particles.popup(x, y + 2.4, line.text, line.color, line.size, 1.1);
  }
}
