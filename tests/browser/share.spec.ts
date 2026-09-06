import { openEditor, closeEditor } from './editor';
import { expect, test } from '@playwright/test';

test('shares edited choices and the latest replay into a fresh browser context', async ({ page, browser }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Denied'); } } });
  });
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await closeEditor(page);
  await page.locator('#spin-button').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
  const winner = await page.locator('#result').textContent();
  await openEditor(page);
  await page.locator('#editor-list input').first().fill('ÆØÅ 🍕');
  await closeEditor(page);
  await page.getByRole('button', { name: 'Share wheel', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Copy the selected link');
  const url = await page.locator('#share-link').inputValue();
  expect(new URL(url).hash).toMatch(/^#wheel=/);
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(url);
    await expect(recipient.locator('#editor-list input').first()).toHaveValue('ÆØÅ 🍕');
    await expect(recipient.locator('#result')).toHaveText('READY');
    await expect(recipient.locator('#replay-spin')).toBeEnabled();
    await closeEditor(recipient);
    await recipient.locator('#replay-spin').click();
    await expect(recipient.locator('#editor-list input').first()).toHaveValue('PIZZA');
    await expect(recipient.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
    await expect(recipient.locator('#result')).toHaveText(winner!);
  } finally {
    await context.close();
  }
});

test('copies a wheel without a replay and recovers from a malformed link', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
      (window as unknown as { copiedLink: string }).copiedLink = text;
    } } });
  });
  await page.goto('/');
  await openEditor(page);
  await page.locator('#editor-list input').first().fill('Shared choice');
  await closeEditor(page);
  await page.locator('#share-wheel').click();
  await expect(page.locator('#notice')).toHaveText('Wheel link copied.');
  const link = await page.evaluate(() => (window as unknown as { copiedLink: string }).copiedLink);
  await page.goto(link);
  await expect(page.locator('#editor-list input').first()).toHaveValue('Shared choice');
  await expect(page.locator('#replay-spin')).toBeHidden();
  await page.goto('/#wheel=broken');
  await expect(page.locator('#notice')).toContainText('invalid or incomplete');
  await expect(page.locator('#editor-list input').first()).toHaveValue('Shared choice');
});

test('confirmed reset clears the shared URL and reloads defaults; cancelling keeps the link', async ({ page }) => {
  const payload = btoa(JSON.stringify({ v: 1, choices: ['One', 'Two'] })).replace(/=+$/, '');
  await page.goto('/?source=test#wheel=' + payload);
  await openEditor(page);
  await expect(page.locator('#editor-list input')).toHaveCount(2);
  const sharedUrl = page.url();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#reset-wheel').click();
  expect(page.url()).toBe(sharedUrl);
  await expect(page.locator('#editor-list input')).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#reset-wheel').click();
  expect(new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).search).toBe('?source=test');
  await expect(page.locator('#wheel-editor')).toBeVisible();
  await expect(page.locator('#editor-list input')).toHaveCount(8);
  await page.reload();
  await expect(page.locator('#editor-list input')).toHaveCount(8);
  await expect(page.locator('#editor-list input').first()).toHaveValue('PIZZA');
});
