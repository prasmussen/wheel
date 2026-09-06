import { DEFAULT_PHYSICS, FIXED_DT, SIMULATION_VERSION } from "../../src/app/Config";
import { PhysicsEngine, type PhysicsSnapshot } from "../../src/physics/PhysicsEngine";
import { physicsModule } from "../../src/physics/WasmCore";
import bytes from "../../src/physics/wasm/physics.wat?wasm";
import { SeededRandom } from "../../src/utils/Random";
import { selectedIndex } from "../../src/wheel/SegmentLayout";
import type { ReplayScenario } from "./scenarios";

const maxTicks = 10800;
const framePattern = [0, 1, 4, 30, 2, 8];

function base64(data: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += 32768) {
    chunks.push(String.fromCharCode(...data.subarray(offset, offset + 32768)));
  }
  return btoa(chunks.join(""));
}

/** Canonical little-endian IEEE-754 bytes: JSON must not normalize -0 to +0. */
class Tape {
  private data: Uint8Array;
  private view: DataView;
  length = 0;
  constructor(values: number) {
    this.data = new Uint8Array(values * 8);
    this.view = new DataView(this.data.buffer);
  }
  push(value: number): void {
    if (!Number.isFinite(value)) throw new Error(`Nonfinite physics output: ${value}`);
    if (this.length + 8 > this.data.length) {
      const grown = new Uint8Array(this.data.length * 2);
      grown.set(this.data); this.data = grown; this.view = new DataView(grown.buffer);
    }
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }
  snapshot(state: PhysicsSnapshot): void {
    this.push(state.wheel.angle); this.push(state.wheel.angularVelocity);
    this.push(state.pointer.angle); this.push(state.pointer.angularVelocity);
    this.push(state.stableTime); this.push(state.lastImpact); this.push(state.currentPeg);
  }
  encode(): string { return base64(this.data.subarray(0, this.length)); }
}

const moduleHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  value => value.toString(16).padStart(2, "0")).join("");

const info = {
  moduleHash, binary: base64(bytes), simulationVersion: SIMULATION_VERSION,
  fixedDt: FIXED_DT, maxTicks, config: DEFAULT_PHYSICS, imports: WebAssembly.Module.imports(physicsModule),
};

function targetEngine(scenario: ReplayScenario, reuse: boolean): { physics: PhysicsEngine; rngState: number } {
  const physics = new PhysicsEngine(reuse ? { ...DEFAULT_PHYSICS, brakeDrag: 1.8 } : DEFAULT_PHYSICS,
    reuse ? 13 : scenario.count);
  if (reuse) {
    physics.launch(0.4, new SeededRandom([13, 5, 1, 0]));
    if (!physics.runUntilSettled(maxTicks).settled) throw new Error("Warm-up spin did not settle");
    physics.setSegmentCount(scenario.count);
    physics.setConfig(DEFAULT_PHYSICS);
  }
  physics.wheel.angle = scenario.startingAngle;
  const random = new SeededRandom(scenario.seed);
  physics.launch(scenario.charge, random);
  return { physics, rngState: random.state };
}

function run(scenario: ReplayScenario) {
  const { physics, rngState } = targetEngine(scenario, scenario.reuse ?? false);
  const state = physics.snapshot(), previous = physics.previousSnapshot();
  const states = new Tape((maxTicks + 2) * 16), events = new Tape(4096);
  let eventCount = 0, previousTimestamp = -1;
  physics.onImpact(event => {
    if (event.timestamp < previousTimestamp) throw new Error("Impact timestamps are out of order");
    previousTimestamp = event.timestamp;
    events.push(event.pegIndex); events.push(event.strength);
    events.push(event.wheelVelocity); events.push(event.timestamp);
    eventCount++;
  });
  let ticks = 0, records = 0, frame = 0;
  function capture() {
    physics.snapshot(state); physics.previousSnapshot(previous);
    states.push(ticks); states.snapshot(state); states.snapshot(previous); states.push(physics.simulationTime);
    records++;
  }
  capture(); // Include launch initialization, before the first tick.
  while (ticks < maxTicks && !physics.isSettled()) {
    if (scenario.mode === "ticks") {
      physics.step(FIXED_DT); ticks++;
    } else {
      const count = Math.min(framePattern[frame++ % framePattern.length], maxTicks - ticks);
      physics.advance(count); ticks += count;
    }
    capture();
  }
  if (!physics.isSettled()) throw new Error(`Spin did not settle within ${maxTicks} ticks`);
  if (eventCount === 0) throw new Error("Spin emitted no impacts");
  const winner = selectedIndex(physics.wheel.angle, scenario.count);

  // Exercise the no-host-loop path in every engine as well. Fresh construction
  // here also verifies final-state replay after the traced engine's earlier spin.
  const headless = targetEngine(scenario, false).physics;
  const result = headless.runUntilSettled(maxTicks);
  if (!result.settled || result.selectedIndex !== winner) throw new Error("Headless winner differs from animation");
  if (result.duration !== result.ticks * FIXED_DT) throw new Error("Headless duration does not match tick count");
  const finalState = new Tape(16), fastState = new Tape(16);
  finalState.push(ticks); finalState.snapshot(state); finalState.snapshot(previous); finalState.push(physics.simulationTime);
  fastState.push(result.ticks); fastState.snapshot(headless.snapshot());
  fastState.snapshot(headless.previousSnapshot()); fastState.push(headless.simulationTime);
  if (scenario.mode === "ticks" && finalState.encode() !== fastState.encode()) {
    throw new Error("Single-tick replay differs from fresh headless replay");
  }
  return { moduleHash, ticks, duration: ticks * FIXED_DT, records, eventCount, winner, rngState,
    states: states.encode(), events: events.encode(), headless: { ...result, state: fastState.encode() } };
}

export interface ReplayHarness { info: typeof info; run: typeof run }
export type ReplayResult = ReturnType<typeof run>;
declare global { interface Window { physicsReplay: ReplayHarness } }
window.physicsReplay = { info, run };
