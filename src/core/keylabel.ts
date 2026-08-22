/**
 * What is actually printed on a physical key.
 *
 * Every binding in the game is a `KeyboardEvent.code` — a *physical position*, not a
 * character — which is already the right call for layout independence: an AZERTY
 * player's ZQSD sits on exactly the codes `KeyW`/`KeyA`/`KeyS`/`KeyD`, so movement
 * works for them without a single remap. The bug was never the bindings.
 *
 * The bug was the pictures. The coach drew a keycap reading "A" and the footer said
 * "M sound", both derived from the QWERTY *name* of the code. An AZERTY player looks
 * for A, presses A — which is `KeyQ`, the wrong physical key — and concludes the game
 * is broken. Same story on QWERTZ, Dvorak and every non-US layout.
 *
 * So the labels come from the browser's own layout map where one exists, and fall back
 * to the code's name where it does not. Chromium ships `navigator.keyboard`; Firefox
 * and Safari do not, and there they get the QWERTY names they get today — this is a
 * strict improvement, never a regression.
 */

/** The shape of a KeyboardLayoutMap, without depending on lib.dom having it. */
interface LayoutMap {
  get(code: string): string | undefined;
}

let layout: LayoutMap | null = null;

/**
 * Starts fetching the layout map. Fire-and-forget, and safe to call more than once.
 *
 * Nothing waits on this: until it resolves, `keyLabel` returns the fallback, so the
 * worst case is a handful of early frames drawn with the QWERTY name. Blocking the
 * boot on a cosmetic lookup would be a far worse trade.
 */
export function primeKeyLabels(): void {
  if (layout) return;
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }).keyboard;
    const p = kb?.getLayoutMap?.();
    if (p && typeof p.then === "function") {
      p.then((m) => { layout = m; }).catch(() => {});
    }
  } catch {
    // Permissions-Policy can block the Keyboard API inside an iframe. Fallback stands.
  }
}

/** The QWERTY name of a code, which is the best guess available without a layout map. */
function derive(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return code.slice(6);
  return code;
}

/**
 * The character printed on the key at `code`, upper-cased, for drawing on a keycap.
 *
 * Anything longer than two characters is rejected rather than drawn: some layouts
 * report dead keys and combining marks as multi-character strings, and a keycap is a
 * fixed-size box. The fallback name is always short enough to fit.
 */
export function keyLabel(code: string): string {
  try {
    const printed = layout?.get(code);
    if (printed && printed.length > 0 && printed.length <= 2) return printed.toUpperCase();
  } catch {
    // A map that throws on lookup is a map we do not use.
  }
  return derive(code);
}
