import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, SIMULATION_VERSION } from "../src/app/Config";
import type { SpinRecord } from "../src/app/State";
import { decodeShare, encodeShare } from "../src/wheel/Share";
import { createDefaultConfig } from "../src/wheel/WheelConfig";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { SeededRandom } from "../src/utils/Random";

const wheel = createDefaultConfig();
const replay: SpinRecord = {
  seed: [42, 0, 0xffffffff, 7], charge: 0.42, startingAngle: 1.234,
  simulationVersion: SIMULATION_VERSION, wheelConfig: wheel, physicsConfig: { ...DEFAULT_PHYSICS },
};
const raw = (payload: unknown) => '#wheel=' + btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const payload = { v: 1, choices: ['A', 'B'], replay: { version: SIMULATION_VERSION, seed: replay.seed, charge: 0.4, angle: 1 } };
const labels = (config: typeof wheel) => config.items.map(item => item.label);

describe('share links', () => {
  it('round-trips Unicode and duplicate choices without a replay', () => {
    const config = structuredClone(wheel);
    config.items[0].label = 'ÆØÅ 🍕 /?# & café';
    config.items[1].label = config.items[0].label;
    const shared = decodeShare(encodeShare(config))!;
    expect(labels(shared.wheelConfig)).toEqual(labels(config));
    expect(shared.lastSpin).toBeUndefined();
    expect(new Set(shared.wheelConfig.items.map(item => item.id)).size).toBe(config.items.length);
  });

  it('preserves separate edited and replay choices and reproduces the trajectory', () => {
    const edited = structuredClone(wheel);
    edited.items[0].label = 'Changed';
    const shared = decodeShare(encodeShare(edited, replay))!;
    expect(labels(shared.wheelConfig)).toEqual(labels(edited));
    expect(labels(shared.lastSpin!.wheelConfig)).toEqual(labels(wheel));
    const simulate = (record: SpinRecord) => {
      const engine = new PhysicsEngine(record.physicsConfig, record.wheelConfig.items.length);
      engine.wheel.angle = record.startingAngle;
      engine.launch(record.charge, new SeededRandom(record.seed));
      for (let i = 0; i < 7200; i++) engine.step(1 / 240);
      return engine.snapshot();
    };
    expect(simulate(shared.lastSpin!)).toEqual(simulate(replay));
  });

  it('deduplicates matching replay choices and restores fixed physics', () => {
    const hash = encodeShare(wheel, replay);
    const data = JSON.parse(atob(hash.slice(7).replace(/-/g, '+').replace(/_/g, '/')));
    expect(data.replay.choices).toBeUndefined();
    data.replay.physicsConfig = { ...DEFAULT_PHYSICS, wheelInertia: 0 };
    const shared = decodeShare(raw(data))!;
    expect(shared.lastSpin!.physicsConfig).toEqual(DEFAULT_PHYSICS);
    expect(labels(shared.lastSpin!.wheelConfig)).toEqual(labels(wheel));
  });

  it('loads choices but declines replays from a different simulation version', () => {
    const shared = decodeShare(raw({ ...payload, replay: { ...payload.replay, version: -1 } }))!;
    expect(labels(shared.wheelConfig)).toEqual(['A', 'B']);
    expect(shared.replayUnavailable).toBe(true);
    expect(shared.lastSpin).toBeUndefined();
  });

  it.each([
    '#wheel=', '#wheel=!!!', '#wheel=' + 'a'.repeat(24001), raw(null), raw({ v: 2, choices: ['A', 'B'] }),
    raw({ v: 1, choices: ['A'] }), raw({ v: 1, choices: Array(51).fill('A') }),
    raw({ v: 1, choices: ['A', 1] }), raw({ v: 1, choices: ['A', 'x'.repeat(31)] }),
    ...[{ seed: [1] }, { seed: [1, 2, 3, -1] }, { seed: [1, 2, 3, 0.5] },
      { charge: 2 }, { charge: '0.4' }, { angle: -1 }, { angle: 7 }, { choices: [' ', 'B'] }]
      .map(change => raw({ ...payload, replay: { ...payload.replay, ...change } })),
  ])('rejects malformed or oversized input %#', hash => expect(() => decodeShare(hash)).toThrow());

  it('supports maximum-size wheels with distinct replay choices', () => {
    const large = { version: 'test', items: Array.from({ length: 50 }, (_, i) => ({ id: String(i), label: '界'.repeat(30), weight: 1 })) };
    const original = structuredClone(large);
    original.items[0].label = '語'.repeat(30);
    expect(decodeShare(encodeShare(large, { ...replay, wheelConfig: original }))!.lastSpin).toBeDefined();
  });
});
