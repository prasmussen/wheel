import type { WheelConfig } from "../wheel/WheelConfig";
import { TAU } from "../utils/Math";

const FALLBACK_FONT = 'system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';
const FONT = `Manrope, ${FALLBACK_FONT}`;

/** Resolve once before the first frame; a slow font must not swap in later. */
export async function resolveLabelFont(config: WheelConfig): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = config.items.map(item => item.label.toUpperCase()).join("");
    return await Promise.race([
      document.fonts.load("600 16px Manrope", text).then(faces => faces.length ? FONT : FALLBACK_FONT),
      new Promise<string>(resolve => { timer = setTimeout(() => resolve(FALLBACK_FONT), 1000); }),
    ]);
  } catch {
    return FALLBACK_FONT;
  } finally {
    clearTimeout(timer);
  }
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Fit complete graphemes, preserving casing, script, and joined emoji. */
export function fitLabel(label: string, maxWidth: number, measure: (text: string) => number): string {
  const normalized = label.normalize("NFC");
  if (measure(normalized) <= maxWidth) return normalized;
  const characters = Array.from(graphemes.segment(normalized), part => part.segment);
  while (characters.length > 0) {
    characters.pop();
    const shortened = characters.join("") + "…";
    if (measure(shortened) <= maxWidth) return shortened;
  }
  return measure("…") <= maxWidth ? "…" : "";
}

/** Rasterize whole labels so the browser handles font fallback and script shaping. */
export function labelTexture(config: WheelConfig, size: number, font: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const scale = size / 2;
  const count = config.items.length;
  const radius = .49;
  const maxWidth = .52 * scale;
  // At the inner end of a label, leave space between adjacent sectors.
  const fontSize = Math.min(.08, .9 / count) * scale;
  for (const [index, item] of config.items.entries()) {
    const angle = (index + .5) / count * TAU;
    context.save();
    context.translate(scale + Math.cos(angle) * radius * scale, scale - Math.sin(angle) * radius * scale);
    context.rotate(-angle);
    context.font = `600 ${fontSize}px ${font}`;
    const displayLabel = item.label.toUpperCase().normalize("NFC");
    const width = context.measureText(displayLabel).width;
    const fittedSize = fontSize * Math.max(.8, Math.min(1, maxWidth / Math.max(1, width)));
    context.font = `600 ${fittedSize}px ${font}`;
    const label = fitLabel(displayLabel, maxWidth, text => context.measureText(text).width);
    const firstLetter = label.match(/\p{L}/u)?.[0] ?? "";
    context.direction = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u.test(firstLetter) ? "rtl" : "ltr";
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    const metrics = context.measureText(label);
    const baseline = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    context.fillStyle = "#f8fafc";
    context.shadowColor = "rgba(6, 12, 22, .45)";
    context.shadowBlur = .004 * scale;
    context.shadowOffsetY = .002 * scale;
    context.fillText(label, 0, baseline);
    context.restore();
  }
  return canvas;
}
