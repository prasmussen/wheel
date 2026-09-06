import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT } from "../src/app/Config";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { SeededRandom } from "../src/utils/Random";

// Supplied replay, decoded independently so this regression survives version bumps.
const replay = new DataView(Uint8Array.from(atob("BwAAAG9tBOMupw5gPrcCgTQjbybsUbgeheuRP2efvZ7cmRJA"), c => c.charCodeAt(0)).buffer);
function replayEngine() {
  const engine = new PhysicsEngine(DEFAULT_PHYSICS, 8);
  engine.wheel.angle = replay.getFloat64(28, true);
  engine.launch(replay.getFloat64(20, true), new SeededRandom(Array.from({ length: 4 }, (_, i) => replay.getUint32(4 + i * 4, true))));
  return engine;
}

describe("pointer approach", () => {
  it.each([-1, 1])("leaves a resting pointer alone before contact in direction %i", direction => {
    const engine = new PhysicsEngine(DEFAULT_PHYSICS, 8);
    engine.wheel.angle = Math.PI / 2 - direction * 0.13;
    engine.wheel.angularVelocity = direction * 0.5;
    engine.step(FIXED_DT);
    expect(engine.pointer.angle).toBe(0);
    expect(engine.pointer.angularVelocity).toBe(0);
  });

  it("does not kick a clear pointer when a peg crosses the release line", () => {
    const crossing = new PhysicsEngine(DEFAULT_PHYSICS, 8);
    const clear = new PhysicsEngine(DEFAULT_PHYSICS, 8);
    crossing.wheel.angle = Math.PI / 2 + 0.059;
    for (const engine of [crossing, clear]) {
      engine.pointer.angle = 0.8;
      engine.wheel.angularVelocity = 0.5;
      engine.step(FIXED_DT);
    }
    expect(crossing.pointer.angle).toBe(clear.pointer.angle);
    expect(crossing.pointer.angularVelocity).toBe(clear.pointer.angularVelocity);
    expect(crossing.wheel.angularVelocity).toBe(clear.wheel.angularVelocity);
  });

  it("does not drive the pointer across empty space in the reported replay", () => {
    const engine = replayEngine();
    let checked = 0;
    for (let tick = 0; tick < 10800 && !engine.isSettled(); tick++) {
      const p = engine.pointer.angle, v = engine.pointer.angularVelocity;
      let distance = Infinity;
      for (let peg = 0; peg < 8; peg++) {
        const a = engine.wheel.angle + peg * Math.PI / 4;
        distance = Math.min(distance, Math.hypot(Math.sin(p) * .145 - Math.cos(a) * .83,
          .955 - Math.cos(p) * .145 - Math.sin(a) * .83));
      }
      const speed = Math.abs(engine.wheel.angularVelocity);
      engine.step(FIXED_DT);
      if (speed < 1 && distance > .06 && Math.abs(p) < .001 && Math.abs(v) < .001) {
        checked++;
        expect(Math.abs(engine.pointer.angle)).toBeLessThanOrEqual(Math.abs(p) + .00001);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(engine.isSettled()).toBe(true);
  });
});
