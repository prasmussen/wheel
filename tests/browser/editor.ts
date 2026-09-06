import type { Page } from '@playwright/test';

export async function openEditor(page: Page): Promise<void> {
  if (!await page.locator('#wheel-editor').isVisible()) await page.locator('#edit-wheel').click();
}

export async function closeEditor(page: Page): Promise<void> {
  if (await page.locator('#wheel-editor').isVisible()) await page.locator('#close-editor').click();
}
