/**
 * Triple-tap gesture on overlay text that is not itself interactive.
 *
 * The overlay is click-through (`pointer-events: none`) so a drag that starts
 * anywhere on screen still reaches the canvas and steers the squad. Turning the
 * wordmark or the level chip into a real button would take that away — a drag
 * beginning on the chip would be swallowed by the button and the squad would
 * not move — so the gesture is recognised by *coordinates* instead: the
 * listeners sit on `window`, the canvas keeps every event it already received,
 * and a tap only counts when the finger barely moved.
 *
 * Hosted playtests run inside a page wrapper that may not pass `?debug`
 * through, which is why the panel needs an in-game way in at all
 * (docs/09-milestone-3-plan.md, "Performance plan" item 6).
 */

/** Longest gap between two taps of the same gesture. */
const TAP_GAP_MS = 600;

/** Longest a single tap may be held. A press-and-hold is not a tap. */
const TAP_MAX_MS = 400;

/** How far the finger may travel and still be a tap rather than a drag. */
const TAP_MOVE_PX = 16;

/** Fat-finger margin around the target, which is small text on a phone. */
const HIT_PAD_PX = 12;

const TAPS_REQUIRED = 3;

/**
 * Calls `onTriple` when three taps land on any of `targets` in quick
 * succession. Targets are hit-tested, never listened to, so they keep
 * `pointer-events: none` and the drag layer underneath is untouched.
 */
export function watchTripleTap(
  targets: readonly HTMLElement[],
  onTriple: () => void,
  signal: AbortSignal,
): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let taps = 0;
  let lastTapTime = 0;

  const onDown = (event: PointerEvent): void => {
    if (!hitsTarget(targets, event.clientX, event.clientY)) {
      pointerId = null;
      return;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startTime = event.timeStamp;
  };

  const onUp = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;

    // A drag that happened to start on the chip has already steered the squad
    // by now; it must not also count towards the gesture.
    if (event.timeStamp - startTime > TAP_MAX_MS) return;
    if (Math.abs(event.clientX - startX) > TAP_MOVE_PX) return;
    if (Math.abs(event.clientY - startY) > TAP_MOVE_PX) return;

    taps = event.timeStamp - lastTapTime > TAP_GAP_MS ? 1 : taps + 1;
    lastTapTime = event.timeStamp;
    if (taps < TAPS_REQUIRED) return;

    taps = 0;
    onTriple();
  };

  const onCancel = (): void => {
    pointerId = null;
  };

  // Capture phase and passive: the gesture only ever reads. The canvas's own
  // `preventDefault` and pointer capture are left exactly as they were.
  const options: AddEventListenerOptions = { capture: true, passive: true, signal };
  window.addEventListener('pointerdown', onDown, options);
  window.addEventListener('pointerup', onUp, options);
  window.addEventListener('pointercancel', onCancel, options);
}

function hitsTarget(targets: readonly HTMLElement[], x: number, y: number): boolean {
  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    // A `hidden` element measures zero, which is also the answer to "is the
    // screen this belongs to even up?" — so no separate visibility check.
    if (rect.width === 0 || rect.height === 0) continue;
    if (x < rect.left - HIT_PAD_PX || x > rect.right + HIT_PAD_PX) continue;
    if (y < rect.top - HIT_PAD_PX || y > rect.bottom + HIT_PAD_PX) continue;
    return true;
  }
  return false;
}
