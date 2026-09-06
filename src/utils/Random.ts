import { numericCore, SEED_CAPACITY, SEED_OFFSET } from "../physics/WasmCore";

export interface RandomSource {
  next(): number;
  range(min: number, max: number): number;
}

const seedWords = new Uint32Array(numericCore.memory.buffer, SEED_OFFSET, SEED_CAPACITY);

/** Opaque state transport; hashing, xorshift, and range mapping run in Wasm. */
export class SeededRandom implements RandomSource {
  state: number;

  constructor(seed: readonly number[]) {
    let hash = 0x811c9dc5;
    for (let offset = 0; offset < seed.length; offset += SEED_CAPACITY) {
      const chunk = seed.slice(offset, offset + SEED_CAPACITY);
      seedWords.set(chunk);
      hash = numericCore.hash_seed(hash, chunk.length);
    }
    this.state = numericCore.finish_seed(hash);
  }

  next(): number { return this.range(0, 1); }

  range(min: number, max: number): number {
    const value = numericCore.rng_sample(this.state, min, max);
    this.state = numericCore.rng_state();
    return value;
  }
}

export function secureSeed(length = 4): number[] {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values);
}
