import { defineConfig } from "vite";

// `base: "./"` keeps every asset path relative, which is what portals like
// CrazyGames / itch require when they serve the build from a nested folder.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    host: true,
    port: 5173,
  },
});
