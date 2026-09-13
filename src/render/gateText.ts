/**
 * What a gate prints: the number, the sign, and the one word a staff gate says.
 *
 * Split out of `./gates.ts` so that file is the pool and the frame. The rules
 * are small but they are *rules*, not formatting: gate values are floats
 * because growth is rate-based (D19), `sub` stores its penalty positive, and a
 * staff gate prints a name the renderer chooses rather than the sim's id.
 */

import type { GateKind, WeaponId } from '@/sim';

/**
 * What a staff gate prints. The sim's ids are lower case; a table rather than
 * `charAt(0).toUpperCase()` so the arch's word is chosen here, in render, and
 * so a new staff cannot ship without one.
 */
const STAFF_NAMES: Record<WeaponId, string> = {
  ember: 'Ember',
  storm: 'Storm',
  frost: 'Frost',
};

/**
 * What the player reads. Gate values are floats — growth is rate-based — so
 * every branch rounds; `sub` stores its penalty positive, so it prints the sign.
 */
export function gateText(kind: GateKind, value: number, weaponId?: WeaponId): string {
  switch (kind) {
    case 'mul':
      return `x${String(whole(value))}`;
    case 'add':
      return `+${String(whole(value))}`;
    case 'sub': {
      const penalty = whole(value);
      // A shot-down `sub` spends its last fraction of a unit before the sim
      // flips it to `add`. Gluing the sign on would print "-0" for that frame.
      return penalty === 0 ? '0' : `-${String(penalty)}`;
    }
    case 'fireRate':
      return `+${String(whole(value * 100))}%`;
    case 'weapon':
      return weaponId === undefined ? 'Staff' : STAFF_NAMES[weaponId];
  }
}

/** `Math.round` hands back `-0` for small negatives, which prints with a sign. */
function whole(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}
