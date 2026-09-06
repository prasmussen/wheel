import { normalizeLabel, validLabel } from "./Labels";
import type { WheelConfig, WheelItem } from "./WheelConfig";

export function validateConfig(value: unknown): WheelConfig | undefined {
  if (!value || typeof value !== "object") return;
  const config = value as Partial<WheelConfig>;
  if (typeof config.version !== "string" || !Array.isArray(config.items)
    || config.items.length < 2 || config.items.length > 50) return;
  const ids = new Set<string>();
  for (const item of config.items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.label !== "string" || !validLabel(normalizeLabel(item.label)) || item.weight !== 1) return;
    ids.add(item.id);
  }
  return { version: config.version, items: config.items.map(({ id, label }) => ({ id, label: normalizeLabel(label), weight: 1 })) };
}

export function parseChoices(text: string): WheelItem[] {
  const labels = text.split(/\r?\n/).map(label => normalizeLabel(label)).filter(Boolean);
  if (labels.length > 50) throw new Error("Keep at most 50 choices.");
  if (labels.length < 2) throw new Error("Enter between 2 and 50 choices, one per line.");
  if (labels.some(label => !validLabel(label))) throw new Error("Keep each choice to 12 characters or fewer.");
  return labels.map(label => ({ id: crypto.randomUUID(), label, weight: 1 }));
}
