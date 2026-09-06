import { expect, test } from '@playwright/test';

test('compact header stays on one row and its menu supports dismissal and resizing', async ({ page }, testInfo) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Wheel menu', exact: true });
  const edit = page.locator('#edit-wheel');
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(toggle).toBeVisible();
    await expect(edit).toBeHidden();
    const title = (await page.locator('.app-title').boundingBox())!;
    const actions = (await page.locator('.header-actions').boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(actions.x);
    expect(Math.abs(title.y + title.height / 2 - actions.y - actions.height / 2)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(edit).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`header-${width}.png`) });
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(edit).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.locator('.app-title').click();
    await expect(edit).toBeHidden();
  }
  await toggle.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toggle).toBeHidden();
  await expect(edit).toBeVisible();
  await expect(edit).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(edit).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});
