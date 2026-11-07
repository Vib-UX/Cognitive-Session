/**
 * Optional 0G Storage. When SESSION_0G_PRIVATE_KEY is set, a finished chess
 * match is uploaded as JSON. The root hash is the only handle for that file.
 */

import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import type { ChessState } from "./types.js";

const TESTNET_RPC = "https://evmrpc-testnet.0g.ai";
const TESTNET_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";

const started = new Set<string>();

export interface StoredMatch {
  rootHash: string;
  txHash: string;
}

export function matchRecord(match: ChessState): Record<string, unknown> {
  return {
    matchId: match.matchId,
    roomCode: match.roomCode,
    white: match.white,
    black: match.black,
    status: match.status,
    result: match.result ?? null,
    drawWord: match.drawWord ?? null,
    lockTx: match.lockTx ?? null,
    ccipMessageId: match.ccipMessageId ?? null,
    payoutTx: match.payoutTx ?? null,
    fen: match.fen,
    storedAt: new Date().toISOString(),
  };
}

/** Upload a finished match. Returns null when 0G is not configured. */
export async function storeFinishedMatch(match: ChessState): Promise<StoredMatch | null> {
  if (match.status !== "finished") return null;
  const privateKey = process.env.SESSION_0G_PRIVATE_KEY;
  if (!privateKey) return null;
  if (started.has(match.matchId)) return null;
  started.add(match.matchId);

  const rpc = process.env.SESSION_0G_RPC ?? TESTNET_RPC;
  const indexerUrl = process.env.SESSION_0G_INDEXER ?? TESTNET_INDEXER;

  try {
    const provider = new JsonRpcProvider(rpc);
    const signer = new Wallet(privateKey, provider);
    const indexer = new Indexer(indexerUrl);
    const file = new MemData(new TextEncoder().encode(JSON.stringify(matchRecord(match))));
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr || !tree) throw treeErr ?? new Error("missing merkle tree");

    // The SDK types pin ethers' CommonJS build. The ESM Wallet is the same signer at runtime.
    const [tx, uploadErr] = await indexer.upload(
      file,
      rpc,
      signer as unknown as Parameters<Indexer["upload"]>[2],
    );
    if (uploadErr) throw uploadErr;

    const rootHash = "rootHash" in tx ? tx.rootHash : tx.rootHashes[0];
    const txHash = "txHash" in tx ? tx.txHash : tx.txHashes[0];
    if (!rootHash || !txHash) throw new Error("0G upload returned no root");
    console.log(`[0g] match ${match.matchId} root ${rootHash} tx ${txHash}`);
    return { rootHash, txHash };
  } catch (err) {
    started.delete(match.matchId);
    console.warn("[0g] match upload failed", err);
    return null;
  }
}
