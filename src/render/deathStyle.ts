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
 * True when this body's death belongs to the physics layer.
 *
 * Only meaningful for stream bodies: a block is `units` skeletons and is
 * handled whole by `src/render/enemies.ts`, and the boss has its own clip.
 */
export function usesRagdoll(enemyId: number): boolean {
  return enemyId % RAGDOLL_EVERY === 0;
}
