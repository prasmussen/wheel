import bytes from "./wasm/physics.wat?wasm";
import type { PhysicsConfig } from "../app/Config";

/** ABI for physics.wat. Every numerical operation lives in that module. */
export interface PhysicsExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  init(count: number): void;
  set_count(count: number): void;
  get_count(): number;
  launch(charge: number, seed: number): void;
  step(dt: number): void;
  is_settled(): number;
  event_count(): number;
  hash_seed(hash: number, length: number): number;
  finish_seed(hash: number): number;
  rng_sample(state: number, min: number, max: number): number;
  rng_state(): number;
  launch_speed(charge: number, firstDraw: number, secondDraw: number): number;
  brake_torque(velocity: number, strength: number): number;
  brake_release(charge: number): number;
  math_round(value: number): number;
  math_wrap(value: number): number;
  math_sin(value: number): number;
  math_cos(value: number): number;
  math_exp(value: number): number;
  math_hypot(x: number, y: number): number;
}

export const physicsModule = new WebAssembly.Module(bytes);

export function createPhysicsCore(): PhysicsExports {
  return new WebAssembly.Instance(physicsModule).exports as PhysicsExports;
}

// Stateless calculations share an instance. RNG state belongs to its caller;
// each simulation gets its own instance and cannot affect another wheel.
export const numericCore = createPhysicsCore();

export const CONFIG_FIELDS = [
  "wheelInertia", "linearDrag", "brakeDrag", "quadraticDrag", "bearingFriction",
  "pointerSpring", "pointerDamping", "pointerInertia", "collisionRestitution", "collisionCoupling",
] as const satisfies readonly (keyof PhysicsConfig)[];

export const STATE_OFFSET = 0;
export const CONFIG_OFFSET = 64;
export const EVENT_OFFSET = 1024;
export const EVENT_CAPACITY = 256;
export const SEED_OFFSET = 32768;
export const SEED_CAPACITY = 8192;
