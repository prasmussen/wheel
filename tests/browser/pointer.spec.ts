import { expect, test } from "@playwright/test";

test("renders peg-driven pointer deflection and recovery at full speed", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { pointerProbe: { active: boolean; angles: number[] } };
    probe.pointerProbe = { active: false, angles: [] };
    const randomValues = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = array => {
      if (array instanceof Uint32Array && array.length === 4) { array.set([42, 0, 0, 0]); return array; }
      return randomValues(array);
    };
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async options => {
      const adapter = await requestAdapter(options);
      if (!adapter) return null;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async descriptor => {
        const device = await requestDevice(descriptor);
        const writeBuffer = device.queue.writeBuffer.bind(device.queue);
        device.queue.writeBuffer = (buffer, offset, data, dataOffset, size) => {
          if (buffer.label === "pointer-state" && probe.pointerProbe.active && data instanceof Float32Array) {
            probe.pointerProbe.angles.push(data[0]);
          }
          writeBuffer(buffer, offset, data, dataOffset, size);
        };
        return device;
      };
      return adapter;
    };
  });
  await page.goto("/");
  await expect(page.locator("#spin-button")).toBeEnabled();
  await page.locator("#spin-button").focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#charge-label")).toHaveText("100%");
  await page.keyboard.up("Space");
  await expect(page.locator("#result")).toHaveText("IN MOTION");
  await page.evaluate(() => {
    (window as unknown as { pointerProbe: { active: boolean } }).pointerProbe.active = true;
  });
  const samples = () => page.evaluate(() => (window as unknown as { pointerProbe: { angles: number[] } }).pointerProbe.angles);
  await expect.poll(async () => (await samples()).length).toBeGreaterThan(60);
  const angles = (await samples()).slice(20);
  expect(Math.min(...angles)).toBeLessThan(-0.7);
  expect(Math.max(...angles)).toBeGreaterThan(-0.3);
  await page.screenshot({ path: testInfo.outputPath("fast-pointer.png") });
});
