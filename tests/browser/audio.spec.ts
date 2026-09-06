import { expect, test } from '@playwright/test';

for (const sessionSupport of ['supported', 'missing', 'rejects', 'touchstart-only', 'touchend-only', 'buffer-start-required'] as const) {
  test(`sound starts and unmute recreates audio when Audio Session is ${sessionSupport}`, async ({ page }) => {
    await page.addInitScript(support => {
      const probe = window as unknown as {
        wheelAudio?: AudioContext;
        audioLevel: () => number;
        sessionType: string;
        createdWithoutActivation: boolean;
      };
      probe.sessionType = 'auto';
      probe.createdWithoutActivation = false;
      Object.defineProperty(navigator, 'audioSession', {
        configurable: true,
        value: support === 'missing' ? undefined : {
          get type() { return probe.sessionType; },
          set type(value: string) {
            if (support === 'rejects') throw new Error('Audio Session unavailable');
            probe.sessionType = value;
          },
        },
      });
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        private meter?: AnalyserNode;
        private unlocked = support !== 'touchend-only' && support !== 'touchstart-only' && support !== 'buffer-start-required';
        constructor() {
          super();
          probe.createdWithoutActivation ||= !navigator.userActivation.isActive && window.event?.type !== 'touchstart';
          probe.wheelAudio = this;
        }
        override get state(): AudioContextState {
          return this.unlocked ? super.state : 'suspended';
        }
        override resume(): Promise<void> {
          if (support === 'buffer-start-required' && !this.unlocked) return new Promise(() => {});
          // Model browsers accepting only the corresponding native touch event.
          const unlockEvent = support === 'touchstart-only' ? 'touchstart' : 'touchend';
          if (!this.unlocked && window.event?.type !== unlockEvent) return new Promise(() => {});
          this.unlocked = true;
          return super.resume();
        }
        override createBufferSource(): AudioBufferSourceNode {
          const source = super.createBufferSource();
          const start = source.start.bind(source);
          source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
            // Model resume() alone being insufficient: a connected source must
            // be started in the native gesture, not in a promise or frame callback.
            if (support === 'buffer-start-required' && window.event?.type === 'touchstart' && window.event.isTrusted) {
              this.unlocked = true;
            }
            start(...args);
          };
          return source;
        }
        override createGain(): GainNode {
          const gain = super.createGain();
          if (!this.meter) {
            this.meter = this.createAnalyser();
            gain.connect(this.meter);
            const samples = new Float32Array(this.meter.fftSize);
            probe.audioLevel = () => {
              this.meter!.getFloatTimeDomainData(samples);
              return Math.max(...samples.map(Math.abs));
            };
          }
          return gain;
        }
      };
    }, sessionSupport);
    await page.goto('/');
    const spin = page.locator('#spin-button');
    const mute = page.locator('#mute');
    await expect(spin).toBeEnabled();
    const setHidden = async (hidden: boolean) => page.evaluate(value => {
      Object.defineProperty(document, 'hidden', { configurable: true, value });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: value ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await setHidden(true);
    await setHidden(false);
    expect(await page.evaluate(() =>
      !!(window as unknown as { wheelAudio?: AudioContext }).wheelAudio)).toBe(false);
    if (sessionSupport === 'touchend-only' || sessionSupport === 'touchstart-only' || sessionSupport === 'buffer-start-required') {
      const touch = await page.context().newCDPSession(page);
      const bounds = (await spin.boundingBox())!;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
      });
      await expect(spin).toHaveClass(/charging/);
      if (sessionSupport !== 'touchend-only') {
        // Sound must start on a fresh page while the first touch is still held.
        await expect.poll(() => page.evaluate(() =>
          (window as unknown as { audioLevel?: () => number }).audioLevel?.() ?? 0),
        { intervals: [50], timeout: 5000 }).toBeGreaterThan(0.0001);
        await expect(spin).toHaveClass(/charging/);
      } else {
        await expect.poll(() => page.evaluate(() =>
          (window as unknown as { wheelAudio: AudioContext }).wheelAudio.state)).toBe('suspended');
      }
      await page.waitForTimeout(1800);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(spin).toBeDisabled();
      await expect(page.locator('#result')).toHaveText('IN MOTION');
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { wheelAudio: AudioContext }).wheelAudio.state)).toBe('running');
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { audioLevel: () => number }).audioLevel()), { intervals: [50], timeout: 5000 }).toBeGreaterThan(0.0001);
      await expect(mute).toHaveAttribute('aria-pressed', 'false');
      expect(await page.evaluate(() =>
        (window as unknown as { createdWithoutActivation: boolean }).createdWithoutActivation)).toBe(false);
      await touch.detach();
      return;
    }
    await spin.focus();
    await page.keyboard.down('Space');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { audioLevel?: () => number }).audioLevel?.() ?? 0)).toBeGreaterThan(0.0001);
    if (sessionSupport === 'supported') {
      for (let cycle = 0; cycle < 3; cycle++) {
        await setHidden(true);
        await expect.poll(() => page.evaluate(() =>
          (window as unknown as { wheelAudio: AudioContext }).wheelAudio.state)).toBe('suspended');
        await page.keyboard.up('Space');
        await expect(spin).not.toHaveClass(/charging/);
        await setHidden(false);
        await expect.poll(() => page.evaluate(() =>
          (window as unknown as { wheelAudio: AudioContext }).wheelAudio.state)).toBe('running');
        await spin.focus();
        await page.keyboard.down('Space');
        await expect.poll(() => page.evaluate(() =>
          (window as unknown as { audioLevel: () => number }).audioLevel())).toBeGreaterThan(0.0001);
      }
      // Also cover returning immediately while the suspension is still pending.
      await page.evaluate(() => {
        for (const hidden of [true, false]) {
          Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
          document.dispatchEvent(new Event('visibilitychange'));
        }
      });
      await page.keyboard.up('Space');
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { wheelAudio: AudioContext }).wheelAudio.state)).toBe('running');
    }
    if (sessionSupport === 'supported') {
      expect(await page.evaluate(() => (window as unknown as { sessionType: string }).sessionType)).toBe('playback');
    }
    await page.evaluate(async () => {
      const probe = window as unknown as { wheelAudio: AudioContext; previousAudio: AudioContext };
      probe.previousAudio = probe.wheelAudio;
      await probe.wheelAudio.suspend();
    });
    await mute.click(); // Moving focus cancels the hold without launching a spin.
    await page.keyboard.up('Space');
    await expect(mute).toHaveAccessibleName('Unmute');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { previousAudio: AudioContext }).previousAudio.state)).toBe('closed');
    if (sessionSupport === 'supported') {
      expect(await page.evaluate(() => (window as unknown as { sessionType: string }).sessionType)).toBe('auto');
    }
    await setHidden(true);
    await setHidden(false);
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { previousAudio: AudioContext }).previousAudio.state)).toBe('closed');
    await mute.click();
    expect(await page.evaluate(() => {
      const probe = window as unknown as { wheelAudio: AudioContext; previousAudio: AudioContext };
      return probe.wheelAudio !== probe.previousAudio;
    })).toBe(true);
    await expect(mute).toHaveAccessibleName('Mute');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { wheelAudio: AudioContext }).wheelAudio.state)).toBe('running');
    await spin.focus();
    await page.keyboard.down('Space');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { audioLevel: () => number }).audioLevel())).toBeGreaterThan(0.0001);
    await page.keyboard.press('Tab');
    await page.keyboard.up('Space');
  });
}
