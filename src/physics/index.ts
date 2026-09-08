/**
 * The presentation-only Havok layer (Milestone 2, Phase B3).
 *
 * Owner: physics agent. The renderer and the app import from here; nothing
 * outside `src/physics` should reach into the files directly.
 *
 *   const physics = new PhysicsLayer(scene, { quality: 2 });
 *   await physics.init();          // Havok WASM, scene physics, both pools
 *   physics.loadLevel(level);      // road collider, pools emptied
 *   // per frame, before scene.render():
 *   physics.onEvents(events, state);
 *   physics.update(dt);
 *
 * Decision D18: it reads sim events and sim state and writes neither.
 */

export { PhysicsLayer } from './PhysicsLayer';
export type { PhysicsLayerOptions, PhysicsQuality, PhysicsStats } from './PhysicsLayer';
export { RAGDOLL_CAPACITY, SHARD_CAPACITY } from './tuning';
