import { defineConfig } from "@playwright/test";

// Separate from WebGPU UI tests: this page imports only the physics modules.
export default defineConfig({
  testDir: "./tests/determinism",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 60_000,
  retries: 0,
  maxFailures: 1,
  outputDir: "test-results/determinism",
  use: { baseURL: "http://127.0.0.1:4176" },
  webServer: {
    command: "npm run dev -- --port 4176 --strictPort",
    url: "http://127.0.0.1:4176/tests/determinism/runner.html",
    reuseExistingServer: false,
  },
});
