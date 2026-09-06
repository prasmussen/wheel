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

- Edit 2–50 choices, with up to 30 characters each. Blank choices must be named before spinning.
- **Paste choices** replaces the wheel with one choice per nonblank line.
- **Spin history** automatically keeps the last 10 completed spins on this device, newest first. Each entry shows its result and completion time. **Load** restores its choices and replay; **Replay last spin** plays it again. Replayed spins are also logged when they finish.
- Storage failures leave the wheel usable for the session and display a message. Invalid stored configurations fall back to the default wheel.

Wheel labels support A–Z, digits, Nordic letters Æ/Ø/Å/Ä/Ö/Ü, É, and basic punctuation. Other accented Latin letters use their base letter; unsupported glyphs use `?`. Labels longer than 14 characters (8 above 20 choices) end in an ellipsis on the wheel. The editor and result retain the original full text.

History is stored under `momentum-spin-history` as a JSON array. Each entry has `completedAt`, `result`, and `state`; `state` is the same plain object encoded in a share link, without Base64. Invalid or incompatible entries are skipped. If storage fails, history remains available for the session.

## Sharing

**Share wheel** copies a link containing the current choices and the latest replay, if one exists. A selectable link is also shown for manual copying. Open it to load the wheel, then choose **Replay last spin** to watch the recorded spin. Opening a link does not start a spin automatically.

If choices changed after the latest spin, the link preserves both sets: replay restores the original choices. Links take precedence over locally stored choices on load. Invalid links fall back to the local wheel with a message; replays from a different simulation version are unavailable, but their shared choices still load.

Data is encoded as compact UTF-8 JSON in a URL-safe Base64 fragment (`#wheel=…`), with matching choice lists stored only once. No sharing service is needed. Anyone with the link can read its choices and replay. Large wheels produce longer links. Physics values come from the fixed simulation version, never from link-supplied settings.

## Physics and replay

Every new launch uses a fresh seed from `crypto.getRandomValues`. The seed varies spring preload, pointer initialization, drag, and restitution. Two independent, bounded preload contributions add to the charge-dependent kinetic energy before the launch torque is applied. This gives even gentle releases a wider range of physical trajectories. The launch sampler has no access to segment count, labels, wheel angle, or a desired winner; there is no destination search, reroll, or steering toward a selected winner.

Longer holds increase launch energy for the same random preload, and even the weakest full-charge launch is stronger than the strongest zero-charge launch. The preload range grows with charge to keep travel varied under the stronger brake. The randomized launch speed remains below 38 rad/s across the full charge range. These changes alter seeded trajectories, so new records use simulation version 5. Each launch resets transient contact state and records its seed, charge, starting angle, complete choice list, physics settings, and simulation version.

**Replay last spin** restores that configuration and reproduces the spin from the current session or a shared link. It remains available after editing choices. Completed replay records persist in Spin history; share links can also carry them across reloads. Replay is intended for the same simulation version and runtime; cross-engine floating-point equivalence is not guaranteed.

Physics settings are fixed and cannot be adjusted in the interface. The outer simulation ticks at 240 Hz. Fast peg travel and spring response use bounded adaptive substeps within each tick, including launch acceleration, so a pin cannot simply cross the contact area between samples. The lighter spring pointer has lower damping and returns quickly enough to show individual deflections on the default wheel. Dense wheels can keep the pointer deflected while it flutters against successive pins. Repeated contact visits within the substeps do not produce duplicate click notifications for the same pin traversal.

## Spin duration

A speed-sensitive brake keeps shorter holds brisk. Above 55% charge, a stronger pull progressively releases more of the brake; a full hold uses 20% of the normal brake strength and coasts substantially longer. The brake setting is established at launch and included implicitly in replay through the recorded charge.

The brake opposes rotation above 0.12 rad/s, engages smoothly up to 0.5 rad/s, and fully releases in the slow contact regime. Baseline bearing friction and inertia remain unchanged. The wheel still stops through friction and peg contact, without a duration deadline or chosen result.

The [current report](docs/distribution.json) contains version 5 durations and outcome frequencies, including the revised pointer contacts. The historical [duration comparison](docs/duration-comparison.json) records the earlier version 2–3 shortening, before full-charge spins gained their longer coast. The diagnostic checks short-hold averages below 12.5 seconds and full-charge averages between 15 and 23 seconds, alongside settling, duration tails, and outcome concentration.

## Outcome distribution

Equal segment sizes do **not** guarantee equal winning probabilities. Outcomes depend on charge, starting position, and physical parameters. The diagnostic samples 1,024 seeds for each combination of 2/8/40/50 choices, 0/55/100% charge, and two starting positions: 24,576 spins total under the default physics settings. Each scenario is reported separately so pooling cannot hide a biased charge or starting position.

The checked-in [sample results](docs/distribution.json) describe the current version 5 mechanics. The [duration comparison](docs/duration-comparison.json) compares versions 2 and 3 using identical seed inputs and scenarios, separate from the smaller exploratory sample used to tune the brake.

Each version’s measurements describe that version’s launch and brake settings; they do not establish exact uniformity.

The historical [bias comparison](docs/bias-comparison.json) records the earlier change from version 1's narrow speed jitter to version 2's randomized preload. Its two-choice, zero-charge, default-position scenario improved from **964–60** to **514–510**. Those historical figures predate the shorter-spin mechanics; use the current report for current outcomes.

The report includes histograms, total variation distance from uniform frequencies, and chi-squared divided by its degrees of freedom. Finite samples have nonzero deviations even for a uniform process. A total variation threshold of 0.2 catches severe regressions; it is not a fairness certification. These measurements do not establish exact uniformity, cover every physics setting, or guarantee every possible spin will settle.

## Verification

```sh
npm test
npm run build
npm run test:browser
npm run analyze:distribution
# Explicitly refresh the checked-in current-model report:
WHEEL_WRITE_DISTRIBUTION=1 npm run analyze:distribution
```

The fast tests cover deterministic replay after previous spins, charge tension, launch extremes, high-speed contacts in both directions and across tick alignments, passive brake torque, spin duration, peg crossings, pointer rebound, low-speed reversal, settling at every segment count from 2 through 50, winner geometry, history and stored-data validation, bulk entry, and label handling.

Browser tests use locally installed Google Chrome with WebGPU enabled. They cover keyboard and pointer cancellation, locked controls, full-speed pointer motion reaching the GPU, replay, bulk editing, ten-entry history retention and restoration, persistence failures, unsupported WebGPU, desktop/mobile resizing, idle rendering, and injected device-loss recovery. The distribution diagnostic is separate from the fast suite and prints per-scenario histograms and concentration metrics. It also checks settling, guards against the old severe outcome concentration, and checks short-hold averages below 12.5 seconds, the 95th percentile below 16 seconds, and every sampled short-hold spin below 20 seconds. Full-charge spins instead target a 15–23-second average, a 95th percentile below 27 seconds, and all sampled spins below 30 seconds.

## Rendering and recovery

All wheel visuals use WebGPU/WGSL. Pegs and procedural signed-distance glyphs are instanced. There is deliberately no WebGL or Canvas 2D fallback.

Rendering and physics pause when the wheel is resting, and while the page is hidden. Resizing or interacting wakes the renderer. After GPU device loss, **Retry** recreates graphics resources and resumes the preserved simulation. Choice editing remains available when WebGPU cannot initialize.
