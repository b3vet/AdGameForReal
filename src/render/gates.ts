/**
 * Gates: a stone arch per lane with the number the player is deciding about cut
 * into a rune plaque hanging in it.
 *
 * Milestone 5 replaced the translucent slab (plan, "Gates too basic"). What a
 * gate is made of is `./gateArch.ts`, which slot is bound to which gate id is
 * `./gateSlots.ts`, and this file is the frame: what is close enough to draw,
 * what carries a number, and what the arch, the plaque, the shimmer and the
 * kind dressing are written with.
 *
 * Every mesh, material and label is built in `Renderer.init`; `loadLevel` only
 * unbinds them.
 *
 * The draw-call arithmetic, because it is the reason for the shape of this
 * file: every arch in view is one thin instance of one mesh, every plaque one
 * instance of a second, and every shimmer one quad in a third batch. Only the
 * kind dressing is per kind, and only inside `ORNAMENT_RANGE`. A row of three
 * arches with three different kinds is six draw calls at its very worst and
 * four in the common case, against nine for the nine panels it replaces.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { createShimmerTexture } from './artTextures';
import { createBoxArch, createPlaque, loadArch } from './gateArch';
import { createOrnaments, ORNAMENT_KINDS, ornamentIndex } from './gateOrnaments';
import {
  GATE_PLAQUE_Z,
  ORNAMENT_RANGE,
  SHIMMER_ALPHA,
  SHIMMER_BURST_ALPHA,
  SHIMMER_BURST_SCALE,
  SHIMMER_EDGE_FADE,
  SHIMMER_HEIGHT,
  SHIMMER_HIT_BOOST,
  SHIMMER_SCROLL,
  SHIMMER_SKIPPED_ALPHA,
  SHIMMER_WIDTH,
  SHIMMER_Y,
} from './gateLook';
import { GateSlots } from './gateSlots';
import type { GateSlot } from './gateSlots';
import { StaffProps } from './gateStaffs';
import { gateText } from './gateText';
import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import { labelPixels, type NumberLabels } from './labels';
import { TintedQuads } from './tintedQuads';
import {
  GATE_CENTER_Y,
  GATE_DRAW_RANGE,
  GATE_EXIT_DURATION,
  GATE_LABEL_COLOR,
  GATE_LABEL_MIN,
  GATE_LABEL_RANGE,
  GATE_LABEL_SIZE,
  GATE_PULSE_DURATION,
  GATE_TINTS,
  GATE_WORD_MIN,
  GATE_WORD_SIZE,
  LABEL_BEHIND,
  POOL,
  SIDE_GATE_LABEL_RANGE,
} from './theme';
import type { RunState } from '@/sim';

/** Metres behind the squad at which an exiting arch is dropped outright. */
const EXIT_CUTOFF_BEHIND = 2;

/** How far the number floats in front of the plaque it is printed on. */
const GATE_LABEL_LIFT = 0.1;

/** Ornaments of one kind that can be in dressing range at once: two rows. */
const ORNAMENT_CAPACITY = 8;
/** Arches, plaques and shimmers in view at once. Three rows of three, plus exits. */
const GATE_DRAW_CAPACITY = 16;

export class GateView {
  /** The slot pool, and the frame stamp the draw pass reads (`./gateSlots.ts`). */
  private readonly pool: GateSlots;
  private readonly scene: Scene;
  private readonly labels: NumberLabels;

  /** The arch, its plaque and the light inside it. */
  private arch: Mesh;
  private archMatrices: Float32Array;
  private readonly plaques: Mesh;
  private readonly plaqueMatrices: Float32Array;
  private readonly shimmer: TintedQuads;
  /**
   * One dressing mesh per kind, in `ORNAMENT_KINDS` order, with its own
   * instance buffer and this frame's count. Parallel arrays rather than a map
   * keyed by kind, because the counts are rewritten every frame and a `Map`
   * allocates an entry array per iteration.
   */
  private readonly ornaments: ({ mesh: Mesh; matrices: Float32Array } | null)[] = [];
  private readonly ornamentCounts: number[] = [];

  /** The staff a `weapon` gate offers, floating over its arch (`./gateStaffs.ts`). */
  private readonly staffs: StaffProps;
  private scroll = 0;

  constructor(scene: Scene, labels: NumberLabels) {
    this.scene = scene;
    this.labels = labels;
    this.pool = new GateSlots(labels, POOL.gates);
    this.staffs = new StaffProps(scene);

    // A box arch stands in until the dungeon pieces arrive, and stays if they
    // never do: a build with no `/assets/` still has to show the player what
    // they are choosing between.
    this.arch = createBoxArch(scene);
    this.archMatrices = createMatrixBuffer(this.arch, GATE_DRAW_CAPACITY);

    this.plaques = createPlaque(scene);
    this.plaqueMatrices = createMatrixBuffer(this.plaques, GATE_DRAW_CAPACITY);

    this.shimmer = new TintedQuads(
      scene,
      'gateShimmer',
      createShimmerTexture(scene),
      GATE_DRAW_CAPACITY,
      SHIMMER_EDGE_FADE,
    );

    const ornaments = createOrnaments(scene);
    for (const kind of ORNAMENT_KINDS) {
      const mesh = ornaments.get(kind);
      this.ornaments.push(
        mesh === undefined ? null : { mesh, matrices: createMatrixBuffer(mesh, ORNAMENT_CAPACITY) },
      );
      this.ornamentCounts.push(0);
    }
  }

  /** The three staff props out of the mage model, and the arch's stonework. */
  async load(): Promise<void> {
    const [, arch] = await Promise.all([this.staffs.load(), loadArch(this.scene)]);
    if (arch === null) return;
    // The greybox is thrown away only once the real one is in hand.
    this.arch.material?.dispose();
    this.arch.dispose();
    this.arch = arch;
    this.archMatrices = createMatrixBuffer(arch, GATE_DRAW_CAPACITY);
  }

  /** Hands every arch back to the pool. Called from `loadLevel`. */
  reset(): void {
    this.pool.reset();
    this.staffs.hideAll();
    commitInstances(this.arch, 0);
    commitInstances(this.plaques, 0);
    for (const ornament of this.ornaments) {
      if (ornament !== null) commitInstances(ornament.mesh, 0);
    }
  }

  /** A shot landed on this gate: flash it so the player sees the number move. */
  onHit(gateId: number): void {
    const slot = this.pool.find(gateId);
    if (slot === undefined || slot.exit !== 'none') return;
    slot.pulse = GATE_PULSE_DURATION;
  }

  /**
   * The squad crossed this row. The gate that applied bursts; its siblings in
   * the same row dim, so the choice reads back to the player.
   */
  onPassed(gateId: number): void {
    const chosen = this.pool.find(gateId);
    if (chosen !== undefined) this.pool.exitRow(chosen);
  }

  update(state: RunState, dt: number): void {
    const frame = this.pool.beginFrame();
    const squadZ = state.squad.z;
    this.staffs.begin();

    // What the sim says, first: every bound slot learns where its gate is and
    // what it is worth before anything is written.
    for (const gate of state.gates) {
      const slot = this.pool.bind(gate);
      if (slot === undefined) continue;
      slot.seen = frame;
      if (slot.exit !== 'none') continue;
      // The sim mutates `passed` even when it emits no event for the skipped
      // lanes, so treat a passed-but-unanimated gate as a fade.
      if (gate.passed || gate.z < squadZ - 1.5) {
        this.pool.startExit(slot, 'skipped');
        continue;
      }
      slot.kind = gate.kind;
      slot.z = gate.z;
      if (gate.value !== slot.shownValue) {
        slot.shownValue = gate.value;
        slot.shownText = gateText(gate.kind, gate.value, gate.weaponId);
      }
      if (gate.kind === 'weapon' && gate.weaponId !== undefined) {
        this.staffs.offer(gate.weaponId, slot.x, slot.z);
      }
    }

    this.draw(squadZ, dt);
    this.staffs.place(dt);
  }

  dispose(): void {
    this.arch.material?.dispose();
    this.arch.dispose();
    this.plaques.material?.dispose();
    this.plaques.dispose();
    this.shimmer.dispose();
    for (const ornament of this.ornaments) {
      if (ornament === null) continue;
      ornament.mesh.material?.dispose();
      ornament.mesh.dispose();
    }
    this.ornaments.length = 0;
    this.pool.dispose();
    this.staffs.dispose();
  }

  /**
   * Writes every instance for this frame: arches, plaques, shimmers, dressing
   * and numbers, in one pass over the pool.
   *
   * One pass rather than one per mesh, because a gate decides all five at once
   * — how far away it is says whether it is drawn at all, whether its number is
   * printed, and whether it is near enough to be dressed.
   */
  private draw(squadZ: number, dt: number): void {
    this.scroll += dt * SHIMMER_SCROLL;
    this.shimmer.begin();

    let arches = 0;
    let plaques = 0;
    this.ornamentCounts.fill(0);

    const frame = this.pool.frame;
    for (const slot of this.pool.all) {
      if (slot.gateId < 0) continue;

      if (slot.exit === 'none') {
        // Gone from the state without a `gatePassed`: retire it quietly.
        if (slot.seen !== frame) {
          this.pool.release(slot);
          continue;
        }
        slot.pulse = Math.max(0, slot.pulse - dt);
      } else {
        slot.exitAge += dt;
        const done =
          slot.exitAge >= GATE_EXIT_DURATION || slot.z < squadZ - EXIT_CUTOFF_BEHIND;
        if (done) {
          this.pool.release(slot);
          continue;
        }
      }

      const ahead = slot.z - squadZ;
      // A level carries up to sixty gates and the ones deep in the fog are a
      // smudge, so only the rows the player can act on are drawn at all.
      if (ahead >= GATE_DRAW_RANGE || ahead <= -LABEL_BEHIND * 2) {
        this.labels.hide(slot.label);
        continue;
      }

      if (arches < GATE_DRAW_CAPACITY) {
        writeInstance(this.archMatrices, arches, 1, 1, 1, slot.x, 0, slot.z);
        arches++;
      }

      this.writeShimmer(slot);

      // The plaque only where the number is: an arch three rows out carries no
      // digits, and a dark slab hanging in it with nothing on it reads as a
      // hole in the frame.
      const range = slot.x === 0 ? GATE_LABEL_RANGE : SIDE_GATE_LABEL_RANGE;
      const labelled = slot.exit === 'none' && ahead < range && ahead > -LABEL_BEHIND;
      if (labelled && plaques < GATE_DRAW_CAPACITY) {
        writeInstance(
          this.plaqueMatrices,
          plaques,
          1,
          1,
          1,
          slot.x,
          GATE_CENTER_Y,
          slot.z - GATE_PLAQUE_Z,
        );
        plaques++;
        const word = slot.kind === 'weapon';
        this.labels.set(
          slot.label,
          slot.shownText,
          slot.x,
          GATE_CENTER_Y,
          // A hair in front of the plaque's own face, toward the camera.
          slot.z - GATE_PLAQUE_Z - GATE_LABEL_LIFT,
          GATE_LABEL_COLOR,
          labelPixels(
            word ? GATE_WORD_SIZE : GATE_LABEL_SIZE,
            word ? GATE_WORD_MIN : GATE_LABEL_MIN,
            ahead,
          ),
        );
      } else {
        this.labels.hide(slot.label);
      }

      if (slot.exit !== 'none' || ahead > ORNAMENT_RANGE) continue;
      const at = ornamentIndex(slot.kind);
      const ornament = at < 0 ? null : (this.ornaments[at] ?? null);
      if (ornament === null) continue;
      const count = this.ornamentCounts[at] ?? 0;
      if (count >= ORNAMENT_CAPACITY) continue;
      writeInstance(ornament.matrices, count, 1, 1, 1, slot.x, 0, slot.z);
      this.ornamentCounts[at] = count + 1;
    }

    commitInstances(this.arch, arches);
    commitInstances(this.plaques, plaques);
    for (let i = 0; i < this.ornaments.length; i++) {
      const ornament = this.ornaments[i];
      if (ornament === null || ornament === undefined) continue;
      commitInstances(ornament.mesh, this.ornamentCounts[i] ?? 0);
    }
    this.shimmer.end();
  }

  /**
   * The light inside one arch: kind-tinted, drifting across the opening,
   * brighter for as long as a shot is landing on it, and either bursting or
   * dimming once the squad has made its choice.
   */
  private writeShimmer(slot: GateSlot): void {
    const tint = GATE_TINTS[slot.kind];
    const pulse = slot.pulse / GATE_PULSE_DURATION;
    let alpha = SHIMMER_ALPHA + pulse * SHIMMER_HIT_BOOST;
    let scale = 1;
    if (slot.exit !== 'none') {
      const t = Math.min(1, slot.exitAge / GATE_EXIT_DURATION);
      if (slot.exit === 'chosen') {
        alpha = SHIMMER_BURST_ALPHA * (1 - t);
        scale = 1 + (SHIMMER_BURST_SCALE - 1) * t;
      } else {
        alpha = SHIMMER_ALPHA * (1 - t) + SHIMMER_SKIPPED_ALPHA * t;
        scale = 1 - t * 0.15;
      }
    }
    this.shimmer.add(
      slot.x,
      SHIMMER_Y * scale,
      slot.z,
      SHIMMER_WIDTH * scale,
      SHIMMER_HEIGHT * scale,
      tint.r,
      tint.g,
      tint.b,
      alpha,
      // The pattern tiles across the arch and is clamped up it
      // (`createShimmerTexture`), so the drift belongs on u — on v it would
      // walk the veil off its own quad and the light would fade out over a
      // run. The per-gate offset on the same axis keeps a row of three from
      // shimmering as one.
      this.scroll + (slot.gateId % 5) * 0.2,
      0,
    );
  }
}
