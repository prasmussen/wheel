import { expect, test } from '@playwright/test';
import { SIMULATION_VERSION } from '../../src/app/Config';

test('automatically stores ten JSON snapshots and restores wheel, replay, and sharing after reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(version => {
    localStorage.setItem('momentum-spin-history', JSON.stringify(Array.from({ length: 10 }, (_, i) => ({
      completedAt: 1000 - i, result: 'Old A',
      state: { v: 1, choices: ['Old A', 'Old B'], replay: { version, seed: [i, 2, 3, 4], charge: 0, angle: 0 } },
    }))));
  }, SIMULATION_VERSION);
  await page.reload();
  await page.getByText('Paste choices', { exact: true }).click();
  await page.locator('#bulk-choices').fill('ÆØÅ\nCafé\nLunch');
  await page.locator('#apply-bulk').click();
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.locator('#spin-button').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
  const winner = await page.locator('#result').textContent();
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('momentum-spin-history')!));
  expect(history).toHaveLength(10);
  expect(history[0].result).toBe(winner);
  expect(history[0].state.choices).toEqual(['ÆØÅ', 'Café', 'Lunch']);
  expect(history[9].completedAt).toBe(992);
  await page.locator('#share-wheel').click();
  const url = await page.locator('#share-link').inputValue();
  const shared = await page.evaluate(url => {
    const text = new URL(url).hash.slice(7).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0))));
  }, url);
  expect(history[0].state).toEqual(shared);
  await page.locator('#reset-wheel').click();
  await page.reload();
  await page.getByText('Spin history', { exact: true }).click();
  await expect(page.locator('#spin-history li')).toHaveCount(10);
  await page.locator('#spin-history button').first().click();
  await expect(page.locator('#editor-list input')).toHaveCount(3);
  await expect(page.locator('#editor-list input').first()).toHaveValue('ÆØÅ');
  await expect(page.locator('#replay-spin')).toBeEnabled();
  await page.locator('#replay-spin').click();
  await expect(page.locator('#spin-history button').first()).toBeDisabled();
  await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
  await expect(page.locator('#result')).toHaveText(winner!);
  const replayHistory = await page.evaluate(() => JSON.parse(localStorage.getItem('momentum-spin-history')!));
  expect(replayHistory).toHaveLength(10);
  expect(replayHistory[0].state).toEqual(history[0].state);
  expect(replayHistory[0].completedAt).toBeGreaterThan(history[0].completedAt);
});

test('corrupt history and failed storage writes leave session history usable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('momentum-spin-history', '{broken');
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await page.getByText('Spin history', { exact: true }).click();
  await expect(page.locator('#history-empty')).toBeVisible();
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.locator('#spin-button').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
  await expect(page.locator('#notice')).toContainText('could not be saved');
  await expect(page.locator('#spin-history li')).toHaveCount(1);
  await expect(page.locator('#history-empty')).toBeHidden();
  await page.locator('#spin-history button').click();
  await expect(page.locator('#replay-spin')).toBeEnabled();
});
