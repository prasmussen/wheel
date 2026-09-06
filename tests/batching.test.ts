import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT } from "../src/app/Config";
import { PhysicsEngine, type PegImpact } from "../src/physics/PhysicsEngine";
import { createPhysicsCore, MAX_ADVANCE_TICKS } from "../src/physics/WasmCore";
import { SeededRandom } from "../src/utils/Random";
import { selectedIndex } from "../src/wheel/SegmentLayout";

function engine(count: number, charge = 1) {
  const physics = new PhysicsEngine({ ...DEFAULT_PHYSICS }, count);
  physics.launch(charge, new SeededRandom([42, count, 0xb17d]));
  return physics;
}

describe("animation batches", () => {
  it.each([2, 8, 40, 50])("preserves every state and timestamped event for %i choices", count => {
    const single = engine(count), batched = engine(count);
    const singleEvents: PegImpact[] = [], batchEvents: PegImpact[] = [];
    single.onImpact(event => singleEvents.push(event));
    batched.onImpact(event => batchEvents.push(event));
    for (let frame = 0; frame < 120; frame++) {
      const ticks = [1, 4, 0, 30, 2, 8][frame % 6];
      let previous = single.previousSnapshot();
      for (let tick = 0; tick < ticks; tick++) { previous = single.snapshot(); single.step(FIXED_DT); }
      batched.advance(ticks);
      expect(batched.previousSnapshot()).toEqual(previous);
      expect(batched.snapshot()).toEqual(single.snapshot());
      expect(batched.simulationTime).toBe(single.simulationTime);
      expect(batchEvents).toEqual(singleEvents);
    }
    expect(batchEvents.length).toBeGreaterThan(10);
  });

  it("reuses snapshot objects and leaves interpolation endpoints alone on a zero-tick frame", () => {
    const physics = engine(8);
    const current = physics.snapshot(), previous = physics.previousSnapshot();
    const currentWheel = current.wheel, previousPointer = previous.pointer;
    physics.advance(4);
    expect(physics.snapshot(current)).toBe(current);
    expect(physics.previousSnapshot(previous)).toBe(previous);
    expect(current.wheel).toBe(currentWheel);
    expect(previous.pointer).toBe(previousPointer);
    expect(previous).not.toEqual(current);
    const endpoints = [physics.previousSnapshot(), physics.snapshot()];
    physics.advance(0);
    expect([physics.previousSnapshot(), physics.snapshot()]).toEqual(endpoints);
  });

  it("rejects invalid frame sizes before mutating the simulation", () => {
    const physics = engine(50), before = physics.snapshot();
    for (const ticks of [-1, 0.5, MAX_ADVANCE_TICKS + 1, Infinity, NaN, 2 ** 32]) {
      expect(() => physics.advance(ticks)).toThrow(RangeError);
      expect(physics.snapshot()).toEqual(before);
    }
    const core = createPhysicsCore();
    expect(() => core.advance(-1)).toThrow(WebAssembly.RuntimeError);
    expect(() => core.advance(MAX_ADVANCE_TICKS + 1)).toThrow(WebAssembly.RuntimeError);
  });

  it("copies a complete batch before listeners reset its memory", () => {
    const expected = engine(50), physics = engine(50);
    const expectedEvents: PegImpact[] = [], actual: PegImpact[] = [];
    expected.advance(24); physics.advance(24);
    expected.onImpact(event => expectedEvents.push(event));
    physics.onImpact(event => {
      actual.push(event);
      if (actual.length === 1) physics.launch(0, new SeededRandom([1]));
    });
    expected.advance(30); physics.advance(30);
    expect(expectedEvents.length).toBeGreaterThan(2);
    expect(actual).toEqual(expectedEvents);
  });
});

describe("headless simulation batches", () => {
  it("matches rendered winner geometry at every segment boundary", () => {
    const core = createPhysicsCore();
    const state = new Float64Array(core.memory.buffer, 0, 7);
    const result = new Float64Array(core.memory.buffer, 288, 2);
    for (let count = 2; count <= 50; count++) {
      core.init(count);
      for (let boundary = 0; boundary <= count; boundary++) {
        for (const offset of [-1e-12, 0, 1e-12]) {
          const angle = Math.PI / 2 - boundary * (Math.PI * 2 / count) + offset;
          state[0] = angle; state[4] = 0.35;
          expect(core.run_until_settled(0)).toBe(0);
          expect(result[1]).toBe(selectedIndex(angle, count));
        }
      }
    }
  });

  it.each([2, 3, 8, 40, 50])("returns the same first settled tick, winner and state for %i choices", count => {
    for (const charge of [0, 0.55, 1]) {
      const single = engine(count, charge), batched = engine(count, charge);
      let ticks = 0;
      while (!single.isSettled() && ticks < 10800) { single.step(FIXED_DT); ticks++; }
      const result = batched.runUntilSettled(10800);
      expect(result).toEqual({ ticks, duration: ticks * FIXED_DT, settled: true,
        selectedIndex: selectedIndex(single.wheel.angle, count) });
      expect(batched.snapshot()).toEqual(single.snapshot());
      expect(batched.previousSnapshot()).toEqual(single.previousSnapshot());
      expect(batched.simulationTime).toBe(single.simulationTime);
      expect(batched.runUntilSettled(0)).toEqual({ ...result, ticks: 0, duration: 0 });
    }
  });

  it("honors a tick cap and can resume without changing the trajectory", () => {
    const single = engine(50), batched = engine(50);
    const initial = batched.snapshot();
    expect(batched.runUntilSettled(0)).toEqual({ ticks: 0, duration: 0, settled: false, selectedIndex: null });
    expect(batched.snapshot()).toEqual(initial);
    expect(batched.runUntilSettled(17)).toEqual({ ticks: 17, duration: 17 * FIXED_DT, settled: false, selectedIndex: null });
    for (let tick = 0; tick < 17; tick++) single.step(FIXED_DT);
    expect(batched.snapshot()).toEqual(single.snapshot());
    const singleEvents: PegImpact[] = [], batchEvents: PegImpact[] = [];
    single.onImpact(event => singleEvents.push(event));
    batched.onImpact(event => batchEvents.push(event));
    single.advance(30); batched.advance(30);
    expect(batchEvents.length).toBeGreaterThan(0);
    expect(batchEvents).toEqual(singleEvents);
    expect(batched.snapshot()).toEqual(single.snapshot());
    const expected = single.runUntilSettled(), result = batched.runUntilSettled();
    expect(result).toEqual(expected);
  });

  it("suppresses diagnostic audio without overflowing or disabling subsequent launches", () => {
    const physics = engine(50);
    let count = 0;
    physics.onImpact(() => count++);
    expect(physics.runUntilSettled().settled).toBe(true);
    expect(count).toBe(0);
    physics.launch(1, new SeededRandom([42]));
    physics.advance(30);
    expect(count).toBeGreaterThan(0);
  });

  it("rejects invalid diagnostic limits", () => {
    const physics = engine(8), before = physics.snapshot();
    for (const ticks of [-1, 0.1, Infinity, NaN, 2 ** 31, 2 ** 32]) {
      expect(() => physics.runUntilSettled(ticks)).toThrow(RangeError);
      expect(physics.snapshot()).toEqual(before);
    }
  });
});

describe("explicit configuration updates", () => {
  it("does not read the source configuration while stepping or advancing", () => {
    let reads = 0;
    const config = new Proxy({ ...DEFAULT_PHYSICS }, { get(target, key, receiver) {
      reads++; return Reflect.get(target, key, receiver);
    } });
    const physics = new PhysicsEngine(config, 8);
    reads = 0;
    physics.launch(1, new SeededRandom([42]));
    physics.step(FIXED_DT); physics.advance(4); physics.runUntilSettled(10);
    expect(reads).toBe(0);
    const storedConfig = physics.config;
    physics.setConfig({ ...DEFAULT_PHYSICS });
    expect(physics.config).toBe(storedConfig);
    expect(Object.isFrozen(physics.config)).toBe(true);
  });

  it("applies an explicit mid-spin update on the next tick", () => {
    const first = engine(8), second = engine(8);
    first.advance(24); second.advance(24);
    const config = { ...DEFAULT_PHYSICS, brakeDrag: 0, linearDrag: 0.05 };
    first.setConfig(config); second.setConfig(config);
    config.brakeDrag = 8; // Caller mutation cannot silently change a running engine.
    first.advance(30);
    for (let tick = 0; tick < 30; tick++) second.step(FIXED_DT);
    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.config.brakeDrag).toBe(0);
  });
});
