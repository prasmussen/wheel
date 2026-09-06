import { expect, test } from '@playwright/test';

test('editor mutations keep focus on the affected choice and dialogs restore their opener', async ({ page }) => {
  await page.goto('/');
  await page.locator('#edit-wheel').click();
  const rows = page.locator('.editor-row');
  await rows.nth(1).locator('[data-action="up"]').focus();
  await page.keyboard.press('Enter');
  await expect(rows.first().locator('input')).toBeFocused();
  await expect(page.locator('#choice-status')).toContainText('position 1');
  await rows.first().locator('[data-action="delete"]').focus();
  await page.keyboard.press('Enter');
  await expect(rows.first().locator('[data-action="delete"]')).toBeFocused();
  await page.locator('#add-item').click();
  await expect(rows.last().locator('input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#edit-wheel')).toBeFocused();
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveAccessibleName('Mute');
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
});

test('assistive activation spins with a stable name and reduced motion keeps the wheel still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const spin = page.locator('#spin-button');
  await expect(spin).toBeEnabled();
  await page.waitForTimeout(500);
  const canvas = page.locator('#wheel-canvas');
  const before = await canvas.screenshot();
  await spin.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#result')).toHaveText('IN MOTION');
  await expect(spin).toHaveAccessibleName('Press & Hold to spin');
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(before)).toBe(true);
  await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
  await expect(page.locator('#result')).toBeVisible();
  await expect(spin).toBeEnabled();
  expect((await canvas.screenshot()).equals(before)).toBe(false);
});
