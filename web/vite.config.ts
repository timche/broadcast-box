import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import { defineConfig, type Plugin } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Load the shared root env files (backend + dev-proxy config) the same way the
// original frontend did, so `HTTP_ADDRESS` / `USE_SSL` drive the /api proxy.
for (const envFile of ["../.env.development", "../.env.production"]) {
  const filePath = path.resolve(rootDir, envFile);
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: [filePath, "../.env"] });
    break;
  }
}

let targetHostAddress = process.env.HTTP_ADDRESS || "localhost:8080";
let targetProtocol = "http://";

if (targetHostAddress.startsWith(":")) {
  targetHostAddress = `localhost${targetHostAddress}`;
}

if (process.env.USE_SSL === "TRUE") {
  targetProtocol = "https://";
  const currentTarget = targetHostAddress.split(":");
  if (currentTarget.length === 1) {
    targetHostAddress += "443";
  } else {
    targetHostAddress = targetHostAddress.replace(currentTarget[1], "443");
  }
}

console.log(`Target Backend: ${targetProtocol}${targetHostAddress}`);

// Named `.json` rather than `.webmanifest`: the Go server types static files
// from the extension, and only the former is guaranteed to come back as JSON.
const MANIFEST_FILE = "manifest.json";
/** Matches the icon background, so the splash screen doesn't flash. */
const BRAND_COLOR = "#111214";

/**
 * Emits the web app manifest. It is generated rather than checked in because
 * the installed app's name has to follow `VITE_SITE_NAME`, same as the header
 * and the document title.
 */
function webAppManifest(): Plugin {
  const siteName = process.env.VITE_SITE_NAME?.trim() || "Broadcast Box";
  const manifest = JSON.stringify(
    {
      name: siteName,
      short_name: siteName,
      description: "Watch and broadcast low-latency WebRTC streams.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: BRAND_COLOR,
      theme_color: BRAND_COLOR,
      // Declared maskable as well as any: the artwork is full-bleed, and
      // without it Android shrinks the icon onto a white plate instead of
      // filling the tile. A round mask trims the corners of the room.
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    null,
    2,
  );

  return {
    name: "broadcast-box:web-app-manifest",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== `/${MANIFEST_FILE}`) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/manifest+json");
        response.end(manifest);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: MANIFEST_FILE, source: manifest });
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    webAppManifest(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  server: {
    host: targetHostAddress.split(":")[0] || "localhost",
    open: true,
    proxy: {
      "/api": {
        target: `${targetProtocol}${targetHostAddress}`,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Keep Server-Sent Events flowing through the dev proxy unbuffered.
            if (req.headers.accept === "text/event-stream") {
              proxyReq.setHeader("Connection", "keep-alive");
              proxyReq.setHeader("Cache-Control", "no-cache");
              proxyReq.setHeader("X-Accel-Buffering", "no");
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "build",
  },
  envDir: "../",
  // Expose both prefixes for backwards compatibility with existing .env files.
  envPrefix: ["REACT_", "VITE_"],
});
