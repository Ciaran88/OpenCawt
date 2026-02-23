import { defineConfig } from "vite";

const base = process.env.VITE_OCP_BASE ?? "/";
const outDir = process.env.VITE_OCP_OUTDIR ?? "../dist";

export default defineConfig({
  base,
  root: "./src",
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api/ocp": "http://127.0.0.1:8788",
      "/v1": "http://127.0.0.1:8788",
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
  },
});
