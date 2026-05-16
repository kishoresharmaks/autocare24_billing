import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  // Electron loads the renderer from file://, so relative asset URLs are intentional.
  // Change this before serving the same build from a web sub-path.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
