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
  Taylor polynomial; cosine uses a phase shift. Tests sweep `[-4pi, 4pi]` and
  bound absolute error against host math to less than `5e-15`.
- Exponential decay uses reduction by a split `ln(2)`, a degree-16 series, and
  power-of-two scaling. Tests cover the decay interval `[-0.9, 0]` to less than
  `8e-16` absolute error, plus representative normal-range values. Values below
  the smallest normal exponential are flushed to zero; simulation decay is
  far from that range.
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

Version **6** identifies the Wasm implementation. The model retains version 5's
mechanics, but new math evaluation may change trajectories near contact
boundaries. Old-version replay records are rejected through the existing
version checks; shared choice lists still load. Do not relabel version 5
records as version 6. The RNG stream itself is preserved and checked against
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
| 512 | Fifty `f64` timestamps for impact deduplication |
| 1024 | Up to 256 impact records: peg index, strength, wheel velocity, simulation timestamp, all `f64` |
| 32768 | Up to 8192 `u32` seed words, hashed in chunks for longer seeds |

`init(count)` initializes a fresh instance. `set_count(count)` clears transient
peg bookkeeping. `launch(charge, rngState)` resets launch/contact state and
consumes the seeded draws; `rng_state()` returns the resulting RNG state.

`step(dt)` reads the state and settings, executes the complete outer tick with
1–32 adaptive substeps, and publishes the new state and event count. The adapter
keeps the existing mutable wheel/pointer views and configuration interface.
All impact notifications are delivered **after** the tick, with each event's
original simulation timestamp and velocity. Event records are copied before
invoking listeners, so resetting the engine from a listener cannot overwrite
pending records. The buffer accommodates the maximum 256 notification attempts
per tick (eight per substep); overflow traps rather than silently dropping
clicks. The application pauses scheduling while idle or hidden as before.

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
stubs. Existing physics, replay, pointer, and browser tests exercise the same
Wasm implementation. The distribution diagnostic checks 24,576 spins and
refreshes the current version's duration and outcome report.
