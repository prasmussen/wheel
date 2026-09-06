import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import wabt from "wabt";

// Optional first argument: pre-optimization WAT, for a same-machine comparison.
// Measures complete settled spins, including the host loop, without rendering.
const compiler = await wabt();
async function compile(path) {
  const source = compiler.parseWat(path, await readFile(path, "utf8"));
  try {
    source.validate();
    return new WebAssembly.Module(source.toBinary({ canonicalize_lebs: true }).buffer);
  } finally { source.destroy(); }
}
const current = await compile(fileURLToPath(new URL("../src/physics/wasm/physics.wat", import.meta.url)));
const modes = [
  { name: "optimized_step", module: current, batch: false },
  { name: "optimized_run_until_settled", module: current, batch: true },
];
if (process.argv[2]) modes.unshift({ name: "baseline_step", module: await compile(process.argv[2]), batch: false });
const config = [2.8, 0.32, 1.4, 0, 0.32, 100, 0.55, 0.01, 0.16, 0.075];
const dt = 1 / 240, maxTicks = 10800;
function measure({ module, batch }, samples) {
  const start = performance.now();
  let ticks = 0, angleChecksum = 0;
  for (const count of [2, 8, 40, 50]) for (const charge of [0, 0.55, 1]) for (let seed = 0; seed < samples; seed++) {
    const core = new WebAssembly.Instance(module).exports;
    new Float64Array(core.memory.buffer, 64, config.length).set(config);
    core.configure?.(); core.init(count);
    new Uint32Array(core.memory.buffer, 32768, 3).set([seed, count, 0xb17d]);
    core.launch(charge, core.finish_seed(core.hash_seed(0x811c9dc5, 3)));
    if (batch) ticks += core.run_until_settled(maxTicks);
    else {
      let tick = 0;
      while (tick < maxTicks && !core.is_settled()) { core.step(dt); tick++; }
      ticks += tick;
    }
    assert.equal(core.is_settled(), 1, `Unsettled ${count}/${charge}/${seed}`);
    angleChecksum += new Float64Array(core.memory.buffer, 0, 1)[0];
  }
  return { milliseconds: performance.now() - start, ticks, angleChecksum };
}
for (const mode of modes) measure(mode, 2);
const rounds = [];
for (let round = 0; round < 3; round++) {
  const result = {};
  // Rotate order to reduce consistent warm-up/thermal ordering effects.
  for (let index = 0; index < modes.length; index++) {
    const mode = modes[(round + index) % modes.length];
    result[mode.name] = measure(mode, 16);
  }
  assert.equal(result.optimized_step.ticks, result.optimized_run_until_settled.ticks);
  assert.equal(result.optimized_step.angleChecksum, result.optimized_run_until_settled.angleChecksum);
  rounds.push(result);
}
const medianMilliseconds = Object.fromEntries(modes.map(({ name }) => [name,
  rounds.map(round => round[name].milliseconds).sort((a, b) => a - b)[1]]));
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  spinsPerSample: 192, warmupSpinsPerMode: 24, config, dt, maxTicks,
  seedRecipe: "[seed 0..15, count 2/8/40/50, 0xb17d]; charge 0/0.55/1",
  rounds, medianMilliseconds }, null, 2));
