import { expect, test } from '@playwright/test';

test('opens a responsive editor modal with keyboard and backdrop dismissal', async ({ page }, testInfo) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Edit wheel' });
  await expect(dialog).toBeHidden();
  await expect(page.locator('#spin-button')).toBeEnabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const canvas = await page.locator('#wheel-canvas').boundingBox();
    expect(canvas!.width).toBeGreaterThan(width * 0.9);
    await page.screenshot({ path: testInfo.outputPath(`wheel-main-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Edit wheel', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('#close-editor')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#editor-list input').first()).toBeFocused();
    await page.locator('#editor-list input').first().fill('Dinner');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`wheel-editor-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#edit-wheel')).toBeFocused();
    await page.locator('#edit-wheel').click();
    await expect(page.locator('#editor-list input').first()).toHaveValue('Dinner');
    await page.locator('#close-editor').click();
    await expect(dialog).toBeHidden();
    await page.locator('#edit-wheel').click();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
    await page.locator('#show-history').click();
    const history = page.getByRole('dialog', { name: 'Spin history' });
    await expect(history).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#close-history')).toBeFocused();
    await expect(page.locator('#history-empty')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`spin-history-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();
    await expect(page.locator('#show-history')).toBeFocused();
    await page.locator('#show-history').click();
    await page.locator('#close-history').click();
    await expect(history).toBeHidden();
    await page.locator('#show-history').click();
    await page.mouse.click(2, 2);
    await expect(history).toBeHidden();
  }
});
