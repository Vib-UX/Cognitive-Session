import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { evmChain, treasuryHomes, type TreasuryHome } from "./chains.js";

/** CCIP chain selectors. Base pays in place; the others are CCIP 2.0 lanes from Base. */
export const MAINNET_LANES = {
  1: { name: "Ethereum", selector: 5009297550715157269n },
  8453: { name: "Base", selector: 15971525489660198786n },
  42161: { name: "Arbitrum", selector: 4949039107694359620n },
  10: { name: "Optimism", selector: 3734403246176062136n },
  137: { name: "Polygon", selector: 4051577828743386545n },
} as const;

export type MainnetChainId = keyof typeof MAINNET_LANES;

const TREASURY_ABI = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "destChainSelector", type: "uint64" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "extraArgs", type: "bytes" },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    type: "function",
    name: "sendReward",
    stateMutability: "payable",
    inputs: [
      { name: "destChainSelector", type: "uint64" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "extraArgs", type: "bytes" },
    ],
    outputs: [{ name: "messageId", type: "bytes32" }],
  },
] as const;

const BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function clientChain(chainId: number) {
  return evmChain(chainId);
}

async function usdcBalance(home: TreasuryHome): Promise<bigint> {
  const client = createPublicClient({ chain: clientChain(home.chainId), transport: http(home.rpc) });
  return client.readContract({
    address: home.usdc,
    abi: BALANCE_ABI,
    functionName: "balanceOf",
    args: [home.address],
  });
}

/** Prefer the treasury on the chain they asked for. Otherwise CCIP from a treasury that holds the USDC. */
export function choosePayout(destChainId: number, funded: { chainId: number; balance: bigint }[], amount: bigint): number | null {
  const local = funded.find((row) => row.chainId === destChainId && row.balance >= amount);
  if (local) return local.chainId;
  const remote = funded.find((row) => row.balance >= amount);
  return remote ? remote.chainId : null;
}

export function laneForChain(chainId: number) {
  if (!Object.prototype.hasOwnProperty.call(MAINNET_LANES, chainId)) return null;
  return MAINNET_LANES[chainId as MainnetChainId];
}

/** 1 cent of credit is 0.01 USDC. USDC has 6 decimals. */
export function centsToUsdc(cents: number): bigint {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Reward amount must be a positive number of cents");
  }
  return BigInt(cents) * 10_000n;
}

/** Basic CCIP 2.0 ExtraArgsV3: gas limit 0, finalized finality, default verifiers. */
/**
 * Packed ExtraArgsV3 from ExtraArgsCodec._getBasicEncodedExtraArgsV3(0, 0):
 * tag, uint32 gas 0, bytes4 finality 0, then 7 zero bytes for empty CCV/executor/token fields.
 */
export function extraArgsV3(): Hex {
  return "0xa69dd4aa00000000000000000000000000000000";
}

const spent = new Map<string, { day: string; units: bigint }>();

function maxUnits(): bigint {
  const raw = process.env.TREASURY_MAX_UNITS?.trim();
  if (!raw) return 3_000_000n;
  return BigInt(raw);
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function reserve(wallet: string, amount: bigint): () => void {
  const max = maxUnits();
  if (amount <= 0n || amount > max) {
    throw new Error("Reward is above the treasury cap");
  }
  const key = wallet.toLowerCase();
  const today = dayKey();
  const row = spent.get(key);
  const used = row && row.day === today ? row.units : 0n;
  if (used + amount > max) {
    throw new Error("Daily USDC reward cap reached for this wallet");
  }
  spent.set(key, { day: today, units: used + amount });
  return () => {
    const current = spent.get(key);
    if (!current || current.day !== today) return;
    const next = current.units - amount;
    spent.set(key, { day: today, units: next > 0n ? next : 0n });
  };
}

export function treasuryConfigured(): boolean {
  return Boolean(process.env.TREASURY_PRIVATE_KEY?.trim() && treasuryHomes().length > 0);
}

export async function payReward(input: {
  wallet: string;
  chainId: number;
  amount: bigint;
}): Promise<{ txHash: Hex; chainId: number; amount: string; chainName: string }> {
  if (!treasuryConfigured()) {
    throw new Error("Treasury is not configured on the relay");
  }
  if (!isAddress(input.wallet)) throw new Error("Wallet is not an address");
  const lane = laneForChain(input.chainId);
  if (!lane) {
    throw new Error("Rewards pay USDC on Ethereum, Base, Arbitrum, Optimism, or Polygon");
  }

  const homes = treasuryHomes();
  const funded = [];
  for (const home of homes) {
    funded.push({ chainId: home.chainId, balance: await usdcBalance(home) });
  }
  const sourceId = choosePayout(input.chainId, funded, input.amount);
  const source = homes.find((home) => home.chainId === sourceId);
  if (!source) {
    throw new Error("The treasuries do not hold enough USDC on one chain to pay this claim.");
  }

  const release = reserve(input.wallet, input.amount);
  try {
    const rawKey = process.env.TREASURY_PRIVATE_KEY!.trim();
    const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex);
    const chain = clientChain(source.chainId);
    const transport = http(source.rpc);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });
    const extraArgs = extraArgsV3();
    const recipient = input.wallet as Address;
    const fee = await publicClient.readContract({
      address: source.address,
      abi: TREASURY_ABI,
      functionName: "quote",
      args: [lane.selector, recipient, input.amount, extraArgs],
    });
    const txHash = await walletClient.writeContract({
      address: source.address,
      abi: TREASURY_ABI,
      functionName: "sendReward",
      args: [lane.selector, recipient, input.amount, extraArgs],
      value: fee,
    });
    return {
      txHash,
      chainId: input.chainId,
      amount: input.amount.toString(),
      chainName: lane.name,
    };
  } catch (err) {
    release();
    throw err;
  }
}
