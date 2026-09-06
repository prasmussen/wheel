import { describe, expect, it } from "vitest";
import { launchBrakeScale, speedBrakeTorque } from "../src/physics/SpeedBrake";

describe("speed-sensitive brake", () => {
  it("only removes energy and treats both directions equally", () => {
    for (const strength of [0, 0.88, 1.08, 5]) {
      for (const speed of [0, 0.05, 0.12, 0.2, 0.5, 1, 10, 34]) {
        expect(speedBrakeTorque(speed, strength) * speed).toBeLessThanOrEqual(0);
        expect(speedBrakeTorque(-speed, strength)).toBeCloseTo(-speedBrakeTorque(speed, strength), 12);
      }
    }
  });

  it("releases during slow peg contact and engages smoothly", () => {
    for (const speed of [-0.12, -0.06, 0, 0.06, 0.12]) {
      expect(Math.abs(speedBrakeTorque(speed, 1.08))).toBe(0);
    }
    expect(Math.abs(speedBrakeTorque(0.120001, 1.08))).toBeLessThan(1e-8);
    expect(speedBrakeTorque(0.499999, 1.08)).toBeCloseTo(speedBrakeTorque(0.5, 1.08), 5);
    expect(speedBrakeTorque(10, 0)).toBeCloseTo(0);
  });
});


describe("charge-dependent brake release", () => {
  it("keeps lower charges brisk, then progressively releases the brake", () => {
    for (const charge of [-1, 0, 0.3, 0.55]) expect(launchBrakeScale(charge)).toBe(1);
    const scales = [0.55, 0.7, 0.85, 1].map(launchBrakeScale);
    for (let index = 1; index < scales.length; index++) expect(scales[index]).toBeLessThan(scales[index - 1]);
    expect(launchBrakeScale(1)).toBeCloseTo(0.2);
    expect(launchBrakeScale(2)).toBe(launchBrakeScale(1));
  });
});
