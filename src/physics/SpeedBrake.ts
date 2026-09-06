import { SLOW_CONTACT_SPEED } from "../app/Config";
import { clamp } from "../utils/Math";

/** A speed-sensitive brake releases smoothly as the wheel enters peg settling. */
export function speedBrakeTorque(angularVelocity: number, strength: number): number {
  const engagement = clamp((Math.abs(angularVelocity) - SLOW_CONTACT_SPEED) / (0.5 - SLOW_CONTACT_SPEED), 0, 1);
  const smoothEngagement = engagement * engagement * (3 - 2 * engagement);
  // Oppose motion in either direction. The brake cannot add energy or hold
  // the pointer against a peg once the wheel enters the slow contact regime.
  return -strength * smoothEngagement * angularVelocity;
}

/** A stronger pull releases more of the brake, allowing a longer free coast. */
export function launchBrakeScale(charge: number): number {
  const release = clamp((charge - 0.55) / 0.45, 0, 1);
  const smoothRelease = release * release * (3 - 2 * release);
  return 1 - 0.8 * smoothRelease;
}
