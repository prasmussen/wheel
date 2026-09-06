import { handwrittenWasm } from "./build/wasm";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [handwrittenWasm()],
  server: { host: "127.0.0.1" },
  build: { target: "esnext" },
});
