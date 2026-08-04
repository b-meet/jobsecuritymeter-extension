import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import manifest from "./src/manifest";

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { target: "esnext" },
});
