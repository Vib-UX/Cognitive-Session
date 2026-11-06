import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

export const GAME_IDS = ["chess", "snakes", "sudoku", "maths", "mate"] as const;
export type GameId = (typeof GAME_IDS)[number];

export const EVM_CHAINS = [
  { id: 84532, name: "Base Sepolia" },
  { id: 11155111, name: "Ethereum Sepolia" },
  { id: 1, name: "Ethereum" },
  { id: 8453, name: "Base" },
  { id: 42161, name: "Arbitrum" },
  { id: 10, name: "Optimism" },
  { id: 137, name: "Polygon" },
] as const;

export type EvmChainId = (typeof EVM_CHAINS)[number]["id"];

export interface SessionPrefs {
  onboarded: boolean;
  games: GameId[];
  multiplayer: boolean;
  wallet: string;
  chainId: EvmChainId;
}

export function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function chainName(id: number): string {
  return EVM_CHAINS.find((chain) => chain.id === id)?.name ?? "EVM";
}

export function prefsFile(): string {
  return join(homedir(), ".session", "prefs.json");
}

export class PrefsStore {
  private listeners = new Set<(prefs: SessionPrefs) => void>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.mirror(this.get());
  }

  get(): SessionPrefs {
    return normalize(this.context.globalState.get<Partial<SessionPrefs>>("session.prefs"));
  }

  async update(next: Partial<SessionPrefs>): Promise<SessionPrefs> {
    const prefs = normalize({ ...this.get(), ...next, onboarded: true });
    await this.context.globalState.update("session.prefs", prefs);
    this.mirror(prefs);
    for (const fn of this.listeners) fn(prefs);
    return prefs;
  }

  private mirror(prefs: SessionPrefs) {
    const dir = join(homedir(), ".session");
    mkdirSync(dir, { recursive: true });
    writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
  }

  onChange(fn: (prefs: SessionPrefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function normalize(raw: Partial<SessionPrefs> | undefined): SessionPrefs {
  const picked = (raw?.games ?? ["chess"]).filter((game): game is GameId =>
    (GAME_IDS as readonly string[]).includes(game),
  );
  const games = [...new Set(picked)];
  const multiplayer = raw?.multiplayer !== false;
  if (multiplayer && !games.includes("chess")) games.unshift("chess");
  if (games.length === 0) games.push("chess");
  const wallet = typeof raw?.wallet === "string" ? raw.wallet.trim() : "";
  const chainId = EVM_CHAINS.some((chain) => chain.id === raw?.chainId)
    ? (raw!.chainId as EvmChainId)
    : 84532;
  const validWallet = isEvmAddress(wallet);
  return {
    onboarded: Boolean(raw?.onboarded) && validWallet,
    games,
    multiplayer,
    wallet: validWallet ? wallet : "",
    chainId,
  };
}
