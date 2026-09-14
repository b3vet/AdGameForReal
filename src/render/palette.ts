/**
 * The palette: one colour list for the whole Babylon layer, read from
 * `src/data/palette.json`.
 *
 * D36 made that file the single source of colour for render and UI, and this is
 * the render half of it: code names a *role* (`'spell.ember.body'`), never a
 * hex string, and the loader hands back a `Color3` for materials or the hex for
 * anything that paints into a 2D canvas (the sprite sheets, the glyph atlas).
 * The UI generates its CSS variables from the same file.
 *
 * Milestone 3 and 4 kept the same list as a wall of `new Color3(...)` literals
 * here; the named exports below are what the views already import, so they stay
 * — only their *source* changed. A view that wants a role the list has no name
 * for calls `paletteColor` directly rather than adding a literal.
 *
 * Bright and casual, per docs/09-milestone-3-plan.md and decision D28, now
 * expressed as roles: a blue sky falling to a pale horizon and a warm haze
 * band, warm stone road, green field, and three saturated spell colours —
 * ember orange, storm violet, frost cyan. Gate panels stay the most readable
 * thing in frame.
 *
 * The sky roles moved with Milestone 5: `sky.haze` is the warm band the fog
 * fades into and the hills are cut out of (`./sky.ts`), and the gradient runs
 * `sky.top` → `sky.mid` → `sky.horizon`. Milestone 3's names for those
 * (`SKY_ZENITH`, `SKY_HORIZON`, `SKY_HAZE`) are kept so the road and the biome
 * still compile while the art track migrates.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

import paletteJson from '@/data/palette.json';
import type { BiomeId } from '@/data/biome-types';

/**
 * Every dotted path in the palette that ends at a hex string:
 * `'arcane.base' | 'sky.top' | 'spell.ember.body' | ...`.
 *
 * Derived from the JSON itself rather than written out, so a role added to the
 * file is immediately spellable and a role removed from it stops compiling
 * wherever it was named. `$comment` is a string at the top level, so it lands
 * in the union and is excluded by hand.
 */
type RolePaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${RolePaths<T[K]>}`;
}[keyof T & string];

export type PaletteRole = Exclude<RolePaths<typeof paletteJson>, `$${string}`>;

/** The raw file, for the few callers that want to walk it (hex, CSS, tests). */
export const palette = paletteJson;

/**
 * Resolved `Color3`s, one per role, built on first use.
 *
 * Shared instances: every caller of `paletteColor('gold.base')` gets the same
 * object, exactly as the named exports below have always been shared. Nothing
 * *outside this file* may mutate one in place — `scale`, `clone` and
 * `Color3.LerpToRef` all write somewhere else, which is what the views already
 * do. `setBiome` is the one exception and it is why the rule matters: a biome
 * switch rewrites these objects rather than replacing them, so every `const`
 * below and every material that was handed one stays correct across a switch.
 */
const colors = new Map<string, Color3>();

/**
 * Which biome's overrides are in force (D49). `meadow` is the base list with
 * nothing over it, which is why it has no entry in `$biomes`.
 */
let biome: BiomeId = 'meadow';

/** The biome overrides, as a plain tree; `$` keys are not roles (see the JSON). */
const biomeOverrides: Record<string, unknown> = paletteJson.$biomes;

/** Walks a dotted role into a tree, or `null` if that tree does not carry it. */
function lookup(root: unknown, role: string): string | null {
  let node: unknown = root;
  for (const key of role.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === 'string' ? node : null;
}

/**
 * The hex string a role names, `'#rrggbb'`, under the biome in force.
 *
 * The override tree is consulted first and the base list answers everything it
 * does not carry, so a biome names only what it changes — the gates, the
 * spells and the UI stay one family across the whole game (D49).
 */
export function paletteHex(role: PaletteRole): string {
  if (biome !== 'meadow') {
    const override = lookup(biomeOverrides[biome], role);
    if (override !== null) return override;
  }
  const base = lookup(paletteJson, role);
  if (base === null) {
    // A throw rather than a fallback colour: the role union makes this
    // unreachable from TypeScript, so reaching it means the JSON and the types
    // have come apart and a silent magenta would hide it until a playtest.
    throw new Error(`palette.json has no colour at role "${role}"`);
  }
  return base;
}

/** The `Color3` a role names. Shared; only `setBiome` ever rewrites one. */
export function paletteColor(role: PaletteRole): Color3 {
  const cached = colors.get(role);
  if (cached !== undefined) return cached;
  const color = Color3.FromHexString(paletteHex(role));
  colors.set(role, color);
  return color;
}

/** Which biome's colours the roles are resolving to right now. */
export function paletteBiome(): BiomeId {
  return biome;
}

/**
 * Switches the palette to a biome's overrides and rewrites every `Color3` the
 * roles have already handed out. Answers whether anything changed, so a caller
 * can skip a rebuild it does not need.
 *
 * In place, and that is the whole design: `SKY_HAZE`, `ROAD_COLOR`,
 * `WALL_STONE_COLOR` and two dozen more are module constants bound at import
 * time, and several materials were handed the object itself as their
 * `diffuseColor`. Handing out fresh instances here would leave every one of
 * them pointing at the previous biome. What it does *not* do is repaint
 * anything already baked from a colour — a vertex buffer, a canvas texture, a
 * material colour that was copied rather than referenced. Those rebuild in the
 * views, which is what `Renderer.setBiome` fans out to.
 */
export function setBiome(id: BiomeId): boolean {
  if (id === biome) return false;
  biome = id;
  for (const [role, color] of colors) {
    // `role` came out of this same map, so it is a role the file carries; the
    // cast is the compiler catching up with that rather than a new claim.
    color.copyFrom(Color3.FromHexString(paletteHex(role as PaletteRole)));
  }
  return true;
}

/** Sky gradient, bottom to top; the dome is `./sky.ts`. */
export const SKY_HAZE = paletteColor('sky.haze');
export const SKY_HORIZON = paletteColor('sky.horizon');
export const SKY_MID = paletteColor('sky.mid');
export const SKY_ZENITH = paletteColor('sky.top');
/** What the canvas clears to: the top of the dome, for the pixels it misses. */
export const SKY = SKY_ZENITH;
/**
 * Daylight haze. The road runs into it at `FOG_END` (`./theme.ts`) and the
 * dome's hill band carries the same colour, so the far end of the level
 * dissolves into the hills instead of stopping in mid-air.
 */
export const FOG_COLOR = SKY_HAZE;

/** Warm stone, so the road is the bright floor the crowd reads against. */
export const ROAD_COLOR = paletteColor('stone.base');
/** Grass either side, the one large cool-green mass in the frame. */
export const FIELD_COLOR = paletteColor('grass.base');
/**
 * Lane runes. Arcane violet rather than Milestone 3's blue: `gate.mul` is the
 * gold arch now and `gate.fireRate` the blue one, which left a cool blue line
 * on the road meaning nothing. The gate panels still win, because they are two
 * metres tall and these are twelve centimetres wide.
 */
export const LANE_LINE_COLOR = paletteColor('arcane.light');
export const ARENA_COLOR = paletteColor('gold.base');

/** The three staffs. Everything a weapon touches is one of these three hues. */
export const EMBER_COLOR = paletteColor('spell.ember.body');
export const STORM_COLOR = paletteColor('spell.storm.body');
export const FROST_COLOR = paletteColor('spell.frost.body');

/** The stand-in colour for a crowd whose model could not be loaded. */
export const ENEMY_COLOR = paletteColor('danger.base');
export const BOSS_ENRAGE_COLOR = paletteColor('danger.light');
export const STOMP_COLOR = paletteColor('spell.ember.body');

/**
 * Gate tints, per `GateKind`.
 *
 * `mul` is gold and `fireRate` is blue, which is the swap the Milestone 5
 * palette makes: the arches are built as a gold crown for multipliers and a
 * blue crystal for fire rate (plan, "Gates too basic"), and the panel tint has
 * to agree with the arch it sits in.
 */
export const GATE_TINTS = {
  add: paletteColor('gate.add'),
  sub: paletteColor('gate.sub'),
  mul: paletteColor('gate.mul'),
  fireRate: paletteColor('gate.fireRate'),
  /**
   * Staff gates. A violet leaning white rather than another saturated hue: this
   * is the only panel that prints a word instead of a number, and the pale tint
   * keeps the letters legible while the violet still reads apart from the rest.
   */
  weapon: paletteColor('gate.weapon'),
} as const;

/**
 * Label ink. The digit atlas paints its glyphs white with a near-black outline
 * and the shader multiplies by these, so a tint only ever darkens the ink and
 * the outline stays the outline (`src/render/labels.ts`). All four are the
 * palette's near-whites, which is what keeps them ink rather than colour.
 */
export const GATE_LABEL_COLOR = paletteColor('parchment.panel');
export const ENEMY_LABEL_COLOR = paletteColor('bone.base');
export const BOSS_LABEL_COLOR = paletteColor('parchment.base');
/**
 * The number floating over a stream's head. In the gate numbers' family — white
 * ink with the atlas's own dark outline — so the player reads it as "a number
 * that matters" rather than as another enemy HP tag, but cooled a shade so it
 * is not mistaken for a gate on a lane with no panel in it.
 */
export const STREAM_LABEL_COLOR = paletteColor('sky.horizon');

/** The ring under a frost-slowed block: the frost staff's own hue. */
export const SLOW_RING_COLOR = FROST_COLOR;

/**
 * Lane walls (D32): dark stone for the posts and rails, an amber rune for the
 * top edge.
 *
 * The stone has to be the road's own family two steps darker, not a colour of
 * its own: a fence at `x = ±1` stands on light stone with green either side,
 * and at twenty metres a stone-coloured post against a stone road is the same
 * pixel. `stone.deep` is what gives the posts an edge; the rune then reads as
 * the lit part of a solid thing rather than as a line floating over the road.
 *
 * Amber rather than one of the spell hues: the fence is in frame for ten to
 * twenty metres at a time, right next to the gate panels, and every saturated
 * hue in the palette already means something the player has to decide about.
 * Gold is the one warm accent nothing else claims on the road.
 */
export const WALL_STONE_COLOR = paletteColor('stone.deep');
export const WALL_RUNE_COLOR = paletteColor('gold.base');

/**
 * The wisp (D33). A pale green will-o'-the-wisp: the one hue on the road that
 * is neither a staff nor a gate, so a familiar hovering beside the squad is
 * never mistaken for the squad's own fire. The sprite sheet carries a white-hot
 * core, so this only has to say which way the rim leans.
 */
export const WISP_COLOR = paletteColor('grass.light');

/**
 * Ember's burn (D33). Hotter and yellower than `EMBER_COLOR`: a body alight is
 * lit from inside, and the flame has to read on top of the ember impacts
 * already going off on the same body.
 */
export const BURN_COLOR = paletteColor('spell.ember.core');

/** Blob shadows (`./shadows.ts`): the one dark the palette carries. */
export const SHADOW_COLOR = paletteColor('shadow.blob');
