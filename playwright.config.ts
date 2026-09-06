import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:4174",
    channel: "chrome",
    launchOptions: { args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox"] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
  },
});
