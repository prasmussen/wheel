export interface RandomSource {
  next(): number;
  range(min: number, max: number): number;
}

export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: readonly number[]) {
    let hash = 0x811c9dc5;
    for (const value of seed) {
      hash ^= value >>> 0;
      hash = Math.imul(hash, 0x01000193);
    }
    this.state = hash || 0x9e3779b9;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x1_0000_0000;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

export function secureSeed(length = 4): number[] {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values);
}
