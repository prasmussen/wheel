/// <reference types="vite/client" />

declare module "*.wgsl?raw" {
  const source: string;
  export default source;
}

declare module "*.wat?wasm" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
