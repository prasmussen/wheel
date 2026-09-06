import { describe, expect, it } from "vitest";
import { parseChoices, validateConfig } from "../src/wheel/Storage";
import { displayLabel } from "../src/renderer/Geometry";

const valid = { version: "v1", items: [{ id: "1", label: "ÆØÅ", weight: 1 }, { id: "2", label: "Pizza", weight: 1 }] };

describe("saved choices", () => {
  it.each([null, {}, { ...valid, items: [null, null] },
    { ...valid, items: [valid.items[0], valid.items[0]] },
    { ...valid, items: [{ id: "1", label: 42, weight: 1 }, valid.items[1]] },
    { ...valid, items: [{ ...valid.items[0], weight: 2 }, valid.items[1]] },
  ])("rejects invalid configuration %j", value => expect(validateConfig(value)).toBeUndefined());
  it("copies validated values", () => {
    expect(validateConfig(valid)).toEqual(valid);
    expect(validateConfig(valid)).not.toBe(valid);
  });
  it("parses pasted lines without losing duplicate choices", () => {
    const items = parseChoices(" Pizza \r\n\nSushi\nPizza");
    expect(items.map(item => item.label)).toEqual(["Pizza", "Sushi", "Pizza"]);
    expect(new Set(items.map(item => item.id)).size).toBe(3);
  });
  it.each(["one", "x".repeat(31) + "\ny", Array(51).fill("x").join("\n")])("rejects invalid bulk entry", text => expect(() => parseChoices(text)).toThrow());
});

describe("wheel labels", () => {
  it("supports Nordic letters and normalized accents", () => {
    expect(displayLabel("æøå äöü café", 8)).toBe("ÆØÅ ÄÖÜ CAFÉ");
    expect(displayLabel("A\u030a", 8)).toBe("Å");
  });
  it("marks truncation explicitly at both density limits", () => {
    expect(displayLabel("abcdefghijklmnop", 8)).toBe("ABCDEFGHIJKLM…");
    expect(displayLabel("abcdefghijklmnop", 50)).toBe("ABCDEFG…");
  });
});
