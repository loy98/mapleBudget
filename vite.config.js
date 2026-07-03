import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "메이플 MVP작 효율 계산기",
        short_name: "MVP작 계산기",
        description: "메이플스토리 MVP 등급작(엠작) 최적 비용 계산기 · 거래 기록 · 13주 달력",
        lang: "ko",
        theme_color: "#0b0e15",
        background_color: "#0b0e15",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      }
    })
  ]
});
