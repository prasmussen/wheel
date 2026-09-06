import { expect, test } from "@playwright/test";

test("locks a spin, replays its result, and clears results after editing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#spin-button")).toBeEnabled();
  await page.locator("#spin-button").focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#charge-label")).toHaveText("100%");
  await page.keyboard.up("Space");
  await expect(page.locator("#result")).toHaveText("IN MOTION");
  await expect(page.locator("#spin-button")).toBeDisabled();
  await expect(page.locator("#editor-list input").first()).toBeDisabled();
  await expect(page.locator("#result")).toHaveClass("winner", { timeout: 45_000 });
  const result = await page.locator("#result").textContent();
  await page.locator("#editor-list input").first().fill("Changed");
  await expect(page.locator("#result")).toHaveText("READY");
  await page.locator("#replay-spin").click();
  await expect(page.locator("#editor-list input").first()).toHaveValue("PIZZA");
  await expect(page.locator("#result")).toHaveClass("winner", { timeout: 45_000 });
  await expect(page.locator("#result")).toHaveText(result!);
});

test("cancels keyboard and pointer charging without launching", async ({ page }) => {
  await page.goto("/");
  const spin = page.locator("#spin-button");
  await expect(spin).toBeEnabled();
  await spin.focus();
  await page.keyboard.down("Space");
  await expect(spin).toHaveClass(/charging/);
  await page.keyboard.press("Tab");
  await page.keyboard.up("Space");
  await expect(spin).not.toHaveClass(/charging/);
  await expect(page.locator("#result")).toHaveText("READY");
  await spin.hover();
  await page.mouse.down();
  await expect(spin).toHaveClass(/charging/);
  await spin.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(spin).not.toHaveClass(/charging/);
  await expect(page.locator("#charge-label")).toHaveText("PRESS & HOLD");
  await expect(page.locator("#editor-list input").first()).toBeEnabled();
});

test("bulk edit, undo, persistence, and mute", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Paste choices", { exact: true }).click();
  await page.locator("#bulk-choices").fill("ÆØÅ\nCafé\nLunch");
  await page.locator("#apply-bulk").click();
  await expect(page.locator("#editor-list input")).toHaveCount(3);
  await page.locator("#reset-wheel").click();
  await expect(page.locator("#editor-list input")).toHaveCount(8);
  await page.locator("#undo").click();
  await expect(page.locator("#editor-list input").first()).toHaveValue("ÆØÅ");
  await page.reload();
  await expect(page.locator("#editor-list input")).toHaveCount(3);
  await expect(page.locator("#editor-list input").first()).toHaveValue("ÆØÅ");
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
});

test("recovers corrupt storage and reports failed writes", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("momentum-wheel", JSON.stringify({ version: "x", items: [null, null] }));
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await page.goto("/");
  await expect(page.locator("#editor-list input")).toHaveCount(8);
  await page.locator("#editor-list input").first().fill("Still works");
  await expect(page.locator("#notice")).toContainText("could not be saved");
  await expect(page.locator("#spin-button")).toBeEnabled();
});

test("unsupported WebGPU keeps editing available and offers retry", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
  await page.goto("/");
  await expect(page.locator("#gpu-error")).toBeVisible();
  await expect(page.locator("#spin-button")).toBeDisabled();
  await page.locator("#editor-list input").first().fill("Offline choice");
  await page.locator("#retry-gpu").click();
  await expect(page.locator("#gpu-message")).toContainText("does not support WebGPU");
});

test("renders without GPU errors across desktop and mobile sizes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await expect(page.locator("#spin-button")).toBeEnabled();
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("#wheel-canvas")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const canvas = await page.locator("#wheel-canvas").boundingBox();
    const controls = await page.locator(".spin-controls").boundingBox();
    expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(controls!.y);
    if (width === 1440 || width === 390) await page.screenshot({ path: testInfo.outputPath(`wheel-${width}.png`), fullPage: true });
  }
  expect(errors.filter(error => !error.includes("fonts.googleapis.com"))).toEqual([]);
});

test("stops drawing at rest, wakes on resize, and recovers device loss", async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { frames: number; loseDevice: () => void };
    probe.frames = 0;
    const gpu = navigator.gpu;
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async options => {
      const adapter = await requestAdapter(options);
      if (!adapter) return null;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async descriptor => {
        const device = await requestDevice(descriptor);
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = buffers => { probe.frames++; submit(buffers); };
        Object.defineProperty(device, "lost", { value: new Promise(resolve => {
          probe.loseDevice = () => resolve({ reason: "unknown", message: "Test device loss" });
        }) });
        return device;
      };
      return adapter;
    };
  });
  await page.goto("/");
  await expect(page.locator("#spin-button")).toBeEnabled();
  const frames = () => page.evaluate(() => (window as unknown as { frames: number }).frames);
  // Wait for the initial resting simulation to stop submitting GPU work.
  await expect.poll(async () => {
    const before = await frames();
    await page.waitForTimeout(150);
    return await frames() === before && before > 0;
  }).toBe(true);
  const beforeResize = await frames();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(frames).toBeGreaterThan(beforeResize);
  await page.locator("#spin-button").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#result")).toHaveText("IN MOTION");
  await page.evaluate(() => (window as unknown as { loseDevice: () => void }).loseDevice());
  await expect(page.locator("#gpu-error")).toBeVisible();
  await expect(page.locator("#spin-button")).toBeDisabled();
  await page.locator("#retry-gpu").click();
  await expect(page.locator("#gpu-error")).toBeHidden();
  await expect(page.locator("#result")).toHaveClass("winner", { timeout: 45_000 });
  await expect(page.locator("#spin-button")).toBeEnabled();
});
