# Momentum

A WebGPU-only spinning wheel whose result emerges from a fixed-timestep mechanical simulation. The wheel, spring pointer, peg impacts, audio, and final selection all share the same physical state—there is no scripted destination animation.

## Run locally

Requirements: Node.js 20+ and a browser with WebGPU enabled.

```sh
npm install
npm run dev
```

Hold the **Press & Hold** control (or Space/Enter while it is focused), then release. Longer holds add more launch energy. Every release uses a fresh seed from `crypto.getRandomValues`; the seed drives a deterministic PRNG so a spin is unpredictable but replayable.

The **Physics** button opens live metrics, collision geometry guidance, and tuning controls. Wheel choices are saved in local storage.

## Verification

```sh
npm test
npm run build
```

The tests cover deterministic replay, launch extremes, high-speed peg crossings, pointer rebound, low-speed reversal, settling, winner geometry, and the full 2–50 segment range.

## Rendering

All wheel visuals use WebGPU/WGSL. Pegs and procedural signed-distance glyphs are instanced; resources are rebuilt only when wheel contents change. There is deliberately no WebGL or Canvas 2D fallback.
