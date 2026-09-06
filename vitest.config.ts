import { defineConfig } from "vitest/config";
import { handwrittenWasm } from "./build/wasm";

export default defineConfig({
  plugins: [handwrittenWasm()],
  test: { include: ["tests/**/*.test.ts"] },
});
