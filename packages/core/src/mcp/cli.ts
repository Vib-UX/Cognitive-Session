#!/usr/bin/env node
import { runSessionMcp } from "./server.js";
import type { HostKind } from "../types.js";

const host = (process.env.SESSION_HOST ?? "cursor") as HostKind;
const displayName = process.env.SESSION_DISPLAY_NAME;
const relayUrl = process.env.SESSION_RELAY_URL;

runSessionMcp({ host, displayName, relayUrl }).catch((err) => {
  console.error(err);
  process.exit(1);
});
