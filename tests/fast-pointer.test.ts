import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT } from "../src/app/Config";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { SeededRandom } from "../src/utils/Random";

describe("high-speed pointer contact", () => {
  it.each([20, 30, 38])("catches pegs at %i rad/s regardless of tick alignment or direction", speed => {
    for (const direction of [-1, 1]) {
      for (let phase = 0; phase < 16; phase++) {
        const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
        engine.wheel.angle = Math.PI / 2 - direction * (0.2 + phase / 16 * speed * FIXED_DT);
        engine.wheel.angularVelocity = direction * speed;
        let deflection = 0;
        for (let tick = 0; tick < Math.ceil(0.6 / speed / FIXED_DT); tick++) {
          engine.step(FIXED_DT);
          deflection = Math.max(deflection, -direction * engine.pointer.angle);
        }
        expect(deflection, `direction ${direction}, phase ${phase}`).toBeGreaterThan(0.65);
      }
    }
  });

  it("visibly deflects and returns at display frame rate during a full-speed spin", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    engine.launch(1, new SeededRandom([42]));
    const frames: number[] = [];
    for (let tick = 0; tick < 240; tick++) {
      engine.step(FIXED_DT);
      if (tick >= 120 && tick % 4 === 0) frames.push(engine.pointer.angle);
    }
    expect(engine.wheel.angularVelocity).toBeGreaterThan(20);
    expect(Math.min(...frames)).toBeLessThan(-0.7);
    expect(Math.max(...frames)).toBeGreaterThan(-0.2);
  });

  it("does not multiply impact notifications when substeps revisit a pin", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 50);
    engine.launch(1, new SeededRandom([42]));
    const times = new Map<number, number>();
    let impacts = 0;
    engine.onImpact(event => {
      const previous = times.get(event.pegIndex);
      if (previous !== undefined) expect(event.timestamp - previous).toBeGreaterThanOrEqual(0.025);
      times.set(event.pegIndex, event.timestamp);
      impacts++;
    });
    for (let tick = 0; tick < 240; tick++) engine.step(FIXED_DT);
    expect(impacts).toBeGreaterThan(100);
    expect(impacts).toBeLessThan(300);
  });
});
