/**
 * How every cell of the spell sheet is painted.
 *
 * Split out of `./spriteSheets.ts` in Milestone 4, which had grown past the
 * file-size rule when the wisp's four books were added: that file is now the
 * sheet's *layout* — the grid, which book lives where, and how a phase becomes
 * a cell — and this is the drawing.
 *
 * Every painter works in a normalised -1..1 square with the origin at the
 * centre of its cell (`inCell` puts it there), so none of them knows the cell
 * size or where in the sheet it landed. Everything is drawn white-hot in the
 * middle fading to its own hue at the edge, on black: the sprites are additive
 * and carry a per-instance tint (`./sprites.ts`), so a cell only has to hold
 * shape and falloff.
 */

import { CELL, GRID, SPRITE_CELLS } from './spriteGrid';

/**
 * The 2D context the sheet is painted with.
 *
 * Babylon types `getContext()` as its own `ICanvasRenderingContext`, which is
 * the subset it needs and carries neither `lineCap` nor
 * `globalCompositeOperation`. Both are standard on every browser canvas and
 * both are load-bearing here — the flipbooks are built out of round-capped
 * strokes added on top of each other — so the context is narrowed once, in
 * `./spriteSheets.ts`, rather than at eight call sites.
 */
export type Context = CanvasRenderingContext2D;

/**
 * Runs `draw` with the origin at the centre of cell `index` and the unit square
 * scaled to the cell, so every painter below works in -1..1 and never has to
 * know where in the sheet it landed.
 */
export function inCell(context: Context, index: number, draw: () => void): void {
  const column = index % GRID;
  const row = Math.floor(index / GRID);
  context.save();
  context.translate(column * CELL + CELL / 2, row * CELL + CELL / 2);
  context.scale(CELL / 2, CELL / 2);
  // Everything is drawn on black and blended additively on the GPU, so
  // overlapping strokes inside a cell should add here too.
  context.globalCompositeOperation = 'lighter';
  draw();
  context.restore();
  context.globalCompositeOperation = 'source-over';
}

/** A soft radial blob: white core, hue at the rim, nothing at the edge. */
function glow(
  context: Context,
  x: number,
  y: number,
  radius: number,
  rim: string,
  strength = 1,
): void {
  if (radius <= 0) return;
  // A *small* white core. The sprites are additive and they overlap — a volley
  // is four hundred of them — so a wide white centre stacks into paper white
  // and every staff ends up looking the same.
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(255,255,255,${String(strength)})`);
  gradient.addColorStop(0.16, rim.replace('ALPHA', String(strength * 0.95)));
  gradient.addColorStop(1, rim.replace('ALPHA', '0'));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

const EMBER_RIM = 'rgba(255,135,25,ALPHA)';
const STORM_RIM = 'rgba(140,80,255,ALPHA)';
const FROST_RIM = 'rgba(90,205,255,ALPHA)';

/**
 * Ember: a round core with a flame licking off the back of it. The lick is
 * three teardrops whose length and sideways lean cycle over the book, so a
 * fireball in flight looks like it is burning rather than spinning.
 */
export function fireball(context: Context, phase: number, random: () => number): void {
  const wobble = Math.sin(phase * Math.PI * 2);
  const flicker = 0.86 + 0.14 * Math.sin(phase * Math.PI * 4);

  // The tail first, so the core sits on top of it.
  for (let i = 0; i < 3; i++) {
    const spread = (i - 1) * 0.22;
    const reach = 0.5 + 0.35 * Math.abs(Math.sin(phase * Math.PI * 2 + i));
    for (let s = 0; s < 5; s++) {
      const t = s / 4;
      glow(
        context,
        spread * t + wobble * 0.12 * t,
        -0.15 - reach * t,
        0.3 * (1 - t * 0.75),
        EMBER_RIM,
        0.42 * (1 - t) * flicker,
      );
    }
  }

  glow(context, 0, 0.16, 0.62 * flicker, EMBER_RIM, 1);
  // Embers thrown off the core, seeded so they sit still across a re-bake but
  // move from frame to frame.
  for (let i = 0; i < 4; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 0.45 + random() * 0.35;
    glow(
      context,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance * 0.7,
      0.07 + random() * 0.05,
      EMBER_RIM,
      0.6,
    );
  }
}

/**
 * Storm: a zigzag of light down the cell, re-broken every frame, with a bead of
 * charge at the head. The seed is per-frame on purpose — a bolt whose kinks
 * stayed put between frames would read as a solid painted shape.
 */
export function boltCell(context: Context, phase: number, random: () => number): void {
  const segments = 7;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const [width, color, alpha] of [
    [0.3, 'rgba(110,50,255,ALPHA)', 0.55],
    [0.1, 'rgba(190,150,255,ALPHA)', 0.9],
  ] as const) {
    context.strokeStyle = color.replace('ALPHA', String(alpha));
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(0, -0.92);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const kink = (random() - 0.5) * 0.62 * Math.sin(t * Math.PI);
      context.lineTo(kink, -0.92 + t * 1.84);
    }
    context.stroke();
  }

  // A bead of charge at the head, not a lamp: this used to be half the cell
  // wide, and at that size the zigzag behind it never read at all.
  const head = 0.3 + 0.12 * Math.sin(phase * Math.PI * 2);
  glow(context, 0, 0.68, head, STORM_RIM, 1);
  // Two short forks off the shaft, so the bolt crackles rather than bends.
  for (let i = 0; i < 2; i++) {
    const y = -0.4 + i * 0.7;
    context.strokeStyle = 'rgba(165,110,255,0.8)';
    context.lineWidth = 0.05;
    context.beginPath();
    context.moveTo((random() - 0.5) * 0.2, y);
    context.lineTo((random() - 0.5) * 0.9, y + 0.3);
    context.stroke();
  }
}

/**
 * Frost: a six-pointed crystal turning a sixth of a revolution over the book,
 * so the loop is seamless, inside a puff of mist.
 */
export function crystal(context: Context, phase: number, random: () => number): void {
  const spin = phase * (Math.PI / 3);

  for (let i = 0; i < 5; i++) {
    const angle = random() * Math.PI * 2;
    const distance = 0.35 + random() * 0.55;
    glow(
      context,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      0.28 + random() * 0.16,
      FROST_RIM,
      0.24,
    );
  }

  context.save();
  context.rotate(spin);
  context.strokeStyle = 'rgba(150,235,255,0.95)';
  context.lineCap = 'round';
  for (let arm = 0; arm < 6; arm++) {
    const angle = (arm / 6) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    context.lineWidth = 0.12;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(dx * 0.85, dy * 0.85);
    context.stroke();
    // The barbs that make a snowflake a snowflake rather than an asterisk.
    context.lineWidth = 0.07;
    for (const at of [0.42, 0.64]) {
      for (const side of [-1, 1]) {
        const branch = angle + side * 0.7;
        context.beginPath();
        context.moveTo(dx * at, dy * at);
        context.lineTo(dx * at + Math.cos(branch) * 0.26, dy * at + Math.sin(branch) * 0.26);
        context.stroke();
      }
    }
  }
  context.restore();

  glow(context, 0, 0, 0.4, FROST_RIM, 1);
}

/**
 * An impact: a flash that expands and thins over the book. Ember blooms into a
 * ball of fire, storm throws crossed sparks, frost throws shards.
 */
export function burst(
  context: Context,
  kind: 'ember' | 'storm' | 'frost',
  phase: number,
  random: () => number,
): void {
  const rim = kind === 'ember' ? EMBER_RIM : kind === 'storm' ? STORM_RIM : FROST_RIM;
  // Out fast, then out of existence — the same curve the meshes used to grow on.
  const size = Math.sin(Math.min(1, phase) * Math.PI) ** 0.55;
  const fade = 1 - phase * 0.85;
  if (size <= 0.01) return;

  glow(context, 0, 0, 0.55 * size + 0.12, rim, fade);

  const spokes = kind === 'ember' ? 0 : kind === 'storm' ? 6 : 8;
  context.lineCap = 'round';
  context.strokeStyle = rim.replace('ALPHA', String(fade * 0.9));
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2 + (kind === 'frost' ? 0.4 : 0);
    const inner = 0.15 + 0.35 * phase;
    const outer = inner + (kind === 'storm' ? 0.75 : 0.45) * (0.4 + 0.6 * phase);
    context.lineWidth = (kind === 'storm' ? 0.07 : 0.12) * (1 - phase * 0.6);
    context.beginPath();
    context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    context.stroke();
  }

  if (kind === 'ember') {
    for (let i = 0; i < 6; i++) {
      const angle = random() * Math.PI * 2;
      const distance = (0.3 + random() * 0.5) * (0.4 + phase);
      glow(
        context,
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        0.13 * (1 - phase * 0.5),
        rim,
        fade * 0.8,
      );
    }
  }
}

/**
 * A twinkle: a soft dot with a four-point star through it, breathing.
 *
 * Deliberately faint. It is drawn hundreds of times a second behind the volley
 * and it is additive, so a bright one paves the road behind the squad in white.
 */
export function sparkle(context: Context, phase: number): void {
  const size = 0.55 + 0.35 * Math.sin(phase * Math.PI * 2);
  glow(context, 0, 0, 0.45 * size, 'rgba(255,230,180,ALPHA)', 0.8);
  context.strokeStyle = 'rgba(255,250,235,0.5)';
  context.lineCap = 'round';
  context.lineWidth = 0.06;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    context.beginPath();
    context.moveTo(-dx * size, -dy * size);
    context.lineTo(dx * size, dy * size);
    context.stroke();
  }
}

/** The wisp's own rim. Painted pale, because the tint carries the hue. */
const WISP_RIM = 'rgba(180,255,200,ALPHA)';

/**
 * The familiar's four books (D33).
 *
 * Kept together in one painter because they are one look: an orb, the rings
 * that say what tier it is, the spark it throws and the flash that spark lands
 * with, all the same pale rim over the same white-hot core.
 */
export function paintWisp(context: Context, random: () => number): void {
  for (let i = 0; i < SPRITE_CELLS.wispCore.frames; i++) {
    inCell(context, SPRITE_CELLS.wispCore.at + i, () => {
      wispOrb(context, i / SPRITE_CELLS.wispCore.frames, random);
    });
  }
  for (let i = 0; i < SPRITE_CELLS.wispRing.frames; i++) {
    inCell(context, SPRITE_CELLS.wispRing.at + i, () => {
      wispRing(context, i / SPRITE_CELLS.wispRing.frames);
    });
  }
  for (let i = 0; i < SPRITE_CELLS.wispSpark.frames; i++) {
    inCell(context, SPRITE_CELLS.wispSpark.at + i, () => {
      wispSpark(context, i / SPRITE_CELLS.wispSpark.frames);
    });
  }
  for (let i = 0; i < SPRITE_CELLS.wispBurst.frames; i++) {
    inCell(context, SPRITE_CELLS.wispBurst.at + i, () => {
      wispBurst(context, i / (SPRITE_CELLS.wispBurst.frames - 1));
    });
  }
}

/**
 * The orb: a bright core inside a breathing corona, with a couple of motes
 * drifting around it. Rounder and softer than any of the spells — it hovers
 * rather than flies, and it has to read as a companion rather than as a shot
 * the squad just fired.
 */
function wispOrb(context: Context, phase: number, random: () => number): void {
  const breath = 0.88 + 0.12 * Math.sin(phase * Math.PI * 2);
  glow(context, 0, 0, 0.9 * breath, WISP_RIM, 0.35);
  glow(context, 0, 0, 0.44 * breath, WISP_RIM, 1);
  for (let i = 0; i < 3; i++) {
    const angle = random() * Math.PI * 2 + phase * Math.PI * 2;
    const distance = 0.5 + random() * 0.3;
    glow(
      context,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      0.08 + random() * 0.05,
      WISP_RIM,
      0.7,
    );
  }
}

/**
 * A tier ring: a thin broken circle. Broken on purpose — a closed circle
 * billboarded at the camera cannot show that it is turning, and the gap is what
 * makes three rings at three speeds read as an orbit rather than as a target.
 */
function wispRing(context: Context, phase: number): void {
  const radius = 0.74;
  context.lineCap = 'round';
  for (const [width, alpha] of [
    [0.16, 0.35],
    [0.07, 0.9],
  ] as const) {
    context.strokeStyle = WISP_RIM.replace('ALPHA', String(alpha));
    context.lineWidth = width;
    context.beginPath();
    // Two arcs with gaps opposite each other, rolling a little over the book.
    for (const from of [0.15, Math.PI + 0.15]) {
      context.arc(0, 0, radius, from + phase * 0.4, from + Math.PI - 0.5 + phase * 0.4);
      context.stroke();
      context.beginPath();
    }
  }
}

/** The spark in flight: a hot mote with four short needles, shimmering. */
function wispSpark(context: Context, phase: number): void {
  const pulse = 0.8 + 0.2 * Math.sin(phase * Math.PI * 2);
  glow(context, 0, 0, 0.5 * pulse, WISP_RIM, 1);
  context.strokeStyle = WISP_RIM.replace('ALPHA', '0.75');
  context.lineCap = 'round';
  context.lineWidth = 0.09;
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + phase * 1.4;
    context.beginPath();
    context.moveTo(Math.cos(angle) * 0.18, Math.sin(angle) * 0.18);
    context.lineTo(Math.cos(angle) * 0.92 * pulse, Math.sin(angle) * 0.92 * pulse);
    context.stroke();
  }
}

/** Where a spark lands: a small expanding halo with a few chips thrown clear. */
function wispBurst(context: Context, phase: number): void {
  const size = Math.sin(Math.min(1, phase) * Math.PI) ** 0.6;
  const fade = 1 - phase * 0.8;
  if (size <= 0.01) return;
  glow(context, 0, 0, 0.5 * size + 0.1, WISP_RIM, fade);
  context.strokeStyle = WISP_RIM.replace('ALPHA', String(fade * 0.85));
  context.lineCap = 'round';
  context.lineWidth = 0.08 * (1 - phase * 0.5);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const inner = 0.2 + 0.3 * phase;
    const outer = inner + 0.4 * (0.4 + 0.6 * phase);
    context.beginPath();
    context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    context.stroke();
  }
}
