import { normalizeLabel } from "./Labels";
import { createSharePayload, readSharePayload, type SharePayload } from "./Share";

export const HISTORY_KEY = "momentum-spin-history";
export const HISTORY_LIMIT = 30;

export interface SpinHistoryEntry {
  completedAt: number;
  result: string;
  state: SharePayload;
}

export function readSpinHistory(value: unknown): SpinHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: SpinHistoryEntry[] = [];
  for (const entry of value) {
    try {
      if (!entry || !Number.isSafeInteger(entry.completedAt) || entry.completedAt < 0
        || entry.completedAt > 8.64e15 || typeof entry.result !== "string" || entry.result.length > 12) continue;
      const shared = readSharePayload(entry.state);
      if (!shared.lastSpin || !shared.lastSpin.wheelConfig.items.some(item => item.label === normalizeLabel(entry.result))) continue;
      entries.push({ completedAt: entry.completedAt, result: normalizeLabel(entry.result),
        state: createSharePayload(shared.wheelConfig, shared.lastSpin) });
    } catch { /* Skip damaged or incompatible entries without losing the others. */ }
  }
  return entries.sort((a, b) => b.completedAt - a.completedAt).slice(0, HISTORY_LIMIT);
}

export function appendSpinHistory(entries: SpinHistoryEntry[], entry: SpinHistoryEntry): SpinHistoryEntry[] {
  return [structuredClone(entry), ...entries].slice(0, HISTORY_LIMIT);
}
