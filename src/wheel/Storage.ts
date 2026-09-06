import type { WheelConfig, WheelItem } from "./WheelConfig";

export function validateConfig(value: unknown): WheelConfig | undefined {
  if (!value || typeof value !== "object") return;
  const config = value as Partial<WheelConfig>;
  if (typeof config.version !== "string" || !Array.isArray(config.items)
    || config.items.length < 2 || config.items.length > 50) return;
  const ids = new Set<string>();
  for (const item of config.items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.label !== "string" || item.label.length > 30 || item.weight !== 1) return;
    ids.add(item.id);
  }
  return { version: config.version, items: config.items.map(({ id, label }) => ({ id, label, weight: 1 })) };
}

export function parseChoices(text: string): WheelItem[] {
  const labels = text.split(/\r?\n/).map(label => label.trim()).filter(Boolean);
  if (labels.length < 2 || labels.length > 50) throw new Error("Enter between 2 and 50 choices, one per line.");
  if (labels.some(label => label.length > 30)) throw new Error("Keep each choice to 30 characters or fewer.");
  return labels.map(label => ({ id: crypto.randomUUID(), label, weight: 1 }));
}

export interface SavedWheel { name: string; config: WheelConfig }

export function readSavedWheels(value: unknown): SavedWheel[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap(entry => {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 40) return [];
    const config = validateConfig(entry.config);
    return config ? [{ name: entry.name, config }] : [];
  });
}
