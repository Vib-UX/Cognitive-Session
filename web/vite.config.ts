import { createReadStream, existsSync, statSync, copyFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const vsixName = "session-ide-0.1.0.vsix";
const vsixPath = path.resolve(webRoot, "../packages/cursor-extension", vsixName);

function vsixPlugin(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split("?")[0];
    if (url !== `/${vsixName}`) return next();
    sendVsix(req, res);
  };
  return {
    name: "session-vsix",
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
    closeBundle() {
      if (!existsSync(vsixPath)) return;
      copyFileSync(vsixPath, path.join(webRoot, "dist", vsixName));
    },
  };
}

function sendVsix(_req: IncomingMessage, res: ServerResponse) {
  if (!existsSync(vsixPath)) {
    res.statusCode = 404;
    res.end("The extension file is not in this build.");
    return;
  }
  const { size } = statSync(vsixPath);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", size);
  res.setHeader("Content-Disposition", `attachment; filename="${vsixName}"`);
  createReadStream(vsixPath).pipe(res);
}

export default defineConfig({
  plugins: [react(), vsixPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/presence": "https://sessionrelay-production.up.railway.app",
      "/health": "https://sessionrelay-production.up.railway.app",
      "/ws": {
        target: "http://127.0.0.1:47831",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
