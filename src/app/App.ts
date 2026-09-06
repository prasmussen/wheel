import { normalizeLabel, validLabel } from "../wheel/Labels";
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
import { createSharePayload, readShareUrl, writeShareUrl, readSharePayload } from "../wheel/Share";
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
  private readonly renderSnapshot: PhysicsSnapshot;
  private spinActive = false;
  private replayActive = false;
  private batchEditing = false;
  private resultAnnounced = false;
  private spinHistory: SpinHistoryEntry[] = [];
  private readonly resizeObserver = new ResizeObserver(() => this.wake());
  private gpuReady = false;
  private recovering = false;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(root: HTMLElement) {
    this.root = root;
    let shared: ReturnType<typeof readShareUrl>;
    try {
      const url = new URL(location.href);
      shared = readShareUrl(url);
    } catch {
      shared = { wheelConfig: createDefaultConfig() };
      try { history.replaceState(history.state, "", location.pathname); }
      catch { /* URL cleanup must not prevent loading the default wheel. */ }
      try {
        localStorage.setItem("momentum-wheel", JSON.stringify(shared.wheelConfig));
      } catch { /* The default wheel remains usable when storage is unavailable. */ }
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
    this.previousSnapshot = this.physics.snapshot();
    this.currentSnapshot = this.physics.snapshot();
    this.renderSnapshot = this.physics.snapshot();
  }

  async start(): Promise<void> {
    this.renderShell();
    this.attachUI();
    this.reducedMotion.addEventListener("change", () => this.wake());
    this.renderEditor();
    this.loadHistory();
    window.addEventListener("popstate", () => location.reload());
    this.loop = new FixedStepLoop(FIXED_DT, ticks => this.advance(ticks), alpha => this.render(alpha), error => {
      console.error("Wheel frame failed", error);
      this.handleDeviceLoss();
    });
    this.resizeObserver.observe(this.required("#stage"));
    document.addEventListener("visibilitychange", () => {
      if (this.audio.isIOS) {
        if (document.hidden) this.setMuted(true);
      } else {
        void this.audio.setVisible(!document.hidden).catch(() => {});
      }
      if (document.hidden) this.loop?.stop(); else this.wake();
    });
    window.addEventListener("blur", () => { if (this.audio.isIOS) this.setMuted(true); });
    window.addEventListener("pagehide", () => { if (this.audio.isIOS) this.setMuted(true); });
    await this.initializeRenderer();

    const spinButton = this.required<HTMLButtonElement>("#spin-button");
    this.input = new ChargeInput(spinButton, charge => this.launch(charge), charge => {
      this.state.interaction.charging = charge > 0;
      this.effect(() => this.audio.setCharge(charge));
      this.updateChargeUI(charge);
      this.updateLocks();
      this.wake();
    }, () => this.resumeAudio(), () => this.gpuReady && !this.spinActive && !this.root.querySelector("dialog[open]"));
    this.physics.onImpact(event => {
      this.effect(() => this.audio.impact(event, this.state.wheelConfig.items.length));
      this.effect(() => { if (navigator.vibrate && event.strength > 0.7) navigator.vibrate(8); });
    });
    this.updateLocks();
    this.wake();
  }

  private advance(ticks: number): void {
    this.physics.advance(ticks);
    this.physics.previousSnapshot(this.previousSnapshot);
    this.physics.snapshot(this.currentSnapshot);
    if (this.spinActive && this.physics.isSettled() && !this.resultAnnounced) this.announceResult();
  }

  private render(alpha: number): void {
    this.input?.update();
    const a = this.previousSnapshot, b = this.currentSnapshot;
    const state = this.renderSnapshot;
    state.wheel.angle = wrapAngle(a.wheel.angle + signedAngle(b.wheel.angle - a.wheel.angle) * alpha);
    state.wheel.angularVelocity = lerp(a.wheel.angularVelocity, b.wheel.angularVelocity, alpha);
    state.pointer.angle = lerp(a.pointer.angle, b.pointer.angle, alpha);
    state.pointer.angularVelocity = lerp(a.pointer.angularVelocity, b.pointer.angularVelocity, alpha);
    state.currentPeg = b.currentPeg;
    state.lastImpact = lerp(a.lastImpact, b.lastImpact, alpha);
    state.stableTime = b.stableTime;
    try {
      if (this.gpuReady && !(this.reducedMotion.matches && this.spinActive)) {
        this.renderer?.render(state, this.reducedMotion.matches ? 0 : this.input?.charge ?? 0);
      }
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
      this.physics.setConfig(this.physicsConfig);
      this.physics.wheel.angle = record.startingAngle;
      this.commitConfig();
      this.renderEditor();
    }
    this.replayActive = replay !== undefined;
    this.state.lastSpin = structuredClone(record);
    this.required<HTMLDialogElement>("#share-dialog").close();
    this.physics.launch(record.charge, new SeededRandom(record.seed));
    this.physics.snapshot(this.previousSnapshot);
    this.physics.snapshot(this.currentSnapshot);
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
    if (this.state.lastSpin && !this.replayActive) {
      this.spinHistory = appendSpinHistory(this.spinHistory, {
        completedAt: Date.now(), result,
        state: createSharePayload(this.state.wheelConfig, this.state.lastSpin),
      });
      this.store(HISTORY_KEY, this.spinHistory);
      this.renderHistory();
    }
    this.updateLocks();
    this.effect(() => this.audio.winner());
  }

  private attachUI(): void {
    const menuToggle = this.required("#toggle-actions");
    const menu = this.required("#wheel-actions");
    const compactHeader = matchMedia("(max-width: 820px)");
    const closeMenu = (restoreFocus = false): void => {
      menuToggle.setAttribute("aria-expanded", "false");
      menu.classList.remove("open");
      if (restoreFocus) menuToggle.focus();
    };
    menuToggle.addEventListener("click", () => {
      const open = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(open));
      menu.classList.toggle("open", open);
    });
    document.addEventListener("pointerdown", event => {
      if (!(event.target instanceof Node) || this.required(".actions-menu").contains(event.target)) return;
      closeMenu(menu.contains(document.activeElement));
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
        event.preventDefault();
        closeMenu(true);
      }
    });
    this.required(".actions-menu").addEventListener("focusout", event => {
      if (!this.required(".actions-menu").contains(event.relatedTarget as Node | null)) {
        const hiddenAction = compactHeader.matches && event.target instanceof HTMLElement
          && menu.contains(event.target) && event.target.getClientRects().length === 0;
        closeMenu(hiddenAction && !event.relatedTarget);
      }
    });
    compactHeader.addEventListener("change", () => {
      const focusHidden = compactHeader.matches && menu.contains(document.activeElement);
      closeMenu(focusHidden);
      if (!compactHeader.matches && document.activeElement === menuToggle) this.required("#edit-wheel").focus();
    });
    for (const [dialogId, openId, closeId] of [
      ["wheel-editor", "edit-wheel", "close-editor"],
      ["history-dialog", "show-history", "close-history"],
      ["share-dialog", "share-wheel", "close-share"],
      ["info-dialog", "show-info", "close-info"],
    ]) {
      const dialog = this.required<HTMLDialogElement>(`#${dialogId}`);
      dialog.addEventListener("close", () => {
        // The viewport may have changed while the dialog was open.
        if (compactHeader.matches && menu.contains(this.required(`#${openId}`)) && !this.root.querySelector("dialog[open]")) menuToggle.focus();
      });
      this.required(`#${openId}`).addEventListener("click", () => {
        if (this.busy && dialogId !== "info-dialog") return;
        if (compactHeader.matches && menuToggle.getAttribute("aria-expanded") === "true") closeMenu(true);
        if (dialogId === "share-dialog") this.shareWheel();
        dialog.showModal();
      });
      this.required(`#${closeId}`).addEventListener("click", () => {
        if (dialogId === "wheel-editor") {
          if (this.batchEditing ? !this.applyBatch() : !this.finishOptionEditing()) return;
        }
        dialog.close();
      });
      if (dialogId === "wheel-editor") {
        dialog.addEventListener("close", () => this.setBatchEditing(false));
        dialog.addEventListener("cancel", event => {
          if (!this.batchEditing && !this.finishOptionEditing()) event.preventDefault();
        });
      }
      // Dismiss at the start of a backdrop press, never at the end of a text-selection drag.
      dialog.addEventListener("pointerdown", event => {
        if (!event.isPrimary || event.button !== 0) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom)) {
          if (dialogId === "wheel-editor" && !this.batchEditing && !this.finishOptionEditing()) return;
          dialog.close();
        }
      });
    }
    this.required("#copy-share-link").addEventListener("click", () => { void this.copyShareLink(); });
    this.required("#replay-spin").addEventListener("click", () => {
      if (!this.state.lastSpin || !this.gpuReady || this.busy) return;
      this.required<HTMLDialogElement>("#history-dialog").close();
      this.launch(this.state.lastSpin.charge, this.state.lastSpin);
    });
    this.required("#mute").addEventListener("click", () => {
      this.setMuted(!this.audio.muted);
    });
    this.required("#retry-gpu").addEventListener("click", () => { void this.initializeRenderer(); });
    this.required("#batch-edit").addEventListener("click", () => {
      if (this.busy) return;
      this.setBatchEditing(true);
      this.required<HTMLTextAreaElement>("#bulk-choices").focus();
    });
    this.required("#cancel-batch").addEventListener("click", () => {
      this.setBatchEditing(false);
      this.required("#batch-edit").focus();
    });
    this.required("#apply-bulk").addEventListener("click", () => {
      if (this.applyBatch()) this.required<HTMLDialogElement>("#wheel-editor").close();
    });
    this.required("#spin-history").addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-history]");
      if (!button || this.busy || !this.gpuReady) return;
      const entry = this.spinHistory[Number(button.dataset.history)];
      if (!entry) return;
      const shared = readSharePayload(entry.state);
      if (!shared.lastSpin) return;
      this.state.lastSpin = shared.lastSpin;
      this.required<HTMLDialogElement>("#history-dialog").close();
      this.launch(shared.lastSpin.charge, shared.lastSpin);
    });
    this.required("#add-item").addEventListener("click", () => {
      if (this.state.wheelConfig.items.length >= 50) return;
      this.updateItems([...this.state.wheelConfig.items, { id: crypto.randomUUID(), label: `OPTION ${this.state.wheelConfig.items.length + 1}`, weight: 1 }]);
      this.root.querySelector<HTMLInputElement>("#editor-list .editor-row:last-child input")?.focus();
    });
    this.required("#reset-wheel").addEventListener("click", () => {
      if (this.busy) return;
      if (window.confirm("Reset the wheel to its default choices? Your current choices will be replaced.")) {
        this.updateItems(createDefaultConfig().items, true);
      }
    });
    const editOption = (event: Event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-id]");
      if (!input || this.busy || (event as InputEvent).isComposing) return;
      this.capitalizeInput(input);
      const label = normalizeLabel(input.value);
      const valid = validLabel(label);
      input.setCustomValidity(valid ? "" : "Enter an option with 1–12 characters.");
      input.toggleAttribute("aria-invalid", !valid);
      if (!valid) { input.setAttribute("aria-invalid", "true"); return; }
      const item = this.state.wheelConfig.items.find(entry => entry.id === input.dataset.id);
      if (item && item.label !== label) { item.label = label; this.commitConfig(); this.clearResult(); }
    };
    const editorList = this.required("#editor-list");
    editorList.addEventListener("input", editOption);
    editorList.addEventListener("compositionend", editOption);
    const bulkInput = this.required<HTMLTextAreaElement>("#bulk-choices");
    bulkInput.autocapitalize = "characters";
    const capitalizeBulk = (event: Event) => {
      if (!(event as InputEvent).isComposing) this.capitalizeInput(bulkInput);
    };
    bulkInput.addEventListener("input", capitalizeBulk);
    bulkInput.addEventListener("compositionend", capitalizeBulk);
    this.required("#editor-list").addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      if (!button) return;
      const index = this.state.wheelConfig.items.findIndex(item => item.id === button.dataset.id);
      if (index < 0) return;
      const items = [...this.state.wheelConfig.items];
      if (button.dataset.action === "delete" && items.length > 2) items.splice(index, 1);
      if (button.dataset.action === "up" && index > 0) [items[index - 1], items[index]] = [items[index], items[index - 1]];
      if (button.dataset.action === "down" && index < items.length - 1) [items[index + 1], items[index]] = [items[index], items[index + 1]];
      const action = button.dataset.action;
      const id = button.dataset.id;
      this.updateItems(items);
      const rows = [...this.root.querySelectorAll<HTMLElement>("#editor-list .editor-row")];
      const row = action === "delete" ? rows[Math.min(index, rows.length - 1)]
        : rows.find(row => row.querySelector<HTMLInputElement>("input")?.dataset.id === id);
      const target = row?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]:not(:disabled)`);
      (target ?? row?.querySelector<HTMLInputElement>("input"))?.focus();
      this.required("#choice-status").textContent = action === "delete"
        ? `Choice deleted. ${items.length} choices remaining.`
        : `Choice moved to position ${items.findIndex(item => item.id === id) + 1} of ${items.length}.`;
    });
  }

  private finishOptionEditing(): boolean {
    const inputs = [...this.root.querySelectorAll<HTMLInputElement>("#editor-list input")];
    const populated = inputs.filter(input => input.value.trim());
    if (populated.length < 2) {
      const input = inputs.find(input => !input.value.trim())!;
      input.setCustomValidity("Keep at least two non-empty options.");
      input.reportValidity();
      return false;
    }
    for (const input of populated) {
      if (!input.reportValidity()) return false;
    }
    const ids = new Set(populated.map(input => input.dataset.id));
    const items = this.state.wheelConfig.items.filter(item => ids.has(item.id));
    if (items.length !== this.state.wheelConfig.items.length) this.updateItems(items);
    return true;
  }

  private capitalizeInput(input: HTMLInputElement | HTMLTextAreaElement): void {
    const value = input.value;
    const uppercase = value.toUpperCase();
    if (uppercase === value) return;
    const start = value.slice(0, input.selectionStart ?? value.length).toUpperCase().length;
    const end = value.slice(0, input.selectionEnd ?? value.length).toUpperCase().length;
    const direction = input.selectionDirection;
    input.value = uppercase;
    input.setSelectionRange(start, end, direction ?? undefined);
  }

  private setBatchEditing(active: boolean): void {
    this.batchEditing = active;
    this.required("#close-editor").hidden = active;
    this.required("#individual-editor").hidden = active;
    this.required("#batch-editor").hidden = !active;
    const textarea = this.required<HTMLTextAreaElement>("#bulk-choices");
    textarea.removeAttribute("aria-invalid");
    this.required("#batch-error").textContent = "";
    if (active) textarea.value = this.state.wheelConfig.items.map(item => item.label.toUpperCase()).join("\n");
  }

  private applyBatch(): boolean {
    if (this.busy) return false;
    const textarea = this.required<HTMLTextAreaElement>("#bulk-choices");
    try {
      const items = parseChoices(textarea.value);
      this.updateItems(items);
      return true;
    } catch (error) {
      this.required("#batch-error").textContent = (error as Error).message;
      textarea.setAttribute("aria-invalid", "true");
      textarea.focus();
      return false;
    }
  }

  private updateItems(items: WheelItem[], clearUrl = false): boolean {
    if (this.busy) return false;
    this.state.wheelConfig = { items, version: crypto.randomUUID() };
    this.clearResult();
    const saved = this.commitConfig(clearUrl);
    this.renderEditor();
    return saved;
  }

  private commitConfig(clearUrl = false): boolean {
    this.state.wheelConfig.version = crypto.randomUUID();
    this.physics.setSegmentCount(this.state.wheelConfig.items.length);
    const saved = this.store("momentum-wheel", this.state.wheelConfig);
    try {
      const url = new URL(location.href);
      if (clearUrl) {
        url.search = "";
        url.hash = "";
      } else {
        writeShareUrl(url, this.state.wheelConfig, this.state.lastSpin);
      }
      // Replacing the URL avoids navigation and one Back entry per keystroke.
      history.replaceState(history.state, "", url);
    } catch {
      this.notice("The URL could not be updated. Use Share to copy the current wheel.");
    }
    try {
      if (this.gpuReady) this.renderer?.updateConfig(this.state.wheelConfig);
    } catch { this.handleDeviceLoss(); }
    this.wake();
    return saved;
  }

  private renderEditor(): void {
    this.setBatchEditing(false);
    const list = this.required("#editor-list");
    list.replaceChildren(...this.state.wheelConfig.items.map((item, index) => {
      const row = document.createElement("div"); row.className = "editor-row";
      const input = document.createElement("input"); input.value = item.label.toUpperCase(); input.dataset.id = item.id;
      input.required = true; input.autocapitalize = "characters";
      input.setAttribute("aria-describedby", "choice-hint");
      input.maxLength = 12; input.setAttribute("aria-label", `Wheel item ${index + 1}`);
      const actions = [["up","↑","Move up"],["down","↓","Move down"],["delete","×","Delete"]] as const;
      row.append(input, ...actions.map(([action,text,label]) => {
        const button=document.createElement("button"); button.type="button"; button.textContent=text;
        button.dataset.action=action; button.dataset.id=item.id; button.title=label; button.setAttribute("aria-label",`${label} ${item.label}`);
        button.disabled=(action==="delete"&&this.state.wheelConfig.items.length<=2)||(action==="up"&&index===0)||(action==="down"&&index===this.state.wheelConfig.items.length-1);
        return button;
      })); return row;
    }));
    this.updateLocks();
  }

  private updateChargeUI(charge: number): void {
    const percent = Math.round(charge * 100);
    this.required<HTMLElement>("#charge-fill").style.setProperty("--charge", String(charge));
    this.required("#charge-label").textContent = charge ? `${percent}%` : "Spin";
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
      time.textContent = new Date(entry.completedAt).toLocaleString(undefined, {
        day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      info.append(result, time);
      const button = document.createElement("button"); button.type = "button";
      button.dataset.history = String(index); button.textContent = "Replay";
      button.setAttribute("aria-label", `Replay spin ${index + 1}: ${entry.result}`);
      row.append(info, button);
      return row;
    }));
  }

  private notice(message: string): void {
    this.required("#editor-notice").textContent = message;
    this.required("#app-notice").textContent = this.required<HTMLDialogElement>("#wheel-editor").open ? "" : message;
  }

  private shareWheel(): void {
    const input = this.required<HTMLInputElement>("#share-link");
    const button = this.required<HTMLButtonElement>("#copy-share-link");
    const status = this.required("#share-status");
    input.value = "";
    button.textContent = "Copy to clipboard";
    button.disabled = false;
    status.textContent = "";
    try {
      const url = new URL(location.href);
      writeShareUrl(url, this.state.wheelConfig, this.state.lastSpin);
      input.value = url.href;
    } catch (error) {
      button.disabled = true;
      status.textContent = error instanceof Error ? error.message : "Could not create a share link.";
    }
  }

  private async copyShareLink(): Promise<void> {
    const input = this.required<HTMLInputElement>("#share-link");
    const button = this.required<HTMLButtonElement>("#copy-share-link");
    const status = this.required("#share-status");
    button.disabled = true;
    status.textContent = "";
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = "Copied!";
      status.textContent = "Link copied to clipboard.";
    } catch {
      input.focus();
      input.select();
      status.textContent = "Could not copy automatically. Copy the selected link instead.";
    } finally {
      button.disabled = false;
    }
  }
  private get busy(): boolean { return this.spinActive || !!this.input?.charging; }
  private wake(): void { if (this.gpuReady && !document.hidden) this.loop?.start(); }
  private effect(action: () => void): void {
    try { action(); }
    catch { /* Optional sound and vibration must not interrupt the wheel. */ }
  }

  private setMuted(muted: boolean): void {
    this.effect(() => this.audio.setMuted(muted));
    const button = this.required<HTMLButtonElement>("#mute");
    button.setAttribute("aria-pressed", String(this.audio.muted));
    button.title = this.audio.muted ? "Unmute" : "Mute";
    button.setAttribute("aria-label", button.title);
    if (!this.audio.muted) this.resumeAudio();
  }

  private resumeAudio(): void {
    void this.audio.resume().catch(() => {});
  }

  private clearResult(): void {
    this.required<HTMLDialogElement>("#share-dialog").close();
    this.state.result = undefined;
    this.required("#result").textContent = "READY";
    this.required("#result").classList.remove("winner");
  }

  private updateLocks(): void {
    this.required<HTMLButtonElement>("#edit-wheel").disabled = this.busy;
    this.required<HTMLButtonElement>("#show-history").disabled = this.busy;
    this.required<HTMLFieldSetElement>("#history-controls").disabled = this.busy || !this.gpuReady;
    this.required<HTMLButtonElement>("#share-wheel").disabled = this.busy;
    this.required<HTMLFieldSetElement>("#choice-controls").disabled = this.busy;
    this.required<HTMLButtonElement>("#spin-button").disabled = !this.gpuReady || this.spinActive;
    const replay = this.state.lastSpin;
    const savedReplay = replay && this.spinHistory.some(entry =>
      JSON.stringify(entry.state) === JSON.stringify(createSharePayload(replay.wheelConfig, replay)));
    this.required("#replay-controls").hidden = !replay || !!savedReplay;
    this.required("#history-empty").hidden = this.spinHistory.length > 0 || !!replay;
    this.required<HTMLButtonElement>("#replay-spin").disabled = !this.gpuReady || this.busy || !this.state.lastSpin;
    this.required<HTMLButtonElement>("#add-item").disabled = this.state.wheelConfig.items.length >= 50;
  }

  private async initializeRenderer(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    this.required<HTMLButtonElement>("#retry-gpu").disabled = true;
    try {
      this.gpuReady = false;
      this.loop?.stop();
      this.renderer?.destroy();
      this.renderer = undefined;
      this.renderer = await WebGPURenderer.create(this.required<HTMLCanvasElement>("#wheel-canvas"), this.state.wheelConfig);
      // Choices may have been replaced while adapter/device/font requests awaited.
      this.renderer.updateConfig(this.state.wheelConfig);
      this.renderer.assertAvailable();
      this.gpuReady = true;
      this.renderer.onDeviceLost = () => this.handleDeviceLoss();
      this.required("#gpu-error").hidden = true;
      this.wake();
    } catch (error) {
      this.renderer?.destroy();
      this.renderer = undefined;
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
      <header><h1 class="app-title">Mechanical Wheel</h1><div class="header-actions"><div class="actions-menu"><button id="toggle-actions" class="ghost" type="button" aria-label="Wheel menu" aria-expanded="false" aria-controls="wheel-actions"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><div id="wheel-actions"><button id="edit-wheel" class="ghost" type="button" aria-haspopup="dialog" aria-controls="wheel-editor">Edit wheel</button><button id="share-wheel" class="ghost" type="button" aria-haspopup="dialog" aria-controls="share-dialog">Share</button><button id="show-history" class="ghost" type="button" aria-haspopup="dialog" aria-controls="history-dialog">Spin history</button></div></div><button id="show-info" class="ghost" type="button" aria-label="About Mechanical Wheel" title="About Mechanical Wheel" aria-haspopup="dialog" aria-controls="info-dialog"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/></svg></button><button id="mute" class="ghost" type="button" aria-pressed="${this.audio.muted}" aria-label="${this.audio.muted ? "Unmute" : "Mute"}" title="${this.audio.muted ? "Unmute" : "Mute"}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path class="sound-on" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-off" d="m16 9 6 6m0-6-6 6"/></svg></button></div></header>
      <main>
        <section id="stage" class="stage" aria-label="Spinning wheel">
          <div class="wheel-glow"></div><canvas id="wheel-canvas" aria-hidden="true"></canvas>
          <div id="gpu-error" class="unsupported" hidden><strong>WebGPU unavailable</strong><p id="gpu-message" role="alert"></p><button id="retry-gpu" type="button">Retry</button></div>
          <div class="spin-controls"><div id="result" role="status" aria-live="polite" aria-atomic="true">READY</div><button id="spin-button" class="spin-button" type="button" aria-label="Spin" aria-describedby="spin-help"><span id="charge-label" aria-hidden="true">Spin</span><i id="charge-fill" aria-hidden="true"></i></button><p id="spin-help">Hold longer for more force.</p></div>
        </section>
        <p id="app-notice" class="hint" role="status"></p>
      </main>
      <dialog id="info-dialog" class="editor wheel-info" aria-labelledby="info-title">
        <div class="panel-heading"><h2 id="info-title">About Mechanical Wheel</h2><button id="close-info" class="ghost" type="button" autofocus>Done</button></div>
        <div id="info-overview"></div>
        <h3>How randomness works</h3>
        <p>Every new spin uses fresh random numbers from your browser to vary the starting push, even if you hold the button for the same amount of time.</p>
        <p>Holding longer adds power. The wheel then slows down and bumps against the pointer until it stops.</p>
        <p>Each entry gets the same amount of space on the wheel. Randomness can still produce repeats or streaks: a previous winner is not ruled out of the next spin.</p>
        <p>Replaying a saved spin repeats its original push and starting position, so you see the same result. Start a new spin for fresh randomness.</p>
        <h4>How evenly do choices win?</h4>
        <p>Our latest tests covered 98,304 simulated spins across 96 combinations of wheel size, power and starting position. None showed a large imbalance in which choices won, including the gentle-release tests.</p>
        <p>These results are reassuring, but equal-sized slices do not guarantee exactly equal odds. The starting position and power can affect the outcome, and tests cannot cover every possible spin.</p>
      </dialog>
      <dialog id="share-dialog" class="editor" aria-labelledby="share-title">
        <div class="panel-heading"><h2 id="share-title">Share wheel</h2><button id="close-share" class="ghost" type="button">Done</button></div>
        <div class="share-link-panel"><label for="share-link">Wheel link</label><input id="share-link" type="text" readonly spellcheck="false"></div>
        <div class="editor-actions"><button id="copy-share-link" type="button" autofocus>Copy to clipboard</button></div>
        <p id="share-status" class="hint" role="status"></p>
      </dialog>
      <dialog id="wheel-editor" class="editor" aria-labelledby="editor-title">
        <div class="panel-heading"><h2 id="editor-title">Edit wheel</h2><button id="close-editor" class="ghost" type="button" autofocus>Done</button></div>
        <fieldset id="choice-controls"><legend class="sr-only">Wheel choices</legend>
          <p id="choice-hint" class="hint">Add 2–50 choices, with 1–12 characters each.</p><p id="choice-status" class="sr-only" role="status"></p>
          <div id="individual-editor"><div id="editor-list" class="editor-list"></div>
          <div class="editor-actions"><button id="add-item" type="button">+ Add choice</button><button id="batch-edit" type="button">Batch edit</button></div>
          <div class="reset-actions"><button id="reset-wheel" type="button">Reset</button></div></div>
          <div id="batch-editor" hidden><label for="bulk-choices">One choice per line</label><textarea id="bulk-choices" rows="12" maxlength="2000" aria-describedby="choice-hint batch-error"></textarea><p id="batch-error" class="hint" role="alert"></p><div class="editor-actions"><button id="apply-bulk" type="button">Apply choices</button><button id="cancel-batch" type="button">Cancel</button></div></div>
        </fieldset><p id="editor-notice" role="status" class="hint"></p>
      </dialog>
      <dialog id="history-dialog" class="editor" aria-labelledby="history-title">
        <div class="panel-heading"><h2 id="history-title">Spin history</h2><button id="close-history" class="ghost" type="button" autofocus>Done</button></div>
        <fieldset id="history-controls"><legend class="sr-only">Previous spins</legend><div id="replay-controls" class="secondary-spin" hidden><button id="replay-spin" type="button" disabled>Replay shared spin</button></div><p id="history-empty">No spins yet.</p><ol id="spin-history" class="spin-history"></ol></fieldset>
      </dialog>`;
    const overview = document.querySelector<HTMLElement>(".site-info");
    if (overview) {
      const title = overview.querySelector("h1");
      if (title) {
        title.classList.add("app-title");
        this.required(".app-title").replaceWith(title);
      }
      overview.querySelector("details")?.setAttribute("open", "");
      this.required("#info-overview").append(overview);
    }
  }
}
