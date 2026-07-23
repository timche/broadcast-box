import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import { defineConfig } from "vite";

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

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
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
