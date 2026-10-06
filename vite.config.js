import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Relative production URLs work at /Trade-timer/ and on other static hosts.
export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      registerType: "prompt",
      // The application handles registration and only reloads after an explicit update.
      injectRegister: false,
      includeAssets: ["icon.svg", "apple-touch-icon.png", "icons/*.png"],
      manifest: {
        id: "./",
        name: "Trade Timer — Job charge-up",
        short_name: "Trade Timer",
        description: "Track job labour, materials and charge-up totals in NZD.",
        lang: "en-NZ",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f6f7f3",
        theme_color: "#183d35",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"],
        navigateFallback: "index.html",
        // Precache only the app shell: authenticated cloud data never enters SW caches.
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
});
