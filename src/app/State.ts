import type { PhysicsConfig, SIMULATION_VERSION } from "./Config";
import type { PointerState, WheelState } from "../physics/PhysicsEngine";
import type { WheelConfig } from "../wheel/WheelConfig";

export interface SpinRecord {
  seed: number[];
  charge: number;
  startingAngle: number;
  simulationVersion: typeof SIMULATION_VERSION;
  wheelConfig: WheelConfig;
  physicsConfig: PhysicsConfig;
}

export interface AppState {
  wheelConfig: WheelConfig;
  wheelState: WheelState;
  pointerState: PointerState;
  interaction: { charging: boolean; chargeStartedAt: number };
  result?: string;
  lastSpin?: SpinRecord;
}
