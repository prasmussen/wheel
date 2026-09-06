import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT, SIMULATION_VERSION } from "../src/app/Config";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { createPhysicsCore, numericCore, physicsModule, SEED_CAPACITY } from "../src/physics/WasmCore";
import { SeededRandom } from "../src/utils/Random";

// Captured from the original FNV-1a/xorshift32 implementation before the port.
const vectors = [
  { seed: [], draws: [0.2739662209060043, 0.31014532619155943, 0.6669882687274367, 0.9511976079083979, 0.03379992418922484, 0.5521611105650663, 0.825145763810724, 0.18137367139570415] },
  { seed: [0], draws: [0.35670013912022114, 0.914233167655766, 0.45259071234613657, 0.4037062544375658, 0.5359791861847043, 0.6564011590089649, 0.20362966577522457, 0.8508645587135106] },
  { seed: [1, 2, 3, 4], draws: [0.5208476409316063, 0.9480905674863607, 0.15046148118562996, 0.9437239568214864, 0.6770443567074835, 0.25879353773780167, 0.18547237012535334, 0.8585922403726727] },
  { seed: [4294967295, 2147483648, 0, 42], draws: [0.41521520004607737, 0.49311013077385724, 0.9215740787331015, 0.011879608267918229, 0.09379571117460728, 0.7349318207707256, 0.25207527237944305, 0.33022132399491966] },
];

describe("handwritten Wasm core", () => {
  it("has no imports and owns fixed, isolated memory", () => {
    expect(WebAssembly.Module.imports(physicsModule)).toEqual([]);
    const first = createPhysicsCore(), second = createPhysicsCore();
    expect(first.memory.buffer).not.toBe(second.memory.buffer);
    expect(first.memory.buffer.byteLength).toBe(65536);
    expect(() => first.memory.grow(1)).toThrow(RangeError);
  });

  it("runs launch, integration, and events without host math", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 50);
    let impacts = 0;
    engine.onImpact(() => impacts++);
    const spies = (["sin", "cos", "exp", "pow", "hypot", "random"] as const).map(name =>
      vi.spyOn(Math, name).mockImplementation(() => { throw new Error(`Host Math.${name} called`); }));
    try {
      engine.launch(1, new SeededRandom([42, 0, 0, 0]));
      for (let tick = 0; tick < 240; tick++) engine.step(FIXED_DT);
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
    expect(impacts).toBeGreaterThan(30);
    expect(engine.wheel.angularVelocity).toBeGreaterThan(20);
    expect(SIMULATION_VERSION).toBe(6);
  });

  it("consumes the seven launch draws internally and preserves subsequent RNG draws", () => {
    const random = new SeededRandom([1, 2, 3, 4]);
    const expected = new SeededRandom([1, 2, 3, 4]);
    for (let draw = 0; draw < 7; draw++) expected.next();
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    engine.launch(0.55, random);
    expect(random.next()).toBe(expected.next());
  });

  it("keeps retained state references live and synchronizes changed configuration", () => {
    const config = { ...DEFAULT_PHYSICS };
    const engine = new PhysicsEngine(config, 8);
    const wheel = engine.wheel, pointer = engine.pointer;
    engine.setSegmentCount(50);
    const fresh = new PhysicsEngine({ ...config, brakeDrag: 0 }, 50);
    config.brakeDrag = 0;
    wheel.angle = fresh.wheel.angle;
    engine.launch(0.7, new SeededRandom([17]));
    fresh.launch(0.7, new SeededRandom([17]));
    for (let tick = 0; tick < 240; tick++) { engine.step(FIXED_DT); fresh.step(FIXED_DT); }
    expect(engine.snapshot()).toEqual(fresh.snapshot());
    expect(wheel).toBe(engine.wheel);
    expect(pointer).toBe(engine.pointer);
    expect(wheel.angle).toBe(engine.snapshot().wheel.angle);
  });

  it("publishes bounded chronological events with historical velocities", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 50);
    const events: Array<{ pegIndex: number; timestamp: number; wheelVelocity: number }> = [];
    engine.onImpact(event => events.push(event));
    engine.launch(1, new SeededRandom([42]));
    // A long tick exercises the 32-substep cap and several events in one batch.
    for (let tick = 0; tick < 10; tick++) engine.step(0.1);
    expect(events.length).toBeGreaterThan(30);
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      expect(event.pegIndex).toBeGreaterThanOrEqual(0);
      expect(event.pegIndex).toBeLessThan(50);
      expect(Number.isFinite(event.wheelVelocity)).toBe(true);
      if (index) expect(event.timestamp).toBeGreaterThanOrEqual(events[index - 1].timestamp);
    }
  });
});

describe("Wasm numerical routines", () => {
  it("matches trigonometry over the complete simulation angle domain", () => {
    let maximumError = 0;
    for (let sample = -10000; sample <= 10000; sample++) {
      const angle = sample / 10000 * Math.PI * 4;
      maximumError = Math.max(maximumError,
        Math.abs(numericCore.math_sin(angle) - Math.sin(angle)),
        Math.abs(numericCore.math_cos(angle) - Math.cos(angle)));
    }
    expect(maximumError).toBeLessThan(5e-15);
  });

  it("matches exponential decay throughout the timestep domain", () => {
    for (let sample = 0; sample <= 1000; sample++) {
      const value = -sample / 1000 * 0.9;
      expect(Math.abs(numericCore.math_exp(value) - Math.exp(value))).toBeLessThan(8e-16);
    }
    for (const value of [-708, -100, -10, 1, 100, 709, 709.7]) {
      expect(Math.abs(numericCore.math_exp(value) / Math.exp(value) - 1)).toBeLessThan(2e-15);
    }
    expect(numericCore.math_exp(0)).toBe(1);
  });

  it("computes robust distances including zero, tiny and large coordinates", () => {
    for (const [x, y] of [[0, 0], [3, 4], [-0.145, 0.955], [1e-300, 1e-300], [1e300, 1e300]]) {
      const expected = Math.hypot(x, y);
      if (expected === 0) expect(numericCore.math_hypot(x, y)).toBe(0);
      else expect(Math.abs(numericCore.math_hypot(x, y) / expected - 1)).toBeLessThan(5e-16);
    }
  });

  it("preserves JS tie rounding and signed zero rather than ties-to-even", () => {
    for (const value of [-50.5, -2.5, -1.5, -0.5000000000000001, -0.5, -0.49999999999999994, -0, 0, 0.49999999999999994, 0.5, 1.5, 2.5, 50.5]) {
      expect(numericCore.math_round(value)).toBe(Math.round(value));
    }
  });

  it("wraps forward and reverse rotations at angle boundaries", () => {
    const tau = Math.PI * 2;
    for (const value of [-2 * tau, -tau - 1e-12, -tau, -1e-12, 0, tau, tau + 1e-12, 2 * tau]) {
      const remainder = value % tau;
      expect(numericCore.math_wrap(value)).toBe(remainder < 0 ? remainder + tau : remainder);
    }
  });
});

describe("Wasm seeded randomness", () => {
  it.each(vectors)("preserves the stream for seed $seed", ({ seed, draws }) => {
    const random = new SeededRandom(seed);
    expect(draws.map(() => random.next())).toEqual(draws);
  });

  it("interleaves independent streams without sharing RNG state", () => {
    const first = new SeededRandom(vectors[2].seed), second = new SeededRandom(vectors[3].seed);
    for (let index = 0; index < 8; index++) {
      expect(first.next()).toBe(vectors[2].draws[index]);
      expect(second.range(-4, 7)).toBe(-4 + 11 * vectors[3].draws[index]);
    }
  });

  it("hashes seeds larger than the staging buffer and replaces a zero hash", () => {
    const seed = Array.from({ length: SEED_CAPACITY + 3 }, (_, index) => index);
    let hash = 0x811c9dc5;
    for (const word of seed) hash = Math.imul(hash ^ word, 0x01000193);
    expect(new SeededRandom(seed).state).toBe(hash);
    expect(new SeededRandom([0x811c9dc5]).state).toBe(numericCore.finish_seed(0));
    expect(new SeededRandom([0x811c9dc5]).next()).toBeGreaterThan(0);
  });
});
