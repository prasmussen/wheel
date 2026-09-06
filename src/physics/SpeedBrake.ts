import { numericCore } from "./WasmCore";

export function speedBrakeTorque(angularVelocity: number, strength: number): number {
  return numericCore.brake_torque(angularVelocity, strength);
}

export function launchBrakeScale(charge: number): number {
  return numericCore.brake_release(charge);
}
