import { expect, test } from "@playwright/test";

test("renders complete Unicode labels and reuses their texture while spinning", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { drawnLabels: string[] };
    probe.drawnLabels = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      probe.drawnLabels.push(text);
      fillText.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto("/");
  await expect(page.locator("#spin-button")).toBeEnabled();
  await page.locator("#edit-wheel").click();
  await page.locator("#batch-edit").click();
  const labels = ["Café", "Æøå", "東京", "مرحبا", "नमस्ते", "👩🏽‍💻", "שלום", "Pizza"];
  await page.locator("#bulk-choices").fill(labels.join("\n"));
  await page.locator("#apply-bulk").click();
  await page.locator("#close-editor").click();
  const drawn = () => page.evaluate(() => (window as unknown as { drawnLabels: string[] }).drawnLabels);
  await expect.poll(drawn).toEqual(expect.arrayContaining(labels.map(label => label.toUpperCase())));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("unicode-wheel.png") });
  await page.locator("#spin-button").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#result")).toHaveText("IN MOTION");
  const before = (await drawn()).length;
  await page.waitForTimeout(500);
  expect((await drawn()).length).toBe(before);
});
