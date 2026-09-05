import { clamp } from "../utils/Math";

export class ChargeInput {
  readonly maxHoldMs = 1800;
  charging = false;
  private startedAt = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly release: (charge: number) => void,
    private readonly change: (charge: number) => void,
    private readonly begin?: () => void,
  ) {
    element.addEventListener("pointerdown", this.onDown);
    element.addEventListener("pointerup", this.onUp);
    element.addEventListener("pointercancel", this.onCancel);
    element.addEventListener("keydown", this.onKeyDown);
    element.addEventListener("keyup", this.onKeyUp);
  }

  get charge(): number {
    return this.charging ? clamp((performance.now() - this.startedAt) / this.maxHoldMs, 0, 1) : 0;
  }

  update(): void { if (this.charging) this.change(this.charge); }

  private start(): void {
    if (this.charging) return;
    this.charging = true;
    this.startedAt = performance.now();
    this.element.classList.add("charging");
    this.begin?.();
    this.change(0);
  }

  private finish(): void {
    if (!this.charging) return;
    const charge = this.charge;
    this.charging = false;
    this.element.classList.remove("charging");
    this.change(0);
    this.release(charge);
  }

  private onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.element.setPointerCapture(event.pointerId);
    this.start();
  };
  private onUp = (): void => this.finish();
  private onCancel = (): void => { this.charging = false; this.change(0); };
  private onKeyDown = (event: KeyboardEvent): void => {
    if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
      event.preventDefault(); this.start();
    }
  };
  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space" || event.code === "Enter") { event.preventDefault(); this.finish(); }
  };
}
