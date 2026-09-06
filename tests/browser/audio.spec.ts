import { expect, test } from '@playwright/test';

for (const sessionSupport of ['supported', 'missing', 'rejects'] as const) {
  test(`sound starts and unmute resumes suspended audio when Audio Session is ${sessionSupport}`, async ({ page }) => {
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
        constructor() {
          super();
          probe.wheelAudio = this;
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
    await spin.focus();
    await page.keyboard.down('Space');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { audioLevel?: () => number }).audioLevel?.() ?? 0)).toBeGreaterThan(0.0001);
    if (sessionSupport === 'supported') {
      expect(await page.evaluate(() => (window as unknown as { sessionType: string }).sessionType)).toBe('playback');
    }
    await mute.click(); // Moving focus cancels the hold without launching a spin.
    await page.keyboard.up('Space');
    await expect(mute).toHaveAccessibleName('Unmute');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { audioLevel: () => number }).audioLevel())).toBe(0);
    if (sessionSupport === 'supported') {
      expect(await page.evaluate(() => (window as unknown as { sessionType: string }).sessionType)).toBe('auto');
    }
    await page.evaluate(() => (window as unknown as { wheelAudio: AudioContext }).wheelAudio.suspend());
    await mute.click();
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
