import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { matchSummary } from "../board.js";
import { renderSnake } from "../snake-board.js";
import { SessionClient } from "../session.js";
import type { ChessState, HostKind, ServerMessage, SnakeDir, SnakeState } from "../types.js";

export interface McpServerOptions {
  host: HostKind;
  displayName?: string;
  relayUrl?: string;
}

function boardFromMessage(msg: ServerMessage): string | null {
  if (msg.type === "match") return matchSummary(msg.match);
  if (msg.type === "challenge_resolved" && msg.match) return matchSummary(msg.match);
  return null;
}

export async function createSessionMcpServer(opts: McpServerOptions) {
  const session = new SessionClient({
    host: opts.host,
    displayName: opts.displayName ?? process.env.SESSION_DISPLAY_NAME,
    relayUrl: opts.relayUrl ?? process.env.SESSION_RELAY_URL,
  });

  await session.start();

  const server = new McpServer({
    name: "session",
    version: "0.1.0",
  });

  const text = (body: string) => ({
    content: [{ type: "text" as const, text: body }],
  });

  const json = (value: unknown, board?: string | null) => {
    const payload = JSON.stringify(value, null, 2);
    if (!board) return text(payload);
    return text(`${board}\n\n---\n${payload}`);
  };

  const boardFor = (match?: ChessState | null, snake?: SnakeState | null) => {
    const parts = [match ? matchSummary(match) : "", snake ? renderSnake(snake) : ""].filter(Boolean);
    return parts.length ? parts.join("\n\n") : null;
  };

  const withBoards = (value: unknown, match?: ChessState | null, snake?: SnakeState | null) =>
    json(value, boardFor(match, snake));

  server.tool(
    "session_me",
    "Return this session's id, display name, host, and ENS name. Play stays in the IDE.",
    {},
    async () => json(session.me()),
  );

  server.tool(
    "session_peers",
    "List live peers from the lobby. Nearby peers (same Wi-Fi via mDNS) are flagged.",
    {},
    async () => json({ peers: session.peers(), nearby: session.nearby.list() }),
  );

  server.tool(
    "session_create_room",
    "Create a short room code so another session can join you.",
    {},
    async () => {
      const room = await session.createRoom();
      return json({ room });
    },
  );

  server.tool(
    "session_join_room",
    "Join a room by its short code.",
    { code: z.string().describe("Room code, e.g. AB12") },
    async ({ code }) => {
      const room = await session.joinRoom(code);
      return json({ room });
    },
  );

  server.tool(
    "session_ping",
    "Send a short ping to another session in the same room. Proves the connection.",
    {
      to: z.string().describe("Target session id (sess_...)"),
      text: z.string().default("hello").describe("Short message"),
    },
    async ({ to, text: pingText }) => {
      const message = await session.ping(to as `sess_${string}`, pingText);
      return json({ message });
    },
  );

  server.tool(
    "session_poll",
    "Poll for peers, room, pings, challenges, the chess match, and the snake arena. Includes an in-IDE board when a game is active.",
    {},
    async () => {
      const poll = session.poll();
      return withBoards(poll, poll.match, poll.snake);
    },
  );

  server.tool(
    "session_challenge",
    "Challenge a peer in your room to a chess match inside the IDE. Optional stake in wei.",
    {
      to: z.string().describe("Target session id"),
      stakeWei: z.string().optional().describe("Stake in wei, default 0"),
    },
    async ({ to, stakeWei }) => {
      const msg = await session.relay.challengeAsync(
        to as `sess_${string}`,
        stakeWei ?? "0",
      );
      return json(msg);
    },
  );

  server.tool(
    "session_respond",
    "Accept or decline an incoming chess challenge. Accepting shows the board in this IDE.",
    {
      challengeId: z.string(),
      accept: z.boolean(),
    },
    async ({ challengeId, accept }) => {
      const msg = await session.relay.respondChallengeAsync(challengeId, accept);
      return json(msg, boardFromMessage(msg));
    },
  );

  server.tool(
    "session_snake_join",
    "Join the snakes arena. Omit the room code to enter the shared OPEN arena with everyone else who did the same. Pass a code to start or join a private room. The second player starts a 90 second round.",
    {
      code: z
        .string()
        .optional()
        .describe("Optional room code. Omit to join the shared arena."),
    },
    async ({ code }) => {
      const msg = await session.relay.snakeJoinAsync(code);
      const snake = msg.type === "snake" ? msg.match : null;
      return withBoards(msg, null, snake);
    },
  );

  server.tool(
    "session_snake_steer",
    "Set your snake's heading. The arena keeps moving on the relay. You cannot reverse 180 degrees. Hold boost to move twice as fast while longer than 10; boosting sheds tail pellets.",
    {
      dir: z.enum(["up", "down", "left", "right"]).describe("New heading"),
      boost: z.boolean().optional().describe("Speed boost. Costs length while you are long enough."),
      matchId: z.string().optional().describe("Snake match id. Defaults to the current arena."),
    },
    async ({ dir, boost, matchId }) => {
      const id = matchId ?? session.snake()?.matchId;
      if (!id) throw new Error("No snake match. Call session_snake_join first.");
      const msg = await session.relay.snakeSteerAsync(id, dir as SnakeDir, boost ?? false);
      const snake = msg.type === "snake" ? msg.match : null;
      return withBoards(msg, null, snake);
    },
  );

  server.tool(
    "session_snake_leave",
    "Leave the snake arena. If a round is live and you were the opponent, the other player wins.",
    {},
    async () => {
      const msg = await session.relay.snakeLeaveAsync();
      const snake = msg.type === "snake" ? msg.match : session.snake();
      return withBoards(msg, null, snake);
    },
  );

  server.tool(
    "session_move",
    "Play a chess move in UCI form (e.g. e2e4). Returns the updated board for the IDE — do not open external links.",
    {
      matchId: z.string(),
      uci: z.string().describe("UCI move like e2e4 or e7e8q"),
    },
    async ({ matchId, uci }) => {
      const msg = await session.relay.moveAsync(matchId, uci);
      return json(msg, boardFromMessage(msg));
    },
  );

  server.tool(
    "session_resign",
    "Resign the active chess match.",
    { matchId: z.string() },
    async ({ matchId }) => {
      const msg = await session.relay.request("match", () =>
        session.relay.resign(matchId),
      );
      return withBoards(msg, msg.type === "match" ? msg.match : null, null);
    },
  );

  const shutdown = () => {
    session.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, session };
}

export async function runSessionMcp(opts: McpServerOptions): Promise<void> {
  const { server } = await createSessionMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
