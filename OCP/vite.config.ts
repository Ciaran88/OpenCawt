import { defineConfig } from "vite";

export default defineConfig({
  root: "./src",
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api/ocp": "http://127.0.0.1:8788",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
