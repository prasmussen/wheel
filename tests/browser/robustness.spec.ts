import { expect, test } from '@playwright/test';
import { openEditor, closeEditor } from './editor';

test('startup catches Wasm compilation failures', async ({ page }) => {
  await page.addInitScript(() => {
    WebAssembly.Module = new Proxy(WebAssembly.Module, {
      construct() { throw new Error('Injected compilation failure'); },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('The wheel could not start. Reload to try again.');
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
});

test('invalid links recover even when URL cleanup fails', async ({ page }) => {
  await page.addInitScript(() => { history.replaceState = () => { throw new Error('Unavailable'); }; });
  await page.goto('/?choices=%ZZ,B');
  await expect(page.locator('#spin-button')).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('momentum-wheel')!).items[0].label)).toBe('PIZZA');
});

test('renderer uses choices replaced while initialization is pending', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { releaseAdapter: () => void; labels: string[] };
    probe.labels = [];
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async options => {
      await new Promise<void>(resolve => { probe.releaseAdapter = resolve; });
      return request(options);
    };
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      probe.labels.push(args[0]);
      fill.apply(this, args);
    };
  });
  await page.goto('/');
  await openEditor(page);
  await page.locator('#batch-edit').click();
  await page.locator('#bulk-choices').fill('ALPHA\nBETA');
  await page.locator('#apply-bulk').click();
  await page.evaluate(() => (window as unknown as { releaseAdapter: () => void }).releaseAdapter());
  await expect(page.locator('#spin-button')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { labels: string[] }).labels)).toEqual(['ALPHA', 'BETA']);
});

test('device loss during initialization is reported and retry works', async ({ page }) => {
  await page.addInitScript(() => {
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    let first = true;
    navigator.gpu.requestAdapter = async options => {
      const adapter = await request(options);
      if (!adapter) return null;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async descriptor => {
        const device = await requestDevice(descriptor);
        if (first) {
          first = false;
          Object.defineProperty(device, 'lost', { value: Promise.resolve({ message: 'Early loss', reason: 'unknown' }) });
        }
        return device;
      };
      return adapter;
    };
  });
  await page.goto('/');
  await expect(page.locator('#gpu-error')).toBeVisible();
  await expect(page.locator('#spin-button')).toBeDisabled();
  await page.locator('#retry-gpu').click();
  await expect(page.locator('#spin-button')).toBeEnabled();
});

test('GPU configuration failure preserves edits and retry restores them', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { failBuffer: boolean };
    const create = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (descriptor) {
      if (probe.failBuffer) { probe.failBuffer = false; throw new Error('Injected allocation failure'); }
      return create.call(this, descriptor);
    };
  });
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await openEditor(page);
  await page.evaluate(() => { (window as unknown as { failBuffer: boolean }).failBuffer = true; });
  await page.locator('#editor-list input').first().fill('SAVED');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('momentum-wheel')!).items[0].label)).toBe('SAVED');
  expect(new URL(page.url()).searchParams.get('choices')).toMatch(/^saved,/);
  await closeEditor(page);
  await expect(page.locator('#gpu-error')).toBeVisible();
  await page.locator('#retry-gpu').click();
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#editor-list input').first()).toHaveValue('SAVED');
});

test('throwing sound and vibration do not prevent settlement or saving', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    AudioContext.prototype.createOscillator = () => { throw new Error('Injected audio failure'); };
    navigator.vibrate = () => { throw new Error('Injected vibration failure'); };
  });
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.locator('#spin-button').focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#spin-button')).toHaveClass(/charging/);
  await page.waitForTimeout(100);
  await page.keyboard.up('Space');
  await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
  await expect(page.locator('#spin-button')).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('momentum-spin-history')!).length)).toBe(1);
  expect(errors).toEqual([]);
});

test('runtime GPU errors offer recovery and large canvases stay within allocation limits', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { failGPU: () => void; sizes: number[][] };
    probe.sizes = [];
    const create = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (descriptor) {
      if (descriptor.sampleCount === 4) {
        const size = descriptor.size as number[];
        probe.sizes.push([size[0], size[1], this.limits.maxTextureDimension2D]);
      }
      return create.call(this, descriptor);
    };
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async options => {
      const adapter = await request(options);
      if (!adapter) return null;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async descriptor => {
        const device = await requestDevice(descriptor);
        probe.failGPU = () => device.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', {
          error: new GPUOutOfMemoryError('Injected allocation failure'), cancelable: true,
        }));
        return device;
      };
      return adapter;
    };
  });
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#wheel-canvas')!;
    Object.defineProperties(canvas, { clientWidth: { value: 20000 }, clientHeight: { value: 1000 } });
  });
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(() => page.evaluate(() => {
    const sizes = (window as unknown as { sizes: number[][] }).sizes;
    return sizes.some(([width, height]) => width / height > 19);
  })).toBe(true);
  const sizes = await page.evaluate(() => (window as unknown as { sizes: number[][] }).sizes);
  for (const [width, height, limit] of sizes) {
    expect(Math.max(width, height)).toBeLessThanOrEqual(limit);
    expect(width * height).toBeLessThanOrEqual(4096 * 4096);
  }
  await page.evaluate(() => (window as unknown as { failGPU: () => void }).failGPU());
  await expect(page.locator('#gpu-error')).toBeVisible();
  await page.locator('#retry-gpu').click();
  await expect(page.locator('#spin-button')).toBeEnabled();
});
