import { isAddress, type Address, type Chain } from "viem";
import { base, mainnet, optimism } from "viem/chains";

/** SessionTreasury on Base. */
const BASE_TREASURY = "0xE2ca5C8ed8589Dc61abE1B2c2Dae309d2f86410c";

/** USDC on each mainnet. Deposits are transfers of that token to the treasury on the same chain. */
export const USDC: Record<number, Address> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
};

/**
 * Treasury deployed on Ethereum. Empty until DeployTreasuryEthereum lands.
 * SESSION_TREASURY_ETHEREUM overrides this.
 */
export const ETHEREUM_TREASURY = "" as Address | "";

/** Treasury on Optimism. SESSION_TREASURY_OPTIMISM overrides this. */
export const OPTIMISM_TREASURY = "0x2aa139d40b57560EE8bAa94325cfdc5a7721DE3f" as Address;

export function evmChain(chainId: number): Chain {
  if (chainId === 1) return mainnet;
  if (chainId === 10) return optimism;
  return base;
}

export interface TreasuryHome {
  chainId: number;
  name: string;
  selector: bigint;
  usdc: Address;
  address: Address;
  rpc: string;
}

function addressFrom(envName: string, fallback: string): Address | null {
  const raw = process.env[envName]?.trim() || fallback;
  return raw && isAddress(raw) ? raw : null;
}

/** RPCs that answer eth_getLogs. The env URL is a backup, because the public Base URL rate-limits. */
export function rpcCandidates(chainId: number): string[] {
  const preferred =
    chainId === 10
      ? ["https://mainnet.optimism.io", "https://optimism.llamarpc.com"]
      : chainId === 1
        ? ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"]
        : ["https://base-rpc.publicnode.com", "https://base.llamarpc.com"];
  const envName = chainId === 10 ? "OPTIMISM_RPC_URL" : chainId === 1 ? "ETHEREUM_RPC_URL" : "BASE_RPC_URL";
  const env = process.env[envName]?.trim();
  return [...new Set([...preferred, env].filter((item): item is string => Boolean(item)))];
}

/** A chain the player can deposit on. Claim on any mainnet can still be paid from one of these. */
export function treasuryHome(chainId: number): TreasuryHome | null {
  if (chainId === 8453) {
    const address = addressFrom("SESSION_TREASURY_ADDRESS", BASE_TREASURY);
    if (!address) return null;
    return {
      chainId,
      name: "Base",
      selector: 15971525489660198786n,
      usdc: USDC[8453],
      address,
      rpc: rpcCandidates(chainId)[0],
    };
  }
  if (chainId === 10) {
    const address = addressFrom("SESSION_TREASURY_OPTIMISM", OPTIMISM_TREASURY);
    if (!address) return null;
    return {
      chainId,
      name: "Optimism",
      selector: 3734403246176062136n,
      usdc: USDC[10],
      address,
      rpc: rpcCandidates(chainId)[0],
    };
  }
  if (chainId === 1) {
    const address = addressFrom("SESSION_TREASURY_ETHEREUM", ETHEREUM_TREASURY);
    if (!address) return null;
    return {
      chainId,
      name: "Ethereum",
      selector: 5009297550715157269n,
      usdc: USDC[1],
      address,
      rpc: rpcCandidates(chainId)[0],
    };
  }
  return null;
}

export function treasuryHomes(): TreasuryHome[] {
  return [8453, 10, 1].map((id) => treasuryHome(id)).filter((home): home is TreasuryHome => home != null);
}
