import type { SnakeState } from "./types.js";

/**
 * Compact arena for IDE tool replies. Heads are player numbers, bodies are
 * the same number's letter, food is * (or @ when it is worth three).
 */
export function renderSnake(match: SnakeState): string {
  const grid: string[][] = Array.from({ length: match.height }, () =>
    Array.from({ length: match.width }, () => "·"),
  );
  for (const pellet of match.pellets) {
    const row = grid[pellet.y];
    if (!row) continue;
    if (pellet.x < 0 || pellet.x >= match.width) continue;
    row[pellet.x] = pellet.value > 1 ? "@" : "*";
  }
  const heads = "12345678";
  const bodies = "abcdefgh";
  const legend: string[] = [];
  match.players.forEach((player, index) => {
    const mark = heads[index] ?? "?";
    const body = bodies[index] ?? "x";
    for (let i = player.body.length - 1; i >= 0; i--) {
      const cell = player.body[i]!;
      const row = grid[cell.y];
      if (!row || cell.x < 0 || cell.x >= match.width) continue;
      row[cell.x] = i === 0 ? mark : body;
    }
    const state = player.alive ? "alive" : "dead";
    legend.push(
      `${mark} ${player.name} ${player.score}pts ${player.body.length} long ${state}${player.boost ? " boost" : ""}`,
    );
  });
  const lines = grid.map((row) => row.join(""));
  const clock =
    match.endsAt != null && match.status === "active"
      ? `ends in ${fmt(match.endsAt - Date.now())}`
      : match.status;
  const result = match.result
    ? `result ${match.result.kind}${match.result.winner ? ` ${match.result.winner}` : ""} (${match.result.reason})`
    : "";
  return [
    `snake ${match.matchId} · room ${match.roomCode} · ${clock}`,
    ...lines,
    ...legend,
    result,
  ]
    .filter(Boolean)
    .join("\n");
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
