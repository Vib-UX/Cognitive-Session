/**
 * Arkiv lobby client.
 *
 * Challenges, rooms, and finished matches become Arkiv entities with an owner
 * and an expiry. Live chess moves stay on the relay.
 *
 * When SESSION_ARKIV_RPC is unset, this falls back to an in-memory store so
 * local demos and unit tests still work.
 */

export type ArkivEntityKind = "challenge" | "room" | "match";

export interface ArkivEntity {
  id: string;
  kind: ArkivEntityKind;
  owner: string;
  expiresAt: number;
  payload: Record<string, unknown>;
}

export interface ArkivClientOptions {
  rpcUrl?: string;
  privateKey?: string;
  namespace?: string;
}

const memory = new Map<string, ArkivEntity>();

export class ArkivLobby {
  readonly rpcUrl?: string;
  readonly namespace: string;

  constructor(opts: ArkivClientOptions = {}) {
    this.rpcUrl = opts.rpcUrl ?? process.env.SESSION_ARKIV_RPC;
    this.namespace = opts.namespace ?? "session";
  }

  get enabled(): boolean {
    return Boolean(this.rpcUrl);
  }

  async upsert(entity: ArkivEntity): Promise<ArkivEntity> {
    if (!this.rpcUrl) {
      memory.set(entity.id, entity);
      return entity;
    }
    // Production path: write via Arkiv JSON-RPC / SDK.
    // Kept behind the env flag so the demo works offline.
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "arkiv_upsertEntity",
        params: [
          {
            namespace: this.namespace,
            id: entity.id,
            kind: entity.kind,
            owner: entity.owner,
            expiresAt: entity.expiresAt,
            payload: entity.payload,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Arkiv upsert failed: ${res.status}`);
    return entity;
  }

  async query(kind?: ArkivEntityKind): Promise<ArkivEntity[]> {
    const now = Date.now();
    if (!this.rpcUrl) {
      return [...memory.values()].filter(
        (e) => e.expiresAt > now && (!kind || e.kind === kind),
      );
    }
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "arkiv_queryEntities",
        params: [{ namespace: this.namespace, kind, now }],
      }),
    });
    if (!res.ok) throw new Error(`Arkiv query failed: ${res.status}`);
    const body = (await res.json()) as { result?: ArkivEntity[] };
    return (body.result ?? []).filter((e) => e.expiresAt > now);
  }

  async refreshExpiry(id: string, expiresAt: number): Promise<void> {
    if (!this.rpcUrl) {
      const existing = memory.get(id);
      if (existing) memory.set(id, { ...existing, expiresAt });
      return;
    }
    await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "arkiv_refreshExpiry",
        params: [{ namespace: this.namespace, id, expiresAt }],
      }),
    });
  }
}

export function challengeEntity(input: {
  id: string;
  owner: string;
  from: string;
  fromName: string;
  to: string;
  stakeWei: string;
  ttlMs?: number;
}): ArkivEntity {
  const ttl = input.ttlMs ?? 5 * 60 * 1000;
  return {
    id: input.id,
    kind: "challenge",
    owner: input.owner,
    expiresAt: Date.now() + ttl,
    payload: {
      from: input.from,
      fromName: input.fromName,
      to: input.to,
      stakeWei: input.stakeWei,
    },
  };
}

export function roomEntity(input: {
  code: string;
  owner: string;
  members: string[];
  matchId?: string | null;
  ttlMs?: number;
}): ArkivEntity {
  return {
    id: `room_${input.code}`,
    kind: "room",
    owner: input.owner,
    expiresAt: Date.now() + (input.ttlMs ?? 60 * 60 * 1000),
    payload: {
      code: input.code,
      members: input.members,
      matchId: input.matchId ?? null,
    },
  };
}

export function matchEntity(input: {
  matchId: string;
  owner: string;
  roomCode: string;
  white: string;
  black: string;
  status: string;
  result?: unknown;
  lockTx?: string;
  ccipMessageId?: string;
  payoutTx?: string;
  ttlMs?: number;
}): ArkivEntity {
  return {
    id: input.matchId,
    kind: "match",
    owner: input.owner,
    expiresAt: Date.now() + (input.ttlMs ?? 24 * 60 * 60 * 1000),
    payload: {
      roomCode: input.roomCode,
      white: input.white,
      black: input.black,
      status: input.status,
      result: input.result ?? null,
      lockTx: input.lockTx ?? null,
      ccipMessageId: input.ccipMessageId ?? null,
      payoutTx: input.payoutTx ?? null,
    },
  };
}
