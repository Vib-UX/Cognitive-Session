#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundled = join(here, "../vendor/mcp/server.js");
const workspace = join(here, "../../core/dist/mcp/server.js");
const file = existsSync(bundled) ? bundled : workspace;
if (!existsSync(file)) {
  console.error("Session core is missing. Reinstall @hlvuser/session.");
  process.exit(1);
}

const { runSessionMcp } = await import(pathToFileURL(file).href);
runSessionMcp({
  host: process.env.SESSION_HOST ?? "claude",
  displayName: process.env.SESSION_DISPLAY_NAME,
  relayUrl: process.env.SESSION_RELAY_URL,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
