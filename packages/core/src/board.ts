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

/**
 * Render a FEN as a monospace board for IDE panes and MCP tool replies.
 * The game is played in-IDE — agents move via tools; humans read this board.
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
