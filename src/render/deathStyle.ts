/**
 * Who draws a stream body's death: the renderer's baked animation, or the
 * physics layer's ragdoll.
 *
 * A stream is up to three hundred bodies on the road at once (D29), and a
 * ragdoll is a skinned mesh and therefore a draw call of its own — three
 * hundred of them is the frame budget several times over. So one body in ten
 * falls over for real and the rest play the baked `death` range, which costs
 * nothing at all because they are already instances of a crowd that is being
 * drawn anyway.
 *
 * The rule lives in its own module, with no imports, because two layers have to
 * agree on it exactly: `src/render/streamBodies.ts` must *not* draw the bodies
 * `src/physics` is about to throw, or every tenth kill is a corpse and a
 * ragdoll standing in the same place. It is `enemyId % 10` rather than a random
 * draw so both sides reach the same answer from the id alone, with nothing to
 * share and nothing to keep in step.
 */

/** One body in this many is thrown as a ragdoll instead of animated. */
export const RAGDOLL_EVERY = 10;

/**
 * How many of the squad's own dead may be handed to the physics layer in one
 * frame (D43).
 *
 * The same rule as above decides *which* of them — `usesRagdoll(index)` on the
 * crowd index, so the choice survives a gate and costs nothing to agree on —
 * but a squad death is not a kill: a brute reaching the column or a stream
 * leaking into it takes dozens of units on one step, and one in ten of dozens
 * is still more corpses than the pool holds. The rest keep the drawn corpse
 * they have always had, which is the right answer and not a fallback: a frame
 * that kills thirty mages is not a frame anyone is counting ragdolls in.
 */
export const MAX_FALLEN_PER_FRAME = 2;

/**
 * True when this body's death belongs to the physics layer.
 *
 * Two callers, two kinds of id: a stream body's `enemyId` (a block is `units`
 * skeletons and is handled whole by `src/render/enemies.ts`, and the boss has
 * its own clip), and a squad unit's crowd index.
 */
export function usesRagdoll(enemyId: number): boolean {
  return enemyId % RAGDOLL_EVERY === 0;
}
