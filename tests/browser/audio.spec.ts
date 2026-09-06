import { expect, test } from '@playwright/test';

for (const sessionSupport of ['supported', 'missing', 'rejects', 'touchend-only'] as const) {
  test(`sound starts and unmute recreates audio when Audio Session is ${sessionSupport}`, async ({ page }) => {
    await page.addInitScript(support => {
      const probe = window as unknown as {
        wheelAudio?: AudioContext;
        audioLevel: () => number;
        sessionType: string;
      };
      probe.sessionType = 'auto';
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
        private unlocked = support !== 'touchend-only';
        constructor() {
          super();
          probe.wheelAudio = this;
        }
        override get state(): AudioContextState {
          return this.unlocked ? super.state : 'suspended';
        }
        override resume(): Promise<void> {
          // Model iOS rejecting the pointer events and accepting native touchend.
          if (!this.unlocked && window.event?.type !== 'touchend') return new Promise(() => {});
          this.unlocked = true;
          return super.resume();
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
    if (sessionSupport === 'touchend-only') {
      const touch = await page.context().newCDPSession(page);
      const bounds = (await spin.boundingBox())!;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
      });
      await expect(spin).toHaveClass(/charging/);
      await page.waitForTimeout(250);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(spin).toBeDisabled();
      await expect(page.locator('#result')).toHaveText('IN MOTION');
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { wheelAudio: AudioContext }).wheelAudio.state)).toBe('running');
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { audioLevel: () => number }).audioLevel()), { intervals: [50], timeout: 5000 }).toBeGreaterThan(0.0001);
      await expect(mute).toHaveAttribute('aria-pressed', 'false');
      await touch.detach();
      return;
    }
    await spin.focus();
    await page.keyboard.down('Space');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { audioLevel?: () => number }).audioLevel?.() ?? 0)).toBeGreaterThan(0.0001);
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
