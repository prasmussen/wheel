import { handwrittenWasm } from "./build/wasm";
import { seo } from "./build/seo";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [handwrittenWasm(), seo(loadEnv(mode, process.cwd(), "SITE_").SITE_URL)],
  server: { host: "127.0.0.1" },
  build: { target: "esnext" },
}));
