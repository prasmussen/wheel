import type { RandomSource } from "../utils/Random";
import { numericCore } from "./WasmCore";

/** Adapter for diagnostics with injectable draws. Engine launches draw inside Wasm. */
export function sampleLaunchSpeed(charge: number, random: RandomSource): number {
  return numericCore.launch_speed(charge, random.next(), random.next());
}
