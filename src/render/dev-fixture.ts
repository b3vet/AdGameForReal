/**
 * The level and the empty `RunState` the dev fixture plays on.
 *
 * Split out of `dev-scenario.ts` so that file stays about the scenario's
 * behaviour rather than its setup.
 */

import { balance, levelConfig } from '@/data';
import { generateLevel } from '@/sim';
import type {
  EnemyState,
  GateState,
  LevelDef,
  ProjectileState,
  RowDef,
  RunState,
  SquadState,
  WallDef,
  WeaponId,
} from '@/sim';

/** The generator is the sim agent's; if it is still a stub, fall back to a fixture. */
export function buildDevLevel(): LevelDef {
  const config = levelConfig(1);
  const generated = generateLevel(1, config, config.seed);
  const level = generated.rows.length > 0 ? generated : handBuiltLevel();
  return withWalls(withStaffGates(level));
}

/**
 * Forces two wall stretches into the fixture's level, one per boundary (D32).
 *
 * Level 1 has `wallRows: 0` — walls start at level 4 — so without this the one
 * thing Phase B2 added to the road would never appear in the scene the render
 * layer is reviewed in. The geometry follows the generator's own rule: a
 * stretch ends `walls.gateClearance` short of the row it guards, so the row is
 * still approachable from both of its sides.
 */
function withWalls(level: LevelDef): LevelDef {
  const clearance = balance.walls.gateClearance;
  const walls: WallDef[] = [];
  let boundary: 1 | -1 = 1;
  for (const index of WALL_ROWS) {
    const row = level.rows[index];
    const previous = level.rows[index - 1];
    if (row === undefined || previous === undefined) continue;
    const zEnd = row.z - clearance;
    const zStart = Math.max(previous.z + clearance, zEnd - balance.walls.length.max);
    if (zEnd - zStart < balance.walls.minLength) continue;
    walls.push({ boundary, zStart, zEnd });
    boundary = boundary === 1 ? -1 : 1;
  }
  return { ...level, walls };
}

/** Which rows the fixture walls the approach to; one per boundary. */
const WALL_ROWS = [2, 5];

/**
 * Forces two staff gates into the fixture's level.
 *
 * `gen.weaponGatesEnabled` is off in `balance.json` until the renderer draws
 * staffs — which is exactly what this scene is for — so without this the one
 * gate kind that carries a floating prop above its panel would never appear in
 * the fixture and could not be reviewed.
 */
function withStaffGates(level: LevelDef): LevelDef {
  const staffed: LevelDef['rows'] = level.rows.map((row, index) => {
    const offer = STAFF_ROWS.get(index);
    if (offer === undefined) return row;
    // The tuple shape is part of `RowDef`: three lanes, some of them empty.
    const gates: RowDef['gates'] = [row.gates[0], row.gates[1], row.gates[2]];
    gates[offer.slot] = { kind: 'weapon', value: 0, weaponId: offer.weaponId };
    return { ...row, gates };
  });
  return { ...level, rows: staffed };
}

/** Which row offers which staff, and in which lane slot (0, 1, 2 = left to right). */
const STAFF_ROWS = new Map<number, { slot: 0 | 1 | 2; weaponId: WeaponId }>([
  [1, { slot: 2, weaponId: 'storm' }],
  [4, { slot: 0, weaponId: 'frost' }],
]);

function handBuiltLevel(): LevelDef {
  const rows: LevelDef['rows'] = [
    { z: 24, gates: [{ kind: 'add', value: 5 }, { kind: 'mul', value: 2 }, { kind: 'sub', value: 3 }], enemies: [] },
    { z: 42, gates: [null, null, null], enemies: [{ kind: 'grunt', lane: 0, units: 8 }] },
    { z: 60, gates: [{ kind: 'sub', value: 6 }, { kind: 'add', value: 12 }, { kind: 'fireRate', value: 0.1 }], enemies: [] },
    { z: 78, gates: [null, null, null], enemies: [{ kind: 'brute', lane: -1, units: 12 }] },
    { z: 96, gates: [{ kind: 'mul', value: 3 }, { kind: 'sub', value: 20 }, { kind: 'add', value: 40 }], enemies: [] },
    { z: 114, gates: [null, null, null], enemies: [{ kind: 'grunt', lane: 1, units: 20 }] },
    { z: 132, gates: [{ kind: 'add', value: 25 }, { kind: 'sub', value: 30 }, { kind: 'fireRate', value: 0.25 }], enemies: [] },
    { z: 150, gates: [null, null, null], enemies: [{ kind: 'brute', lane: 0, units: 26 }] },
  ];
  return { index: 1, seed: 1, runSpeed: 5, startCount: 5, rows, arenaZ: 168, boss: { hp: 1200, units: 120 } };
}

export function emptyDevState(level: LevelDef): RunState {
  const squad: SquadState = {
    count: level.startCount,
    x: 0,
    targetX: 0,
    z: 0,
    fireRate: balance.squad.fireRate,
    damage: balance.squad.damage,
    fireRateBonus: 0,
  };

  const projectiles: ProjectileState[] = [];
  for (let i = 0; i < balance.projectiles.max; i++) {
    projectiles.push({ id: i, x: 0, z: 0, alive: false });
  }

  const gates: GateState[] = [];
  const enemies: EnemyState[] = [];

  return {
    levelIndex: level.index,
    seed: level.seed,
    time: 0,
    status: 'running',
    squad,
    gates,
    enemies,
    streams: [],
    projectiles,
    boss: null,
    peakCount: level.startCount,
    survivors: level.startCount,
    arenaZ: level.arenaZ,
    // The wisp and the walls are the fixture's to drive (`dev-extras.ts`); both
    // are optional on `RunState`, and both are written by `DevExtras.reset`.
    familiar: null,
    walls: level.walls ?? [],
  };
}
