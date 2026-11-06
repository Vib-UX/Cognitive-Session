import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

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

const spent = new Map<string, { day: string; units: bigint }>();

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
  return Boolean(process.env.TREASURY_PRIVATE_KEY?.trim() && process.env.SESSION_TREASURY_ADDRESS?.trim());
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

  const release = reserve(input.wallet, input.amount);
  try {
    const rawKey = process.env.TREASURY_PRIVATE_KEY!.trim();
    const account = privateKeyToAccount((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex);
    const treasury = process.env.SESSION_TREASURY_ADDRESS!.trim() as Address;
    const transport = http(process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org");
    const publicClient = createPublicClient({ chain: base, transport });
    const walletClient = createWalletClient({ account, chain: base, transport });
    const extraArgs = extraArgsV3();
    const recipient = input.wallet as Address;
    const fee = await publicClient.readContract({
      address: treasury,
      abi: TREASURY_ABI,
      functionName: "quote",
      args: [lane.selector, recipient, input.amount, extraArgs],
    });
    const txHash = await walletClient.writeContract({
      address: treasury,
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
