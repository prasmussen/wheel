import { expect, test } from '@playwright/test';

for (const sessionSupport of ['supported', 'missing', 'rejects'] as const) {
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
        constructor() {
          super();
          probe.createdWithoutActivation ||= !navigator.userActivation.isActive;
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
    const setHidden = async (hidden: boolean) => page.evaluate(value => {
      Object.defineProperty(document, 'hidden', { configurable: true, value });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: value ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await setHidden(true);
    await setHidden(false);
    expect(await page.evaluate(() =>
      !!(window as unknown as { wheelAudio?: AudioContext }).wheelAudio)).toBe(false);
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

for (const device of ['iPhone', 'iPad-desktop'] as const) {
  test(`${device} starts muted and a tap enables sound for a held spin`, async ({ page }) => {
    await page.addInitScript(device => {
      Object.defineProperty(navigator, 'userAgent', { value: device === 'iPhone'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' });
      Object.defineProperty(navigator, 'platform', { value: device === 'iPhone' ? 'iPhone' : 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
      const probe = window as unknown as {
        wheelAudio?: AudioContext;
        createdByClick: boolean;
        audioLevel: () => number;
      };
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor() {
          super();
          probe.wheelAudio = this;
          probe.createdByClick = window.event?.type === 'click' && window.event.isTrusted;
        }
        override createGain(): GainNode {
          const gain = super.createGain();
          if (!probe.audioLevel) {
            const meter = this.createAnalyser();
            gain.connect(meter);
            const samples = new Float32Array(meter.fftSize);
            probe.audioLevel = () => {
              meter.getFloatTimeDomainData(samples);
              return Math.max(...samples.map(Math.abs));
            };
          }
          return gain;
        }
      };
    }, device);
    await page.goto('/');
    const spin = page.locator('#spin-button');
    const mute = page.locator('#mute');
    await expect(spin).toBeEnabled();
    await expect(mute).toHaveAccessibleName('Unmute');
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await expect(mute).toHaveAttribute('title', 'Unmute');
    const touch = await page.context().newCDPSession(page);
    const press = async (button: typeof spin) => {
      const bounds = (await button.boundingBox())!;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
      });
    };
    await press(spin);
    await expect(spin).toHaveClass(/charging/);
    await page.waitForTimeout(1800);
    expect(await page.evaluate(() =>
      !!(window as unknown as { wheelAudio?: AudioContext }).wheelAudio)).toBe(false);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(spin).not.toHaveClass(/charging/);
    await press(mute);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(mute).toHaveAccessibleName('Mute');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() =>
      (window as unknown as { createdByClick: boolean }).createdByClick)).toBe(true);
    await press(spin);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { audioLevel: () => number }).audioLevel())).toBeGreaterThan(0.0001);
    await expect(spin).toHaveClass(/charging/);
    await page.waitForTimeout(1800);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#result')).toHaveText('IN MOTION');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { audioLevel: () => number }).audioLevel())).toBeGreaterThan(0.0001);
    await touch.detach();
    await page.reload();
    await expect(page.locator('#mute')).toHaveAccessibleName('Unmute');
    expect(await page.evaluate(() =>
      !!(window as unknown as { wheelAudio?: AudioContext }).wheelAudio)).toBe(false);
  });
}
