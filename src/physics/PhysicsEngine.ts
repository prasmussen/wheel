import type { PhysicsConfig } from "../app/Config";
import type { SeededRandom } from "../utils/Random";
import { CONFIG_FIELDS, CONFIG_OFFSET, createPhysicsCore, EVENT_CAPACITY, EVENT_OFFSET, STATE_OFFSET } from "./WasmCore";

export interface WheelState { angle: number; angularVelocity: number }
export interface PointerState { angle: number; angularVelocity: number }
export interface PegImpact {
  pegIndex: number;
  strength: number;
  wheelVelocity: number;
  timestamp: number;
}
export interface PhysicsSnapshot {
  wheel: WheelState;
  pointer: PointerState;
  currentPeg: number;
  lastImpact: number;
  stableTime: number;
}

/** Browser-facing adapter. State, mechanics, and seeded draws live in Wasm. */
export class PhysicsEngine {
  private readonly core = createPhysicsCore();
  private readonly state = new Float64Array(this.core.memory.buffer, STATE_OFFSET, 7);
  private readonly settings = new Float64Array(this.core.memory.buffer, CONFIG_OFFSET, CONFIG_FIELDS.length);
  private readonly events = new Float64Array(this.core.memory.buffer, EVENT_OFFSET, EVENT_CAPACITY * 4);
  private readonly impactListeners = new Set<(event: PegImpact) => void>();
  readonly wheel: WheelState;
  readonly pointer: PointerState;

  constructor(public config: PhysicsConfig, segmentCount: number) {
    const state = this.state;
    this.wheel = {
      get angle() { return state[0]; }, set angle(value) { state[0] = value; },
      get angularVelocity() { return state[1]; }, set angularVelocity(value) { state[1] = value; },
    };
    this.pointer = {
      get angle() { return state[2]; }, set angle(value) { state[2] = value; },
      get angularVelocity() { return state[3]; }, set angularVelocity(value) { state[3] = value; },
    };
    this.syncConfig();
    this.core.init(segmentCount);
  }

  get segmentCount(): number { return this.core.get_count(); }
  get stableTime(): number { return this.state[4]; }
  get lastImpactStrength(): number { return this.state[5]; }

  onImpact(listener: (event: PegImpact) => void): () => void {
    this.impactListeners.add(listener);
    return () => this.impactListeners.delete(listener);
  }

  setSegmentCount(count: number): void { this.core.set_count(count); }

  launch(charge: number, random: SeededRandom): void {
    this.syncConfig();
    this.core.launch(charge, random.state);
    random.state = this.core.rng_state();
  }

  step(dt: number): void {
    this.syncConfig();
    this.core.step(dt);
    // Deliver after the complete tick. Wasm never calls into JS, including
    // during contact resolution. Each event keeps its simulation timestamp.
    const count = this.core.event_count();
    if (this.impactListeners.size === 0 || count === 0) return;
    // Snapshot before callbacks, so a listener may safely reset the engine.
    const pending: PegImpact[] = [];
    for (let index = 0; index < count; index++) {
      const offset = index * 4;
      pending.push({ pegIndex: this.events[offset], strength: this.events[offset + 1],
        wheelVelocity: this.events[offset + 2], timestamp: this.events[offset + 3] });
    }
    for (const event of pending) for (const listener of this.impactListeners) listener(event);
  }

  isSettled(): boolean { return this.core.is_settled() !== 0; }

  snapshot(): PhysicsSnapshot {
    return {
      wheel: { angle: this.state[0], angularVelocity: this.state[1] },
      pointer: { angle: this.state[2], angularVelocity: this.state[3] },
      currentPeg: this.state[6], lastImpact: this.state[5], stableTime: this.state[4],
    };
  }

  private syncConfig(): void {
    // Preserve callers' existing mutable PhysicsConfig interface.
    for (let index = 0; index < CONFIG_FIELDS.length; index++) this.settings[index] = this.config[CONFIG_FIELDS[index]];
  }
}
