import { writeFile } from "node:fs/promises";
import { afterAll, expect, test } from "vitest";
import { DEFAULT_PHYSICS, FIXED_DT, SIMULATION_VERSION } from "../src/app/Config";
import { PhysicsEngine } from "../src/physics/PhysicsEngine";
import { SeededRandom } from "../src/utils/Random";

const samples = 1024;
const seedSalt = 0xb17d;
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
for (const count of [2, 8, 40, 50]) {
  for (const charge of [0, 0.55, 1]) {
    for (const startOffset of [0, 0.37]) {
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
        expect(elapsed / samples, "Average spin is too long").toBeLessThan(charge === 1 ? 23 : 12.5);
        if (charge === 1) expect(elapsed / samples, "Full-charge coast is too short").toBeGreaterThan(15);
        expect(p95, "Too many long spins").toBeLessThan(charge === 1 ? 27 : 16);
        expect(longest, "A spin lingered too long").toBeLessThan(charge === 1 ? 30 : 20);
        // Broad regression guard against the old concentrated outcomes, not
        // a claim of exact uniformity or a formal statistical acceptance test.
        expect(totalVariation, "Outcome concentration regressed").toBeLessThan(0.2);
      });
    }
  }
}

afterAll(async () => {
  if (process.env.WHEEL_WRITE_DISTRIBUTION === "1") {
    const report = { simulationVersion: SIMULATION_VERSION, samplesTotal: samples * results.length,
      seedRecipe: "[sampleIndex, segmentCount, 0xb17d]", physicsConfig: DEFAULT_PHYSICS, results };
    await writeFile(new URL("../docs/distribution.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  }
});
