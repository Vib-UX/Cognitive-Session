import { Chess } from "chess.js";

const UNICODE: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

/** Legal moves as UCI, including a promotion letter when one is required. */
export function legalUci(fen: string): string[] {
  const chess = new Chess(fen);
  return chess.moves({ verbose: true }).map((move) => {
    return `${move.from}${move.to}${move.promotion ?? ""}`;
  });
}

/** Accept SAN (`e4`, `Nf3`, `O-O`, `e8=Q`) or UCI (`e2e4`, `e7e8q`). */
export function toUci(fen: string, text: string): string {
  const cleaned = text.trim().replace(/\s+/g, "");
  if (!cleaned) throw new Error("Empty move");
  const chess = new Chess(fen);
  const uci = cleaned.match(/^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/);
  try {
    const from = uci?.[1]?.toLowerCase();
    const to = uci?.[2]?.toLowerCase();
    const promotion = uci?.[3]?.toLowerCase() as "q" | "r" | "b" | "n" | undefined;
    const move = uci
      ? chess.move(promotion ? { from: from!, to: to!, promotion } : { from: from!, to: to! })
      : chess.move(cleaned.replace(/0-0-0/gi, "O-O-O").replace(/0-0/gi, "O-O"));
    if (!move) throw new Error(`Illegal move: ${text.trim()}`);
    return `${move.from}${move.to}${move.promotion ?? ""}`;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Illegal move:")) throw err;
    const message = err instanceof Error ? err.message : "Illegal move";
    throw new Error(message);
  }
}

/**
 * Render a FEN as a monospace board for IDE panes and MCP tool replies.
 */
export function renderBoard(fen: string): string {
  const chess = new Chess(fen);
  const rows = chess.board();
  const lines: string[] = ["  a b c d e f g h"];
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    const cells = rows[r]!.map((sq) => {
      if (!sq) return "·";
      const key = sq.color === "w" ? sq.type.toUpperCase() : sq.type;
      return UNICODE[key] ?? key;
    });
    lines.push(`${rank} ${cells.join(" ")}`);
  }
  lines.push(`turn: ${chess.turn() === "w" ? "white" : "black"}`);
  return lines.join("\n");
}

export function matchSummary(match: {
  matchId: string;
  fen: string;
  turn: string;
  status: string;
  white: string;
  black: string;
  clocksMs?: { w: number; b: number };
  result?: unknown;
}): string {
  const clock =
    match.clocksMs != null
      ? `\nclocks W ${fmt(match.clocksMs.w)} / B ${fmt(match.clocksMs.b)}`
      : "";
  const result = match.result ? `\nresult ${JSON.stringify(match.result)}` : "";
  return [
    `match ${match.matchId} · ${match.status}`,
    `white ${match.white}`,
    `black ${match.black}`,
    renderBoard(match.fen),
    clock.trim(),
    result.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
