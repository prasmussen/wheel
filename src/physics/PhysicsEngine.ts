import { FIXED_DT, type PhysicsConfig } from "../app/Config";
import type { SeededRandom } from "../utils/Random";
import { CONFIG_FIELDS, CONFIG_OFFSET, createPhysicsCore, EVENT_CAPACITY, EVENT_OFFSET, MAX_ADVANCE_TICKS, PREVIOUS_STATE_OFFSET, RUN_RESULT_OFFSET, SIMULATION_TIME_OFFSET, STATE_OFFSET } from "./WasmCore";

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

export interface SimulationRun {
  ticks: number;
  duration: number;
  settled: boolean;
  selectedIndex: number | null;
}

/** Browser-facing adapter. State, mechanics, and seeded draws live in Wasm. */
export class PhysicsEngine {
  private readonly core = createPhysicsCore();
  private readonly state = new Float64Array(this.core.memory.buffer, STATE_OFFSET, 7);
  private readonly previous = new Float64Array(this.core.memory.buffer, PREVIOUS_STATE_OFFSET, 7);
  private readonly runResult = new Float64Array(this.core.memory.buffer, RUN_RESULT_OFFSET, 2);
  private readonly clock = new Float64Array(this.core.memory.buffer, SIMULATION_TIME_OFFSET, 1);
  private configuration!: Readonly<PhysicsConfig>;
  private readonly settings = new Float64Array(this.core.memory.buffer, CONFIG_OFFSET, CONFIG_FIELDS.length);
  private readonly events = new Float64Array(this.core.memory.buffer, EVENT_OFFSET, EVENT_CAPACITY * 4);
  private readonly impactListeners = new Set<(event: PegImpact) => void>();
  readonly wheel: WheelState;
  readonly pointer: PointerState;

  constructor(config: Readonly<PhysicsConfig>, segmentCount: number) {
    const state = this.state;
    this.wheel = {
      get angle() { return state[0]; }, set angle(value) { state[0] = value; },
      get angularVelocity() { return state[1]; }, set angularVelocity(value) { state[1] = value; },
    };
    this.pointer = {
      get angle() { return state[2]; }, set angle(value) { state[2] = value; },
      get angularVelocity() { return state[3]; }, set angularVelocity(value) { state[3] = value; },
    };
    this.setConfig(config);
    this.core.init(segmentCount);
  }

  get config(): Readonly<PhysicsConfig> { return this.configuration; }
  get simulationTime(): number { return this.clock[0]; }

  /** Configuration is copied and immutable; updates are explicit, never polled per tick. */
  setConfig(config: Readonly<PhysicsConfig>): void {
    let changed = this.configuration === undefined;
    for (let index = 0; index < CONFIG_FIELDS.length; index++) {
      const value = config[CONFIG_FIELDS[index]];
      if (!Object.is(this.settings[index], value)) {
        this.settings[index] = value;
        changed = true;
      }
    }
    if (changed) {
      this.configuration = Object.freeze({ ...config });
      this.core.configure();
    }
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
    this.core.launch(charge, random.state);
    random.state = this.core.rng_state();
  }

  step(dt: number): void {
    this.core.step(dt);
    this.deliverImpacts();
  }

  /** One host call for a frame, preserving the previous/current interpolation pair. */
  advance(tickCount: number): void {
    if (!Number.isInteger(tickCount) || tickCount < 0 || tickCount > MAX_ADVANCE_TICKS) {
      throw new RangeError(`Expected 0–${MAX_ADVANCE_TICKS} fixed ticks`);
    }
    this.core.advance(tickCount);
    this.deliverImpacts();
  }

  /** Headless diagnostic run. Audio notifications are intentionally suppressed. */
  runUntilSettled(maxTicks = 45 / FIXED_DT): SimulationRun {
    if (!Number.isInteger(maxTicks) || maxTicks < 0 || maxTicks > 0x7fffffff) {
      throw new RangeError("Expected a nonnegative signed 32-bit tick limit");
    }
    const ticks = this.core.run_until_settled(maxTicks);
    const selectedIndex = this.runResult[1];
    return { ticks, duration: this.runResult[0], settled: selectedIndex >= 0,
      selectedIndex: selectedIndex >= 0 ? selectedIndex : null };
  }

  private deliverImpacts(): void {
    // Deliver after the complete tick or frame batch. Wasm never calls into JS, including
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

  snapshot(target?: PhysicsSnapshot): PhysicsSnapshot {
    return this.readSnapshot(this.state, target);
  }

  previousSnapshot(target?: PhysicsSnapshot): PhysicsSnapshot {
    return this.readSnapshot(this.previous, target);
  }

  private readSnapshot(values: Float64Array, target?: PhysicsSnapshot): PhysicsSnapshot {
    target ??= { wheel: { angle: 0, angularVelocity: 0 }, pointer: { angle: 0, angularVelocity: 0 },
      currentPeg: -1, lastImpact: 0, stableTime: 0 };
    target.wheel.angle = values[0]; target.wheel.angularVelocity = values[1];
    target.pointer.angle = values[2]; target.pointer.angularVelocity = values[3];
    target.stableTime = values[4]; target.lastImpact = values[5]; target.currentPeg = values[6];
    return target;
  }
}
