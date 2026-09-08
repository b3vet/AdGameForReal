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
 * Multi-touch: one finger steers, but every finger on the glass is tracked, so
 * when the steering one lifts the newest of the rest takes over on the spot
 * (docs/06-milestone-2-plan.md, carried over from Milestone 1).
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
  /**
   * Every finger currently on the glass, in the order it landed, mapped to
   * where it last was. Only one of them steers — two fingers dragging opposite
   * ways would fight over `targetX` — but the others are tracked so that when
   * the steering finger lifts, the newest finger still down takes over without
   * the player having to lift and re-place it.
   */
  const pointers = new Map<number, number>();
  let activePointerId: number | null = null;

  const heldKeys = new Set<string>();
  let keyRafId: number | null = null;
  let keyLastTime = 0;

  /** Hands steering to the most recently placed finger that is still down. */
  const promoteNewestPointer = (): void => {
    activePointerId = null;
    for (const pointerId of pointers.keys()) activePointerId = pointerId;
  };

  const onPointerDown = (event: PointerEvent): void => {
    // Even when steering is disabled: this is what stops the page from scrolling.
    event.preventDefault();
    pointers.set(event.pointerId, event.clientX);
    if (activePointerId === null) activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const lastX = pointers.get(event.pointerId);
    if (lastX === undefined) return;
    event.preventDefault();

    pointers.set(event.pointerId, event.clientX);
    if (event.pointerId !== activePointerId) return;

    const delta = event.clientX - lastX;
    if (delta !== 0 && options.enabled()) onDeltaX(delta);
  };

  const endPointer = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (event.pointerId === activePointerId) promoteNewestPointer();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  /**
   * Capture can be taken away without a pointerup — a browser gesture, or the
   * canvas being detached. Without this the drag stays "active" forever and
   * every later touch is ignored, which reads as the controls dying.
   */
  const onLostCapture = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (event.pointerId === activePointerId) promoteNewestPointer();
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
    pointers.clear();
    activePointerId = null;
  };
}

function isSteerKey(code: string): boolean {
  return code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD';
}
