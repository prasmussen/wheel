import { defineConfig } from "vitest/config";
import { handwrittenWasm } from "./build/wasm";

export default defineConfig({
  plugins: [handwrittenWasm()],
  test: { include: ["scripts/distribution.ts"], testTimeout: 120_000 },
});
