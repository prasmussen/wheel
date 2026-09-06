import { writeFile } from "node:fs/promises";
import { afterAll, expect, test } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT, SIMULATION_VERSION } from "../src/app/Config";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { SeededRandom } from "../src/utils/Random";

const samples = 1024;
const seedSalt = 0xb17d;
const segmentCounts = [2, 8, 40, 50];
const charges = [0, 0.05, 0.1, 0.25, 0.55, 1];
const baseStartOffsets = [0, 0.37];
const lowChargeExtraSegmentFractions = [0.25, 0.5, 0.75];
const scenarios = segmentCounts.flatMap(count => charges.flatMap(charge => {
  // Retain the original offsets for comparison. Fractional segment offsets
  // sample different peg/pointer alignments at every wheel density; half a
  // segment puts a peg directly beneath the pointer from the default angle.
  const offsets = charge <= 0.25
    ? [...baseStartOffsets, ...lowChargeExtraSegmentFractions.map(fraction => fraction * (2 * Math.PI / count))]
    : baseStartOffsets;
  return offsets.map(startOffset => ({ count, charge, startOffset }));
}));
interface Measurement {
  count: number;
  charge: number;
  startOffset: number;
  samples: number;
  unsettled: number;
  meanSeconds: number;
  longestSeconds: number;
  medianSeconds: number;
  p95Seconds: number;
  totalVariation: number;
  chiSquaredPerDegreeOfFreedom: number;
  histogram: number[];
}
const results: Measurement[] = [];

// Keep scenarios separate: pooling different charges or starting positions
// can disguise a severely biased scenario behind a balanced aggregate.
for (const { count, charge, startOffset } of scenarios) {
  test(`${count} choices, charge ${charge}, starting offset ${startOffset}`, async () => {
    const histogram = Array<number>(count).fill(0);
    let unsettled = 0;
    let longest = 0;
    let elapsed = 0;
    const durations: number[] = [];
    for (let seed = 0; seed < samples; seed++) {
      // Let the runner process its messages during this CPU-heavy check.
      if (seed % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      const engine = new PhysicsEngine({ ...DEFAULT_PHYSICS }, count);
      engine.wheel.angle += startOffset;
      engine.launch(charge, new SeededRandom([seed, count, seedSalt]));
      const run = engine.runUntilSettled(45 / FIXED_DT);
      const seconds = run.duration;
      longest = Math.max(longest, seconds);
      elapsed += seconds;
      durations.push(seconds);
      if (!run.settled) unsettled++;
      else histogram[run.selectedIndex!]++;
    }
    const expected = samples / count;
    const chiSquared = histogram.reduce((sum, hits) => sum + (hits - expected) ** 2 / expected, 0);
    const totalVariation = histogram.reduce((sum, hits) => sum + Math.abs(hits / samples - 1 / count), 0) / 2;
    durations.sort((a, b) => a - b);
    const median = (durations[samples / 2 - 1] + durations[samples / 2]) / 2;
    const p95 = durations[Math.ceil(samples * 0.95) - 1];
    const measurement: Measurement = { count, charge, startOffset, samples, unsettled,
      meanSeconds: Number((elapsed / samples).toFixed(2)),
      longestSeconds: Number(longest.toFixed(2)),
      medianSeconds: Number(median.toFixed(2)),
      p95Seconds: Number(p95.toFixed(2)),
      totalVariation: Number(totalVariation.toFixed(4)),
      chiSquaredPerDegreeOfFreedom: Number((chiSquared / (count - 1)).toFixed(3)),
      histogram };
    results.push(measurement);
    console.log(JSON.stringify(measurement));
    expect(unsettled, "Some spins did not settle within 45 seconds").toBe(0);
    expect(elapsed / samples, "Average spin is too short").toBeGreaterThan(7);
    // Version 8 removes approach-zone drag. Match the existing dense-wheel
    // mean limits in tests/physics.test.ts; tail and concentration limits stay fixed.
    const meanLimit = charge === 1 ? (count === 50 ? 26 : 23) : (count === 50 ? 14 : 12.5);
    expect(elapsed / samples, "Average spin is too long").toBeLessThan(meanLimit);
    if (charge === 1) expect(elapsed / samples, "Full-charge coast is too short").toBeGreaterThan(15);
    expect(p95, "Too many long spins").toBeLessThan(charge === 1 ? 27 : 16);
    expect(longest, "A spin lingered too long").toBeLessThan(charge === 1 ? 30 : 20);
    // Broad regression guard against the old concentrated outcomes, not
    // a claim of exact uniformity or a formal statistical acceptance test.
    expect(totalVariation, "Outcome concentration regressed").toBeLessThan(0.2);
  });
}

afterAll(async () => {
  if (process.env.WHEEL_WRITE_DISTRIBUTION === "1") {
    expect(results).toHaveLength(scenarios.length);
    const report = { simulationVersion: SIMULATION_VERSION, samplesTotal: samples * results.length,
      seedRecipe: "[sampleIndex, segmentCount, 0xb17d]",
      coverage: { samplesPerScenario: samples, segmentCounts, charges, baseStartOffsets,
        lowChargeMaximum: 0.25, lowChargeExtraSegmentFractions,
        startOffsetUnits: "radians added to the default wheel angle" },
      physicsConfig: DEFAULT_PHYSICS, results };
    await writeFile(new URL("../docs/distribution.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  }
});
