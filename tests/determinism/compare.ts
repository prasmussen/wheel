import { Buffer } from "node:buffer";

export interface TraceDifference {
  byte: number;
  record: number;
  column: string;
  expectedBits: string;
  actualBits: string;
  expectedValue: number | "missing";
  actualValue: number | "missing";
  expectedBytes: number;
  actualBytes: number;
}

/** Exact byte comparison, with a useful first divergent field on failure. */
export function firstDifference(expected: Buffer, actual: Buffer, columns: readonly string[]): TraceDifference | null {
  if (expected.equals(actual)) return null;
  let byte = 0;
  while (byte < expected.length && byte < actual.length && expected[byte] === actual[byte]) byte++;
  const field = Math.floor(byte / 8), offset = field * 8;
  return {
    byte, record: Math.floor(field / columns.length), column: columns[field % columns.length],
    expectedBits: expected.subarray(offset, offset + 8).toString("hex"),
    actualBits: actual.subarray(offset, offset + 8).toString("hex"),
    expectedValue: offset + 8 <= expected.length ? expected.readDoubleLE(offset) : "missing",
    actualValue: offset + 8 <= actual.length ? actual.readDoubleLE(offset) : "missing",
    expectedBytes: expected.length, actualBytes: actual.length,
  };
}
