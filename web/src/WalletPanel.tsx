import { useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  keccak256,
  parseEther,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
  isAddress,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import type { ChessState } from "./types";
import { SESSION_LOCK_ABI, SESSION_PAYOUT_ABI } from "./abis";

const LOCK_ADDRESS = (import.meta.env.VITE_SESSION_LOCK_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;
const PAYOUT_ADDRESS = (import.meta.env.VITE_SESSION_PAYOUT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;
const BASE_RPC = import.meta.env.VITE_BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC ?? "https://rpc.sepolia.org";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

function matchIdBytes(matchId: string): Hex {
  return keccak256(stringToHex(matchId));
}

export function WalletPanel({ match }: { match: ChessState | null }) {
  const [account, setAccount] = useState<Address | null>(null);
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [status, setStatus] = useState(
    "Connect a wallet to deposit the stake on Base Sepolia.",
  );
  const [tx, setTx] = useState<Hash | null>(null);
  const [stakeEth, setStakeEth] = useState("0.001");

  const stakeWei = useMemo(() => {
    try {
      return match?.stakeWei && match.stakeWei !== "0"
        ? BigInt(match.stakeWei)
        : parseEther(stakeEth || "0");
    } catch {
      return 0n;
    }
  }, [match, stakeEth]);

  const connect = async () => {
    if (!window.ethereum) {
      setStatus("No injected wallet found. Install MetaMask or another EIP-1193 wallet.");
      return;
    }
    const accounts = (await window.ethereum.request({
      method: "eth_requestAccounts",
    })) as string[];
    const addr = accounts[0] as Address;
    setAccount(addr);
    if (!playerA) setPlayerA(addr);
    setStatus(`Connected ${addr}`);
  };

  const deposit = async () => {
    if (!window.ethereum || !account || !match) return;
    if (LOCK_ADDRESS.endsWith("0000")) {
      setStatus("Deploy SessionLock and set VITE_SESSION_LOCK_ADDRESS first.");
      return;
    }
    if (!isAddress(playerA) || !isAddress(playerB) || playerA.toLowerCase() === playerB.toLowerCase()) {
      setStatus("Enter two distinct player addresses (White / Black wallets).");
      return;
    }

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${baseSepolia.id.toString(16)}` }],
      });
    } catch {
      /* may already be on Base Sepolia */
    }

    const wallet = createWalletClient({
      account,
      chain: baseSepolia,
      transport: custom(window.ethereum),
    });
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(BASE_RPC),
    });

    setStatus("Depositing on Base Sepolia…");
    const hash = await wallet.writeContract({
      address: LOCK_ADDRESS,
      abi: SESSION_LOCK_ABI,
      functionName: "deposit",
      args: [matchIdBytes(match.matchId), playerA as Address, playerB as Address],
      value: stakeWei,
      chain: baseSepolia,
      account,
    });
    setTx(hash);
    setStatus(`Deposit tx ${hash}. Waiting for confirmation…`);
    await publicClient.waitForTransactionReceipt({ hash });
    setStatus(`Deposited ${formatEther(stakeWei)} ETH on Base Sepolia.`);
  };

  const refreshPayout = async () => {
    if (!match) return;
    const client = createPublicClient({
      chain: sepolia,
      transport: http(SEPOLIA_RPC),
    });
    if (PAYOUT_ADDRESS.endsWith("0000")) {
      setStatus("Set VITE_SESSION_PAYOUT_ADDRESS after deploying SessionPayout.");
      return;
    }
    try {
      const paid = await client.readContract({
        address: PAYOUT_ADDRESS,
        abi: SESSION_PAYOUT_ABI,
        functionName: "settled",
        args: [matchIdBytes(match.matchId)],
      });
      setStatus(paid ? "Payout settled on Ethereum Sepolia." : "Payout not settled yet.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <p className="note">
        Equal stakes lock on Base Sepolia. After the game, CCIP carries the result to Ethereum
        Sepolia.
      </p>
      {!match && <div className="empty">Start a chess match to enable deposits.</div>}
      {match && (
        <div className="stack">
          <label>
            Stake (ETH)
            <input
              value={
                match.stakeWei && match.stakeWei !== "0"
                  ? formatEther(BigInt(match.stakeWei))
                  : stakeEth
              }
              onChange={(e) => setStakeEth(e.target.value)}
              disabled={Boolean(match.stakeWei && match.stakeWei !== "0")}
            />
          </label>
          <label>
            Player A wallet
            <input value={playerA} onChange={(e) => setPlayerA(e.target.value)} placeholder="0x…" />
          </label>
          <label>
            Player B wallet
            <input value={playerB} onChange={(e) => setPlayerB(e.target.value)} placeholder="0x…" />
          </label>
          <div className="actions">
            <button type="button" onClick={connect}>
              {account ? "Wallet connected" : "Connect wallet"}
            </button>
            <button type="button" className="primary" disabled={!account} onClick={deposit}>
              Deposit on Base
            </button>
            <button type="button" onClick={refreshPayout}>
              Check Sepolia payout
            </button>
          </div>
        </div>
      )}
      <p className="note" style={{ marginTop: "0.85rem" }}>
        {status}
      </p>
      {tx && (
        <a
          className="mono"
          href={`https://sepolia.basescan.org/tx/${tx}`}
          target="_blank"
          rel="noreferrer"
        >
          {tx}
        </a>
      )}
      <div className="fine">
        lock {LOCK_ADDRESS}
        <br />
        payout {PAYOUT_ADDRESS}
        {match && (
          <>
            <br />
            matchId bytes32 {matchIdBytes(match.matchId)}
          </>
        )}
      </div>
    </div>
  );
}
