import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT } from "../src/app/Config";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { SeededRandom } from "../src/utils/Random";

function tipDistance(engine: PhysicsEngine, peg: number): number {
  const angle = engine.wheel.angle + peg * Math.PI * 2 / engine.segmentCount;
  return Math.hypot(
    Math.sin(engine.pointer.angle) * 0.145 - Math.cos(angle) * 0.83,
    0.955 - Math.cos(engine.pointer.angle) * 0.145 - Math.sin(angle) * 0.83,
  );
}

describe("audible peg contact", () => {
  it.each([-1, 1])("does not click in the approach zone in direction %i", direction => {
    const engine = new PhysicsEngine(DEFAULT_PHYSICS, 8);
    engine.wheel.angle = Math.PI / 2 - direction * 0.13;
    engine.wheel.angularVelocity = direction * 0.5;
    let impacts = 0;
    engine.onImpact(() => impacts++);
    engine.step(FIXED_DT);
    expect(tipDistance(engine, 0)).toBeGreaterThan(0.09);
    expect(impacts).toBe(0);
  });

  it.each([8, 50])("aligns slow clicks with tip contact through settling with %i pegs", count => {
    const engine = new PhysicsEngine(DEFAULT_PHYSICS, count);
    engine.launch(0.65, new SeededRandom([42]));
    let slowImpacts = 0;
    engine.onImpact(event => {
      if (Math.abs(event.wheelVelocity) >= 2) return;
      slowImpacts++;
      // Events are delivered at the end of the tick, after contact projection.
      expect(tipDistance(engine, event.pegIndex)).toBeLessThan(0.05);
    });
    for (let tick = 0; tick < 10800 && !engine.isSettled(); tick++) engine.step(FIXED_DT);
    expect(engine.isSettled()).toBe(true);
    expect(slowImpacts).toBeGreaterThan(0);
  });
});
