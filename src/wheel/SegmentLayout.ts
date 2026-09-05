import { TAU, wrapAngle } from "../utils/Math";
import type { WheelConfig } from "./WheelConfig";

export interface SegmentRenderData {
  startAngle: number;
  endAngle: number;
  colorIndex: number;
}

export function segmentLayout(config: WheelConfig): SegmentRenderData[] {
  const step = TAU / config.items.length;
  return config.items.map((_, index) => ({
    startAngle: index * step,
    endAngle: (index + 1) * step,
    colorIndex: index,
  }));
}

// WebGPU clip-space +Y is the top of the wheel, so the fixed pointer is at +PI/2.
export function selectedIndex(wheelAngle: number, itemCount: number): number {
  const localPointer = wrapAngle(Math.PI / 2 - wheelAngle);
  return Math.floor(localPointer / (TAU / itemCount)) % itemCount;
}
