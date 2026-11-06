import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Local Session credits, denominated in USD cents. Not an on-chain transfer. */
export const DAILY_CAP_CENTS = 300;

export const REWARD_CENTS = {
  sudoku: 40,
  cross: 25,
  kenken: 35,
  maze: 25,
  mate: 50,
  chess: 75,
} as const;

export type RewardKind = keyof typeof REWARD_CENTS;

interface Ledger {
  day: string;
  earnedTodayCents: number;
  pendingCents: number;
  claimableCents: number;
  claimedTodayCents: number;
  lifetimeClaimedCents: number;
  settledGeneration: number;
  note: string;
  seen: string[];
}

export interface LedgerEntry {
  usd: string;
  chainName: string;
  tx: string;
  href: string;
}

export interface CreditView {
  today: string;
  pending: string;
  claimable: string;
  claimed: string;
  working: boolean;
  canClaim: boolean;
  claimLabel: string;
  note: string;
  ledger: LedgerEntry[];
}

export interface AwardResult {
  cents: number;
  counted: boolean;
  note: string;
}

interface AgentWork {
  phase?: string;
  generation?: number;
}

const EMPTY = (): Ledger => ({
  day: todayKey(),
  earnedTodayCents: 0,
  pendingCents: 0,
  claimableCents: 0,
  claimedTodayCents: 0,
  lifetimeClaimedCents: 0,
  settledGeneration: 0,
  note: "Solves pay only while the agent is working.",
  seen: [],
});

export function sessionDir(): string {
  return join(homedir(), ".session");
}

export function usd(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isRewardKind(kind: string): kind is RewardKind {
  return Object.prototype.hasOwnProperty.call(REWARD_CENTS, kind);
}

function isReceipt(row: Partial<Receipt>): row is Receipt {
  return typeof row.txHash === "string"
    && /^0x[a-fA-F0-9]{64}$/.test(row.txHash)
    && typeof row.chainName === "string"
    && row.chainName.length > 0
    && row.chainName.length < 40
    && typeof row.usd === "string";
}

interface Receipt {
  cents: number;
  usd: string;
  chainName: string;
  txHash: string;
}

export class Credits {
  private ledger: Ledger = EMPTY();
  private receipts: Receipt[] = [];
  private readonly listeners = new Set<(view: CreditView) => void>();
  private readonly wallet: () => string;

  constructor(wallet: () => string) {
    this.wallet = wallet;
    this.ledger = this.read();
    this.receipts = this.readReceipts();
    this.rollDay();
  }

  onChange(fn: (view: CreditView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  view(): CreditView {
    const working = this.agent()?.phase === "working";
    const claimable = this.ledger.claimableCents;
    return {
      today: usd(this.ledger.earnedTodayCents),
      pending: usd(this.ledger.pendingCents),
      claimable: usd(claimable),
      claimed: usd(this.ledger.claimedTodayCents),
      working,
      canClaim: !working && claimable > 0,
      claimLabel: claimable > 0 ? `Claim ${usd(claimable)}` : "Claim",
      note: this.ledger.note,
      ledger: this.receipts.slice(-8).reverse().map((row) => ({
        usd: row.usd,
        chainName: row.chainName,
        tx: `${row.txHash.slice(0, 6)}…${row.txHash.slice(-4)}`,
        href: `https://basescan.org/tx/${row.txHash}`,
      })),
    };
  }

  /** Move credits earned during a finished agent turn into the claimable balance. */
  sync(): void {
    this.rollDay();
    const agent = this.agent();
    const generation = Number(agent?.generation) || 0;
    if (agent?.phase === "done" && generation > this.ledger.settledGeneration) {
      this.ledger.claimableCents += this.ledger.pendingCents;
      this.ledger.pendingCents = 0;
      this.ledger.settledGeneration = generation;
      if (this.ledger.claimableCents > 0) {
        this.ledger.note = `${usd(this.ledger.claimableCents)} ready to claim.`;
      }
      this.write();
    }
    this.emit();
  }

  award(kind: string, id: string): AwardResult {
    this.sync();
    if (!id || this.ledger.seen.includes(id)) {
      return { cents: 0, counted: false, note: this.ledger.note };
    }
    if (!isRewardKind(kind)) {
      return { cents: 0, counted: false, note: this.ledger.note };
    }
    if (this.agent()?.phase !== "working") {
      this.ledger.note = "This one counts while the agent is working.";
      this.write();
      return { cents: 0, counted: false, note: this.ledger.note };
    }
    const room = DAILY_CAP_CENTS - this.ledger.earnedTodayCents;
    if (room <= 0) {
      this.ledger.seen = [...this.ledger.seen, id].slice(-200);
      this.ledger.note = "That's all for today.";
      this.write();
      return { cents: 0, counted: false, note: this.ledger.note };
    }
    const cents = Math.min(REWARD_CENTS[kind], room);
    this.ledger.earnedTodayCents += cents;
    this.ledger.pendingCents += cents;
    this.ledger.seen = [...this.ledger.seen, id].slice(-200);
    this.ledger.note = "Credit added. Claim it after the agent finishes.";
    this.write();
    return { cents, counted: true, note: this.ledger.note };
  }

  claim(): AwardResult {
    this.sync();
    if (this.agent()?.phase === "working") {
      this.ledger.note = "Claim after the agent finishes.";
      this.write();
      return { cents: 0, counted: false, note: this.ledger.note };
    }
    const cents = this.ledger.claimableCents;
    if (cents <= 0) {
      this.ledger.note = "Nothing to claim yet.";
      this.write();
      return { cents: 0, counted: false, note: this.ledger.note };
    }
    this.ledger.claimableCents = 0;
    this.ledger.claimedTodayCents += cents;
    this.ledger.lifetimeClaimedCents += cents;
    const wallet = this.wallet();
    const short = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "your wallet";
    this.ledger.note = `Sending ${usd(cents)} USDC to ${short}.`;
    this.write();
    return { cents, counted: true, note: this.ledger.note };
  }

  markSent(cents: number, wallet: string, chainName: string, txHash: string): void {
    this.ledger.note = `${usd(cents)} USDC on ${chainName}. ${txHash}`;
    this.appendReceipt(cents, wallet, chainName, txHash);
    this.write();
  }

  restore(cents: number, note: string): void {
    this.rollDay();
    this.ledger.claimableCents += cents;
    this.ledger.claimedTodayCents = Math.max(0, this.ledger.claimedTodayCents - cents);
    this.ledger.lifetimeClaimedCents = Math.max(0, this.ledger.lifetimeClaimedCents - cents);
    this.ledger.note = note;
    this.write();
  }

  private rollDay(): void {
    const day = todayKey();
    if (this.ledger.day === day) return;
    this.ledger.claimableCents += this.ledger.pendingCents;
    this.ledger.pendingCents = 0;
    this.ledger.earnedTodayCents = 0;
    this.ledger.claimedTodayCents = 0;
    this.ledger.seen = [];
    this.ledger.day = day;
    this.write();
  }

  private agent(): AgentWork | null {
    try {
      return JSON.parse(readFileSync(join(sessionDir(), "agent-work.json"), "utf8")) as AgentWork;
    } catch {
      return null;
    }
  }

  private read(): Ledger {
    try {
      const raw = JSON.parse(readFileSync(join(sessionDir(), "credits.json"), "utf8")) as Partial<Ledger>;
      const base = EMPTY();
      return {
        ...base,
        ...raw,
        seen: Array.isArray(raw.seen) ? raw.seen.filter((id) => typeof id === "string") : [],
        earnedTodayCents: Number(raw.earnedTodayCents) || 0,
        pendingCents: Number(raw.pendingCents) || 0,
        claimableCents: Number(raw.claimableCents) || 0,
        claimedTodayCents: Number(raw.claimedTodayCents) || 0,
        lifetimeClaimedCents: Number(raw.lifetimeClaimedCents) || 0,
        settledGeneration: Number(raw.settledGeneration) || 0,
        note: typeof raw.note === "string" ? raw.note : base.note,
        day: typeof raw.day === "string" ? raw.day : base.day,
      };
    } catch {
      return EMPTY();
    }
  }

  private write(): void {
    const dir = sessionDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credits.json"), JSON.stringify(this.ledger, null, 2));
    this.emit();
  }

  private readReceipts(): Receipt[] {
    try {
      const text = readFileSync(join(sessionDir(), "claims.jsonl"), "utf8");
      const rows: Receipt[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const row = JSON.parse(line) as Partial<Receipt>;
        if (!isReceipt(row)) continue;
        rows.push({ cents: Number(row.cents) || 0, usd: row.usd, chainName: row.chainName, txHash: row.txHash });
      }
      return rows.slice(-20);
    } catch {
      return [];
    }
  }

  private appendReceipt(cents: number, wallet: string, chainName: string, txHash: string): void {
    const receipt: Receipt = { cents, usd: usd(cents), chainName, txHash };
    if (!isReceipt(receipt) || this.receipts.some((row) => row.txHash === txHash)) return;
    const line = JSON.stringify({
      at: Date.now(),
      day: this.ledger.day,
      wallet,
      chainName,
      txHash,
      cents,
      usd: receipt.usd,
    });
    mkdirSync(sessionDir(), { recursive: true });
    writeFileSync(join(sessionDir(), "claims.jsonl"), `${line}\n`, { flag: "a" });
    this.receipts = [...this.receipts, receipt].slice(-20);
  }

  private emit(): void {
    const view = this.view();
    for (const fn of this.listeners) fn(view);
  }
}
