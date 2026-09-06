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
    || value.some(label => typeof label !== "string" || label.length > 30)) {
    throw new Error("Invalid shared choices");
  }
  return {
    version: crypto.randomUUID(),
    items: value.map(label => ({ id: crypto.randomUUID(), label, weight: 1 })),
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

export function encodeShare(wheel: WheelConfig, replay?: SpinRecord): string {
  const bytes = new TextEncoder().encode(JSON.stringify(createSharePayload(wheel, replay)));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (encoded.length > MAX_PAYLOAD_LENGTH) throw new Error("This wheel is too large to share in a link.");
  return `#wheel=${encoded}`;
}

export function decodeShare(hash: string): SharedWheel | undefined {
  if (!hash.startsWith("#wheel=")) return;
  const encoded = hash.slice(7);
  if (!encoded || encoded.length > MAX_PAYLOAD_LENGTH || !/^[\w-]+$/.test(encoded)) {
    throw new Error("Invalid wheel link");
  }
  const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  return readSharePayload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
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
