import type { PegImpact } from "../physics/PhysicsEngine";

export class WheelAudio {
  private context?: AudioContext;
  private output?: GainNode;
  private chargeOscillator?: OscillatorNode;
  private chargeGain?: GainNode;

  muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.output) this.output.gain.value = muted ? 0 : 0.3;
    if (this.context) this.configureSession();
  }

  async resume(): Promise<void> {
    this.context ??= new AudioContext();
    this.configureSession();
    if (!this.output) {
      this.output = this.context.createGain();
      this.output.connect(this.context.destination);
    }
    this.output.gain.value = this.muted ? 0 : 0.3;
    const resumed = this.context.resume();
    // Start a source inside the gesture, rather than waiting for the animation loop.
    if (this.context.state !== "running") {
      const unlock = this.context.createBufferSource();
      unlock.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      unlock.connect(this.output);
      unlock.onended = () => unlock.disconnect();
      unlock.start();
    }
    await resumed;
  }

  private configureSession(): void {
    // iOS treats Web Audio as ambient sound by default, obeying the Silent switch.
    // Request media playback when sound is enabled; unsupported browsers use their default.
    try {
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = this.muted ? "auto" : "playback";
    } catch { /* An optional audio-session override must not prevent Web Audio playback. */ }
  }

  setCharge(charge: number): void {
    const context=this.context;
    if(!context||!this.output||context.state!=="running")return;
    if(charge>0&&!this.chargeOscillator){
      this.chargeOscillator=context.createOscillator(); this.chargeGain=context.createGain();
      this.chargeOscillator.type="sine"; this.chargeGain.gain.value=.0001;
      this.chargeOscillator.connect(this.chargeGain).connect(this.output); this.chargeOscillator.start();
    }
    if(this.chargeOscillator&&this.chargeGain){
      const now=context.currentTime;
      this.chargeOscillator.frequency.setTargetAtTime(48+charge*72,now,.04);
      this.chargeGain.gain.setTargetAtTime(charge>0?.012*charge:.0001,now,.025);
      if(charge===0){const oscillator=this.chargeOscillator;oscillator.stop(now+.12);this.chargeOscillator=undefined;this.chargeGain=undefined;}
    }
  }

  impact(event: PegImpact, pegCount: number): void {
    const context = this.context;
    if (!context || !this.output || context.state !== "running") return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    const variation = ((event.pegIndex * 1103515245 + Math.floor(event.timestamp * 1000)) >>> 8) % 17;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(1050 + Math.abs(event.wheelVelocity) * 22 + variation * 8, now);
    oscillator.frequency.exponentialRampToValueAtTime(310, now + 0.045);
    gain.gain.setValueAtTime(0.012 + event.strength * 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055 + event.strength * 0.04);
    pan.pan.value = Math.sin((event.pegIndex / pegCount) * Math.PI * 2) * 0.2;
    oscillator.connect(gain).connect(pan).connect(this.output);
    oscillator.start(now); oscillator.stop(now + 0.11);
  }

  winner(): void {
    const context = this.context;
    if (!context || !this.output) return;
    [0, 0.09, 0.18].forEach((delay, index) => {
      const osc = context.createOscillator(); const gain = context.createGain();
      osc.type = "sine"; osc.frequency.value = [523, 659, 784][index];
      gain.gain.setValueAtTime(0.08, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.35);
      osc.connect(gain).connect(this.output!); osc.start(context.currentTime + delay); osc.stop(context.currentTime + delay + 0.4);
    });
  }
}
