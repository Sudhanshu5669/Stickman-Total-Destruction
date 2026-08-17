import { clamp, damp, lerp, rand, v, type V } from "./math";

/**
 * World units are metres, Y points up. The camera installs a flipped transform so
 * gameplay code can draw in physics space directly; see `apply()`.
 */
export class Camera {
  pos: V = v(0, 6);
  /** Pixels per metre. */
  zoom = 34;
  targetZoom = 34;
  minZoom = 9;
  maxZoom = 90;

  /** 0..1 "how rattled are we" — decays every frame, shake scales with its square. */
  trauma = 0;
  private shakeOffset: V = v(0, 0);
  private shakeAngle = 0;
  /** Momentary punch applied on top of zoom, e.g. an explosion snapping the view in. */
  private punch = 0;

  viewW = 1;
  viewH = 1;

  private target: V = v(0, 6);
  private lead: V = v(0, 0);

  /** Point the camera at `p`, biased `leadX/leadY` metres toward where the player is aiming. */
  follow(p: V, leadX = 0, leadY = 0, dt = 1 / 60) {
    this.target.x = p.x;
    this.target.y = p.y;
    this.lead.x = damp(this.lead.x, clamp(leadX, -14, 14), 7, dt);
    this.lead.y = damp(this.lead.y, clamp(leadY, -10, 10), 7, dt);
  }

  addTrauma(t: number) {
    this.trauma = clamp(this.trauma + t, 0, 1);
  }

  /** Negative values push the view outward (explosions), positive snap it in. */
  addPunch(p: number) {
    this.punch = clamp(this.punch + p, -0.5, 0.5);
  }

  update(dt: number, snap = false) {
    // ~80ms to close the gap. Slower than this and the camera reads as input lag even
    // though the character is responding immediately.
    const rate = snap ? 1000 : 13;
    this.pos.x = damp(this.pos.x, this.target.x + this.lead.x, rate, dt);
    this.pos.y = damp(this.pos.y, this.target.y + this.lead.y, rate, dt);
    this.zoom = damp(this.zoom, clamp(this.targetZoom, this.minZoom, this.maxZoom), 4, dt);

    this.trauma = Math.max(0, this.trauma - dt * 1.35);
    this.punch = damp(this.punch, 0, 9, dt);

    // Squaring trauma keeps small hits subtle while big ones still slam.
    const s = this.trauma * this.trauma;
    const amp = s * 1.15;
    this.shakeOffset.x = rand(-amp, amp);
    this.shakeOffset.y = rand(-amp, amp);
    this.shakeAngle = rand(-s * 0.05, s * 0.05);
  }

  /** Installs world->screen transform. Call inside save()/restore(). */
  apply(ctx: CanvasRenderingContext2D, w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
    const z = this.zoom * (1 + this.punch);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.shakeAngle);
    ctx.scale(z, -z); // flip Y so +Y is up in world space
    ctx.translate(-(this.pos.x + this.shakeOffset.x), -(this.pos.y + this.shakeOffset.y));
  }

  get effectiveZoom() {
    return this.zoom * (1 + this.punch);
  }

  screenToWorld(sx: number, sy: number): V {
    const z = this.effectiveZoom;
    return v(
      (sx - this.viewW / 2) / z + this.pos.x + this.shakeOffset.x,
      -(sy - this.viewH / 2) / z + this.pos.y + this.shakeOffset.y,
    );
  }

  worldToScreen(p: V): V {
    const z = this.effectiveZoom;
    return v(
      (p.x - this.pos.x - this.shakeOffset.x) * z + this.viewW / 2,
      -(p.y - this.pos.y - this.shakeOffset.y) * z + this.viewH / 2,
    );
  }

  /** Half-extents of the visible world rect, plus `pad` metres of slack for culling. */
  visibleHalf(pad = 0): V {
    const z = this.effectiveZoom;
    return v(this.viewW / 2 / z + pad, this.viewH / 2 / z + pad);
  }

  /** Allocation-free: this runs once per actor per frame across hundreds of blocks. */
  isVisible(p: V, pad = 3) {
    const z = this.effectiveZoom;
    return (
      Math.abs(p.x - this.pos.x) < this.viewW / 2 / z + pad &&
      Math.abs(p.y - this.pos.y) < this.viewH / 2 / z + pad
    );
  }

  /** Frames the action: zoom out when the player is moving fast or a fight is spread out. */
  autoZoom(speed: number, dt: number, base = 34) {
    const want = lerp(base, base * 0.62, clamp(speed / 26, 0, 1));
    this.targetZoom = damp(this.targetZoom, want, 1.6, dt);
  }
}
