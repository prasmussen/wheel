import { describe, expect, it } from 'vitest';
import { appendSpinHistory, readSpinHistory, type SpinHistoryEntry } from '../src/wheel/History';
import { createSharePayload } from '../src/wheel/Share';
import { createDefaultConfig } from '../src/wheel/WheelConfig';
import { DEFAULT_PHYSICS, SIMULATION_VERSION } from '../src/app/Config';

const wheel = createDefaultConfig();
const entry: SpinHistoryEntry = {
  completedAt: 1000, result: 'PIZZA',
  state: createSharePayload(wheel, {
    seed: [1, 2, 3, 4], charge: 0.4, startingAngle: 1,
    simulationVersion: SIMULATION_VERSION, wheelConfig: wheel, physicsConfig: { ...DEFAULT_PHYSICS },
  }),
};

describe('spin history', () => {
  it('keeps the 30 latest spins in newest-first order, including repeated results', () => {
    let history: SpinHistoryEntry[] = [];
    for (let i = 0; i < 32; i++) history = appendSpinHistory(history, { ...entry, completedAt: i });
    expect(history.map(item => item.completedAt)).toEqual(Array.from({ length: 30 }, (_, i) => 31 - i));
    expect(readSpinHistory(JSON.parse(JSON.stringify(history)))).toEqual(history);
  });
  it('snapshots the same plain JSON state used for sharing', () => {
    const original = structuredClone(entry);
    const history = appendSpinHistory([], original);
    original.state.choices[0] = 'Changed';
    expect(history[0].state.choices[0]).toBe('PIZZA');
    expect(JSON.parse(JSON.stringify(history))[0].state).toEqual(JSON.parse(JSON.stringify(entry.state)));
  });
  it('skips corrupt, incomplete, and incompatible records without losing valid spins', () => {
    expect(readSpinHistory([null, {}, { ...entry, completedAt: -1 }, { ...entry, completedAt: 9e15 },
      { ...entry, result: 'Not a choice' }, { ...entry, state: createSharePayload(wheel) },
      { ...entry, state: { ...entry.state, replay: { ...entry.state.replay, version: -1 } } }, entry,
    ])).toEqual([entry]);
    expect(readSpinHistory({})).toEqual([]);
  });
  it('sorts and caps stored records on read', () => {
    const entries = Array.from({ length: 35 }, (_, completedAt) => ({ ...entry, completedAt }));
    expect(readSpinHistory(entries).map(item => item.completedAt)).toEqual(Array.from({ length: 30 }, (_, i) => 34 - i));
  });
});
