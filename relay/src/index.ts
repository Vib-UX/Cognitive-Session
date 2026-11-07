import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { PlayBank } from "./bank.js";
import { matchDrawAddress, pollDraws } from "./draw.js";
import { SNAKE_TICK_MS } from "./snake.js";
import { RelayStore } from "./store.js";

const PORT = Number(process.env.PORT ?? 47831);
const bankFile = join(process.env.SESSION_DATA_DIR?.trim() || join(homedir(), ".session"), "relay-bank.json");

const store = new RelayStore({ bank: PlayBank.open(bankFile), requireDeposit: true });
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "session-relay", puzzles: true });
});

app.get("/presence", (_req, res) => {
  res.json(store.snapshot());
});

app.post("/match/:id/meta", (req, res) => {
  const matchId = req.params.id;
  const snap = store.snapshot();
  const match = snap.matches.find((m) => m.matchId === matchId);
  if (!match) {
    res.status(404).json({ error: "match not found" });
    return;
  }
  // Meta updates from the web/board go through a synthetic path by
  // rewriting the in-memory match via set_match_meta from a connected player.
  // This endpoint is a read-friendly mirror for the UI.
  res.json({ match, hint: "Use the board wallet flow; players push meta via WS" });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  store.add(ws);
  ws.on("message", (data) => store.handle(ws, data.toString()));
  ws.on("close", () => store.remove(ws));
  ws.on("error", () => store.remove(ws));
});

setInterval(() => store.sweepStale(), 5000);
if (matchDrawAddress()) {
  setInterval(() => {
    pollDraws()
      .then((rows) => {
        for (const row of rows) store.applyDraw(row.pairId, row.word);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "draw poll failed";
        console.error("draw poll", message);
      });
  }, 8_000);
}
setInterval(() => store.sweepClocks(), 200);
setInterval(() => store.tickSnakes(), SNAKE_TICK_MS);

server.listen(PORT, () => {
  console.log(`session relay listening on http://127.0.0.1:${PORT}`);
  console.log(`websocket ws://127.0.0.1:${PORT}/ws`);
  console.log(`presence  http://127.0.0.1:${PORT}/presence`);
});
