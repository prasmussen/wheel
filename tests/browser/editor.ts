import type { Page } from '@playwright/test';

export async function clickHeaderAction(page: Page, selector: string): Promise<void> {
  const action = page.locator(selector);
  if (!await action.isVisible()) await page.locator('#toggle-actions').click();
  await action.click();
}

export async function openEditor(page: Page): Promise<void> {
  if (!await page.locator('#wheel-editor').isVisible()) await clickHeaderAction(page, '#edit-wheel');
}

export async function closeEditor(page: Page): Promise<void> {
  if (await page.locator('#wheel-editor').isVisible()) await page.locator('#close-editor').click();
}
