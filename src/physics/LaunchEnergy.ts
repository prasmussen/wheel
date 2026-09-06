import { clamp } from "../utils/Math";
import type { RandomSource } from "../utils/Random";

const MIN_LAUNCH_SPEED = 4.2;
const CHARGE_SPEED_GAIN = 20;
const PRELOAD_SPEED_SQUARED = 200;

/**
 * Randomize spring preload before applying the launch torque. Kinetic energy
 * is proportional to angular speed squared, so independent, bounded preload
 * contributions add here rather than multiplying speed by a narrow jitter.
 * Their sum has a triangular distribution, avoiding sharp uniform endpoints.
 *
 * This sampler does not know the wheel angle, segment count, or any winner.
 * Longer holds increase the energy for every fixed pair of random draws.
 */
export function sampleLaunchSpeed(charge: number, random: RandomSource): number {
  const power = Math.pow(clamp(charge, 0, 1), 1.5);
  const chargedSpeed = MIN_LAUNCH_SPEED + CHARGE_SPEED_GAIN * power;
  // A stronger winding also has a wider preload range. This keeps physical
  // travel varied at full charge despite the stronger speed brake.
  const preload = PRELOAD_SPEED_SQUARED * (1 + power) * (random.next() + random.next());
  return Math.sqrt(chargedSpeed * chargedSpeed + preload);
}
