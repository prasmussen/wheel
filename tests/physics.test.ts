import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT } from "../src/app/Config";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { SeededRandom } from "../src/utils/Random";
import { selectedIndex } from "../src/wheel/SegmentLayout";

function run(seed: number[], charge: number, count = 8, maxSeconds = 45) {
  const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, count);
  const impacts: Array<{ pegIndex: number; strength: number }> = [];
  engine.onImpact(({ pegIndex, strength }) => impacts.push({ pegIndex, strength }));
  engine.launch(charge, new SeededRandom(seed));
  let steps = 0;
  for (; steps < maxSeconds / FIXED_DT && !engine.isSettled(); steps++) engine.step(FIXED_DT);
  return { engine, impacts, seconds: steps * FIXED_DT, result: selectedIndex(engine.wheel.angle, count) };
}

describe("mechanical wheel physics", () => {
  it("is deterministic for the same seed, charge, state, and config", () => {
    const first = run([1, 2, 3, 4], 0.72);
    const second = run([1, 2, 3, 4], 0.72);
    expect(second.engine.wheel.angle).toBe(first.engine.wheel.angle);
    expect(second.engine.pointer.angle).toBe(first.engine.pointer.angle);
    expect(second.impacts).toEqual(first.impacts);
    expect(second.result).toBe(first.result);
  });

  it("turns a longer hold into substantially more launch energy", () => {
    const low = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    const high = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    low.launch(0.05, new SeededRandom([9, 8, 7]));
    high.launch(1, new SeededRandom([9, 8, 7]));
    for (let i = 0; i < 24; i++) { low.step(FIXED_DT); high.step(FIXED_DT); }
    // With randomized preload, compare kinetic energy (proportional to ω²).
    // Hold strength must remain meaningful even though gentle spins now have
    // enough launch variation to avoid repeating almost the same trajectory.
    expect(high.wheel.angularVelocity ** 2).toBeGreaterThan(low.wheel.angularVelocity ** 2 * 2.5);
  });

  it("emits real peg impacts at high speed and moves the pointer", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    let impacts = 0; let peakPointerSpeed = 0; let peakPointerAngle = 0;
    engine.onImpact(() => impacts++);
    engine.launch(1, new SeededRandom([42]));
    for (let i = 0; i < 240; i++) {
      engine.step(FIXED_DT);
      peakPointerSpeed = Math.max(peakPointerSpeed, Math.abs(engine.pointer.angularVelocity));
      peakPointerAngle = Math.max(peakPointerAngle, Math.abs(engine.pointer.angle));
    }
    expect(impacts).toBeGreaterThan(8);
    expect(peakPointerSpeed).toBeGreaterThan(3);
    expect(peakPointerAngle).toBeGreaterThan(0.1);
  });

  it("damps pointer rebound toward its rest angle", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    engine.pointer.angle = 0.4;
    for (let i = 0; i < 480; i++) engine.step(FIXED_DT);
    expect(Math.abs(engine.pointer.angle)).toBeLessThan(0.001);
    expect(Math.abs(engine.pointer.angularVelocity)).toBeLessThan(0.01);
  });

  it("rides up a peg before snapping back after release", () => {
    const engine = new PhysicsEngine({
      ...DEFAULT_PHYSICS,
      linearDrag: 0,
      brakeDrag: 0,
      quadraticDrag: 0,
      bearingFriction: 0,
    }, 8);
    engine.wheel.angle = Math.PI / 2 - 0.12;
    engine.wheel.angularVelocity = 0.8;
    let deepestDeflection = 0;
    let phaseAtDeepestDeflection = -Infinity;
    let rebound = 0;
    for (let i = 0; i < 180; i++) {
      engine.step(FIXED_DT);
      if (engine.pointer.angle < deepestDeflection) {
        deepestDeflection = engine.pointer.angle;
        phaseAtDeepestDeflection = engine.wheel.angle - Math.PI / 2;
      }
      if (deepestDeflection < -0.1) rebound = Math.max(rebound, engine.pointer.angle);
    }
    expect(deepestDeflection).toBeLessThan(-0.28);
    expect(phaseAtDeepestDeflection).toBeGreaterThan(0.025);
    expect(rebound).toBeGreaterThan(0.005);
  });

  it("cannot settle with the pointer occupying the same space as a peg", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    // Force a pin directly beneath the resting pointer with no initial motion.
    engine.wheel.angle = Math.PI / 2;
    engine.wheel.angularVelocity = 0;
    for (let i = 0; i < 12 / FIXED_DT && !engine.isSettled(); i++) engine.step(FIXED_DT);

    const pegStep = Math.PI * 2 / engine.segmentCount;
    const nearestPeg = Math.round((Math.PI / 2 - engine.wheel.angle) / pegStep);
    const pegAngle = engine.wheel.angle + nearestPeg * pegStep;
    const clearance = Math.abs(((pegAngle - Math.PI / 2 + Math.PI) % (Math.PI * 2)) - Math.PI);
    expect(engine.isSettled()).toBe(true);
    expect(clearance).toBeGreaterThan(0.025);
    expect(Math.abs(engine.pointer.angle)).toBeLessThan(0.012);
    expect(Math.abs(engine.pointer.angularVelocity)).toBeLessThan(0.06);
  });

  it("escapes a loaded pointer resting against the side of a pin", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    engine.wheel.angle = Math.PI / 2 + 0.025;
    engine.wheel.angularVelocity = 0;
    engine.pointer.angle = -0.5;
    engine.pointer.angularVelocity = 0;

    for (let i = 0; i < 12 / FIXED_DT && !engine.isSettled(); i++) engine.step(FIXED_DT);

    expect(engine.isSettled()).toBe(true);
    expect(Math.abs(engine.pointer.angle)).toBeLessThan(0.012);
    expect(Math.abs(engine.pointer.angularVelocity)).toBeLessThan(0.06);
  });

  it("never lets the rendered pointer bead penetrate a pin at slow speed", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    engine.wheel.angle = Math.PI / 2 - 0.055;
    engine.wheel.angularVelocity = 0.35;
    let minimumSeparation = Infinity;
    for (let frame = 0; frame < 360; frame++) {
      engine.step(FIXED_DT);
      const step = Math.PI * 2 / engine.segmentCount;
      const nearest = Math.round((Math.PI / 2 - engine.wheel.angle) / step);
      const pinAngle = engine.wheel.angle + nearest * step;
      const pinX = Math.cos(pinAngle) * 0.83;
      const pinY = Math.sin(pinAngle) * 0.83;
      const tipX = Math.sin(engine.pointer.angle) * 0.145;
      const tipY = 0.955 - Math.cos(engine.pointer.angle) * 0.145;
      const separation=Math.hypot(tipX-pinX,tipY-pinY);
      minimumSeparation=Math.min(minimumSeparation,separation);
    }
    expect(minimumSeparation).toBeGreaterThanOrEqual(0.0458);
  });

  it.each(Array.from({ length: 49 }, (_, index) => index + 2))("remains stable and settles with %i segments", count => {
    const { engine, impacts, result } = run([count, 1234], 0.65, count);
    expect(engine.isSettled()).toBe(true);
    expect(Number.isFinite(engine.wheel.angle)).toBe(true);
    expect(impacts.length).toBeGreaterThan(0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(count);
  });

  it.each([0, 0.001, 1])("settles for an extreme charge of %f", charge => {
    const { engine } = run([77, 21], charge);
    expect(engine.isSettled()).toBe(true);
    expect(engine.wheel.angularVelocity).toBe(0);
  });

  it("can transfer enough momentum to reverse at a final peg", () => {
    const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    engine.wheel.angle = Math.PI * 1.5 - 0.02;
    engine.wheel.angularVelocity = 0.01;
    let collided = false;
    engine.onImpact(() => collided = true);
    let minimumVelocity = engine.wheel.angularVelocity;
    for (let i = 0; i < 240; i++) {
      engine.step(FIXED_DT);
      minimumVelocity = Math.min(minimumVelocity, engine.wheel.angularVelocity);
    }
    expect(collided).toBe(true);
    expect(minimumVelocity).toBeLessThan(0);
  });
});


describe("launch isolation", () => {
  it("replays after an earlier spin and a changed wheel", () => {
    const engine = run([13, 5], 0.8, 13).engine;
    const seed = [8, 9, 10, 11];
    const startingAngle = 1.234;
    engine.setSegmentCount(8);
    engine.wheel.angle = startingAngle;
    engine.launch(0.6, new SeededRandom(seed));
    const replay = new PhysicsEngine({ ...DEFAULT_PHYSICS }, 8);
    replay.wheel.angle = startingAngle;
    replay.launch(0.6, new SeededRandom(seed));
    for (let i = 0; i < 45 / FIXED_DT && !engine.isSettled(); i++) {
      engine.step(FIXED_DT);
      replay.step(FIXED_DT);
      expect(replay.snapshot()).toEqual(engine.snapshot());
    }
    expect(engine.isSettled()).toBe(true);
  });


});


describe("mechanical outcome concentration", () => {
  it("does not repeat nearly the same result for gentle two-choice spins", () => {
    const hits = [0, 0];
    for (let seed = 0; seed < 128; seed++) {
      const { engine, result } = run([seed, 2, 0xb17d], 0, 2);
      expect(engine.isSettled()).toBe(true);
      hits[result]++;
    }
    // A deliberately loose, fixed-seed regression check. The full diagnostic
    // tests more choices, charges, and start positions; neither proves fairness.
    expect(Math.min(...hits)).toBeGreaterThan(40);
  });
});


describe("spin duration", () => {
  it.each([2, 8, 40, 50])("gives full-charge %i-choice spins a substantially longer coast", count => {
    // Removing approach-zone drag modestly extends dense-wheel coast times.
    let quickMean = 0;
    for (const charge of [0, 0.55, 1]) {
      let elapsed = 0;
      for (let seed = 0; seed < 8; seed++) {
        const { engine, seconds } = run([seed, count, 0xd073], charge, count, 30);
        expect(engine.isSettled()).toBe(true);
        elapsed += seconds;
      }
      expect(elapsed / 8).toBeGreaterThan(7);
      if (charge === 0.55) quickMean = elapsed / 8;
      if (charge === 1) {
        expect(elapsed / 8).toBeGreaterThan(quickMean + 4);
        expect(elapsed / 8).toBeLessThan(count === 50 ? 26 : 23);
      } else expect(elapsed / 8).toBeLessThan(count === 50 ? 14 : 12.5);
    }
  });
});
