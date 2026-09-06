import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["scripts/distribution.ts"], testTimeout: 120_000 } });
