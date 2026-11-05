import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HostKind, SessionId, SessionIdentity } from "./types.js";

function dataDir(host: HostKind): string {
  const override = process.env.SESSION_DATA_DIR;
  if (override) return override;
  const base =
    process.env.CLAUDE_PLUGIN_DATA ??
    process.env.CURSOR_PLUGIN_DATA ??
    join(homedir(), ".session");
  return join(base, host);
}

function newSessionId(): SessionId {
  return `sess_${randomBytes(4).toString("hex")}` as SessionId;
}

export function loadOrCreateIdentity(
  host: HostKind,
  displayName?: string,
): SessionIdentity {
  const dir = dataDir(host);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "identity.json");

  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SessionIdentity;
    if (displayName && displayName !== raw.displayName) {
      raw.displayName = displayName;
      writeFileSync(path, JSON.stringify(raw, null, 2));
    }
    return raw;
  }

  const identity: SessionIdentity = {
    id: newSessionId(),
    displayName: displayName ?? `${host}-${randomBytes(2).toString("hex")}`,
    host,
  };
  writeFileSync(path, JSON.stringify(identity, null, 2));
  return identity;
}

export function saveIdentity(identity: SessionIdentity): void {
  const dir = dataDir(identity.host);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "identity.json"), JSON.stringify(identity, null, 2));
}
