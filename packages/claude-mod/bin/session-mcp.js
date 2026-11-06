#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "../../core/dist/mcp/cli.js");
process.env.SESSION_HOST = process.env.SESSION_HOST ?? "claude";
await import(pathToFileURL(cli).href);
