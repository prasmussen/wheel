import { DEFAULT_PHYSICS, FIXED_DT, SIMULATION_VERSION, type PhysicsConfig } from "./Config";
import type { AppState, SpinRecord } from "./State";
import { WheelAudio } from "../audio/WheelAudio";
import { ChargeInput } from "../input/ChargeInput";
import { FixedStepLoop } from "../physics/FixedStepLoop";
import { PhysicsEngine, type PhysicsSnapshot } from "../physics/PhysicsEngine";
import { WebGPURenderer } from "../renderer/WebGPURenderer";
import { lerp, signedAngle, wrapAngle } from "../utils/Math";
import { secureSeed, SeededRandom } from "../utils/Random";
import { parseChoices, validateConfig } from "../wheel/Storage";
import { appendSpinHistory, HISTORY_KEY, readSpinHistory, type SpinHistoryEntry } from "../wheel/History";
import { selectedIndex } from "../wheel/SegmentLayout";
import { createSharePayload, decodeShare, encodeShare, readSharePayload } from "../wheel/Share";
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
  private spinHistory: SpinHistoryEntry[] = [];
  private readonly resizeObserver = new ResizeObserver(() => this.wake());
  private gpuReady = false;
  private recovering = false;
  private shareNotice = "";

  constructor(root: HTMLElement) {
    this.root = root;
    let shared: ReturnType<typeof decodeShare>;
    try {
      shared = decodeShare(location.hash);
      if (shared) this.shareNotice = shared.replayUnavailable
        ? "Shared wheel loaded. Its replay uses a different physics version and is unavailable."
        : shared.lastSpin ? "Shared wheel loaded. Choose Replay last spin to watch its latest spin." : "Shared wheel loaded.";
    } catch {
      this.shareNotice = "This wheel link is invalid or incomplete. Your local wheel has been loaded instead.";
    }
    const wheelConfig = shared?.wheelConfig ?? this.loadConfig();
    this.physics = new PhysicsEngine(this.physicsConfig, wheelConfig.items.length);
    this.state = {
      wheelConfig,
      wheelState: this.physics.wheel,
      pointerState: this.physics.pointer,
      interaction: { charging: false, chargeStartedAt: 0 },
      lastSpin: shared?.lastSpin,
    };
    this.previousSnapshot = this.currentSnapshot = this.physics.snapshot();
  }

  async start(): Promise<void> {
    this.renderShell();
    this.attachUI();
    this.renderEditor();
    this.loadHistory();
    if (this.shareNotice) this.notice(this.shareNotice);
    window.addEventListener("hashchange", () => {
      if (location.hash.startsWith("#wheel=")) location.reload();
    });
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
      this.state.wheelConfig = structuredClone(record.wheelConfig);
      Object.assign(this.physicsConfig, record.physicsConfig);
      this.physics.wheel.angle = record.startingAngle;
      this.commitConfig();
      this.renderEditor();
    }
    this.state.lastSpin = structuredClone(record);
    this.required("#share-link-panel").hidden = true;
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
    if (this.state.lastSpin) {
      this.spinHistory = appendSpinHistory(this.spinHistory, {
        completedAt: Date.now(), result,
        state: createSharePayload(this.state.wheelConfig, this.state.lastSpin),
      });
      this.store(HISTORY_KEY, this.spinHistory);
      this.renderHistory();
    }
    this.updateLocks();
  }

  private attachUI(): void {
    this.required("#share-wheel").addEventListener("click", () => { void this.shareWheel(); });
    this.required("#replay-spin").addEventListener("click", () => {
      if (this.state.lastSpin) this.launch(this.state.lastSpin.charge, this.state.lastSpin);
    });
    this.required("#mute").addEventListener("click", () => {
      this.audio.setMuted(!this.audio.muted);
      this.required("#mute").setAttribute("aria-pressed", String(this.audio.muted));
      this.required("#mute").textContent = this.audio.muted ? "Unmute" : "Mute";
    });
    this.required("#retry-gpu").addEventListener("click", () => { void this.initializeRenderer(); });
    this.required("#apply-bulk").addEventListener("click", () => {
      if (this.busy) return;
      try {
        if (this.updateItems(parseChoices(this.required<HTMLTextAreaElement>("#bulk-choices").value)))
          this.notice("Choices replaced.");
      } catch (error) { this.notice((error as Error).message); }
    });
    this.required("#spin-history").addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-history]");
      if (!button || this.busy) return;
      const entry = this.spinHistory[Number(button.dataset.history)];
      if (!entry) return;
      const shared = readSharePayload(entry.state);
      this.state.lastSpin = shared.lastSpin;
      if (this.updateItems(shared.wheelConfig.items)) this.notice("Spin loaded. Choose Replay last spin to watch it.");
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

  private loadHistory(): void {
    try { this.spinHistory = readSpinHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")); }
    catch { this.spinHistory = []; }
    this.renderHistory();
  }

  private renderHistory(): void {
    const list = this.required("#spin-history");
    this.required("#history-empty").hidden = this.spinHistory.length > 0;
    list.replaceChildren(...this.spinHistory.map((entry, index) => {
      const row = document.createElement("li");
      const info = document.createElement("div");
      const result = document.createElement("strong"); result.textContent = entry.result;
      const time = document.createElement("time");
      time.dateTime = new Date(entry.completedAt).toISOString();
      time.textContent = new Date(entry.completedAt).toLocaleString();
      const choices = document.createElement("span"); choices.textContent = entry.state.choices.join(" · ");
      info.append(result, time, choices);
      const button = document.createElement("button"); button.type = "button";
      button.dataset.history = String(index); button.textContent = "Load";
      button.setAttribute("aria-label", `Load spin ${index + 1}: ${entry.result}`);
      row.append(info, button);
      return row;
    }));
  }

  private notice(message: string): void { this.required("#notice").textContent = message; }

  private async shareWheel(): Promise<void> {
    if (this.busy) return;
    try {
      const url = new URL(location.href);
      url.hash = encodeShare(this.state.wheelConfig, this.state.lastSpin);
      const input = this.required<HTMLInputElement>("#share-link");
      input.value = url.href;
      this.required("#share-link-panel").hidden = false;
      input.focus(); input.select();
      try {
        await navigator.clipboard.writeText(url.href);
        this.notice(this.state.lastSpin ? "Link copied, including the latest replay." : "Wheel link copied.");
      } catch {
        this.notice("Copy the selected link to share this wheel.");
      }
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "Could not create a share link.");
    }
  }
  private get busy(): boolean { return this.spinActive || !!this.input?.charging; }
  private wake(): void { if (this.gpuReady && !document.hidden) this.loop?.start(); }
  private resumeAudio(): void {
    void this.audio.resume().catch(() => this.notice("Audio is unavailable. You can still spin the wheel."));
  }

  private clearResult(): void {
    this.required("#share-link-panel").hidden = true;
    this.state.result = undefined;
    this.required("#result").textContent = "READY";
    this.required("#result").classList.remove("winner");
  }

  private updateLocks(): void {
    this.required<HTMLButtonElement>("#share-wheel").disabled = this.busy;
    this.required<HTMLFieldSetElement>("#choice-controls").disabled = this.busy;
    this.required<HTMLButtonElement>("#spin-button").disabled = !this.gpuReady || this.spinActive;
    this.required("#replay-controls").hidden = !this.state.lastSpin;
    this.required<HTMLButtonElement>("#replay-spin").disabled = !this.gpuReady || this.busy || !this.state.lastSpin;
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
      <header><div><span class="eyebrow">A PHYSICAL RANDOMIZER</span><h1>Momentum</h1></div><div class="header-actions"><button id="share-wheel" class="ghost" type="button">Share wheel</button><button id="mute" class="ghost" aria-pressed="false">Mute</button></div></header>
      <main>
        <section id="stage" class="stage" aria-label="Spinning wheel">
          <div class="wheel-glow"></div><canvas id="wheel-canvas" aria-hidden="true"></canvas>
          <div id="gpu-error" class="unsupported" hidden><strong>WebGPU unavailable</strong><p id="gpu-message"></p><button id="retry-gpu" type="button">Retry</button></div>
          <div class="result-wrap"><span class="eyebrow">RESULT</span><div id="result" role="status" aria-live="polite">READY</div></div>
          <div class="spin-controls"><button id="spin-button" class="spin-button" type="button"><span id="charge-label">PRESS & HOLD</span><i id="charge-fill"></i></button><div id="replay-controls" class="secondary-spin" hidden><button id="replay-spin" type="button" disabled>Replay last spin</button></div></div>
        </section>
        <aside class="editor"><fieldset id="choice-controls"><legend class="sr-only">Wheel choices</legend><div class="panel-heading"><div><span class="eyebrow">YOUR WHEEL</span><h2>Choices</h2></div><span id="item-count"></span></div>
          <div id="editor-list" class="editor-list"></div>
          <div class="editor-actions"><button id="add-item" type="button">+ Add choice</button><button id="reset-wheel" class="ghost" type="button">Reset</button></div>
          <details><summary>Paste choices</summary><label for="bulk-choices">One choice per line · 2–50 choices</label><textarea id="bulk-choices" rows="5" maxlength="2000"></textarea><button id="apply-bulk" type="button">Replace choices</button></details>
          <details><summary>Spin history</summary><p id="history-empty">No spins yet.</p><ol id="spin-history" class="spin-history"></ol></details>
          </fieldset><div id="share-link-panel" class="share-link-panel" hidden><label for="share-link">Share link</label><input id="share-link" type="text" readonly spellcheck="false"></div><p id="notice" role="status" class="hint"></p>
        </aside>
      </main>`;
  }
}
