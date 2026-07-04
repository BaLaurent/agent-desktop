import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Renderer-only build for the deno desktop shell. The Electron main/preload bundles are gone —
// the backend is the Deno process (src/desktop/), which serves this build over HTTP+WS
// (src/desktop/uiServer.ts). Dev loop rebuilds on change via `vite build --watch`
// (see scripts/dev-desktop.mjs); the desktop window hot-reloads with F5.
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./", // relative asset URLs so uiServer can serve index.html from any path
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  css: {
    postcss: resolve(__dirname, "postcss.config.js"),
  },
  build: {
    outDir: resolve(__dirname, "out/renderer"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
});
