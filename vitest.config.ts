import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * Separate from vite.config.ts on purpose. vitest ships its own pinned copy of
 * vite, so a single config importing both the CRXJS plugin and vitest's
 * defineConfig makes TypeScript compare two different Vite installs' Plugin
 * types and fail. The build config has no business knowing about tests anyway.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: { environment: "jsdom", globals: true, include: ["src/**/*.test.ts"] },
});
