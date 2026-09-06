import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "../src/app/Config";
import { FixedStepLoop } from "../src/physics/FixedStepLoop";

function harness(dt = FIXED_DT, onError?: (error: unknown) => void) {
  let now = 0, nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = nextHandle++; callbacks.set(handle, callback); return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => callbacks.delete(handle));
  const advance = vi.fn(), render = vi.fn();
  const loop = new FixedStepLoop(dt, advance, render, onError);
  return { loop, advance, render, callbacks,
    setTime(time: number) { now = time; },
    frame(time: number) {
      now = time;
      const [handle, callback] = callbacks.entries().next().value!;
      callbacks.delete(handle); callback(time);
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("fixed-step batching", () => {
  it("makes one advance call per frame and retains fractional time for interpolation", () => {
    const h = harness(); h.loop.start();
    h.frame(17);
    expect(h.advance.mock.calls).toEqual([[4]]);
    expect(h.render.mock.calls[0][0]).toBeCloseTo(0.08);
    h.frame(18);
    expect(h.advance).toHaveBeenCalledTimes(1);
    expect(h.render.mock.calls[1][0]).toBeCloseTo(0.32);
    h.frame(34);
    expect(h.advance.mock.calls).toEqual([[4], [4]]);
    h.loop.stop();
    expect(h.callbacks.size).toBe(0);
  });

  it("bounds catch-up work and drops hidden time on restart", () => {
    const h = harness(); h.loop.start(); h.frame(1000);
    expect(h.advance).toHaveBeenLastCalledWith(24);
    h.loop.stop(); h.setTime(100000); h.loop.start(); h.frame(100017);
    expect(h.advance).toHaveBeenLastCalledWith(4);
    h.loop.stop();
  });

  it("keeps the 30-tick cap even with a shorter scheduler interval", () => {
    const h = harness(0.001); h.loop.start(); h.frame(1000);
    expect(h.advance.mock.calls).toEqual([[30]]);
    h.loop.stop();
  });
});

it.each(["advance", "render"] as const)("stops after a %s failure and can restart", phase => {
  const h = harness();
  h[phase].mockImplementationOnce(() => { throw new Error("frame failed"); });
  h.loop.start();
  expect(() => h.frame(17)).toThrow("frame failed");
  expect(h.callbacks.size).toBe(0);
  h.loop.start();
  h.frame(34);
  expect(h.callbacks.size).toBe(1);
  h.loop.stop();
});

it("reports frame failure after stopping the loop", () => {
  const onError = vi.fn();
  const h = harness(FIXED_DT, onError);
  const error = new Error("failed");
  h.advance.mockImplementationOnce(() => { throw error; });
  h.loop.start();
  h.frame(17);
  expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(h.callbacks.size).toBe(0);
  h.loop.start();
  h.frame(34);
  expect(h.callbacks.size).toBe(1);
  h.loop.stop();
});
