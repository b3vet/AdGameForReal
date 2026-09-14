/**
 * Turning a `LevelDef` into the mutable actors a run works with.
 * Runs once per run, so readability wins over allocation counting here.
 */

import { enemyBalance } from './enemies';
import { gateCap } from './gates';
import { laneCenter } from './lanes';
import type { LevelDef } from './level';
import { shieldFor } from './shields';
import type { EnemyState, GateState, Lane } from './types';
import type { Balance } from '@/data/types';

export interface World {
  gates: GateState[];
  enemies: EnemyState[];
  /** Null on the endless road, which has no arena and no boss to stand in it (D52). */
  boss: EnemyState | null;
  /** Where stream bodies carry on numbering from, so every id stays unique. */
  nextId: number;
}

export function buildWorld(level: LevelDef, balance: Balance): World {
  const gates: GateState[] = [];
  const enemies: EnemyState[] = [];
  let nextId = 0;

  for (let rowIndex = 0; rowIndex < level.rows.length; rowIndex++) {
    const row = level.rows[rowIndex];
    if (row === undefined) continue;

    for (let slot = 0; slot < row.gates.length; slot++) {
      const def = row.gates[slot];
      if (def === undefined || def === null) continue;
      const gate: GateState = {
        id: nextId++,
        rowIndex,
        lane: (slot - 1) as Lane,
        z: row.z,
        kind: def.kind,
        value: def.value,
        hits: 0,
        passed: false,
        // Frozen here rather than derived per hit: a cap that tracked the value
        // it bounds would creep upward for as long as the player kept shooting.
        cap: def.cap ?? gateCap(def.kind, def.value, balance),
      };
      if (def.weaponId !== undefined) gate.weaponId = def.weaponId;
      gates.push(gate);
    }

    for (const def of row.enemies) {
      const config = enemyBalance(def.kind, balance);
      const hp = def.units * config.hpPerUnit;
      const enemy: EnemyState = {
        id: nextId++,
        kind: def.kind,
        x: laneCenter(def.lane, balance.road.laneWidth),
        // Mixed rows stand their block short of the gate row (`dz`), so the two
        // labels never print on top of each other.
        z: row.z + (def.dz ?? 0),
        hp,
        maxHp: hp,
        units: def.units,
        speed: config.speed,
        active: false,
        alive: true,
        slowUntil: 0,
        diedAt: 0,
      };
      // The shield is a share of the body it stands in front of (D49), so a
      // bigger brute carries a bigger shield and the label still reads the
      // body alone.
      if (def.kind === 'shieldBrute') enemy.shield = shieldFor(hp, balance);
      enemies.push(enemy);
    }
  }

  if (level.endless === true) return { gates, enemies, boss: null, nextId };

  const boss: EnemyState = {
    id: nextId,
    kind: 'boss',
    x: 0,
    z: level.arenaZ + balance.level.bossOffset,
    hp: level.boss.hp,
    maxHp: level.boss.hp,
    units: level.boss.units,
    speed: balance.enemies.boss.speed,
    active: false,
    alive: true,
    slowUntil: 0,
    diedAt: 0,
    enraged: false,
    // Which boss stands here (D49). Written always rather than only for the
    // Rime Fiend, so render never has to guess what an absent field means.
    variant: level.boss.kind ?? 'demon',
  };

  return { gates, enemies, boss, nextId: nextId + 1 };
}
