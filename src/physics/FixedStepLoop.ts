export class FixedStepLoop {
  private accumulator = 0;
  private previousTime = 0;
  private running = false;
  private frameHandle = 0;
  physicsSteps = 0;
  fps = 0;
  private sampleTime = 0;
  private sampledFrames = 0;
  private sampledSteps = 0;

  constructor(
    private readonly fixedDt: number,
    private readonly step: (dt: number) => void,
    private readonly render: (alpha: number, time: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.previousTime = performance.now();
    this.sampleTime = this.previousTime;
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.frameHandle); }

  private tick = (now: number): void => {
    if (!this.running) return;
    const elapsed = Math.min((now - this.previousTime) / 1000, 0.1);
    this.previousTime = now;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < 30) {
      this.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    this.sampledFrames++;
    this.sampledSteps += steps;
    if (now - this.sampleTime >= 500) {
      const scale = 1000 / (now - this.sampleTime);
      this.fps = Math.round(this.sampledFrames * scale);
      this.physicsSteps = Math.round(this.sampledSteps * scale);
      this.sampleTime = now;
      this.sampledFrames = this.sampledSteps = 0;
    }
    this.render(this.accumulator / this.fixedDt, now);
    if (this.running) this.frameHandle = requestAnimationFrame(this.tick);
  };
}
