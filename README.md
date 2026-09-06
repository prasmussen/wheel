# Momentum

A WebGPU-only spinning wheel whose result emerges from a fixed-timestep mechanical simulation. The wheel, spring pointer, peg impacts, audio, and final selection share the same physical state—there is no scripted destination animation.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and a browser with WebGPU enabled.

```sh
npm install
npm run dev
```

Hold **Press & Hold** (or Space/Enter while focused), then release. Longer holds add more launch energy. **Mute** toggles sound for the session. Moving focus, leaving the page, or cancelling a pointer gesture cancels charging without spinning.

Choices stay locked while charging or spinning. Once the wheel settles, its selected choice is announced. Editing choices clears the previous result.

## Choices

Choose **Edit wheel** to edit choices, or **Spin history** to open previous spins in a separate dialog. Close either dialog with **Done**, Escape, or a click outside it. Choosing Replay closes the history dialog and immediately replays that spin. The main screen gives the wheel the full available width.

- Edit 2–50 choices, with up to 12 characters each. Blank choices must be named before spinning.
- **Batch edit** switches the individual fields to a multiline editor prefilled with the current choices. **Apply choices** returns to individual editing, where **Done** closes the dialog. **Cancel**, Escape, or clicking outside discards unapplied batch edits. Keep 2–50 choices, one per nonblank line, with up to 12 characters each.
- **Spin history** automatically keeps the last 30 completed spins on this device, newest first. Each entry shows its result and completion time. **Replay** restores its choices and immediately plays that spin again. Replays do not add history entries or change the order of existing spins.
- Storage failures leave the wheel usable for the session and announce a status to screen readers. Invalid stored configurations fall back to the default wheel.

Wheel labels use smooth semibold Manrope text with system font fallbacks, displaying uppercase text while preserving accents, non-Latin scripts, and emoji. Character coverage depends on available fonts. Labels fit the available width with modest size reduction followed by an ellipsis at a complete grapheme boundary. Option inputs automatically uppercase text, including pasted batches. Blank lines in batches are ignored; blank individual choices are removed when the modal closes, provided at least two choices remain. Full labels are retained in the editor and result.

History is stored under `momentum-spin-history` as a JSON array. Each entry has `completedAt`, `result`, and `state`; `state` holds the choices and replay inputs as a plain object. Invalid or incompatible entries are skipped. If storage fails, history remains available for the session.

## Sharing

Choice changes automatically update the current URL without navigating or adding browser history entries. Reloading restores those choices, including edits to a shared wheel; reset also updates the URL to the defaults. Unapplied batch edits and temporarily blank fields are drafts until applied or removed on close.

**Share** opens a modal with a link containing the current choices and the latest replay, if one exists. **Copy to clipboard** copies it; if clipboard access fails, the link is selected for manual copying. Open it to load the wheel, then open **Spin history** and choose **Replay shared spin** to watch the recorded spin. Opening a link does not start a spin automatically.

If choices changed after the latest spin, the link preserves both sets: replay restores the original choices. Links take precedence over locally stored choices on load. Invalid links silently clear the URL query and fragment and reset the saved wheel to the defaults; replays from a different simulation version are unavailable, but their shared choices still load.

New links use readable lowercase comma-separated choices (`?choices=pizza,sushi,tacos`). Labels are restored to uppercase when loading the wheel. Each label is individually percent-encoded, so commas within labels, spaces, and Unicode round-trip correctly. Optional `replay=2.…` data uses base64url over 36 binary bytes: a little-endian uint32 simulation version, four uint32 seed words, and float64 charge and starting angle. A separate `replayChoices` list is included only when the recorded choices differ. Split choice lists on literal commas before percent-decoding; do not reserialize them through `URLSearchParams`. Legacy `?wheel=…` links are unsupported. No sharing service is needed. Anyone with the link can read its choices and replay. Large wheels produce longer links. Physics values come from the fixed simulation version, never from link-supplied settings.

## Physics and replay

The physics core, seeded RNG, launch energy, and brake calculations run in [handwritten WebAssembly](src/physics/wasm/physics.wat), with no imports or calls to TypeScript math. TypeScript handles browser APIs, state transport, and rendering interpolation; WebGPU/WGSL handles rendering. Animation advances all due ticks in one Wasm call per frame and reuses its display buffers. Diagnostic spins run to settlement entirely inside Wasm. WABT assembles the module automatically during development, builds, and tests. See the [Wasm architecture and numerical contract](docs/wasm-physics.md).

Every new launch uses a fresh seed from `crypto.getRandomValues`. The seed varies spring preload, pointer initialization, drag, and restitution. Two independent, bounded preload contributions add to the charge-dependent kinetic energy before the launch torque is applied. This gives even gentle releases a wider range of physical trajectories. The launch sampler has no access to segment count, labels, wheel angle, or a desired winner; there is no destination search, reroll, or steering toward a selected winner.

Longer holds increase launch energy for the same random preload, and even the weakest full-charge launch is stronger than the strongest zero-charge launch. The preload range grows with charge to keep travel varied under the stronger brake. The randomized launch speed remains below 38 rad/s across the full charge range. New records use simulation version 7, identifying the handwritten WebAssembly core and its optimized, self-contained math routines. Each launch resets transient contact state and records its seed, charge, starting angle, complete choice list, physics settings, and simulation version.

**Replay** in Spin history restores that configuration and reproduces a saved spin. A shared replay that is not already saved appears there as **Replay shared spin**. It remains available after editing choices. Completed replay records persist in Spin history; share links can also carry them across reloads. Replay requires the same simulation version. Version 7 retains the previous mechanics but optimizes math evaluation, so earlier-version replays are unavailable; their shared choices still load. The physics-only replay suite verifies exact state and impact equivalence across Chrome, Firefox, and WebKit for 101 scenarios. The [recorded results](docs/cross-browser-replay.json) identify the tested browser builds and platform.

Physics settings are fixed and cannot be adjusted in the interface. The outer simulation ticks at 240 Hz. Fast peg travel and spring response use bounded adaptive substeps within each tick, including launch acceleration, so a pin cannot simply cross the contact area between samples. The lighter spring pointer has lower damping and returns quickly enough to show individual deflections on the default wheel. Dense wheels can keep the pointer deflected while it flutters against successive pins. Repeated contact visits within the substeps do not produce duplicate click notifications for the same pin traversal.

## Spin duration

A speed-sensitive brake keeps shorter holds brisk. Above 55% charge, a stronger pull progressively releases more of the brake; a full hold uses 20% of the normal brake strength and coasts substantially longer. The brake setting is established at launch and included implicitly in replay through the recorded charge.

The brake opposes rotation above 0.12 rad/s, engages smoothly up to 0.5 rad/s, and fully releases in the slow contact regime. Baseline bearing friction and inertia remain unchanged. The wheel still stops through friction and peg contact, without a duration deadline or chosen result.

The [current report](docs/distribution.json) contains version 7 durations and outcome frequencies, including the revised pointer contacts. The historical [duration comparison](docs/duration-comparison.json) records the earlier version 2–3 shortening, before full-charge spins gained their longer coast. The diagnostic checks short-hold averages below 12.5 seconds and full-charge averages between 15 and 23 seconds, alongside settling, duration tails, and outcome concentration.

## Outcome distribution

Equal segment sizes do **not** guarantee equal winning probabilities. Outcomes depend on charge, starting position, and physical parameters. The diagnostic samples 1,024 seeds for each combination of 2/8/40/50 choices, 0/55/100% charge, and two starting positions: 24,576 spins total under the default physics settings. Each scenario is reported separately so pooling cannot hide a biased charge or starting position.

The checked-in [sample results](docs/distribution.json) describe the current version 7 implementation. The [duration comparison](docs/duration-comparison.json) compares versions 2 and 3 using identical seed inputs and scenarios, separate from the smaller exploratory sample used to tune the brake.

Each version’s measurements describe that version’s launch and brake settings; they do not establish exact uniformity.

The historical [bias comparison](docs/bias-comparison.json) records the earlier change from version 1's narrow speed jitter to version 2's randomized preload. Its two-choice, zero-charge, default-position scenario improved from **964–60** to **514–510**. Those historical figures predate the shorter-spin mechanics; use the current report for current outcomes.

The report includes histograms, total variation distance from uniform frequencies, and chi-squared divided by its degrees of freedom. Finite samples have nonzero deviations even for a uniform process. A total variation threshold of 0.2 catches severe regressions; it is not a fairness certification. These measurements do not establish exact uniformity, cover every physics setting, or guarantee every possible spin will settle.

## Verification

```sh
npm test
npm run build
npm run test:browser
npm run test:determinism
npm run analyze:distribution
# Explicitly refresh the checked-in current-model report:
WHEEL_WRITE_DISTRIBUTION=1 npm run analyze:distribution
```

The cross-browser replay suite uses locally installed Google Chrome plus Playwright’s Firefox and WebKit builds (`npx playwright install firefox webkit`). It starts a physics-only page and requires no WebGPU support. See the [comparison method and report instructions](docs/wasm-physics.md#cross-browser-replay).

The fast tests also verify the import-free Wasm module, numerical accuracy, preserved RNG streams, exact batch/single-tick equivalence, interpolation endpoints, and explicit configuration updates. They cover deterministic replay after previous spins, stationary charging, launch extremes, high-speed contacts in both directions and across tick alignments, passive brake torque, spin duration, peg crossings, pointer rebound, low-speed reversal, settling at every segment count from 2 through 50, winner geometry, history and stored-data validation, bulk entry, and label handling.

Browser tests use locally installed Google Chrome with WebGPU enabled. They cover keyboard and pointer cancellation, locked controls, full-speed pointer motion reaching the GPU, replay, bulk editing, 30-entry history retention and restoration, persistence failures, unsupported WebGPU, desktop/mobile resizing, idle rendering, and injected device-loss recovery. The distribution diagnostic is separate from the fast suite and prints per-scenario histograms and concentration metrics. It also checks settling, guards against the old severe outcome concentration, and checks short-hold averages below 12.5 seconds, the 95th percentile below 16 seconds, and every sampled short-hold spin below 20 seconds. Full-charge spins instead target a 15–23-second average, a 95th percentile below 27 seconds, and all sampled spins below 30 seconds.

## Rendering and recovery

All wheel visuals are composited with WebGPU/WGSL. Pegs are instanced. Complete labels are rasterized with Canvas 2D into an oversampled transparent texture so the browser handles font fallback and script shaping. This texture is cached during spins and refreshed after label edits or display-size changes. The label font is resolved before the first frame, with a one-second limit; if loading fails or takes longer, the renderer keeps its system fallback to avoid a later text-size change. There is no WebGL or Canvas 2D rendering fallback.

Rendering and physics pause when the wheel is resting, and while the page is hidden. Resizing or interacting wakes the renderer. After GPU device loss, **Retry** recreates graphics resources and resumes the preserved simulation. Choice editing remains available when WebGPU cannot initialize.
