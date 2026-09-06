import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, SIMULATION_VERSION } from '../src/app/Config';
import type { SpinRecord } from '../src/app/State';
import { readShareUrl, writeShareUrl } from '../src/wheel/Share';
import { createDefaultConfig } from '../src/wheel/WheelConfig';
import { PhysicsEngine } from '../src/physics/PhysicsEngine';
import { SeededRandom } from '../src/utils/Random';

const wheel = createDefaultConfig();
const replay: SpinRecord = {
  seed: [42, 0, 0xffffffff, 7], charge: 0.42, startingAngle: 1.234,
  simulationVersion: SIMULATION_VERSION, wheelConfig: wheel, physicsConfig: { ...DEFAULT_PHYSICS },
};
const labels = (config: typeof wheel) => config.items.map(item => item.label);
const share = (config = wheel, spin?: SpinRecord) => {
  const url = new URL('https://example.com/?source=a%20b#old');
  writeShareUrl(url, config, spin);
  return url;
};

describe('readable share links', () => {
  it('writes plain labels and preserves unrelated parameters without a fragment', () => {
    expect(share().href).toBe('https://example.com/?source=a%20b&choices=pizza,sushi,tacos,thai,pasta,ramen,curry,burger');
    expect(readShareUrl(new URL('https://example.com/?source=test'))).toBeUndefined();
  });

  it('round-trips delimiters, Unicode, duplicate and temporarily blank choices', () => {
    const config = structuredClone(wheel);
    const values = ['A,B', 'A+B', '%2C', 'ÆØ 🍕 /?#&', '', 'A,B', '"=!', 'A B'];
    config.items.forEach((item, i) => item.label = values[i]);
    const url = share(config);
    expect(url.search).toContain('choices=a%2Cb,a%2Bb,%252c,');
    const decoded = readShareUrl(url)!;
    expect(labels(decoded.wheelConfig)).toEqual(values);
    expect(new Set(decoded.wheelConfig.items.map(item => item.id)).size).toBe(values.length);
    expect(decoded.lastSpin).toBeUndefined();
    expect(labels(readShareUrl(new URL('https://example.com/?choices=A+B,C'))!.wheelConfig)).toEqual(['A B', 'C']);
  });

  it('preserves distinct replay choices and reproduces the exact trajectory', () => {
    const edited = structuredClone(wheel);
    edited.items[0].label = 'CHANGED,🍕';
    const url = share(edited, replay);
    expect(url.searchParams.get('replay')).toMatch(/^2\.[A-Za-z0-9_-]{48}$/);
    expect(url.search).toContain('&replayChoices=pizza,sushi');
    const decoded = readShareUrl(url)!;
    expect(labels(decoded.wheelConfig)).toEqual(labels(edited));
    expect(labels(decoded.lastSpin!.wheelConfig)).toEqual(labels(wheel));
    expect(decoded.lastSpin!.seed).toEqual(replay.seed);
    expect(decoded.lastSpin!.charge).toBe(replay.charge);
    expect(decoded.lastSpin!.startingAngle).toBe(replay.startingAngle);
    const simulate = (record: SpinRecord) => {
      const engine = new PhysicsEngine(record.physicsConfig, record.wheelConfig.items.length);
      engine.wheel.angle = record.startingAngle;
      engine.launch(record.charge, new SeededRandom(record.seed));
      for (let i = 0; i < 7200; i++) engine.step(1 / 240);
      return engine.snapshot();
    };
    expect(simulate(decoded.lastSpin!)).toEqual(simulate(replay));
  });

  it('deduplicates replay choices and preserves signed zero', () => {
    const url = share(wheel, { ...replay, charge: -0, startingAngle: -0 });
    expect(url.searchParams.has('replayChoices')).toBe(false);
    const record = readShareUrl(url)!.lastSpin!;
    expect(record.charge).toBe(-0);
    expect(record.startingAngle).toBe(-0);
    expect(record.physicsConfig).toEqual(DEFAULT_PHYSICS);
  });

  it('loads choices but declines a different simulation version', () => {
    const url = share(wheel, replay);
    const bytes = Buffer.from(url.searchParams.get('replay')!.slice(2), 'base64url');
    bytes.writeUInt32LE(SIMULATION_VERSION + 1, 0);
    url.search = url.search.replace(/replay=2\.[\w-]+/, 'replay=2.' + bytes.toString('base64url'));
    const decoded = readShareUrl(url)!;
    expect(labels(decoded.wheelConfig)).toEqual(labels(wheel));
    expect(decoded.replayUnavailable).toBe(true);
    expect(decoded.lastSpin).toBeUndefined();
  });

  it.each([
    'wheel=old', 'choices=', 'choices=A', 'choices=A,B&choices=C,D',
    'choices=%ZZ,B', 'choices=%FF,B', 'choices=' + Array(51).fill('A').join(','),
    'choices=A,' + 'x'.repeat(13), 'choices=' + 'x'.repeat(24001),
    'replay=2.AAAA', 'choices=A,B&replay=', 'choices=A,B&replay=3.AAAA',
    'choices=A,B&replayChoices=C,D', 'choices=A,B&replay=2.' + 'A'.repeat(47),
  ])('rejects malformed input: %s', query => {
    expect(() => readShareUrl(new URL('https://example.com/?' + query))).toThrow();
  });

  it.each([[20, NaN], [20, 2], [28, Infinity], [28, -1], [28, 7]])('rejects invalid binary replay value at %s: %s', (offset, value) => {
    const url = share(wheel, replay);
    const bytes = Buffer.from(url.searchParams.get('replay')!.slice(2), 'base64url');
    bytes.writeDoubleLE(value, offset);
    url.search = url.search.replace(/replay=2\.[\w-]+/, 'replay=2.' + bytes.toString('base64url'));
    expect(() => readShareUrl(url)).toThrow();
  });

  it('handles maximum Unicode lists and removes stale share fields on rewrite', () => {
    const large = { version: 'test', items: Array.from({ length: 50 }, (_, i) => ({ id: String(i), label: '界'.repeat(12), weight: 1 })) };
    const original = structuredClone(large);
    original.items[0].label = '語'.repeat(12);
    const url = share(large, { ...replay, wheelConfig: original });
    expect(readShareUrl(url)!.lastSpin).toBeDefined();
    writeShareUrl(url, wheel);
    expect(url.href).toBe(share().href);
  });
});
