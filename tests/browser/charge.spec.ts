import { expect, test } from '@playwright/test';

test('holding charge keeps the wheel and pointer still until release', async ({ page }) => {
  await page.goto('/');
  const spin = page.locator('#spin-button');
  const canvas = page.locator('#wheel-canvas');
  await expect(spin).toBeEnabled();
  await page.waitForTimeout(500);
  const before = await canvas.screenshot();
  await spin.focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#charge-label')).toHaveText('100%');
  await expect(page.locator('#result')).toHaveText('READY');
  const held = await canvas.screenshot();
  expect(held.equals(before)).toBe(true);
  await page.keyboard.up('Space');
  await expect(page.locator('#result')).toHaveText('IN MOTION');
  await expect(spin).toBeDisabled();
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
});
