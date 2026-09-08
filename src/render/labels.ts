/**
 * The one Babylon GUI layer. Every number the player reads in 3D — gate values,
 * block HP, the boss bar — is a `TextBlock` on this fullscreen texture, linked
 * to a pooled mesh.
 *
 * All blocks are created in `Renderer.init` and then only shown, hidden and
 * retargeted, because a GUI control allocation mid-run would stall a frame.
 */

import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';

/**
 * Control sizes are authored against a 390x844 phone; the GUI scales them by
 * `idealRatio`, so a label is the same physical size on a 3x screen. With both
 * ideals set, `useSmallestIdeal` picks the width ratio in portrait and the
 * height ratio in landscape, which keeps labels sane on a wide desktop window
 * instead of scaling them to the full window width.
 */
const IDEAL_WIDTH = 390;
const IDEAL_HEIGHT = 844;

export interface LabelStyle {
  fontSize: number;
  color: string;
  outline: number;
}

export class LabelLayer {
  private readonly ui: AdvancedDynamicTexture;
  private readonly blocks: TextBlock[] = [];

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI('arcane-labels', true, scene);
    this.ui.idealWidth = IDEAL_WIDTH;
    this.ui.idealHeight = IDEAL_HEIGHT;
    this.ui.useSmallestIdeal = true;
    // Labels are decoration; letting them eat pointer events would break drag.
    this.ui.isForeground = true;
  }

  /** Init-time only. Returns a hidden block the caller owns for the app's life. */
  create(style: LabelStyle): TextBlock {
    const block = new TextBlock(`label-${String(this.blocks.length)}`);
    block.text = '';
    block.color = style.color;
    block.fontSize = style.fontSize;
    block.fontStyle = 'bold';
    block.outlineWidth = style.outline;
    block.outlineColor = '#0d1018';
    block.isHitTestVisible = false;
    block.isVisible = false;
    // Without this the block is measured as full-screen and the outline smears.
    block.resizeToFit = true;
    this.ui.addControl(block);
    this.blocks.push(block);
    return block;
  }

  dispose(): void {
    for (const block of this.blocks) block.dispose();
    this.blocks.length = 0;
    this.ui.dispose();
  }
}

/**
 * Points a label at a mesh. `offsetY` is in design pixels: negative is up, so
 * an HP label clears the top of its block.
 */
export function linkLabel(block: TextBlock, mesh: TransformNode, offsetY: number): void {
  block.linkWithMesh(mesh);
  block.linkOffsetY = offsetY;
}

export function hideLabel(block: TextBlock): void {
  if (block.isVisible) block.isVisible = false;
}

/**
 * Distance at which a label is drawn at its full size. Labels shrink past it,
 * so the three rows stacked toward the horizon do not print on top of each
 * other — the row the player is deciding about is always the loud one.
 */
const FULL_SIZE_DISTANCE = 12;

/**
 * Sizes a label for its distance and returns the size it applied.
 *
 * `shown` is the size the caller applied last time. Assigning `fontSize` is not
 * free — Babylon's setter formats the current value to a string to compare, and
 * a number never equals that string, so every assignment re-dirties the control
 * and re-lays out the GUI. Callers keep the returned value and hand it back, so
 * a label that has not changed size costs nothing.
 */
export function scaleLabel(
  block: TextBlock,
  base: number,
  minimum: number,
  distance: number,
  shown: number,
): number {
  const scaled = Math.round((base * FULL_SIZE_DISTANCE) / Math.max(FULL_SIZE_DISTANCE / 2, distance));
  const size = Math.max(minimum, Math.min(base, scaled));
  if (size !== shown) block.fontSize = size;
  return size;
}
