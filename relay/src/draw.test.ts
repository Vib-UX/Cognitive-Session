import assert from "node:assert/strict";
import test from "node:test";
import type WebSocket from "ws";
import { RelayStore } from "./store.js";
import type { ServerMessage, SessionId } from "./types.js";

const A = "sess_drawaaaa" as SessionId;
const B = "sess_drawbbbb" as SessionId;

function fakeSocket() {
  const sent: ServerMessage[] = [];
  const ws = {
    readyState: 1,
    OPEN: 1,
    send(raw: string) {
      sent.push(JSON.parse(raw) as ServerMessage);
    },
    close() {},
  };
  return { ws: ws as unknown as WebSocket, sent };
}

function last<T extends ServerMessage["type"]>(sent: ServerMessage[], type: T) {
  const found = [...sent].reverse().find((msg) => msg.type === type);
  assert.ok(found, `expected ${type}`);
  return found as Extract<ServerMessage, { type: T }>;
}

test("an even VRF word makes the waiting player white", () => {
  const store = new RelayStore({ draw: true });
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({ type: "hello", identity: { id: A, displayName: "ada", host: "cursor" } }));
  store.handle(bob.ws, JSON.stringify({ type: "hello", identity: { id: B, displayName: "bob", host: "cursor" } }));
  store.handle(ada.ws, JSON.stringify({ type: "next" }));
  store.handle(bob.ws, JSON.stringify({ type: "next" }));

  const held = last(ada.sent, "queue");
  assert.equal(held.drawing, true);
  assert.equal(ada.sent.some((msg) => msg.type === "match"), false);

  const pairId = store.pendingPair();
  assert.ok(pairId);
  const match = store.applyDraw(pairId, 4n);
  assert.ok(match);
  assert.equal(match.white, A);
  assert.equal(match.black, B);
  assert.equal(match.drawWord, "4");
  assert.equal(last(bob.sent, "match").match.white, A);
});

test("an odd VRF word makes the waiting player black", () => {
  const store = new RelayStore({ draw: true });
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({ type: "hello", identity: { id: A, displayName: "ada", host: "cursor" } }));
  store.handle(bob.ws, JSON.stringify({ type: "hello", identity: { id: B, displayName: "bob", host: "cursor" } }));
  store.handle(ada.ws, JSON.stringify({ type: "next" }));
  store.handle(bob.ws, JSON.stringify({ type: "next" }));
  const pairId = store.pendingPair();
  assert.ok(pairId);
  const match = store.applyDraw(pairId, 5n);
  assert.ok(match);
  assert.equal(match.white, B);
  assert.equal(match.black, A);
});
