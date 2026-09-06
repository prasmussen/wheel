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
    await expect(page.locator('#editor-list input').first()).toHaveValue('DINNER');
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
    await page.locator('#show-info').click();
    const info = page.getByRole('dialog', { name: 'About Mechanical Wheel' });
    await expect(info).toBeVisible();
    await expect(info.locator('.site-info')).toContainText('A free custom picker');
    await expect(info.getByText('How to use the wheel', { exact: true })).toBeVisible();
    await expect(info.locator('h3')).toHaveText('How randomness works');
    await expect(page.locator('body > .site-info')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`wheel-info-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('#show-info')).toBeFocused();
  }
});


test('keeps the editor open when text selection ends outside the modal', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.locator('#edit-wheel').click();
  const dialog = page.locator('#wheel-editor');
  const input = page.locator('#editor-list input').first();
  await expect(input).toHaveAttribute('maxlength', '12');
  await input.fill('ABCDEFGHIJKLM');
  await expect(input).toHaveValue('ABCDEFGHIJKL');
  await input.fill('Select this');
  {
    const bounds = (await input.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width - 8, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(2, bounds.y + bounds.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    expect(await input.evaluate(element => {
      const field = element as HTMLInputElement;
      return field.selectionEnd! - field.selectionStart!;
    })).toBeGreaterThan(0);
  }
  await page.locator('#batch-edit').click();
  const textarea = page.locator('#bulk-choices');
  await textarea.fill('First choice\nSecond choice');
  const bounds = (await textarea.boundingBox())!;
  await page.mouse.move(bounds.x + 12, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(2, 2, { steps: 10 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(textarea).toHaveValue('FIRST CHOICE\nSECOND CHOICE');
  await page.mouse.down();
  await expect(dialog).toBeHidden();
  await page.mouse.up();
});


test('capitalizes input without moving the caret and removes blank choices on dismissal', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  for (const dismiss of ['done', 'escape', 'backdrop']) {
    await page.locator('#edit-wheel').click();
    const inputs = page.locator('#editor-list input');
    const count = await inputs.count();
    const first = inputs.first();
    await first.fill('café');
    await expect(first).toHaveValue('CAFÉ');
    await first.evaluate(element => (element as HTMLInputElement).setSelectionRange(2, 2));
    await page.keyboard.type('x');
    await expect(first).toHaveValue('CAXFÉ');
    expect(await first.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(3);
    await first.fill('   ');
    await inputs.nth(1).focus();
    await expect(first).toHaveValue('   ');
    if (dismiss === 'done') await page.locator('#close-editor').click();
    if (dismiss === 'escape') await page.keyboard.press('Escape');
    if (dismiss === 'backdrop') await page.mouse.click(2, 2);
    await expect(page.locator('#wheel-editor')).toBeHidden();
    await page.reload();
    await expect(page.locator('#editor-list input')).toHaveCount(count - 1);
  }
});

test('keeps the editor open if removing blanks would leave fewer than two choices', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.locator('#edit-wheel').click();
  await page.locator('#batch-edit').click();
  await page.locator('#bulk-choices').fill('first\nsecond');
  await page.locator('#apply-bulk').click();
  await expect(page.locator('#wheel-editor')).toBeHidden();
  await page.locator('#edit-wheel').click();
  const first = page.locator('#editor-list input').first();
  await first.fill('');
  await page.locator('#close-editor').click();
  await expect(page.locator('#wheel-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wheel-editor')).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.locator('#wheel-editor')).toBeVisible();
  await first.fill('replacement');
  await page.locator('#close-editor').click();
  await expect(page.locator('#wheel-editor')).toBeHidden();
  await page.reload();
  await expect(page.locator('#editor-list input').first()).toHaveValue('REPLACEMENT');
});
