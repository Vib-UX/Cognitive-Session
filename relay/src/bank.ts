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
      const lookback = 20_000n;
      const chunk = 1_999n;
      let cursor = latest > lookback ? latest - lookback : 0n;
      const rows: DepositRow[] = [];
      while (cursor <= latest) {
        const end = cursor + chunk > latest ? latest : cursor + chunk;
        const logs = await client.getLogs({
          address: home.usdc,
          event: TRANSFER,
          args: { from: wallet, to: home.address },
          fromBlock: cursor,
          toBlock: end,
        });
        for (const log of logs) {
          if (!log.transactionHash || log.args.value == null) continue;
          rows.push({ txHash: log.transactionHash, amount: log.args.value });
        }
        if (end === latest) break;
        cursor = end + 1n;
      }
      return rows;
    } catch (err) {
      const detail = err instanceof Error ? err.message : "request failed";
      lastDetail = detail.split("\n")[0]?.slice(0, 180) || "request failed";
    }
  }
  throw new Error(`Could not read the ${home.name} deposit (${lastDetail}).`);
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
