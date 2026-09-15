/**
 * How the six Milestone 8 evolutions are drawn (D54).
 *
 * Numbers only, in the family of `./spellLook.ts` and `./monsterLook.ts`: the
 * file that draws them is long enough without the metres and seconds that
 * describe them, and every one of these is a *look* rather than a rule — how
 * far a mechanic actually reaches is the sim's, and it arrives on the event.
 *
 * Two of the six need nothing here. Wildfire is the burn visual on one more
 * body (`./burn.ts`), because that is exactly what it is: a fire handed on.
 * Full chains are the chain arc that was already drawn, at its own length.
 */

/**
 * The meteor (ember tier 4). A bright head falling out of frame onto the aim
 * point, a flash where it lands, a crater ring that stays a beat, and a kick.
 *
 * `FALL_SECONDS` is a *look*, not the sim's clock: the sim resolves the strike
 * in one step and emits one event, so the fall is drawn backwards from the
 * landing — the head is placed where it would have been that many seconds ago
 * and catches up. Kept short so the strike still reads as sudden.
 */
export const METEOR_FALL_SECONDS = 0.45;
export const METEOR_HEIGHT = 16;
/** How far up the road the head starts, so it falls forward rather than down. */
export const METEOR_LEAD = 5;
export const METEOR_HEAD_SIZE = 1.5;
/** The trail behind the head: this many quads, each this far back and dimmer. */
export const METEOR_TAIL = 4;
export const METEOR_TAIL_GAP = 0.8;
/** The flash at the landing, as a share of the strike's own radius. */
export const METEOR_FLASH_SIZE = 1.3;
export const METEOR_FLASH_DURATION = 0.34;
/** Bursts thrown around the rim of the crater as it lands. */
export const METEOR_BURSTS = 7;
/**
 * The crater: a ring on the ground at the sim's own radius, fading over this
 * long. `INNER` is the hole, as a share of the radius, so what is left is a rim
 * rather than a disc — a crater is an edge.
 */
export const METEOR_CRATER_SECONDS = 1.6;
export const METEOR_CRATER_INNER = 0.62;
export const METEOR_CRATER_ALPHA = 0.5;
/**
 * The kick. Deliberately under the stomp's (`SHAKE_STOMP`, 0.15 for 0.3 s): the
 * stomp is three metres of boss landing on the crowd and this is the player's
 * own spell, so a meteor that outshook it would read as being hit.
 */
export const METEOR_SHAKE = { strength: 0.1, seconds: 0.24 } as const;

/**
 * Overcharge (storm tier 4): the volley arcs to everything at once.
 *
 * The arcs are the chain visual — the same crackling line the staff already
 * draws between two blocks — thrown from the crowd to each body the sim says it
 * reached, which is what makes "everything at once" legible as the same
 * mechanic rather than as a new one. `ARC_CAP` is the chain pool's share this
 * may take in one frame, so an arc to the twentieth body never costs the
 * ordinary chains their slots.
 */
export const OVERCHARGE_ARC_CAP = 10;
/** Where the arcs are thrown from, relative to the squad's head. */
export const OVERCHARGE_FROM_Z = 0.6;
/** The flash at the crowd: brighter and bigger than an impact, and no longer. */
export const OVERCHARGE_FLASH_SIZE = 2.2;
export const OVERCHARGE_FLASH_DURATION = 0.3;
export const OVERCHARGE_GLOW_BOOST = 2.4;

/**
 * The freeze pulse (frost tier 3): a ring of cold thrown out from a body that
 * died frozen, to the radius the sim chilled.
 *
 * It *expands* rather than sitting at the radius, because the whole point of
 * the mechanic is that the cold spread — a static ring at the final radius
 * would read as another shatter. The ring thins as it goes out.
 */
export const FREEZE_RING_SECONDS = 0.5;
export const FREEZE_RING_START = 0.25;
export const FREEZE_RING_INNER = 0.55;
export const FREEZE_RING_ALPHA = 0.55;

/**
 * The glacier (frost tier 4): a wall of ice across one lane.
 *
 * Its length is the lane's own width and its `z` is the sim's; the only thing
 * chosen here is how solid it looks and how it arrives and leaves. It rises out
 * of the road rather than appearing, and melts back into it at the end of the
 * hold — both short, because the wall is up for a few seconds and an entrance
 * that costs a quarter of that is a wall that is always moving.
 */
export const GLACIER_HEIGHT = 1.6;
export const GLACIER_THICKNESS = 0.55;
export const GLACIER_RISE_SECONDS = 0.22;
export const GLACIER_MELT_SECONDS = 0.45;
export const GLACIER_ALPHA = 0.72;
/** How much of the ice is lit from inside, so it reads as ice and not as stone. */
export const GLACIER_EMISSIVE = 0.45;

/**
 * Ground marks the evolutions may have up at once, on top of the monsters'
 * (`SPRAY_DECAL_POOL`). A meteor crater and a couple of freeze rings is the
 * realistic worst case; the pool is what keeps one from taking a charger's
 * dust away.
 */
export const EVOLUTION_DECAL_POOL = 12;
