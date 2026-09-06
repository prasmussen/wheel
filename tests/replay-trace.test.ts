import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { firstDifference } from "./determinism/compare";

function bytes(...values: number[]) {
  const buffer = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => buffer.writeDoubleLE(value, index * 8));
  return buffer;
}

describe("exact cross-browser trace comparison", () => {
  it("accepts identical bytes and detects signed zero", () => {
    expect(firstDifference(bytes(1, -0), bytes(1, -0), ["angle", "velocity"])).toBeNull();
    const difference = firstDifference(bytes(1, -0), bytes(1, 0), ["angle", "velocity"]);
    expect(difference).toMatchObject({ record: 0, column: "velocity",
      expectedBits: "0000000000000080", actualBits: "0000000000000000" });
  });

  it("locates a one-ULP error in a later record", () => {
    const expected = bytes(0, 1, 2, 1), actual = Buffer.from(expected);
    actual.writeBigUInt64LE(0x3ff0000000000001n, 24);
    expect(firstDifference(expected, actual, ["tick", "angle"])).toMatchObject({
      record: 1, column: "angle", expectedValue: 1, actualValue: 1 + Number.EPSILON,
    });
  });

  it("detects missing or extra events even when all preceding bytes match", () => {
    expect(firstDifference(bytes(1, 2), bytes(1), ["timestamp"])).toMatchObject({
      record: 1, column: "timestamp", actualValue: "missing", expectedBytes: 16, actualBytes: 8,
    });
    expect(firstDifference(bytes(1), bytes(1, 2), ["timestamp"])).toMatchObject({ expectedValue: "missing" });
  });
});
