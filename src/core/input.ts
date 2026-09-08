/**
 * Pointer and keyboard steering.
 *
 * `onDeltaX` receives a horizontal delta in **CSS pixels**. Converting pixels to
 * road meters is the caller's job, because the conversion factor
 * (`balance.input.sensitivity`) is tuning data and tuning lives in `src/data`
 * (CLAUDE.md).
 *
 * No tap-to-move: a tap with no drag produces no delta, so the UI buttons
 * layered over the canvas stay usable.
 *
 * Gestures over the canvas are swallowed (`preventDefault` plus
 * `touch-action: none`) so a drag never scrolls, rubber-bands or zooms the page
 * on a phone.
 */

import { balance } from '@/data';

export type DetachInput = () => void;

export interface InputOptions {
  /**
   * Polled on every event. `false` swallows the gesture but emits no delta —
   * which is how `?bot=` mode locks the player out without letting the page
   * start scrolling under their finger.
   */
  enabled: () => boolean;
}

export function attachInput(
  canvas: HTMLCanvasElement,
  onDeltaX: (deltaXPixels: number) => void,
  options: InputOptions,
): DetachInput {
  let activePointerId: number | null = null;
  let lastX = 0;

  const heldKeys = new Set<string>();
  let keyRafId: number | null = null;
  let keyLastTime = 0;

  const onPointerDown = (event: PointerEvent): void => {
    // Even when steering is disabled: this is what stops the page from scrolling.
    event.preventDefault();
    // One finger steers. A second one is swallowed, not tracked: two fingers
    // dragging opposite ways would fight over `targetX`.
    if (activePointerId !== null) return;
    activePointerId = event.pointerId;
    lastX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();

    const delta = event.clientX - lastX;
    lastX = event.clientX;
    if (delta !== 0 && options.enabled()) onDeltaX(delta);
  };

  const endPointer = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  /**
   * Capture can be taken away without a pointerup — a browser gesture, or the
   * canvas being detached. Without this the drag stays "active" forever and
   * every later touch is ignored, which reads as the controls dying.
   */
  const onLostCapture = (event: PointerEvent): void => {
    if (event.pointerId === activePointerId) activePointerId = null;
  };

  // iOS Safari still honours `touchmove` defaults in some gesture states even
  // with `touch-action: none`, so the canvas swallows those too.
  const swallow = (event: Event): void => {
    event.preventDefault();
  };

  const stepKeys = (time: number): void => {
    const dt = keyLastTime === 0 ? 0 : Math.min(0.05, (time - keyLastTime) / 1000);
    keyLastTime = time;

    let direction = 0;
    if (heldKeys.has('ArrowLeft') || heldKeys.has('KeyA')) direction -= 1;
    if (heldKeys.has('ArrowRight') || heldKeys.has('KeyD')) direction += 1;
    if (direction !== 0 && dt > 0 && options.enabled()) {
      onDeltaX(direction * balance.ui.keySpeed * dt);
    }

    if (heldKeys.size === 0) {
      keyRafId = null;
      keyLastTime = 0;
      return;
    }
    keyRafId = requestAnimationFrame(stepKeys);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isSteerKey(event.code)) return;
    event.preventDefault();
    heldKeys.add(event.code);
    if (keyRafId === null) keyRafId = requestAnimationFrame(stepKeys);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    heldKeys.delete(event.code);
  };

  const onBlur = (): void => {
    heldKeys.clear();
  };

  // Not passive: these listeners exist partly to call `preventDefault`.
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', endPointer, { passive: true });
  canvas.addEventListener('pointercancel', endPointer, { passive: true });
  canvas.addEventListener('lostpointercapture', onLostCapture, { passive: true });
  canvas.addEventListener('touchmove', swallow, { passive: false });
  canvas.addEventListener('contextmenu', swallow);
  canvas.addEventListener('dragstart', swallow);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return function detach(): void {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endPointer);
    canvas.removeEventListener('pointercancel', endPointer);
    canvas.removeEventListener('lostpointercapture', onLostCapture);
    canvas.removeEventListener('touchmove', swallow);
    canvas.removeEventListener('contextmenu', swallow);
    canvas.removeEventListener('dragstart', swallow);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (keyRafId !== null) cancelAnimationFrame(keyRafId);
    heldKeys.clear();
  };
}

function isSteerKey(code: string): boolean {
  return code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD';
}
