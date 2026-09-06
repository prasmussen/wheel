import { normalizeLabel, validLabel } from "./Labels";
import { DEFAULT_PHYSICS, SIMULATION_VERSION } from "../app/Config";
import type { SpinRecord } from "../app/State";
import type { WheelConfig } from "./WheelConfig";

const MAX_PAYLOAD_LENGTH = 24_000;

interface SharedWheel {
  wheelConfig: WheelConfig;
  lastSpin?: SpinRecord;
  replayUnavailable?: boolean;
}

function readChoices(value: unknown): WheelConfig {
  if (!Array.isArray(value) || value.length < 2 || value.length > 50
    || value.some(label => typeof label !== "string" || !validLabel(normalizeLabel(label), true))) {
    throw new Error("Invalid shared choices");
  }
  return {
    version: crypto.randomUUID(),
    items: value.map(label => ({ id: crypto.randomUUID(), label: normalizeLabel(label), weight: 1 })),
  };
}

export function createSharePayload(wheel: WheelConfig, replay?: SpinRecord) {
  const choices = wheel.items.map(item => item.label);
  const replayChoices = replay?.wheelConfig.items.map(item => item.label);
  return {
    v: 1,
    choices,
    replay: replay && {
      version: replay.simulationVersion,
      seed: replay.seed,
      charge: replay.charge,
      angle: replay.startingAngle,
      choices: JSON.stringify(choices) === JSON.stringify(replayChoices) ? undefined : replayChoices,
    },
  };
}

export type SharePayload = ReturnType<typeof createSharePayload>;

const SHARE_PARAMS = new Set(["wheel", "choices", "replay", "replayChoices"]);

// Split labels before percent-decoding: an encoded comma belongs to a label.
function decodeChoices(encoded: string): string[] {
  return encoded.split(",").map(label => normalizeLabel(decodeURIComponent(label.replace(/\+/g, " "))));
}

function encodeChoices(choices: string[]): string {
  return choices.map(label => {
    const normalized = normalizeLabel(label);
    const lower = normalized.toLowerCase();
    return encodeURIComponent(normalizeLabel(lower) === normalized ? lower : normalized);
  }).join(",");
}

/** Write readable labels and a fixed-width, lossless replay record. */
export function writeShareUrl(url: URL, wheel: WheelConfig, replay?: SpinRecord): void {
  const payload = createSharePayload(wheel, replay);
  readSharePayload(payload);
  const parts = [`choices=${encodeChoices(payload.choices)}`];
  if (payload.replay) {
    const record = payload.replay;
    const bytes = new Uint8Array(36);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, record.version, true);
    record.seed.forEach((word, index) => view.setUint32(4 + index * 4, word, true));
    view.setFloat64(20, record.charge, true);
    view.setFloat64(28, record.angle, true);
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
    parts.push(`replay=2.${encoded}`);
    if (record.choices) parts.push(`replayChoices=${encodeChoices(record.choices)}`);
  }
  if (parts.join("&").length > MAX_PAYLOAD_LENGTH) throw new Error("This wheel is too large to share in a link.");
  // Preserve unrelated parameters byte-for-byte; URLSearchParams would escape separators.
  const others = url.search.slice(1).split("&").filter(part => part &&
    !SHARE_PARAMS.has(new URLSearchParams(part).keys().next().value ?? ""));
  url.search = [...others, ...parts].join("&");
  url.hash = "";
}

/** Read labels before percent-decoding their separators. */
export function readShareUrl(url: URL): SharedWheel | undefined {
  const params = new Map<string, string>();
  for (const part of url.search.slice(1).split("&")) {
    const key = new URLSearchParams(part).keys().next().value;
    if (!key || !SHARE_PARAMS.has(key)) continue;
    if (params.has(key)) throw new Error("Duplicate wheel parameter");
    params.set(key, part.slice(part.indexOf("=") + 1));
  }
  if (!params.has("choices")) {
    if (params.has("replay") || params.has("replayChoices")) throw new Error("Missing shared choices");
    if (params.has("wheel")) throw new Error("Unsupported wheel link");
    return;
  }
  if ([...params.values()].reduce((size, value) => size + value.length, 0) > MAX_PAYLOAD_LENGTH) {
    throw new Error("Invalid wheel link");
  }
  const choices = decodeChoices(params.get("choices")!);
  const encoded = params.get("replay");
  if (encoded === undefined) {
    if (params.has("replayChoices")) throw new Error("Missing replay");
    return readSharePayload({ v: 1, choices });
  }
  if (!/^2\.[A-Za-z0-9_-]{48}$/.test(encoded)) throw new Error("Invalid replay");
  const bytes = Uint8Array.from(atob(encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return readSharePayload({ v: 1, choices, replay: {
    version: view.getUint32(0, true),
    seed: Array.from({ length: 4 }, (_, index) => view.getUint32(4 + index * 4, true)),
    charge: view.getFloat64(20, true), angle: view.getFloat64(28, true),
    choices: params.has("replayChoices") ? decodeChoices(params.get("replayChoices")!) : undefined,
  } });
}

export function readSharePayload(value: unknown): SharedWheel {
  if (!value || typeof value !== "object") throw new Error("Invalid wheel state");
  const payload = value as Partial<SharePayload>;
  if (!payload || payload.v !== 1) throw new Error("Unsupported wheel link");
  const wheelConfig = readChoices(payload.choices);
  if (payload.replay === undefined) return { wheelConfig };
  const replay = payload.replay;
  if (!replay || typeof replay !== "object") throw new Error("Invalid replay");
  if (replay.version !== SIMULATION_VERSION) return { wheelConfig, replayUnavailable: true };
  if (!Array.isArray(replay.seed) || replay.seed.length !== 4
    || replay.seed.some((n: unknown) => typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 0xffffffff)
    || typeof replay.charge !== "number" || !Number.isFinite(replay.charge) || replay.charge < 0 || replay.charge > 1
    || typeof replay.angle !== "number" || !Number.isFinite(replay.angle) || replay.angle < 0 || replay.angle >= Math.PI * 2) {
    throw new Error("Invalid replay");
  }
  const replayWheel = replay.choices === undefined ? structuredClone(wheelConfig) : readChoices(replay.choices);
  if (replayWheel.items.some(item => !item.label.trim())) throw new Error("Invalid replay choices");
  return {
    wheelConfig,
    lastSpin: {
      seed: [...replay.seed], charge: replay.charge, startingAngle: replay.angle,
      simulationVersion: SIMULATION_VERSION, wheelConfig: replayWheel,
      // Shared links always use the fixed physics for this simulation version.
      physicsConfig: { ...DEFAULT_PHYSICS },
    },
  };
}
