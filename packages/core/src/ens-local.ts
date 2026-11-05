/**
 * Local ENS name helpers that do not require viem at build time.
 * On-chain registration lives in scripts/ once a registry is deployed.
 */

import type { SessionIdentity } from "./types.js";
import { saveIdentity } from "./identity.js";

export function localEnsName(identity: SessionIdentity): string {
  const label =
    identity.displayName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 16) || identity.id.slice(5, 13);
  return `${label}.session.eth`;
}

export function attachLocalEns(identity: SessionIdentity): SessionIdentity {
  if (identity.ensName) return identity;
  identity.ensName = localEnsName(identity);
  saveIdentity(identity);
  return identity;
}
