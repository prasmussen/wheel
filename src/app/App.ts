import { DEFAULT_PHYSICS, FIXED_DT, SIMULATION_VERSION, type PhysicsConfig } from "./Config";
import type { AppState, SpinRecord } from "./State";
import { WheelAudio } from "../audio/WheelAudio";
import { ChargeInput } from "../input/ChargeInput";
import { FixedStepLoop } from "../physics/FixedStepLoop";
import { PhysicsEngine, type PhysicsSnapshot } from "../physics/PhysicsEngine";
import { WebGPURenderer } from "../renderer/WebGPURenderer";
import { lerp, signedAngle, wrapAngle } from "../utils/Math";
import { secureSeed, SeededRandom } from "../utils/Random";
import { parseChoices, readSavedWheels, validateConfig, type SavedWheel } from "../wheel/Storage";
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
  private undoItems?: WheelItem[];
  private savedWheels: SavedWheel[] = [];
  private readonly resizeObserver = new ResizeObserver(() => this.wake());
  private gpuReady = false;
  private recovering = false;

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
    this.attachUI();
    this.renderEditor();
    this.loadSavedWheels();
    this.loop = new FixedStepLoop(FIXED_DT, dt => this.step(dt), alpha => this.render(alpha));
    this.resizeObserver.observe(this.required("#stage"));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.loop?.stop(); else this.wake();
    });
    await this.initializeRenderer();

    const spinButton = this.required<HTMLButtonElement>("#spin-button");
    this.input = new ChargeInput(spinButton, charge => this.launch(charge), charge => {
      this.state.interaction.charging = charge > 0;
      this.audio.setCharge(charge);
      this.updateChargeUI(charge);
      this.updateLocks();
      this.wake();
    }, () => { this.resumeAudio(); }, () => this.gpuReady && !this.spinActive);
    this.physics.onImpact(event => {
      this.audio.impact(event, this.state.wheelConfig.items.length);
      if (navigator.vibrate && event.strength > 0.7) navigator.vibrate(8);
    });
    this.updateLocks();
    this.wake();
  }

  private step(dt: number): void {
    this.previousSnapshot = this.currentSnapshot;
    if (this.input?.charging) this.physics.applyChargeTension(this.input.charge, dt);
    this.physics.step(dt);
    this.currentSnapshot = this.physics.snapshot();
    if (this.spinActive && this.physics.isSettled() && !this.resultAnnounced) this.announceResult();
  }

  private render(alpha: number): void {
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
    try {
      if (this.gpuReady) this.renderer?.render(state, this.input?.charge ?? 0);
    } catch {
      this.handleDeviceLoss();
    }
    if (!this.spinActive && !this.input?.charging && this.physics.isSettled()
      && state.lastImpact < 0.001) this.loop?.stop();
  }

  private launch(charge: number, replay?: SpinRecord): void {
    if (!this.gpuReady || this.spinActive || this.input?.charging) return;
    if (!replay && this.state.wheelConfig.items.some(item => !item.label.trim())) {
      this.notice("Give every choice a name before spinning.");
      return;
    }
    this.resumeAudio();
    const record: SpinRecord = replay ?? {
      seed: secureSeed(), charge, startingAngle: this.physics.wheel.angle,
      simulationVersion: SIMULATION_VERSION,
      wheelConfig: structuredClone(this.state.wheelConfig),
      physicsConfig: { ...this.physicsConfig },
    };
    if (replay) {
      this.undoItems = structuredClone(this.state.wheelConfig.items);
      this.state.wheelConfig = structuredClone(record.wheelConfig);
      Object.assign(this.physicsConfig, record.physicsConfig);
      this.physics.wheel.angle = record.startingAngle;
      this.commitConfig();
      this.renderEditor();
    }
    this.state.lastSpin = structuredClone(record);
    this.physics.launch(record.charge, new SeededRandom(record.seed));
    this.previousSnapshot = this.currentSnapshot = this.physics.snapshot();
    this.spinActive = true; this.resultAnnounced = false; this.state.result = undefined;
    this.required("#result").textContent = "IN MOTION";
    this.required("#result").classList.remove("winner");
    this.updateLocks();
    this.wake();
  }

  private announceResult(): void {
    const index = selectedIndex(this.physics.wheel.angle, this.state.wheelConfig.items.length);
    const result = this.state.wheelConfig.items[index]?.label ?? "";
    this.state.result = result; this.resultAnnounced = true; this.spinActive = false;
    const element = this.required("#result"); element.textContent = result; element.classList.add("winner");
    this.audio.winner();
    this.updateLocks();
  }

  private attachUI(): void {
    this.required("#replay-spin").addEventListener("click", () => {
      if (this.state.lastSpin) this.launch(this.state.lastSpin.charge, this.state.lastSpin);
    });
    this.required("#mute").addEventListener("click", () => {
      this.audio.setMuted(!this.audio.muted);
      this.required("#mute").setAttribute("aria-pressed", String(this.audio.muted));
      this.required("#mute").textContent = this.audio.muted ? "Unmute" : "Mute";
    });
    this.required("#retry-gpu").addEventListener("click", () => { void this.initializeRenderer(); });
    this.required("#undo").addEventListener("click", () => {
      if (!this.undoItems || this.busy) return;
      const items = this.undoItems;
      this.updateItems(items);
      this.undoItems = undefined;
      this.updateLocks();
    });
    this.required("#apply-bulk").addEventListener("click", () => {
      if (this.busy) return;
      try {
        if (this.updateItems(parseChoices(this.required<HTMLTextAreaElement>("#bulk-choices").value)))
          this.notice("Choices replaced. Undo is available.");
      } catch (error) { this.notice((error as Error).message); }
    });
    this.required("#save-wheel").addEventListener("click", () => {
      const name = this.required<HTMLInputElement>("#wheel-name").value.trim();
      if (!name) { this.notice("Enter a name for this wheel."); return; }
      if (this.savedWheels.length >= 20) { this.notice("You can save up to 20 wheels. Delete one first."); return; }
      if (this.savedWheels.some(wheel => wheel.name === name)) { this.notice("That name is already saved. Choose another name."); return; }
      this.savedWheels.push({ name, config: structuredClone(this.state.wheelConfig) });
      if (this.store("momentum-saved-wheels", this.savedWheels)) this.notice("Wheel saved.");
      this.renderSavedWheels();
    });
    this.required("#load-wheel").addEventListener("click", () => {
      const wheel = this.savedWheels[Number(this.required<HTMLSelectElement>("#saved-wheels").value)];
      if (wheel) this.updateItems(structuredClone(wheel.config.items));
    });
    this.required("#delete-saved").addEventListener("click", () => {
      this.savedWheels.splice(Number(this.required<HTMLSelectElement>("#saved-wheels").value), 1);
      this.store("momentum-saved-wheels", this.savedWheels);
      this.renderSavedWheels();
    });
    this.required("#add-item").addEventListener("click", () => {
      if (this.state.wheelConfig.items.length >= 50) return;
      this.updateItems([...this.state.wheelConfig.items, { id: crypto.randomUUID(), label: `OPTION ${this.state.wheelConfig.items.length + 1}`, weight: 1 }]);
    });
    this.required("#reset-wheel").addEventListener("click", () => this.updateItems(createDefaultConfig().items));
    this.required("#editor-list").addEventListener("input", event => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-id]");
      if (!input || this.busy) return;
      const item = this.state.wheelConfig.items.find(entry => entry.id === input.dataset.id);
      if (item) { item.label = input.value; this.commitConfig(); this.clearResult(); }
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
  }

  private updateItems(items: WheelItem[]): boolean {
    if (this.busy) return false;
    this.undoItems = structuredClone(this.state.wheelConfig.items);
    this.state.wheelConfig = { items, version: crypto.randomUUID() };
    this.clearResult();
    const saved = this.commitConfig();
    this.renderEditor();
    return saved;
  }

  private commitConfig(): boolean {
    this.state.wheelConfig.version = crypto.randomUUID();
    this.physics.setSegmentCount(this.state.wheelConfig.items.length);
    if (this.gpuReady) this.renderer?.updateConfig(this.state.wheelConfig);
    const saved = this.store("momentum-wheel", this.state.wheelConfig);
    this.wake();
    return saved;
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
    this.updateLocks();
  }

  private updateChargeUI(charge: number): void {
    const percent = Math.round(charge * 100);
    this.required<HTMLElement>("#charge-fill").style.setProperty("--charge", String(charge));
    this.required("#charge-label").textContent = charge ? `${percent}%` : "PRESS & HOLD";
  }

  private loadConfig(): WheelConfig {
    try {
      return validateConfig(JSON.parse(localStorage.getItem("momentum-wheel") ?? "null")) ?? createDefaultConfig();
    } catch { return createDefaultConfig(); }
  }

  private store(key: string, value: unknown): boolean {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { this.notice("Changes work for this session, but could not be saved on this device."); return false; }
  }

  private loadSavedWheels(): void {
    try { this.savedWheels = readSavedWheels(JSON.parse(localStorage.getItem("momentum-saved-wheels") ?? "[]")); }
    catch { this.savedWheels = []; }
    this.renderSavedWheels();
  }

  private renderSavedWheels(): void {
    const select = this.required<HTMLSelectElement>("#saved-wheels");
    select.replaceChildren(...this.savedWheels.map((wheel, index) => new Option(wheel.name, String(index))));
    this.required<HTMLButtonElement>("#load-wheel").disabled = !this.savedWheels.length;
    this.required<HTMLButtonElement>("#delete-saved").disabled = !this.savedWheels.length;
  }

  private notice(message: string): void { this.required("#notice").textContent = message; }
  private get busy(): boolean { return this.spinActive || !!this.input?.charging; }
  private wake(): void { if (this.gpuReady && !document.hidden) this.loop?.start(); }
  private resumeAudio(): void {
    void this.audio.resume().catch(() => this.notice("Audio is unavailable. You can still spin the wheel."));
  }

  private clearResult(): void {
    this.state.result = undefined;
    this.required("#result").textContent = "READY";
    this.required("#result").classList.remove("winner");
  }

  private updateLocks(): void {
    this.required<HTMLFieldSetElement>("#choice-controls").disabled = this.busy;
    this.required<HTMLButtonElement>("#spin-button").disabled = !this.gpuReady || this.spinActive;
    this.required<HTMLButtonElement>("#replay-spin").disabled = !this.gpuReady || this.busy || !this.state.lastSpin;
    this.required<HTMLButtonElement>("#undo").disabled = !this.undoItems;
    this.required<HTMLButtonElement>("#add-item").disabled = this.state.wheelConfig.items.length >= 50;
  }

  private async initializeRenderer(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    this.required<HTMLButtonElement>("#retry-gpu").disabled = true;
    try {
      this.renderer?.destroy();
      this.renderer = await WebGPURenderer.create(this.required<HTMLCanvasElement>("#wheel-canvas"), this.state.wheelConfig);
      this.gpuReady = true;
      this.renderer.onDeviceLost = () => this.handleDeviceLoss();
      this.required("#gpu-error").hidden = true;
      this.wake();
    } catch (error) {
      this.gpuReady = false;
      this.required("#gpu-error").hidden = false;
      this.required("#gpu-message").textContent = error instanceof Error ? error.message : "WebGPU could not be initialized.";
    } finally {
      this.recovering = false;
      this.required<HTMLButtonElement>("#retry-gpu").disabled = false;
      this.updateLocks();
    }
  }

  private handleDeviceLoss(): void {
    if (!this.gpuReady) return;
    this.gpuReady = false;
    this.loop?.stop();
    this.input?.cancel();
    // Preserve the frozen simulation. Retry resumes the same spin.
    this.required("#gpu-error").hidden = false;
    this.required("#gpu-message").textContent = "The graphics device disconnected. Retry to resume your wheel.";
    this.updateLocks();
  }

  private required<T extends HTMLElement = HTMLElement>(selector: string): T {
    const value = this.root.querySelector<T>(selector); if (!value) throw new Error(`Missing element: ${selector}`); return value;
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <header><div><span class="eyebrow">A PHYSICAL RANDOMIZER</span><h1>Momentum</h1></div><div class="header-actions"><button id="mute" class="ghost" aria-pressed="false">Mute</button></div></header>
      <main>
        <section id="stage" class="stage" aria-label="Spinning wheel">
          <div class="wheel-glow"></div><canvas id="wheel-canvas" aria-hidden="true"></canvas>
          <div id="gpu-error" class="unsupported" hidden><strong>WebGPU unavailable</strong><p id="gpu-message"></p><button id="retry-gpu" type="button">Retry</button></div>
          <div class="result-wrap"><span class="eyebrow">RESULT</span><div id="result" role="status" aria-live="polite">READY</div></div>
          <div class="spin-controls"><button id="spin-button" class="spin-button" type="button"><span id="charge-label">PRESS & HOLD</span><i id="charge-fill"></i></button><div class="secondary-spin"><button id="replay-spin" type="button" disabled>Replay last spin</button></div></div>
        </section>
        <aside class="editor"><fieldset id="choice-controls"><legend class="sr-only">Wheel choices</legend><div class="panel-heading"><div><span class="eyebrow">YOUR WHEEL</span><h2>Choices</h2></div><span id="item-count"></span></div>
          <div id="editor-list" class="editor-list"></div>
          <div class="editor-actions"><button id="add-item" type="button">+ Add choice</button><button id="reset-wheel" class="ghost" type="button">Reset</button><button id="undo" type="button" disabled>Undo</button></div>
          <details><summary>Paste choices</summary><label for="bulk-choices">One choice per line · 2–50 choices</label><textarea id="bulk-choices" rows="5" maxlength="2000"></textarea><button id="apply-bulk" type="button">Replace choices</button></details>
          <details><summary>Saved wheels</summary><label for="wheel-name">Wheel name</label><input id="wheel-name" maxlength="40"><button id="save-wheel" type="button">Save current wheel</button><label for="saved-wheels">Your saved wheels</label><select id="saved-wheels"></select><div class="editor-actions"><button id="load-wheel" type="button">Load</button><button id="delete-saved" type="button">Delete saved</button></div></details>
          </fieldset><p id="notice" role="status" class="hint"></p>
          <p class="hint">Hold longer for a longer spin. Choices stay fixed during a spin. Long labels use … on the wheel; full names appear here and in the result.</p>
          <p class="hint">Outcomes depend on charge and starting position. Equal odds are not guaranteed.</p>
        </aside>
      </main>`;
  }
}
