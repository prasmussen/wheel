import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, firefox, webkit, expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { DEFAULT_PHYSICS, FIXED_DT, SIMULATION_VERSION } from "../../src/app/Config";
import { firstDifference } from "./compare";
import { eventColumns, scenarios, stateColumns } from "./scenarios";
import type { ReplayHarness, ReplayResult } from "./replay";

const implementations = [
  { name: "Chrome", type: chromium, options: { channel: "chrome" } },
  { name: "Firefox", type: firefox, options: {} },
  { name: "WebKit", type: webkit, options: {} },
];
const browsers: Browser[] = [];
const runners: Array<{ name: string; version: string; page: Page; info: ReplayHarness["info"] }> = [];
const results: Array<Record<string, unknown>> = [];
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  for (const implementation of implementations) {
    // A missing browser is a failure, never a silently skipped comparison.
    const browser = await implementation.type.launch(implementation.options);
    browsers.push(browser);
    const page = await browser.newPage();
    await page.goto(`${testInfo.project.use.baseURL}/tests/determinism/runner.html`);
    await page.waitForFunction(() => typeof window.physicsReplay?.run === "function");
    const info = await page.evaluate(() => window.physicsReplay.info);
    expect(info.imports).toEqual([]);
    expect(info.simulationVersion).toBe(SIMULATION_VERSION);
    expect(info.fixedDt).toBe(FIXED_DT);
    expect(info.config).toEqual(DEFAULT_PHYSICS);
    expect(info.moduleHash).toBe(hash(Buffer.from(info.binary, "base64")));
    if (runners.length) expect(info).toEqual(runners[0].info);
    runners.push({ name: implementation.name, version: browser.version(), page, info });
  }
});

async function compareTrace(kind: string, expected: string, actual: string, columns: string[], testInfo: TestInfo) {
  const expectedBytes = Buffer.from(expected, "base64"), actualBytes = Buffer.from(actual, "base64");
  const difference = firstDifference(expectedBytes, actualBytes, columns);
  if (difference) {
    await testInfo.attach(`${kind}-expected.bin`, { body: expectedBytes, contentType: "application/octet-stream" });
    await testInfo.attach(`${kind}-actual.bin`, { body: actualBytes, contentType: "application/octet-stream" });
  }
  expect(difference, `${kind}: ${JSON.stringify(difference)}`).toBeNull();
}

for (const scenario of scenarios) {
  test(scenario.id, async ({}, testInfo) => {
    let reference: ReplayResult | undefined;
    // Keep only this scenario's complete traces in Node memory, comparing
    // actual IEEE-754 bytes, rather than only hashes or rounded JSON numbers.
    for (const runner of runners) {
      const actual = await runner.page.evaluate(input => window.physicsReplay.run(input), scenario);
      expect(actual.moduleHash, `${runner.name} module changed during the suite`).toBe(runners[0].info.moduleHash);
      if (reference) {
        await compareTrace(`${runner.name}-states`, reference.states, actual.states, stateColumns, testInfo);
        await compareTrace(`${runner.name}-impacts`, reference.events, actual.events, eventColumns, testInfo);
        await compareTrace(`${runner.name}-headless`, reference.headless.state, actual.headless.state, stateColumns, testInfo);
        const { states: _states, events: _events, ...metadata } = actual;
        const { states: _referenceStates, events: _referenceEvents, ...referenceMetadata } = reference;
        expect(metadata, `${runner.name} replay metadata`).toEqual(referenceMetadata);
      } else reference = actual;
    }
    expect(runners.map(runner => runner.name)).toEqual(["Chrome", "Firefox", "WebKit"]);
    results.push({ scenario, ticks: reference!.ticks, records: reference!.records,
      eventCount: reference!.eventCount, winner: reference!.winner,
      stateSha256: hash(Buffer.from(reference!.states, "base64")),
      impactSha256: hash(Buffer.from(reference!.events, "base64")), headless: reference!.headless });
  });
}

test.afterAll(async ({}, testInfo) => {
  await Promise.all(browsers.map(browser => browser.close()));
  const report = {
    simulationVersion: SIMULATION_VERSION, moduleSha256: runners[0]?.info.moduleHash,
    fixedDt: runners[0]?.info.fixedDt, maxTicks: runners[0]?.info.maxTicks,
    physicsConfig: runners[0]?.info.config,
    platform: process.platform, arch: process.arch,
    browsers: runners.map(({ name, version }) => ({ name, version })),
    comparison: "Exact little-endian IEEE-754 bytes of full observable snapshots, prior snapshots, simulation time and impact records; plus ticks, durations, RNG state and winners. Trace hashes are summaries only.",
    expectedScenarios: scenarios.length, passedScenarios: results.length, results,
  };
  const encoded = JSON.stringify(report, null, 2) + "\n";
  await testInfo.attach("cross-browser-replay.json", { body: Buffer.from(encoded), contentType: "application/json" });
  // The always-written artifact includes partial progress when a comparison fails.
  const artifact = "test-results/determinism/summary.json";
  await mkdir(dirname(artifact), { recursive: true });
  await writeFile(artifact, encoded);
  if (process.env.WHEEL_WRITE_DETERMINISM === "1" && results.length === scenarios.length && runners.length === 3) {
    await writeFile("docs/cross-browser-replay.json", encoded);
  }
});
