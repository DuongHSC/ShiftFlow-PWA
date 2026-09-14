import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// Base path is configurable for GitHub Pages project sites.
// For a project page hosted at https://<user>.github.io/ShiftFlow-PWA/,
// set SHIFTFLOW_BASE=/ShiftFlow-PWA/ at build time.
// Defaults to "/" for local dev / preview and user/organization pages.
const base = process.env.SHIFTFLOW_BASE ?? "/";

export default defineConfig({
  base,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/icon.svg"],
      manifest: {
        name: "ShiftFlow",
        short_name: "ShiftFlow",
        description: "Local-first personal shift management.",
        theme_color: "#2f6feb",
        background_color: "#f5f6f8",
        display: "standalone",
        orientation: "portrait",
        start_url: base,
        scope: base,
        // SVG icons keep the repo binary-free and are supported by the web app
        // manifest. A rasterized PNG set can be added in M2 for broader coverage.
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Cache the built app shell (content-hashed). User data lives in
        // IndexedDB and is never cached here.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: base + "index.html",
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
