import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http, isAddress, parseAbiItem, type Address } from "viem";
import { evmChain, rpcCandidates, treasuryHome } from "./chains.js";

/** USDC on Base. Kept for the Base treasury address default. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** SessionTreasury on Base. One transfer funds many games. */
export const DEPOSIT_ADDRESS = "0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c" as const;

/** $1.00 USDC, shown as the deposit example. Any amount sent is credited. */
export const SUGGESTED_DEPOSIT = 1_000_000n;

/** $0.05 USDC moves from the loser to the winner after a decisive game. */
export const STAKE_USDC = 50_000n;

export const DEPOSIT_USD = "$1.00";
export const STAKE_USD = "$0.05";

/** Existing Base CCIP message for the cross-chain USDC lane. */
export const BASE_CCIP_TX_URL =
  "https://ccip.chain.link/msg/0xffa95e81e2a89a55f2f9352e7930f07c97157646558135c5000d420e81cf915d";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** How far back a deposit check looks. Base produces blocks fast enough that a short block count misses a same-day transfer. */
const DEPOSIT_WINDOW_SEC = 3n * 24n * 60n * 60n;
/** Smallest block span a deposit check walks, so a same-day transfer is not missed when blocks are fast. */
const MIN_DEPOSIT_BLOCKS = 49_000n;
/** Public Base RPCs reject a getLogs span much wider than this. */
const BASE_LOG_SPAN = 49_000n;
/** Optimism's official RPC rejects eth_getLogs ranges wider than 10,000 blocks. */
const OPTIMISM_LOG_SPAN = 9_000n;
/** Parallel log pages. A 3-day Optimism window is about fifteen pages, and the check has to finish inside the client timeout. */
const LOG_CONCURRENCY = 4;

/**
 * First block to scan for a deposit. Uses the recent block time so the window stays three days
 * when blocks are faster than one every two seconds.
 */
export function depositFromBlock(
  latest: bigint,
  headTime: bigint,
  sampleBlock: bigint,
  sampleTime: bigint,
): bigint {
  const blockSpan = latest - sampleBlock;
  const timeSpan = headTime - sampleTime;
  let blocks = 400_000n;
  if (blockSpan > 0n && timeSpan > 0n) {
    blocks = (blockSpan * DEPOSIT_WINDOW_SEC + timeSpan - 1n) / timeSpan;
  }
  if (blocks < MIN_DEPOSIT_BLOCKS) blocks = MIN_DEPOSIT_BLOCKS;
  if (blocks > 1_500_000n) blocks = 1_500_000n;
  return latest > blocks ? latest - blocks : 0n;
}

/** Page size for eth_getLogs on this chain. Wider pages are rejected by the public RPC. */
export function logSpan(chainId: number): bigint {
  return chainId === 10 ? OPTIMISM_LOG_SPAN : BASE_LOG_SPAN;
}

/** Inclusive block pages of at most `span` blocks, covering `fromBlock` through `latest`. */
export function logRanges(
  fromBlock: bigint,
  latest: bigint,
  span: bigint,
): Array<{ from: bigint; to: bigint }> {
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  const size = span > 0n ? span : 1n;
  let cursor = fromBlock;
  while (cursor <= latest) {
    const end = cursor + size - 1n > latest ? latest : cursor + size - 1n;
    ranges.push({ from: cursor, to: end });
    if (end === latest) break;
    cursor = end + 1n;
  }
  return ranges;
}

export function depositAddress(): Address {
  const raw = process.env.SESSION_TREASURY_ADDRESS?.trim();
  if (raw && isAddress(raw)) return raw;
  return DEPOSIT_ADDRESS;
}

export function formatUsdc(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}

/** Claude plays from Optimism. Cursor plays from Base. An explicit chainId wins. */
export function stakeChain(identity?: { host?: string; chainId?: number } | null): number {
  if (typeof identity?.chainId === "number" && identity.chainId > 0) return identity.chainId;
  return identity?.host === "claude" ? 10 : 8453;
}

export function chainLabel(chainId?: number): string {
  switch (chainId) {
    case 1:
      return "Ethereum";
    case 8453:
      return "Base";
    case 42161:
      return "Arbitrum";
    case 10:
      return "Optimism";
    case 137:
      return "Polygon";
    case 84532:
      return "Base Sepolia";
    case 11155111:
      return "Ethereum Sepolia";
    default:
      return "chain";
  }
}

export function transferHref(fromChain: string, toChain: string): string | null {
  if (fromChain === toChain || (fromChain !== "Base" && toChain !== "Base")) return null;
  return BASE_CCIP_TX_URL;
}

const TX_EXPLORER: Record<string, string> = {
  Ethereum: "https://etherscan.io/tx/",
  Base: "https://basescan.org/tx/",
  Arbitrum: "https://arbiscan.io/tx/",
  Optimism: "https://optimistic.etherscan.io/tx/",
  Polygon: "https://polygonscan.com/tx/",
};

/** Explorer link for a send on that chain. */
export function txHref(chainName: string, txHash: string): string | null {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return null;
  const base = TX_EXPLORER[chainName];
  return base ? `${base}${txHash}` : null;
}

/** CCIP explorer link for a cross-chain send. */
export function ccipHref(messageId?: string): string | null {
  if (!messageId || !/^0x[a-fA-F0-9]{64}$/.test(messageId) || /^0x0{64}$/.test(messageId)) return null;
  return `https://ccip.chain.link/msg/${messageId}`;
}

/** The link to show after a claim: the CCIP message when the send crosses chains, otherwise the chain transaction. */
export function payoutReceipt(
  paid: { txHash: string; chainName: string; messageId?: string },
  usd: string,
): { txHash: string; chainName: string; usd: string; href: string; ccipHref: string | null } | null {
  const href = txHref(paid.chainName, paid.txHash);
  if (!href) return null;
  return {
    txHash: paid.txHash,
    chainName: paid.chainName,
    usd,
    href,
    ccipHref: ccipHref(paid.messageId),
  };
}

export function transferLine(you: "won" | "lost" | "short", fromChain: string, toChain: string): string {
  if (you === "short") return `Deposit ${DEPOSIT_USD} USDC to cover the ${STAKE_USD}.`;
  const href = transferHref(fromChain, toChain);
  if (href) {
    const direction = you === "won"
      ? `from their ${fromChain} to your ${toChain}`
      : `from your ${fromChain} to their ${toChain}`;
    return `CCIP transaction: cross-chain transfer ${direction}. ${href}`;
  }
  if (you === "won") return `${STAKE_USD} from their ${fromChain} to your ${toChain}.`;
  return `${STAKE_USD} from your ${fromChain} to their ${toChain}.`;
}

export interface DepositRow {
  txHash: string;
  amount: bigint;
}

export type DepositReader = (wallet: Address, chainId: number) => Promise<DepositRow[]>;

/** USDC transfers from `wallet` to the treasury on `chainId`. */
export async function readUsdcDeposits(wallet: Address, chainId: number): Promise<DepositRow[]> {
  const home = treasuryHome(chainId);
  if (!isAddress(wallet)) throw new Error("Deposit check needs a wallet.");
  if (!home) {
    throw new Error(
      `Deposit $1.00 USDC on Base or Optimism. ${chainLabel(chainId)} has no treasury yet, and a claim there is sent over CCIP.`,
    );
  }
  const chain = evmChain(chainId);
  let lastDetail = "request failed";
  for (const rpc of rpcCandidates(chainId)) {
    try {
      const client = createPublicClient({ chain, transport: http(rpc) });
      const latest = await client.getBlockNumber();
      const head = await client.getBlock({ blockNumber: latest });
      const sampleBlock = latest > 2_000n ? latest - 2_000n : 0n;
      const sample = sampleBlock === latest ? head : await client.getBlock({ blockNumber: sampleBlock });
      const fromBlock = depositFromBlock(latest, head.timestamp, sampleBlock, sample.timestamp);
      const ranges = logRanges(fromBlock, latest, logSpan(chainId));
      const pages = await mapPool(ranges, LOG_CONCURRENCY, (range) =>
        client.getLogs({
          address: home.usdc,
          event: TRANSFER,
          args: { from: wallet, to: home.address },
          fromBlock: range.from,
          toBlock: range.to,
        }),
      );
      const rows: DepositRow[] = [];
      for (const logs of pages) {
        for (const log of logs) {
          if (!log.transactionHash || log.args.value == null) continue;
          rows.push({ txHash: log.transactionHash, amount: log.args.value });
        }
      }
      return rows;
    } catch (err) {
      const detail = err instanceof Error ? err.message : "request failed";
      lastDetail = detail.split("\n")[0]?.slice(0, 180) || "request failed";
    }
  }
  throw new Error(`Could not read the ${home.name} deposit (${lastDetail}).`);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}

interface SavedBank {
  balances: Record<string, string>;
  seen: string[];
}

/**
 * Play balances held by the Base treasury.
 * A deposit is credited once. A loss moves $0.05 to the winner. Claim pays the remainder.
 */
export class PlayBank {
  private balances = new Map<string, bigint>();
  private seen = new Set<string>();
  private claiming = new Set<string>();

  constructor(
    private readonly file: string | null = null,
    private readonly readDeposits: DepositReader = readUsdcDeposits,
  ) {
    this.load();
  }

  static open(file: string): PlayBank {
    return new PlayBank(file);
  }

  balanceOf(wallet: string, chainId = 8453): bigint {
    return this.balances.get(this.slot(wallet, chainId)) ?? 0n;
  }

  credit(wallet: string, txHash: string, amount: bigint, chainId = 8453): boolean {
    if (amount <= 0n || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) return false;
    const hash = txHash.toLowerCase();
    if (this.seen.has(hash)) return false;
    const id = this.slot(wallet, chainId);
    this.seen.add(hash);
    this.balances.set(id, (this.balances.get(id) ?? 0n) + amount);
    this.save();
    return true;
  }

  /** Move `amount` from the loser's chain balance to the winner's chain balance. */
  take(loser: string, winner: string, amount: bigint, fromChain = 8453, toChain = 8453): boolean {
    const from = this.slot(loser, fromChain);
    const to = this.slot(winner, toChain);
    if (from === to || amount <= 0n) return false;
    const have = this.balances.get(from) ?? 0n;
    if (have < amount) return false;
    this.balances.set(from, have - amount);
    this.balances.set(to, (this.balances.get(to) ?? 0n) + amount);
    this.save();
    return true;
  }

  reserveClaim(wallet: string, chainId = 8453): bigint {
    const id = this.slot(wallet, chainId);
    if (this.claiming.has(id)) throw new Error("Claim already in progress.");
    const amount = this.balances.get(id) ?? 0n;
    if (amount <= 0n) return 0n;
    this.claiming.add(id);
    this.balances.set(id, 0n);
    this.save();
    return amount;
  }

  restore(wallet: string, amount: bigint, chainId = 8453): void {
    const id = this.slot(wallet, chainId);
    this.claiming.delete(id);
    if (amount <= 0n) return;
    this.balances.set(id, (this.balances.get(id) ?? 0n) + amount);
    this.save();
  }

  finishClaim(wallet: string, chainId = 8453): void {
    this.claiming.delete(this.slot(wallet, chainId));
  }

  async pull(wallet: Address, chainId = 8453): Promise<{ added: number; chains: string[] }> {
    const home = treasuryHome(chainId);
    if (!home) {
      throw new Error(
        `Deposit $1.00 USDC on Base or Optimism. ${chainLabel(chainId)} has no treasury yet, and a claim there is sent over CCIP.`,
      );
    }
    const rows = await this.readDeposits(wallet, chainId);
    let added = 0;
    for (const row of rows) {
      if (this.credit(wallet, row.txHash, row.amount, chainId)) added += 1;
    }
    return { added, chains: added > 0 ? [home.name] : [] };
  }

  private slot(wallet: string, chainId: number): string {
    return `${chainId}:${wallet.toLowerCase()}`;
  }

  private load(): void {
    if (!this.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<SavedBank>;
      let legacy = false;
      for (const [key, units] of Object.entries(raw.balances ?? {})) {
        if (typeof units !== "string" || !/^\d+$/.test(units)) continue;
        if (/^\d+:0x[a-fA-F0-9]{40}$/.test(key)) {
          this.balances.set(key.toLowerCase(), BigInt(units));
          continue;
        }
        if (/^0x[a-fA-F0-9]{40}$/.test(key)) legacy = true;
      }
      if (!legacy) {
        for (const hash of raw.seen ?? []) {
          if (typeof hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(hash)) this.seen.add(hash.toLowerCase());
        }
      }
    } catch {
      /* first run, or a file that is not a bank */
    }
  }

  private save(): void {
    if (!this.file) return;
    const balances: Record<string, string> = {};
    for (const [wallet, units] of this.balances) balances[wallet] = units.toString();
    const body: SavedBank = { balances, seen: [...this.seen] };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(body, null, 2));
  }
}
