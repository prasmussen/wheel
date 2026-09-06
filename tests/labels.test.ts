import { describe, expect, it } from "vitest";
import { fitLabel } from "../src/renderer/TextLabels";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const measure = (text: string) => Array.from(segmenter.segment(text)).length * 10;

describe("wheel label fitting", () => {
  it.each(["æøå äöü café", "東京", "مرحبا", "שלום", "नमस्ते", "👩🏽‍💻 Pizza"])("preserves casing and Unicode in %s", label => {
    expect(fitLabel(label, 300, measure)).toBe(label);
  });
  it("normalizes combining accents without stripping them", () => {
    expect(fitLabel("A\u030a", 30, measure)).toBe("Å");
  });
  it("truncates only at grapheme boundaries", () => {
    expect(fitLabel("👩🏽‍💻👨‍👩‍👧‍👦🇳🇴abcd", 40, measure)).toBe("👩🏽‍💻👨‍👩‍👧‍👦🇳🇴…");
  });
  it("fits by measured width instead of character count", () => {
    const proportional = (text: string) => [...text].reduce((width, char) => width + (char === "W" ? 20 : 5), 0);
    expect(fitLabel("iiii", 20, proportional)).toBe("iiii");
    expect(fitLabel("WWWW", 30, proportional)).toBe("W…");
    expect(fitLabel("Wide", 0, proportional)).toBe("");
  });
});
