import { describe, expect, it } from "vitest";
import { sampleLaunchSpeed } from "../src/physics/LaunchEnergy";
import { SeededRandom, type RandomSource } from "../src/utils/Random";

function fixed(value: number): RandomSource {
  return { next: () => value, range: (min, max) => min + (max - min) * value };
}

describe("mechanical launch energy", () => {
  it("keeps the launch finite, forward, and bounded at random and charge extremes", () => {
    for (const draw of [0, 0.5, 1 - Number.EPSILON]) {
      for (const charge of [-1, 0, 0.5, 1, 2]) {
        const speed = sampleLaunchSpeed(charge, fixed(draw));
        expect(speed).toBeGreaterThanOrEqual(4.2);
        expect(speed).toBeLessThan(38);
      }
    }
    expect(sampleLaunchSpeed(-1, fixed(0.5))).toBe(sampleLaunchSpeed(0, fixed(0.5)));
    expect(sampleLaunchSpeed(2, fixed(0.5))).toBe(sampleLaunchSpeed(1, fixed(0.5)));
  });

  it("gives full holds more energy than even the strongest gentle launch", () => {
    const strongestGentle = sampleLaunchSpeed(0, fixed(1 - Number.EPSILON));
    const weakestFull = sampleLaunchSpeed(1, fixed(0));
    expect(weakestFull).toBeGreaterThan(strongestGentle);
  });

  it("increases launch energy with charge for every sampled preload", () => {
    for (let seed = 0; seed < 128; seed++) {
      const speeds = [0, 0.25, 0.55, 1].map(charge => sampleLaunchSpeed(charge, new SeededRandom([seed, 0x1234])));
      for (let index = 1; index < speeds.length; index++) expect(speeds[index]).toBeGreaterThan(speeds[index - 1]);
    }
  });
});
