export interface WheelItem {
  id: string;
  label: string;
  weight: number;
  color?: string;
}

export interface WheelConfig {
  items: WheelItem[];
  version: string;
}

export const DEFAULT_ITEMS = [
  "PIZZA", "SUSHI", "TACOS", "THAI", "PASTA", "RAMEN", "CURRY", "BURGER",
];

export function createDefaultConfig(): WheelConfig {
  return {
    items: DEFAULT_ITEMS.map((label) => ({
      id: crypto.randomUUID(), label, weight: 1,
    })),
    version: crypto.randomUUID(),
  };
}
