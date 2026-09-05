import { describe, expect, it } from "vitest";
import { selectedIndex, segmentLayout } from "../src/wheel/SegmentLayout";
import type { WheelConfig } from "../src/wheel/WheelConfig";

describe("segment layout", () => {
  it("builds equal, contiguous segments", () => {
    const config: WheelConfig = { version: "test", items: Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: String(i), weight: 1 })) };
    const layout = segmentLayout(config);
    expect(layout).toHaveLength(8);
    expect(layout[0].startAngle).toBe(0);
    expect(layout.at(-1)?.endAngle).toBeCloseTo(Math.PI * 2);
    layout.slice(1).forEach((segment, index) => expect(segment.startAngle).toBe(layout[index].endAngle));
  });

  it("selects the segment beneath the fixed top pointer", () => {
    expect(selectedIndex(0, 8)).toBe(2);
    expect(selectedIndex(Math.PI / 4, 8)).toBe(1);
    expect(selectedIndex(-Math.PI / 4, 8)).toBe(3);
  });
});
