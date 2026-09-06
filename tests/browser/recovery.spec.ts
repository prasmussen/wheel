import { expect, test, type Page } from '@playwright/test';
import type { PhysicsSnapshot } from '../../src/physics/PhysicsEngine';
import type { SpinHistoryEntry } from '../../src/wheel/History';

interface RecoveryProbe {
  loseDevice: () => void;
  failNextDevice: boolean;
  setHidden: (hidden: boolean) => void;
  ticks: number;
  launches: number;
  snapshot?: () => PhysicsSnapshot;
}

declare global { interface Window { recovery: RecoveryProbe } }

async function prepare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = window.recovery = {
      loseDevice: () => {}, failNextDevice: false, ticks: 0, launches: 0,
      // Control the browser visibility signals without depending on OS focus.
      setHidden(hidden: boolean) {
        Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      },
    };
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async options => {
      const adapter = await request(options);
      if (!adapter) return null;
      const requestDevice = adapter.requestDevice.bind(adapter);
      adapter.requestDevice = async descriptor => {
        if (probe.failNextDevice) {
          probe.failNextDevice = false;
          throw new Error('Injected retry failure');
        }
        const device = await requestDevice(descriptor);
        // Actually release the device, exercising the native device.lost promise.
        probe.loseDevice = () => device.destroy();
        return device;
      };
      return adapter;
    };
  });
  await page.goto('/');
  await expect(page.locator('#spin-button')).toBeEnabled();
  await page.evaluate(async () => {
    const path = '/src/physics/PhysicsEngine.ts';
    const { PhysicsEngine } = await import(/* @vite-ignore */ path) as typeof import('../../src/physics/PhysicsEngine');
    const advance = PhysicsEngine.prototype.advance;
    PhysicsEngine.prototype.advance = function (ticks) {
      window.recovery.ticks += ticks;
      window.recovery.snapshot = () => this.snapshot();
      return advance.call(this, ticks);
    };
    const launch = PhysicsEngine.prototype.launch;
    PhysicsEngine.prototype.launch = function (...args) {
      window.recovery.launches++;
      return launch.apply(this, args);
    };
  });
}

async function history(page: Page): Promise<SpinHistoryEntry[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('momentum-spin-history') ?? '[]'));
}

async function controlsReady(page: Page): Promise<void> {
  for (const selector of ['#spin-button', '#edit-wheel', '#share-wheel', '#show-history', '#choice-controls', '#history-controls']) {
    await expect(page.locator(selector)).toBeEnabled();
  }
}

async function launch(page: Page): Promise<void> {
  await page.locator('#spin-button').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#result')).toHaveText('IN MOTION');
}

async function frozen(page: Page): Promise<void> {
  const state = () => page.evaluate(() => ({ ticks: window.recovery.ticks, snapshot: window.recovery.snapshot?.() }));
  const before = await state();
  expect(before.snapshot).toBeDefined();
  // Cross many normal frame intervals to prove that the simulation is paused.
  await page.waitForTimeout(250);
  expect(await state()).toEqual(before);
}

for (const interruption of ['device loss', 'hidden page'] as const) {
  test(`${interruption} cancels charging without creating a spin`, async ({ page }) => {
    await prepare(page);
    await page.locator('#spin-button').focus();
    await page.keyboard.down('Space');
    await expect(page.locator('#spin-button')).toHaveClass(/charging/);
    await expect(page.locator('#edit-wheel')).toBeDisabled();
    if (interruption === 'device loss') {
      await page.evaluate(() => window.recovery.loseDevice());
      await expect(page.locator('#gpu-error')).toBeVisible();
    } else await page.evaluate(() => window.recovery.setHidden(true));
    await expect(page.locator('#spin-button')).not.toHaveClass(/charging/);
    await page.keyboard.up('Space');
    await expect(page.locator('#charge-label')).toHaveText('PRESS & HOLD');
    await expect(page.locator('#result')).toHaveText('READY');
    expect(await history(page)).toEqual([]);
    expect(await page.evaluate(() => window.recovery.launches)).toBe(0);
    if (interruption === 'device loss') await page.locator('#retry-gpu').click();
    else await page.evaluate(() => window.recovery.setHidden(false));
    await controlsReady(page);
    await launch(page);
    await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
    await controlsReady(page);
    expect(await history(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.recovery.launches)).toBe(1);
  });

  test(`${interruption} preserves a spin and its replay without duplicate history`, async ({ page }) => {
    await prepare(page);
    await launch(page);
    await expect.poll(() => page.evaluate(() => window.recovery.ticks)).toBeGreaterThan(20);
    if (interruption === 'device loss') {
      await page.evaluate(() => window.recovery.loseDevice());
      await expect(page.locator('#gpu-error')).toBeVisible();
      await frozen(page);
      await page.evaluate(() => { window.recovery.failNextDevice = true; });
      await page.locator('#retry-gpu').click();
      await expect(page.locator('#gpu-message')).toHaveText('Injected retry failure');
      await expect(page.locator('#retry-gpu')).toBeEnabled();
      await expect(page.locator('#spin-button')).toBeDisabled();
      await frozen(page);
      expect(await history(page)).toEqual([]);
      await page.locator('#retry-gpu').click();
      await expect(page.locator('#gpu-error')).toBeHidden();
    } else {
      await page.evaluate(() => window.recovery.setHidden(true));
      await frozen(page);
      expect(await history(page)).toEqual([]);
      await page.evaluate(() => window.recovery.setHidden(false));
    }
    await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
    await controlsReady(page);
    const saved = await history(page);
    expect(saved).toHaveLength(1);
    expect(await page.evaluate(() => window.recovery.launches)).toBe(1);
    await expect(page.locator('#result')).toHaveText(saved[0].result);

    // Compare against an uninterrupted run of the recorded inputs, independent of the UI loop.
    const expected = await page.evaluate(async entry => {
      const physicsPath = '/src/physics/PhysicsEngine.ts';
      const randomPath = '/src/utils/Random.ts';
      const sharePath = '/src/wheel/Share.ts';
      const { PhysicsEngine } = await import(/* @vite-ignore */ physicsPath) as typeof import('../../src/physics/PhysicsEngine');
      const { SeededRandom } = await import(/* @vite-ignore */ randomPath) as typeof import('../../src/utils/Random');
      const { readSharePayload } = await import(/* @vite-ignore */ sharePath) as typeof import('../../src/wheel/Share');
      const record = readSharePayload(entry.state).lastSpin!;
      const engine = new PhysicsEngine(record.physicsConfig, record.wheelConfig.items.length);
      engine.wheel.angle = record.startingAngle;
      // Bypass the launch probe for this independent diagnostic instance.
      const launches = window.recovery.launches;
      engine.launch(record.charge, new SeededRandom(record.seed));
      window.recovery.launches = launches;
      const run = engine.runUntilSettled(45 * 240);
      if (!run.settled) throw new Error('Reference spin failed to settle');
      return record.wheelConfig.items[run.selectedIndex!].label;
    }, saved[0]);
    expect(saved[0].result).toBe(expected);

    await page.locator('#show-history').click();
    await page.locator('#spin-history button').click();
    await expect(page.locator('#result')).toHaveText('IN MOTION');
    // Interrupt the replay too; it must retain replay mode across recovery.
    if (interruption === 'device loss') {
      await page.evaluate(() => window.recovery.loseDevice());
      await expect(page.locator('#gpu-error')).toBeVisible();
      await page.locator('#retry-gpu').click();
    } else {
      await page.evaluate(() => window.recovery.setHidden(true));
      await frozen(page);
      await page.evaluate(() => window.recovery.setHidden(false));
    }
    await expect(page.locator('#result')).toHaveClass('winner', { timeout: 45_000 });
    await expect(page.locator('#result')).toHaveText(expected);
    await controlsReady(page);
    expect(await history(page)).toEqual(saved);
    expect(await page.evaluate(() => window.recovery.launches)).toBe(2);
    await expect(page.locator('#spin-history li')).toHaveCount(1);
  });
}
