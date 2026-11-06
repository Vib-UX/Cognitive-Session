import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { WebSocketServer } from "ws";
import { RelayStore } from "./store.js";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage, SessionIdentity } from "./types.js";

function once(ws: WebSocket, type: ServerMessage["type"], timeoutMs = 3000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${type}`)), timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(msg);
    };
    ws.on("message", onMessage);
  });
}

function send(ws: WebSocket, msg: ClientMessage) {
  ws.send(JSON.stringify(msg));
}

let port = 0;
let server: ReturnType<typeof createServer>;
let store: RelayStore;

before(async () => {
  store = new RelayStore();
  server = createServer();
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    store.add(ws);
    ws.on("message", (data) => store.handle(ws, data.toString()));
    ws.on("close", () => store.remove(ws));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") port = addr.port;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test("two sessions join a room and ping", async () => {
  const aId = "sess_aaa11111" as const;
  const bId = "sess_bbb22222" as const;
  const aIdentity: SessionIdentity = {
    id: aId,
    displayName: "alice",
    host: "cursor",
  };
  const bIdentity: SessionIdentity = {
    id: bId,
    displayName: "bob",
    host: "claude",
  };

  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([
    new Promise((r) => a.once("open", r)),
    new Promise((r) => b.once("open", r)),
  ]);

  send(a, { type: "hello", identity: aIdentity });
  send(b, { type: "hello", identity: bIdentity });
  await once(a, "welcome");
  await once(b, "welcome");

  send(a, { type: "create_room" });
  const roomMsg = await once(a, "room");
  assert.equal(roomMsg.type, "room");
  assert.ok(roomMsg.room?.code);

  send(b, { type: "join_room", code: roomMsg.room!.code });
  const joined = await once(b, "room");
  assert.equal(joined.type, "room");
  assert.equal(joined.room?.members.length, 2);

  send(a, { type: "ping", to: bId, text: "hello bob" });
  const pingA = await once(a, "ping");
  const pingB = await once(b, "ping");
  assert.equal(pingA.type, "ping");
  assert.equal(pingB.type, "ping");
  assert.equal(pingB.message.text, "hello bob");

  a.close();
  b.close();
});

test("lobby challenge without a room starts a match", async () => {
  const aId = "sess_eee55555" as const;
  const bId = "sess_fff66666" as const;

  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([
    new Promise((r) => a.once("open", r)),
    new Promise((r) => b.once("open", r)),
  ]);

  send(a, { type: "hello", identity: { id: aId, displayName: "e", host: "cursor" } });
  send(b, { type: "hello", identity: { id: bId, displayName: "f", host: "claude" } });
  await once(a, "welcome");
  await once(b, "welcome");

  send(a, { type: "challenge", to: bId, stakeWei: "0" });
  const chal = await once(b, "challenge");
  assert.equal(chal.type, "challenge");

  send(b, { type: "respond_challenge", challengeId: chal.challenge.id, accept: true });
  const resolved = await once(a, "challenge_resolved");
  assert.equal(resolved.type, "challenge_resolved");
  assert.equal(resolved.accepted, true);
  assert.ok(resolved.match?.matchId);
  assert.ok(resolved.match?.roomCode);

  a.close();
  b.close();
});

test("challenge starts a chess match", async () => {
  const aId = "sess_ccc33333" as const;
  const bId = "sess_ddd44444" as const;

  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([
    new Promise((r) => a.once("open", r)),
    new Promise((r) => b.once("open", r)),
  ]);

  send(a, { type: "hello", identity: { id: aId, displayName: "c", host: "cursor" } });
  send(b, { type: "hello", identity: { id: bId, displayName: "d", host: "claude" } });
  await once(a, "welcome");
  await once(b, "welcome");

  send(a, { type: "create_room" });
  const roomMsg = await once(a, "room");
  assert.equal(roomMsg.type, "room");
  send(b, { type: "join_room", code: roomMsg.room!.code });
  await once(b, "room");

  send(a, { type: "challenge", to: bId, stakeWei: "0" });
  const chal = await once(b, "challenge");
  assert.equal(chal.type, "challenge");

  send(b, { type: "respond_challenge", challengeId: chal.challenge.id, accept: true });
  const resolved = await once(a, "challenge_resolved");
  assert.equal(resolved.type, "challenge_resolved");
  assert.equal(resolved.accepted, true);
  assert.ok(resolved.match?.matchId);

  const matchId = resolved.match!.matchId;
  const iAmWhite = resolved.match!.white === aId;
  const mover = iAmWhite ? a : b;
  send(mover, { type: "move", matchId, uci: "e2e4" });
  const matchMsg = await once(a, "match");
  assert.equal(matchMsg.type, "match");
  assert.equal(matchMsg.match.turn, "b");

  a.close();
  b.close();
});

test("next pairs a waiting session without a room", async () => {
  const aId = "sess_nextaaaa" as const;
  const bId = "sess_nextbbbb" as const;
  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([
    new Promise((r) => a.once("open", r)),
    new Promise((r) => b.once("open", r)),
  ]);

  send(a, { type: "hello", identity: { id: aId, displayName: "a", host: "cursor" } });
  send(b, { type: "hello", identity: { id: bId, displayName: "b", host: "cursor" } });
  await once(a, "welcome");
  await once(b, "welcome");

  const pingPromise = once(b, "ping");
  send(a, { type: "ping", to: bId, text: "no room" });
  const ping = await pingPromise;
  assert.equal(ping.type, "ping");
  assert.equal(ping.message.text, "no room");

  const waitingPromise = once(a, "queue");
  send(a, { type: "next" });
  const waiting = await waitingPromise;
  assert.equal(waiting.type, "queue");
  assert.equal(waiting.seeking, true);

  const matchA = once(a, "match");
  const matchB = once(b, "match");
  send(b, { type: "next" });
  const matched = await matchA;
  const matchedB = await matchB;
  assert.equal(matched.type, "match");
  assert.equal(matchedB.type, "match");
  assert.equal(matched.match.status, "active");
  const players = [matched.match.white, matched.match.black].sort();
  assert.deepEqual(players, [aId, bId].sort());

  a.close();
  b.close();
});
