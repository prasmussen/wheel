export interface ReplayScenario {
  id: string;
  count: number;
  charge: number;
  seed: number[];
  startingAngle: number;
  mode: "ticks" | "frames";
  reuse?: boolean;
}

export const scenarios: ReplayScenario[] = [];
const seeds = [[1, 2, 3, 4], [0xffffffff, 0x80000000, 0, 42]];
for (const count of [2, 8, 40, 50]) {
  for (const charge of [0, 0.55, 1]) {
    for (const offset of [0, 0.37]) {
      seeds.forEach((seed, index) => scenarios.push({
        id: `${count} choices / charge ${charge} / offset ${offset} / seed ${index}`,
        count, charge, seed, startingAngle: Math.PI / 2 - Math.PI / count + offset,
        mode: "ticks",
      }));
    }
  }
}
// Every supported segment count; also exercise the zero-hash RNG fallback.
for (let count = 2; count <= 50; count++) {
  scenarios.push({ id: `${count} choices / mixed frame batches`, count, charge: 0.65,
    seed: [0x811c9dc5], startingAngle: Math.PI / 2 - Math.PI / count, mode: "frames" });
}
for (const count of [2, 8, 40, 50]) {
  scenarios.push({ id: `${count} choices / reused engine`, count, charge: 1,
    seed: seeds[1], startingAngle: 1.234, mode: "ticks", reuse: true });
}

export const stateColumns = [
  "tick", "wheel.angle", "wheel.angularVelocity", "pointer.angle", "pointer.angularVelocity",
  "stableTime", "lastImpact", "currentPeg", "previous.wheel.angle", "previous.wheel.angularVelocity",
  "previous.pointer.angle", "previous.pointer.angularVelocity", "previous.stableTime",
  "previous.lastImpact", "previous.currentPeg", "simulationTime",
];
export const eventColumns = ["pegIndex", "strength", "wheelVelocity", "timestamp"];
