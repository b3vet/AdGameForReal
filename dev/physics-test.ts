/**
 * Physics proof scene: `npm run dev`, then open `/dev/physics-test.html`.
 *
 * A stretch of road, a hand-built `RunState` that never ticks, and a scripted
 * event stream — a kill every 1.5 s, a frost shatter every 4 s, a gate every
 * 3 s, a boss stomp every 6 s — fed to `PhysicsLayer.onEvents` exactly the way
 * the app will feed it. Nothing here is the game: it exists so the pools, the
 * ragdoll rig and the degrade ladder can be looked at on their own.
 *
 *   ?quality=0|1|2   start at a quality (keys 0/1/2 and Q change it live)
 *   ?pin=1           hold that quality: the degrade ladder cannot lower it
 *   ?kill=1.5 ?shatter=4 ?gate=3 ?stomp=6   event intervals; 0 turns one off
 *   ?boss=0          seconds between boss deaths; off by default
 *   ?radius=6        camera distance; ?beta, ?alpha, ?z aim it
 *
 * A screenshot script waits for `__physicsTest.ready` and reads
 * `__physicsTest.stats()`.
 */

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Scene } from '@babylonjs/core/scene';

import { balance } from '@/data';
import { PhysicsLayer } from '@/physics';
import type { PhysicsQuality, PhysicsStats } from '@/physics';
import { laneCenter, mulberry32 } from '@/sim';
import type { GateState, Lane, LevelDef, RunState, SimEvent } from '@/sim';

interface PhysicsTestHandle {
  ready: boolean;
  stats: () => PhysicsStats & { fps: number; drawCalls: number };
  setQuality: (quality: PhysicsQuality) => void;
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __physicsTest: PhysicsTestHandle | undefined;
}

const ARENA_Z = 40;
const ROAD_START_Z = -10;
const ROAD_END_Z = 60;
/** Where the scripted carnage happens, in front of the fake squad. */
const ACTION_Z = 9;

const DEFAULT_KILL_EVERY = 1.5;
const DEFAULT_SHATTER_EVERY = 4;
const DEFAULT_GATE_EVERY = 3;
const DEFAULT_STOMP_EVERY = 6;
/** Off by default: the scripted stream in the plan is the four above. */
const DEFAULT_BOSS_EVERY = 0;

const canvas = document.querySelector<HTMLCanvasElement>('#physics-test-canvas');
const hudElement = document.querySelector<HTMLElement>('#hud');
if (canvas === null || hudElement === null) {
  throw new Error('dev/physics-test.html is missing its canvas or HUD');
}
const hud: HTMLElement = hudElement;

const params = new URLSearchParams(window.location.search);
const number = (key: string, fallback: number): number => {
  const raw = Number(params.get(key));
  return Number.isFinite(raw) && params.get(key) !== null ? raw : fallback;
};
const startQuality = Math.min(2, Math.max(0, Math.round(number('quality', 2)))) as PhysicsQuality;
/**
 * Under SwiftShader the scene draws at a handful of frames a second, which is
 * exactly what the degrade ladder is built to notice — so a screenshot run that
 * wants to watch quality 2 for ten seconds has to pin it.
 */
const pinQuality = number('pin', 0) === 1;
const killEvery = number('kill', DEFAULT_KILL_EVERY);
const shatterEvery = number('shatter', DEFAULT_SHATTER_EVERY);
const gateEvery = number('gate', DEFAULT_GATE_EVERY);
const stompEvery = number('stomp', DEFAULT_STOMP_EVERY);
const bossEvery = number('boss', DEFAULT_BOSS_EVERY);

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false }, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.043, 0.051, 0.078, 1);

const camera = new ArcRotateCamera(
  'camera',
  number('alpha', -Math.PI / 2),
  number('beta', 1.16),
  number('radius', 7),
  new Vector3(0, 0.5, number('z', ACTION_Z)),
  scene,
);
camera.attachControl(canvas, true);
camera.minZ = 0.05;

const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.6), scene);
sun.intensity = 1.6;
const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
sky.intensity = 0.8;

/** The road the physics ground sits under, so debris has something to read against. */
// Drawn as wide as the collider, not as wide as the drivable road, so a shard
// resting on the half-metre margin does not read as a shard resting on nothing.
const road = CreateGround(
  'road',
  { width: (balance.road.halfWidth + 0.5) * 2, height: ROAD_END_Z - ROAD_START_Z },
  scene,
);
road.position.set(0, 0, (ROAD_START_Z + ROAD_END_Z) / 2);
const roadMaterial = new StandardMaterial('roadMat', scene);
roadMaterial.diffuseColor = new Color3(0.28, 0.26, 0.24);
roadMaterial.specularColor = new Color3(0.05, 0.05, 0.06);
road.material = roadMaterial;
road.isPickable = false;

const level: LevelDef = {
  index: 1,
  seed: 1,
  runSpeed: balance.squad.runSpeed,
  startCount: 30,
  rows: [],
  arenaZ: ARENA_Z,
  boss: { hp: 400, units: 40 },
};

const gates: GateState[] = ([-1, 0, 1] as Lane[]).map((lane, index) => ({
  id: index + 1,
  rowIndex: 0,
  lane,
  z: ACTION_Z + 2,
  kind: index === 0 ? 'add' : index === 1 ? 'sub' : 'mul',
  value: 6,
  hits: 0,
  passed: false,
}));

const state: RunState = {
  levelIndex: 1,
  seed: 1,
  time: 0,
  status: 'running',
  squad: { count: 60, x: 0, targetX: 0, z: 0, fireRate: 2, damage: 1, fireRateBonus: 0 },
  gates,
  enemies: [],
  projectiles: [],
  boss: null,
  peakCount: 60,
  survivors: 60,
  arenaZ: ARENA_Z,
};

const physics = new PhysicsLayer(scene, { quality: startQuality });
const random = mulberry32(0xc0ffee);
const events: SimEvent[] = [];

let enemyId = 100;
let sinceKill = 0;
let sinceShatter = 0;
let sinceGate = 0;
let sinceStomp = 0;
let sinceBoss = 0;
let elapsed = 0;

/** A lane centre, jittered, somewhere in front of the fake squad. */
function actionX(): number {
  return laneCenter(([-1, 0, 1] as Lane[])[Math.floor(random() * 3)] ?? 0) + (random() - 0.5) * 0.8;
}

function script(dt: number): void {
  events.length = 0;
  elapsed += dt;
  sinceKill += dt;
  sinceShatter += dt;
  sinceGate += dt;
  sinceStomp += dt;
  sinceBoss += dt;

  if (killEvery > 0 && sinceKill >= killEvery) {
    sinceKill -= killEvery;
    events.push({
      type: 'enemyKilled',
      enemyId: ++enemyId,
      kind: random() < 0.3 ? 'brute' : 'grunt',
      x: actionX(),
      z: ACTION_Z + (random() - 0.5) * 3,
    });
  }
  if (shatterEvery > 0 && sinceShatter >= shatterEvery) {
    sinceShatter -= shatterEvery;
    events.push({
      type: 'enemyShattered',
      enemyId: ++enemyId,
      x: actionX(),
      z: ACTION_Z + (random() - 0.5) * 3,
    });
  }
  if (gateEvery > 0 && sinceGate >= gateEvery) {
    sinceGate -= gateEvery;
    const gate = gates[Math.floor(random() * gates.length)];
    if (gate !== undefined) {
      events.push({
        type: 'gatePassed',
        gateId: gate.id,
        kind: gate.kind,
        value: gate.value,
        countBefore: 60,
        countAfter: 66,
      });
    }
  }
  if (stompEvery > 0 && sinceStomp >= stompEvery) {
    sinceStomp -= stompEvery;
    events.push({ type: 'bossStomp', x: 0, z: ACTION_Z });
  }
  // Both events, in the order the sim emits them, so the layer's guard against
  // spawning the ring twice is exercised rather than assumed.
  if (bossEvery > 0 && sinceBoss >= bossEvery) {
    sinceBoss -= bossEvery;
    events.push({ type: 'enemyKilled', enemyId: ++enemyId, kind: 'boss', x: 0, z: ACTION_Z + 2 });
    events.push({ type: 'bossKilled' });
  }
}

function readStats(): PhysicsStats & { fps: number; drawCalls: number } {
  return {
    ragdolls: physics.stats.ragdolls,
    shards: physics.stats.shards,
    bodies: physics.stats.bodies,
    quality: physics.stats.quality,
    fps: Math.round(engine.getFps()),
    drawCalls: instrumentation.drawCallsCounter.current,
  };
}

const instrumentation = new SceneInstrumentation(scene);
instrumentation.captureFrameTime = true;

function setQuality(quality: PhysicsQuality): void {
  physics.setQuality(quality);
}

window.addEventListener('keydown', (event) => {
  if (event.key === '0') setQuality(0);
  else if (event.key === '1') setQuality(1);
  else if (event.key === '2') setQuality(2);
  else if (event.key.toLowerCase() === 'q') {
    setQuality(((physics.stats.quality + 2) % 3) as PhysicsQuality);
  }
});

async function main(): Promise<void> {
  await physics.init();
  physics.loadLevel(level);

  engine.runRenderLoop(() => {
    // Clamped so a stall does not fire one enormous scripted burst.
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    script(dt);
    physics.onEvents(events, state);
    physics.update(dt);
    if (pinQuality) physics.setQuality(startQuality);
    scene.render();
  });
  window.addEventListener('resize', () => {
    engine.resize();
  });

  scene.onAfterRenderObservable.add(() => {
    const current = readStats();
    hud.innerHTML =
      `<b>quality</b> ${String(current.quality)}   <b>ragdolls</b> ${String(current.ragdolls)}` +
      `   <b>shards</b> ${String(current.shards)}   <b>bodies</b> ${String(current.bodies)}\n` +
      `<b>fps</b> ${String(current.fps)}   <b>draw calls</b> ${String(current.drawCalls)}` +
      `   <b>t</b> ${elapsed.toFixed(1)}s\nkeys 0/1/2 or Q change quality`;
  });

  globalThis.__physicsTest = { ready: true, stats: readStats, setQuality };
}

main().catch((error: unknown) => {
  hud.textContent = `FAILED: ${String(error)}`;
  console.error('[physics-test] failed to start', error);
});
