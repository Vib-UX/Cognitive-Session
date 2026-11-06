/**
 * Optional Arkiv sync. When SESSION_ARKIV_RPC is set, the relay mirrors
 * challenges, rooms, and finished matches as expiring entities.
 */

export async function syncEntity(entity: {
  id: string;
  kind: string;
  owner: string;
  expiresAt: number;
  payload: Record<string, unknown>;
}): Promise<void> {
  const rpc = process.env.SESSION_ARKIV_RPC;
  if (!rpc) return;
  try {
    await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "arkiv_upsertEntity",
        params: [{ namespace: "session", ...entity }],
      }),
    });
  } catch (err) {
    console.warn("[arkiv] sync failed", err);
  }
}
