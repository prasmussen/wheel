# Handwritten WebAssembly physics

The authoritative simulation is [`physics.wat`](../src/physics/wasm/physics.wat).
It is handwritten WebAssembly text, assembled by WABT through a small Vite
plugin. The same plugin runs in development, production builds, and Vitest.
The browser receives the assembled bytes, not WABT or WAT source. A compiled
`WebAssembly.Module` is shared; each physics engine has an independent instance.
No generated physics source needs to be checked in.

The module has **zero imports**. Wheel and pointer integration, adaptive
substeps, peg contact, penetration correction, settling, impact deduplication,
FNV-1a seed hashing, xorshift32, launch energy, and speed-sensitive braking all
execute inside Wasm. There is no TypeScript physics fallback and no call to
JavaScript math, randomness, or audio from Wasm.

TypeScript owns browser scheduling, input, cryptographic seed acquisition,
configuration serialization, state interpolation for display, audio dispatch,
UI, persistence, and WebGPU commands. WGSL still performs GPU rendering.
`PhysicsEngine.ts`, `Random.ts`, `LaunchEnergy.ts`, and `SpeedBrake.ts` are
adapters to the module. The injectable-draw launch helper is for diagnostics;
normal engine launches consume all seven random draws inside Wasm.

## Numerical behavior

Simulation state and calculations use `f64`. Only the renderer converts display
state to `f32` for GPU uniforms. The module uses native Wasm arithmetic, square
root, floor, ceiling, truncation, absolute value, minimum, maximum, and copy-sign.
The other required functions are implemented directly in WAT:

- Sine reduces simulation angles to `[-pi/2, pi/2]` and evaluates a degree-21
  Taylor polynomial in Horner form using fixed coefficients; cosine uses a
  phase shift. There are no series loops or divisions during polynomial
  evaluation. Tests sweep `[-4pi, 4pi]` and
  bound absolute error against host math to less than `5e-15`.
- Exponential decay uses reduction by a split `ln(2)`, a degree-16 polynomial
  in Horner form, and power-of-two scaling. Tests cover the decay interval `[-0.9, 0]` to less than
  `8e-16` absolute error, plus representative normal-range values. Values below
  the smallest normal exponential are flushed to zero; simulation decay is
  far from that range. Each outer tick calculates the decay factor once and
  reuses it for its equal-duration adaptive substeps.
- Two-coordinate hypotenuse scales by the larger magnitude before taking the
  square root, avoiding unnecessary overflow and underflow.
- Launch charge uses `x * sqrt(x)` for `x^1.5` with charge clamped to `[0,1]`.
  A general-purpose power function is unnecessary for this model.
- Rounding explicitly implements ties toward positive infinity, including
  negative zero. `f64.nearest` would have the wrong tie behavior for peg indices.
- Angle wrapping uses truncation-based remainder for the bounded simulation
  angles, preserving signed zero and reverse-rotation behavior.

These are simulation routines, not a general-purpose arbitrary-magnitude math
library. Nonfinite simulation inputs are unsupported. The supported application
uses 2–50 segments, validated finite launch records, fixed positive physical
settings, and a 1/240-second timestep. Penetration correction caches the three
nearby pin centers once per pass without changing the contact geometry.

Version **7** identifies the optimized polynomial evaluation. Version 6 introduced
the handwritten Wasm implementation; the model retains the same mechanics,
but reassociated math may change trajectories near contact boundaries.
Old-version replay records are rejected through the existing
version checks; shared choice lists still load. Do not relabel earlier
records as version 7. The RNG stream itself is preserved and checked against
captured pre-port vectors, including high-bit seed words and the zero-hash
fallback. Replay tests compare full state and impact sequences for identical
inputs, including reuse of an engine after earlier spins.

## Memory and calls

Each instance owns one fixed 64 KiB memory page. It cannot grow, so TypeScript's
views remain valid throughout the instance's lifetime. There is no allocator.

| Byte offset | Contents |
|---|---|
| 0 | Seven `f64` values: wheel angle/velocity, pointer angle/velocity, stable time, last impact strength, last peg index |
| 64 | Ten `f64` configuration fields in `CONFIG_FIELDS` order |
| 160 | Scratch: three cached pin centers, each two `f64` coordinates |
| 224 | Previous outer-tick snapshot, seven `f64` values in the same order as state |
| 288 | Diagnostic batch duration in seconds and selected index (`-1` if unsettled), both `f64` |
| 304 | Current simulation time as `f64` |
| 512 | Fifty `f64` timestamps for impact deduplication |
| 1024 | Up to 512 impact records: peg index, strength, wheel velocity, simulation timestamp, all `f64` |
| 32768 | Up to 8192 `u32` seed words, hashed in chunks for longer seeds |

`init(count)` initializes a fresh instance. `set_count(count)` clears transient
peg bookkeeping. `launch(charge, rngState)` resets launch/contact state and
consumes the seeded draws; `rng_state()` returns the resulting RNG state.

`configure()` loads the configuration block into Wasm globals. The TypeScript
adapter copies configuration on construction and exposes a frozen `config`.
Call `setConfig(config)` to change settings; it writes changed fields and calls
`configure()` only when settings differ. Mutating the original caller-owned
object no longer changes a running engine. No configuration is polled or copied
per tick, frame, or launch. Replay restoration calls `setConfig` explicitly.

`step(dt)` runs one outer tick, retaining a previous/current snapshot pair.
`advance(tickCount)` executes 0–30 ticks at 1/240 second in one call, retaining
the states immediately before and after the final tick. A zero-tick call leaves
both endpoints unchanged. It executes all requested ticks, even if already at
rest, so pointer relaxation and impact fading behave like repeated `step` calls.
`FixedStepLoop` computes due ticks while preserving its fractional accumulator;
it calls `advance` once per frame. The app reads into reusable snapshot objects
and interpolates into a third reusable object. GPU uniform arrays are also
reused. Rendering still pauses when idle or hidden.

Impact notifications are delivered **after** a tick or frame batch, with each
event's original simulation timestamp and velocity. Records are copied before
invoking listeners, so resetting the engine from a listener cannot overwrite
pending events. Single ticks have at most 256 attempts (eight per substep).
A maximum-size animation batch spans 0.125 seconds; the 25ms per-pin cooldown
bounds it to at most 300 events across 50 pins. The fixed 512-record buffer
accommodates either path; overflow traps rather than silently dropping clicks.
The wrapper rejects noninteger or out-of-range batch sizes before calling Wasm.

`run_until_settled(maxTicks)` runs until the first settled outer tick or the
caller-supplied limit and returns the executed tick count. It publishes batch
duration, final state, and selected index (`-1` when unsettled). It preserves
contact deduplication and physical state, but suppresses audio record collection
so a whole spin cannot overflow the event buffer. This is a headless diagnostic
API; registered impact listeners are not called. Animation resumes normally
afterward. A zero limit performs no ticks. The TypeScript `runUntilSettled`
wrapper returns `{ ticks, duration, settled, selectedIndex }`, using `null` for
an unsettled result. Duration describes this call, so a capped run can be resumed.
The distribution diagnostic uses this path instead of a TypeScript tick loop.

## Verification

```sh
npm test
npm run build
npm run test:browser
WHEEL_WRITE_DISTRIBUTION=1 npm run analyze:distribution
```

`tests/wasm.test.ts` verifies the import-free module, memory isolation, bounded
math accuracy, rounding/angle boundaries, original RNG vectors, launch draw
consumption, configuration synchronization, and buffered events. It also runs
the simulation with host transcendental math functions replaced by throwing
stubs. `tests/batching.test.ts`
compares full snapshots, final interpolation pairs, winners, durations, and
impact streams against single-tick execution, including capped/resumed runs,
zero-tick frames, configuration changes, and resets from event listeners.
`tests/fixed-step.test.ts` checks frame batching and pause/resume scheduling.
Existing physics, replay, pointer, and browser tests exercise the same
Wasm implementation. The distribution diagnostic checks 24,576 spins and
refreshes the current version's duration and outcome report.

## Performance measurement

```sh
node scripts/benchmark-physics.mjs
# Optional same-machine comparison with a previous WAT implementation:
node scripts/benchmark-physics.mjs /tmp/previous-physics.wat
```

The benchmark warms each mode with 24 spins, then rotates mode order across
three 192-spin samples using fixed seeds, charges, and configuration. It checks
that optimized single-tick and headless paths produce identical total tick
counts and final-angle checksums. It measures core instantiation, launch, and
simulation with the host loop, excluding rendering and the application adapter.

The [local measurement](physics-performance.json) compares version 6 with this
implementation on Node 26/macOS ARM64. Median time fell from **1.342 seconds** to
**0.870 seconds** per 192 spins, about **35% less time**. Optimized single-tick
execution took 0.888 seconds; most of the gain comes from the math and core
changes. Batching also removes repeated wrapper calls and configuration work
from the application, which this core-only benchmark does not measure. These
numbers do not establish a browser frame-rate improvement.
