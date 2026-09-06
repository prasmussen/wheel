import { expect, test } from '@playwright/test';
import { openEditor } from './editor';

const canonical = 'https://wheel.glotlabs.com/';

test('serves complete search and social metadata before JavaScript runs', async ({ request }) => {
  const response = await request.get('/?choices=pizza,sushi');
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(Buffer.byteLength(html.slice(0, html.indexOf('<meta charset="UTF-8"')))).toBeLessThan(1024);
  expect(html.match(/<title>/g)).toHaveLength(1);
  expect(html).toContain('Mechanical Wheel – Free Online Spinning Wheel');
  expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
  expect(html).toContain(`<meta property="og:image" content="${canonical}social-preview.png">`);
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  expect(data['@graph'].map((entity: { name: string; url: string }) => [entity.name, entity.url]))
    .toEqual([['Mechanical Wheel', canonical], ['Mechanical Wheel', canonical]]);
  expect(html).toContain('<h1 id="site-title">Mechanical Wheel</h1>');
  const preview = await request.get('/social-preview.png');
  expect(preview.headers()['content-type']).toContain('image/png');
  const bytes = await preview.body();
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
  const manifest = await (await request.get('/site.webmanifest')).json();
  expect(manifest.name).toContain('Mechanical Wheel');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test('keeps canonical metadata stable while editing and sharing a wheel', async ({ page }) => {
  await page.goto('/?choices=pizza,sushi');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await openEditor(page);
  await page.locator('#editor-list input').first().fill('tacos');
  await expect(page).toHaveURL(/choices=tacos,sushi/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
  await page.locator('#close-editor').click();
  await page.locator('#share-wheel').click();
  await expect(page.locator('#share-link')).toHaveValue(/choices=tacos,sushi/);
});

test('offers readable instructions without JavaScript on mobile', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4174/');
    await expect(page.getByRole('heading', { name: 'Mechanical Wheel', level: 1 })).toBeVisible();
    await expect(page.locator('.site-info noscript p')).toBeVisible();
    await expect(page.locator('.site-info noscript p')).toHaveText('Enable JavaScript to edit your choices and spin the wheel.');
    await page.getByText('How to use the wheel', { exact: true }).click();
    await expect(page.getByText('The wheel needs JavaScript and a browser with WebGPU support.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});
