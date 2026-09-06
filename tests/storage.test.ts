import { describe, expect, it } from "vitest";
import { parseChoices, validateConfig } from "../src/wheel/Storage";

const valid = { version: "v1", items: [{ id: "1", label: "ÆØÅ", weight: 1 }, { id: "2", label: "Pizza", weight: 1 }] };

describe("saved choices", () => {
  it.each([null, {}, { ...valid, items: [null, null] },
    { ...valid, items: [valid.items[0], valid.items[0]] },
    { ...valid, items: [{ id: "1", label: 42, weight: 1 }, valid.items[1]] },
    { ...valid, items: [{ ...valid.items[0], weight: 2 }, valid.items[1]] },
  ])("rejects invalid configuration %j", value => expect(validateConfig(value)).toBeUndefined());
  it.each(["", "   ", "\t\n"])("rejects blank saved labels %j", label => {
    expect(validateConfig({ ...valid, items: [{ ...valid.items[0], label }, valid.items[1]] })).toBeUndefined();
  });
  it("checks length after uppercase expansion", () => {
    expect(parseChoices("ß".repeat(6) + "\nPizza")[0].label).toBe("S".repeat(12));
    expect(() => parseChoices("ß".repeat(7) + "\nPizza")).toThrow();
  });
  it("copies validated values", () => {
    expect(validateConfig(valid)?.items.map(item => item.label)).toEqual(["ÆØÅ", "PIZZA"]);
    expect(validateConfig(valid)).not.toBe(valid);
  });
  it("parses pasted lines without losing duplicate choices", () => {
    const items = parseChoices(" Pizza \r\n\nSushi\nPizza");
    expect(items.map(item => item.label)).toEqual(["PIZZA", "SUSHI", "PIZZA"]);
    expect(new Set(items.map(item => item.id)).size).toBe(3);
    expect(parseChoices(Array(50).fill(" Pizza \n \n").join("\n"))).toHaveLength(50);
  });
  it.each(["one", "x".repeat(13) + "\ny", Array(51).fill("x").join("\n")])("rejects invalid bulk entry", text => expect(() => parseChoices(text)).toThrow());
});

it('normalizes old saved labels and rejects expansion overflow and unpaired surrogates', () => {
  const config = structuredClone(valid);
  config.items[0].label = ' cafe\u0301 ';
  expect(validateConfig(config)?.items[0].label).toBe('CAFÉ');
  for (const label of ['ß'.repeat(7), '\ud800', '\udc00']) {
    config.items[0].label = label;
    expect(validateConfig(config)).toBeUndefined();
    expect(() => parseChoices(label + '\nOTHER')).toThrow();
  }
});
