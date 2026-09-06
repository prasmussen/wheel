import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1440]) {
  test(`startup stays stable with delayed fonts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://fonts.gstatic.com/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 800));
      await route.continue();
    });
    await page.addInitScript(() => {
      const probe = window as unknown as { startupShift: number };
      probe.startupShift = 0;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) probe.startupShift += shift.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/');
    await expect(page.locator('.header-actions')).toBeVisible();
    const geometry = () => page.evaluate(() =>
      ['header', '#edit-wheel', '#share-wheel', '#show-history', '#mute', '#wheel-canvas', '#spin-button'].map(selector => {
        const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
        return { x, y, width, height };
      }));
    const before = await geometry();
    await expect(page.locator('#spin-button')).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    expect(await geometry()).toEqual(before);
    expect(await page.evaluate(() => (window as unknown as { startupShift: number }).startupShift)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('late font loading does not redraw or change the wheel label font', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { labelFonts: string[] };
    probe.labelFonts = [];
    const load = document.fonts.load.bind(document.fonts);
    document.fonts.load = async (font, text) => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return load(font, text);
    };
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      probe.labelFonts.push(this.font);
      fillText.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  const fonts = () => page.evaluate(() => (window as unknown as { labelFonts: string[] }).labelFonts);
  await expect.poll(async () => (await fonts()).length).toBeGreaterThan(0);
  const initial = await fonts();
  expect(initial.every(font => !font.includes('Manrope'))).toBe(true);
  await page.waitForTimeout(1700);
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.fonts.dispatchEvent(new Event('loadingdone'));
  });
  await page.waitForTimeout(200);
  expect(await fonts()).toEqual(initial);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await fonts()).length).toBeGreaterThan(initial.length);
  expect((await fonts()).every(font => !font.includes('Manrope'))).toBe(true);
});
