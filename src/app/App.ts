import { DEFAULT_PHYSICS, FIXED_DT, type PhysicsConfig } from "./Config";
import type { AppState, SpinRecord } from "./State";
import { WheelAudio } from "../audio/WheelAudio";
import { ChargeInput } from "../input/ChargeInput";
import { FixedStepLoop } from "../physics/FixedStepLoop";
import { PhysicsEngine, type PhysicsSnapshot } from "../physics/PhysicsEngine";
import { WebGPURenderer } from "../renderer/WebGPURenderer";
import { lerp, signedAngle, wrapAngle } from "../utils/Math";
import { secureSeed, SeededRandom } from "../utils/Random";
import { selectedIndex } from "../wheel/SegmentLayout";
import { createDefaultConfig, type WheelConfig, type WheelItem } from "../wheel/WheelConfig";

export class App {
  private readonly root: HTMLElement;
  private readonly state: AppState;
  private readonly physicsConfig: PhysicsConfig = { ...DEFAULT_PHYSICS };
  private readonly physics: PhysicsEngine;
  private readonly audio = new WheelAudio();
  private renderer?: WebGPURenderer;
  private loop?: FixedStepLoop;
  private input?: ChargeInput;
  private previousSnapshot: PhysicsSnapshot;
  private currentSnapshot: PhysicsSnapshot;
  private spinActive = false;
  private resultAnnounced = false;
  private debugVisible = false;
  private lastDebugUpdate = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    const wheelConfig = this.loadConfig();
    this.physics = new PhysicsEngine(this.physicsConfig, wheelConfig.items.length);
    this.state = {
      wheelConfig,
      wheelState: this.physics.wheel,
      pointerState: this.physics.pointer,
      interaction: { charging: false, chargeStartedAt: 0 },
    };
    this.previousSnapshot = this.currentSnapshot = this.physics.snapshot();
  }

  async start(): Promise<void> {
    this.renderShell();
    const canvas = this.required<HTMLCanvasElement>("#wheel-canvas");
    try {
      this.renderer = await WebGPURenderer.create(canvas, this.state.wheelConfig);
    } catch (error) {
      this.showUnsupported(error instanceof Error ? error.message : "WebGPU could not be initialized.");
      return;
    }

    const spinButton = this.required<HTMLButtonElement>("#spin-button");
    this.input = new ChargeInput(spinButton, charge => this.launch(charge), charge => {
      this.state.interaction.charging = charge > 0;
      this.physics.applyChargeTension(charge);
      this.audio.setCharge(charge);
      this.updateChargeUI(charge);
    }, () => { void this.audio.resume(); });
    this.physics.onImpact(event => {
      this.audio.impact(event, this.state.wheelConfig.items.length);
      if (navigator.vibrate && event.strength > 0.7) navigator.vibrate(8);
    });
    this.attachUI();
    this.renderEditor();
    this.loop = new FixedStepLoop(FIXED_DT, dt => this.step(dt), (alpha, now) => this.render(alpha, now));
    this.loop.start();
  }

  private step(dt: number): void {
    this.previousSnapshot = this.currentSnapshot;
    this.physics.step(dt);
    this.currentSnapshot = this.physics.snapshot();
    if (this.spinActive && this.physics.isSettled() && !this.resultAnnounced) this.announceResult();
  }

  private render(alpha: number, now: number): void {
    this.input?.update();
    const a = this.previousSnapshot, b = this.currentSnapshot;
    const state: PhysicsSnapshot = {
      wheel: {
        angle: wrapAngle(a.wheel.angle + signedAngle(b.wheel.angle - a.wheel.angle) * alpha),
        angularVelocity: lerp(a.wheel.angularVelocity, b.wheel.angularVelocity, alpha),
      },
      pointer: {
        angle: lerp(a.pointer.angle, b.pointer.angle, alpha),
        angularVelocity: lerp(a.pointer.angularVelocity, b.pointer.angularVelocity, alpha),
      },
      currentPeg: b.currentPeg,
      lastImpact: lerp(a.lastImpact, b.lastImpact, alpha),
      stableTime: b.stableTime,
    };
    this.renderer?.render(state, this.input?.charge ?? 0);
    if (this.debugVisible && now - this.lastDebugUpdate > 100) {
      this.lastDebugUpdate = now; this.updateDebug(state);
    }
  }

  private launch(charge: number): void {
    void this.audio.resume();
    const seed = secureSeed();
    const record: SpinRecord = {
      seed, charge, startingAngle: this.physics.wheel.angle, configVersion: this.state.wheelConfig.version,
    };
    this.state.lastSpin = record;
    this.physics.launch(charge, new SeededRandom(seed));
    this.spinActive = true; this.resultAnnounced = false; this.state.result = undefined;
    this.required("#result").textContent = "IN MOTION";
    this.required("#result").classList.remove("winner");
  }

  private announceResult(): void {
    const index = selectedIndex(this.physics.wheel.angle, this.state.wheelConfig.items.length);
    const result = this.state.wheelConfig.items[index]?.label ?? "";
    this.state.result = result; this.resultAnnounced = true; this.spinActive = false;
    const element = this.required("#result"); element.textContent = result; element.classList.add("winner");
    this.audio.winner();
  }

  private attachUI(): void {
    this.required("#add-item").addEventListener("click", () => {
      if (this.state.wheelConfig.items.length >= 50) return;
      this.updateItems([...this.state.wheelConfig.items, { id: crypto.randomUUID(), label: `OPTION ${this.state.wheelConfig.items.length + 1}`, weight: 1 }]);
    });
    this.required("#debug-toggle").addEventListener("click", () => {
      this.debugVisible = !this.debugVisible;
      this.required("#debug-panel").toggleAttribute("hidden", !this.debugVisible);
      this.required("#debug-overlay").toggleAttribute("hidden", !this.debugVisible);
      this.required("#debug-toggle").setAttribute("aria-pressed", String(this.debugVisible));
    });
    this.required("#reset-wheel").addEventListener("click", () => this.updateItems(createDefaultConfig().items));
    this.required("#editor-list").addEventListener("input", event => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-id]");
      if (!input) return;
      const item = this.state.wheelConfig.items.find(entry => entry.id === input.dataset.id);
      if (item) { item.label = input.value; this.commitConfig(); }
    });
    this.required("#editor-list").addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      if (!button) return;
      const index = this.state.wheelConfig.items.findIndex(item => item.id === button.dataset.id);
      if (index < 0) return;
      const items = [...this.state.wheelConfig.items];
      if (button.dataset.action === "delete" && items.length > 2) items.splice(index, 1);
      if (button.dataset.action === "up" && index > 0) [items[index - 1], items[index]] = [items[index], items[index - 1]];
      if (button.dataset.action === "down" && index < items.length - 1) [items[index + 1], items[index]] = [items[index], items[index + 1]];
      this.updateItems(items);
    });
    this.required("#tuning").addEventListener("input", event => {
      const slider = event.target as HTMLInputElement;
      const key = slider.dataset.physics as keyof PhysicsConfig | undefined;
      if (!key) return;
      this.physicsConfig[key] = Number(slider.value);
      const output = slider.parentElement?.querySelector("output"); if (output) output.value = slider.value;
    });
  }

  private updateItems(items: WheelItem[]): void {
    this.state.wheelConfig = { items, version: crypto.randomUUID() };
    this.commitConfig(); this.renderEditor();
  }

  private commitConfig(): void {
    this.state.wheelConfig.version = crypto.randomUUID();
    this.physics.setSegmentCount(this.state.wheelConfig.items.length);
    this.renderer?.updateConfig(this.state.wheelConfig);
    localStorage.setItem("momentum-wheel", JSON.stringify(this.state.wheelConfig));
  }

  private renderEditor(): void {
    const list = this.required("#editor-list");
    list.replaceChildren(...this.state.wheelConfig.items.map((item, index) => {
      const row = document.createElement("div"); row.className = "editor-row";
      const input = document.createElement("input"); input.value = item.label; input.dataset.id = item.id;
      input.maxLength = 30; input.setAttribute("aria-label", `Wheel item ${index + 1}`);
      const actions = [["up","↑","Move up"],["down","↓","Move down"],["delete","×","Delete"]] as const;
      row.append(input, ...actions.map(([action,text,label]) => {
        const button=document.createElement("button"); button.type="button"; button.textContent=text;
        button.dataset.action=action; button.dataset.id=item.id; button.title=label; button.setAttribute("aria-label",`${label} ${item.label}`);
        button.disabled=(action==="delete"&&this.state.wheelConfig.items.length<=2)||(action==="up"&&index===0)||(action==="down"&&index===this.state.wheelConfig.items.length-1);
        return button;
      })); return row;
    }));
    this.required("#item-count").textContent = `${this.state.wheelConfig.items.length} segments`;
  }

  private updateChargeUI(charge: number): void {
    const percent = Math.round(charge * 100);
    this.required<HTMLElement>("#charge-fill").style.setProperty("--charge", String(charge));
    this.required("#charge-label").textContent = charge ? `${percent}%` : "PRESS & HOLD";
  }

  private updateDebug(state: PhysicsSnapshot): void {
    const values: Record<string,string|number> = {
      "d-wheel-angle": state.wheel.angle.toFixed(3), "d-wheel-velocity": state.wheel.angularVelocity.toFixed(3),
      "d-pointer-angle": state.pointer.angle.toFixed(3), "d-pointer-velocity": state.pointer.angularVelocity.toFixed(3),
      "d-current-peg": state.currentPeg, "d-impact": state.lastImpact.toFixed(3),
      "d-steps": this.loop?.physicsSteps ?? 0, "d-fps": this.loop?.fps ?? 0,
    };
    Object.entries(values).forEach(([id,value]) => { this.required(`#${id}`).textContent=String(value); });
    const index=selectedIndex(state.wheel.angle,this.state.wheelConfig.items.length);
    this.required("#overlay-readout").textContent=`ω ${state.wheel.angularVelocity.toFixed(2)} rad/s · segment ${index+1} · dt ${(FIXED_DT*1000).toFixed(2)} ms`;
  }

  private loadConfig(): WheelConfig {
    try {
      const parsed = JSON.parse(localStorage.getItem("momentum-wheel") ?? "null") as WheelConfig | null;
      if (parsed && Array.isArray(parsed.items) && parsed.items.length >= 2 && parsed.items.length <= 50) return parsed;
    } catch { /* Ignore corrupt local preferences. */ }
    return createDefaultConfig();
  }

  private showUnsupported(message: string): void {
    this.required("#stage").innerHTML = `<div class="unsupported"><strong>WebGPU required</strong><p>${message}</p><p>Try a current version of Chrome, Edge, or Safari on supported hardware.</p></div>`;
  }

  private required<T extends HTMLElement = HTMLElement>(selector: string): T {
    const value = this.root.querySelector<T>(selector); if (!value) throw new Error(`Missing element: ${selector}`); return value;
  }

  private renderShell(): void {
    const tuning = Object.entries(DEFAULT_PHYSICS).map(([key,value]) => {
      const range = key.includes("Inertia") ? [0.02,10,0.01] : key.includes("Spring") ? [20,160,1] : [0,5,0.001];
      return `<label>${key}<output>${value}</output><input data-physics="${key}" type="range" min="${range[0]}" max="${range[1]}" step="${range[2]}" value="${value}"></label>`;
    }).join("");
    this.root.innerHTML = `
      <header><div><span class="eyebrow">A PHYSICAL RANDOMIZER</span><h1>Momentum</h1></div><button id="debug-toggle" class="ghost" aria-pressed="false">Physics</button></header>
      <main>
        <section id="stage" class="stage" aria-label="Spinning wheel">
          <div class="wheel-glow"></div><canvas id="wheel-canvas"></canvas>
          <div id="debug-overlay" class="debug-overlay" hidden><i></i><span id="overlay-readout">ω 0 rad/s</span></div>
          <div class="result-wrap"><span class="eyebrow">RESULT</span><div id="result" role="status" aria-live="polite">READY</div></div>
          <button id="spin-button" class="spin-button" type="button"><span id="charge-label">PRESS & HOLD</span><i id="charge-fill"></i></button>
        </section>
        <aside class="editor"><div class="panel-heading"><div><span class="eyebrow">YOUR WHEEL</span><h2>Choices</h2></div><span id="item-count"></span></div>
          <div id="editor-list" class="editor-list"></div>
          <div class="editor-actions"><button id="add-item" type="button">+ Add choice</button><button id="reset-wheel" class="ghost" type="button">Reset</button></div>
          <p class="hint">Hold to build momentum. Release to let the mechanism decide.</p>
        </aside>
      </main>
      <section id="debug-panel" class="debug-panel" hidden><div class="metrics">
        <span>Wheel angle <b id="d-wheel-angle">0</b></span><span>Wheel velocity <b id="d-wheel-velocity">0</b></span>
        <span>Pointer angle <b id="d-pointer-angle">0</b></span><span>Pointer velocity <b id="d-pointer-velocity">0</b></span>
        <span>Current peg <b id="d-current-peg">-</b></span><span>Impact <b id="d-impact">0</b></span>
        <span>Physics Hz <b id="d-steps">0</b></span><span>Render FPS <b id="d-fps">0</b></span>
      </div><div id="tuning" class="tuning">${tuning}</div></section>`;
  }
}
