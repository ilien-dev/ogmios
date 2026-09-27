import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1427,
    strictPort: true,
    host: host ?? false,
    hmr: host === undefined ? undefined : { protocol: "ws", host, port: 1421 },
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
