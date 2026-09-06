import { clickHeaderAction } from './editor';
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
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.locator('#share-dialog')).toBeVisible();
  await expect(page.locator('#share-link')).toBeVisible();
  await page.locator('#copy-share-link').click();
  await expect(page.locator('#share-status')).toContainText('Copy the selected link');
  await expect(page.locator('#notice')).toHaveCount(0);
  const url = await page.locator('#share-link').inputValue();
  expect(new URL(url).searchParams.has('choices')).toBe(true);
  expect(new URL(url).hash).toBe('');
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    await recipient.goto(url);
    await expect(recipient.locator('#editor-list input').first()).toHaveValue('ÆØÅ 🍕');
    await expect(recipient.locator('#result')).toHaveText('READY');
    await expect(recipient.locator('#replay-spin')).toBeEnabled();
    await closeEditor(recipient);
    await recipient.locator('#show-history').click();
    await recipient.locator('#replay-spin').click();
    await expect(recipient.locator('#history-dialog')).toBeHidden();
    await expect(recipient.locator('#editor-list input').first()).toHaveValue('PIZZA');
    await expect(recipient.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
    await expect(recipient.locator('#result')).toHaveText(winner!);
    expect(await recipient.evaluate(() => localStorage.getItem('momentum-spin-history'))).toBeNull();
    await expect(recipient.locator('#spin-history li')).toHaveCount(0);
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
  await page.locator('#editor-list input').first().fill('Shared item');
  await closeEditor(page);
  await clickHeaderAction(page, '#share-wheel');
  await expect(page.locator('#notice')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { copiedLink?: string }).copiedLink)).toBeUndefined();
  await page.locator('#copy-share-link').click();
  await expect(page.locator('#copy-share-link')).toHaveText('Copied!');
  const link = await page.evaluate(() => (window as unknown as { copiedLink: string }).copiedLink);
  await page.goto(link);
  await expect(page.locator('#editor-list input').first()).toHaveValue('SHARED ITEM');
  await expect(page.locator('#replay-spin')).toBeHidden();
  await page.goto('/?wheel=broken#old');
  await expect(page).toHaveURL('http://127.0.0.1:4174/');
  await expect(page.locator('#editor-notice')).toBeEmpty();
  await expect(page.locator('#editor-list input')).toHaveCount(8);
  await expect(page.locator('#editor-list input').first()).toHaveValue('PIZZA');
  await page.reload();
  await expect(page.locator('#editor-list input').first()).toHaveValue('PIZZA');
});

test('confirmed reset clears the URL; cancelling keeps the link', async ({ page }) => {
  await page.goto('/?source=test&choices=One,Two#old');
  await openEditor(page);
  await expect(page.locator('#editor-list input')).toHaveCount(2);
  const sharedUrl = page.url();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#reset-wheel').click();
  expect(page.url()).toBe(sharedUrl);
  await expect(page.locator('#editor-list input')).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#reset-wheel').click();
  await expect(page).toHaveURL('http://127.0.0.1:4174/');
  await expect(page.locator('#wheel-editor')).toBeVisible();
  await expect(page.locator('#editor-list input')).toHaveCount(8);
  await page.reload();
  await expect(page.locator('#editor-list input')).toHaveCount(8);
  await expect(page.locator('#editor-list input').first()).toHaveValue('PIZZA');
});


test('updates a shared URL as choices are typed and reloads without local storage', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.goto('/?source=test&choices=ONE,TWO,THREE');
  await expect(page.locator('#spin-button')).toBeEnabled();
  const historyLength = await page.evaluate(() => history.length);
  await openEditor(page);
  const first = page.locator('#editor-list input').first();
  await first.fill('café 🍕');
  await expect(first).toHaveValue('CAFÉ 🍕');
  const editedUrl = page.url();
  expect(new URL(editedUrl).searchParams.get('source')).toBe('test');
  expect(new URL(editedUrl).searchParams.has('wheel')).toBe(false);
  expect(new URL(editedUrl).searchParams.get('choices')).toContain('café 🍕');
  expect(new URL(editedUrl).hash).toBe('');
  await expect(page.locator('#wheel-editor')).toBeVisible();
  await expect(first).toBeFocused();
  await page.keyboard.type('x');
  expect(page.url()).not.toBe(editedUrl);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.reload();
  await expect(page.locator('#editor-list input').first()).toHaveValue('CAFÉ 🍕X');
});

test('keeps the URL current after batch edits, additions, reordering, and blank removal', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await openEditor(page);
  await page.locator('#batch-edit').click();
  await page.locator('#bulk-choices').fill('first\nsecond\nthird');
  await page.locator('#apply-bulk').click();
  const urlChoices = () => page.evaluate(() => {
    const raw = new URL(location.href).search.slice(1).split('&').find(part => part.startsWith('choices='))!.slice(8);
    return raw.split(',').map(decodeURIComponent);
  });
  expect(await urlChoices()).toEqual(['first', 'second', 'third']);
  await openEditor(page);
  await page.locator('#add-item').click();
  expect(await urlChoices()).toEqual(['first', 'second', 'third', 'option 4']);
  await page.locator('#editor-list button[data-action="up"]').last().click();
  expect(await urlChoices()).toEqual(['first', 'second', 'option 4', 'third']);
  await page.locator('#editor-list button[data-action="delete"]').last().click();
  expect(await urlChoices()).toEqual(['first', 'second', 'option 4']);
  await page.locator('#editor-list input').first().fill('');
  await closeEditor(page);
  expect(await urlChoices()).toEqual(['second', 'option 4']);
  await page.reload();
  await expect(page.locator('#editor-list input')).toHaveCount(2);
  await expect(page.locator('#editor-list input').first()).toHaveValue('SECOND');
});


test('share modal fits mobile and supports selection, dismissal, and focus restoration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  const dialog = page.locator('#share-dialog');
  await clickHeaderAction(page, '#share-wheel');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#copy-share-link')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = (await page.locator('#share-link').boundingBox())!;
  await page.mouse.move(bounds.x + 20, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(2, 2, { steps: 10 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#toggle-actions')).toBeFocused();
  await clickHeaderAction(page, '#share-wheel');
  await page.locator('#close-share').click();
  await expect(dialog).toBeHidden();
  await clickHeaderAction(page, '#share-wheel');
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
});

test('readable links preserve separators and escaped labels through editing and reload', async ({ page }) => {
  await page.goto('/?source=a%20b&choices=A%2CB,C%2BD,%252C,%F0%9F%8D%95');
  await expect(page.locator('#editor-list input')).toHaveCount(4);
  await expect(page.locator('#editor-list input').nth(0)).toHaveValue('A,B');
  await expect(page.locator('#editor-list input').nth(1)).toHaveValue('C+D');
  await expect(page.locator('#editor-list input').nth(2)).toHaveValue('%2C');
  await openEditor(page);
  await page.locator('#editor-list input').nth(3).fill('TACOS');
  await expect(page).toHaveURL('http://127.0.0.1:4174/?source=a%20b&choices=a%2Cb,c%2Bd,%252c,tacos');
  await page.reload();
  await expect(page.locator('#editor-list input').nth(0)).toHaveValue('A,B');
});
