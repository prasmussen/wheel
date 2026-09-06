import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";
import wabt from "wabt";

/** Assemble handwritten WAT at build time. WABT is never shipped to browsers. */
export function handwrittenWasm(): Plugin {
  const compiler = wabt();
  return {
    name: "handwritten-wasm",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(".wat?wasm")) return;
      const path = id.slice(0, -"?wasm".length);
      this.addWatchFile(path);
      const assembler = await compiler;
      const module = assembler.parseWat(path, await readFile(path, "utf8"));
      try {
        module.resolveNames();
        module.validate();
        const { buffer } = module.toBinary({ canonicalize_lebs: true });
        // Keep synchronous constructors in the application and tests. The
        // small binary is bundled as bytes, with no runtime fetch or compiler.
        return `export default new Uint8Array([${buffer.join(",")}]);`;
      } finally {
        module.destroy();
      }
    },
  };
}
