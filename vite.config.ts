import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPlugin from "vite-plugin-monaco-editor";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    // [START] Phase 8 — Monaco editor web worker bundling
    (monacoEditorPlugin as unknown as { default: typeof monacoEditorPlugin }).default({
      languageWorkers: ["editorWorkerService", "typescript", "json", "css", "html"],
    }),
    // [END]
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  // [START] Phase 5 — allow top-level await in production bundles.
  // main.tsx uses `const { PetApp } = await import(...)` to lazy-load the
  // pet window. The default Vite target ("modules" / ES2020) rejects TLA.
  // Tauri on macOS uses WebKit which has supported TLA since 15 — esnext
  // is safe across all target versions we care about.
  build: {
    target: "esnext",
  },
  esbuild: {
    target: "esnext",
  },
  // [END]
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/sidecar/**"],
    },
  },
}));
