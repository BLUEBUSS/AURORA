import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const backend = process.env.AURORA_BACKEND_URL || "http://127.0.0.1:18789";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/fin-core/ws": {
        target: backend,
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace("/fin-core/ws", "/fin-core"),
      },
      "/fin-core/api": { target: backend, changeOrigin: true },
      "/fin-core/backend": { target: backend, changeOrigin: true },
      "/api/auth": { target: backend, changeOrigin: true },
      "/fin-core/files": { target: backend, changeOrigin: true },
      "/fin-core/workspace-api": { target: backend, changeOrigin: true },
      "/fin-core/uploads": { target: backend, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
