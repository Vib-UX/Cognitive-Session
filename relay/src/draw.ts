import { spawn } from "node:child_process";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbiItem, stringToBytes } from "viem";
import { base } from "viem/chains";
import type { SessionId } from "./types.js";

const fulfilled = parseAbiItem(
  "event DrawFulfilled(bytes32 indexed pairId, uint256 indexed requestId, uint256 word, bool whiteIsFirst)",
);

let cursor: bigint | undefined;

export function matchDrawAddress(): `0x${string}` | null {
  const raw = process.env.SESSION_MATCH_DRAW_ADDRESS?.trim();
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

/** keccak256 of the raw session id. The workflow hashes the same way. */
export function sessionHash(id: string): `0x${string}` {
  return keccak256(stringToBytes(id));
}

export function makePairId(first: SessionId, second: SessionId): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint256" }],
      [first, second, BigInt(Date.now())],
    ),
  );
}

/** Even word: the player who waited (first) is white. */
export function whiteIsFirst(word: bigint): boolean {
  return word % 2n === 0n;
}

export function kickWorkflow(body: { pairId: `0x${string}`; first: SessionId; second: SessionId }): void {
  if (process.env.CRE_SIMULATE !== "1") return;
  const payload = JSON.stringify({
    pairId: body.pairId,
    first: body.first,
    second: body.second,
    firstHash: sessionHash(body.first),
    secondHash: sessionHash(body.second),
  });
  const child = spawn(
    "cre",
    [
      "workflow",
      "simulate",
      ".",
      "--non-interactive",
      "--trigger-index",
      "0",
      "--http-payload",
      payload,
      "--target",
      process.env.CRE_TARGET || "base",
      ...(process.env.CRE_BROADCAST === "1" ? ["--broadcast"] : []),
    ],
    {
      cwd: process.env.CRE_WORKFLOW_DIR || "cre/match-draw",
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
}

export async function pollDraws(): Promise<{ pairId: `0x${string}`; word: bigint }[]> {
  const address = matchDrawAddress();
  if (!address) return [];
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });
  const latest = await client.getBlockNumber();
  if (cursor === undefined) {
    cursor = latest;
    return [];
  }
  const from = cursor;
  const logs = await client.getLogs({
    address,
    event: fulfilled,
    fromBlock: from,
    toBlock: latest,
  });
  cursor = latest + 1n;
  return logs.flatMap((log) => {
    const pairId = log.args.pairId;
    const word = log.args.word;
    if (!pairId || word === undefined) return [];
    return [{ pairId, word }];
  });
}
