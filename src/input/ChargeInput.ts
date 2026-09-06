import { clamp } from "../utils/Math";

export class ChargeInput {
  readonly maxHoldMs = 1800;
  charging = false;
  private startedAt = 0;
  private pointerId?: number;
  private key?: string;
  private readonly controller = new AbortController();

  constructor(
    private readonly element: HTMLElement,
    private readonly release: (charge: number) => void,
    private readonly change: (charge: number) => void,
    private readonly begin?: () => void,
    private readonly allowed: () => boolean = () => true,
  ) {
    const options = { signal: this.controller.signal };
    element.addEventListener("click", this.onClick, options);
    element.addEventListener("pointerdown", this.onDown, options);
    element.addEventListener("pointerup", this.onUp, options);
    element.addEventListener("pointercancel", this.cancel, options);
    element.addEventListener("lostpointercapture", this.cancel, options);
    element.addEventListener("keydown", this.onKeyDown, options);
    element.addEventListener("keyup", this.onKeyUp, options);
    element.addEventListener("blur", this.cancel, options);
    window.addEventListener("blur", this.cancel, options);
    document.addEventListener("visibilitychange", this.onVisibility, options);
  }

  get charge(): number {
    return this.charging ? clamp((performance.now() - this.startedAt) / this.maxHoldMs, 0, 1) : 0;
  }

  update(): void { if (this.charging) this.change(this.charge); }
  destroy(): void { this.cancel(); this.controller.abort(); }

  cancel = (): void => {
    const pointerId = this.pointerId;
    this.charging = false;
    this.pointerId = undefined;
    this.key = undefined;
    this.element.classList.remove("charging");
    if (pointerId !== undefined && this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId);
    this.change(0);
  };

  private start(): boolean {
    if (this.charging || !this.allowed()) return false;
    this.charging = true;
    this.startedAt = performance.now();
    this.element.classList.add("charging");
    this.begin?.();
    this.change(0);
    return true;
  }

  private finish(): void {
    if (!this.charging) return;
    const charge = this.charge;
    this.cancel();
    this.release(charge);
  }

  // Assistive technologies activate buttons with a click and no preceding key/pointer events.
  private onClick = (event: MouseEvent): void => {
    if (event.detail === 0 && !this.charging && this.allowed()) this.release(0.5);
  };

  private onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || !this.start()) return;
    this.pointerId = event.pointerId;
    this.element.setPointerCapture(event.pointerId);
  };
  private onUp = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.finish();
  };
  private onVisibility = (): void => { if (document.hidden) this.cancel(); };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      if (!event.repeat && this.start()) this.key = event.code;
    }
  };
  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === this.key) { event.preventDefault(); this.finish(); }
  };
}
