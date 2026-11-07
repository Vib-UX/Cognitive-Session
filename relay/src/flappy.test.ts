import assert from "node:assert/strict";
import test from "node:test";
import type WebSocket from "ws";
import { RelayStore } from "./store.js";
import type { ServerMessage, SessionId } from "./types.js";

const A = "sess_flap_a" as SessionId;
const B = "sess_flap_b" as SessionId;

function fakeSocket() {
  const sent: ServerMessage[] = [];
  const ws = {
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

test("the relay pairs two players on one course and says who scored higher", () => {
  const store = new RelayStore();
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({ type: "hello", identity: { id: A, displayName: "ada", host: "cursor" } }));
  store.handle(bob.ws, JSON.stringify({ type: "hello", identity: { id: B, displayName: "bob", host: "claude" } }));

  store.handle(ada.ws, JSON.stringify({ type: "flappy_join" }));
  const waiting = last(ada.sent, "flappy");
  assert.equal(waiting.flappy.status, "waiting");
  assert.equal(waiting.flappy.seeking, true);

  store.handle(bob.ws, JSON.stringify({ type: "flappy_join" }));
  const adaStart = last(ada.sent, "flappy");
  const bobStart = last(bob.sent, "flappy");
  assert.equal(adaStart.flappy.status, "playing");
  assert.equal(bobStart.flappy.status, "playing");
  assert.equal(adaStart.flappy.id, bobStart.flappy.id);
  assert.equal(adaStart.flappy.seed, bobStart.flappy.seed);
  assert.ok(adaStart.flappy.seed > 0);

  store.handle(ada.ws, JSON.stringify({ type: "flappy_score", contestId: adaStart.flappy.id, score: 4 }));
  const adaWaiting = last(ada.sent, "flappy");
  assert.equal(adaWaiting.flappy.status, "playing");
  assert.equal(adaWaiting.flappy.you, 4);
  assert.equal(adaWaiting.flappy.winner, null);

  store.handle(bob.ws, JSON.stringify({ type: "flappy_score", contestId: bobStart.flappy.id, score: 2 }));
  const adaDone = last(ada.sent, "flappy");
  const bobDone = last(bob.sent, "flappy");
  assert.equal(adaDone.flappy.status, "done");
  assert.equal(adaDone.flappy.winner, "you");
  assert.equal(adaDone.flappy.you, 4);
  assert.equal(adaDone.flappy.them, 2);
  assert.equal(adaDone.flappy.themName, "bob");
  assert.equal(bobDone.flappy.winner, "them");
  assert.equal(bobDone.flappy.you, 2);
  assert.equal(bobDone.flappy.them, 4);
});

test("equal flappy scores are a draw", () => {
  const store = new RelayStore();
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(ada.ws, JSON.stringify({ type: "hello", identity: { id: A, displayName: "ada", host: "web" } }));
  store.handle(bob.ws, JSON.stringify({ type: "hello", identity: { id: B, displayName: "bob", host: "cursor" } }));
  store.handle(ada.ws, JSON.stringify({ type: "flappy_join" }));
  store.handle(bob.ws, JSON.stringify({ type: "flappy_join" }));
  const start = last(ada.sent, "flappy");
  store.handle(ada.ws, JSON.stringify({ type: "flappy_score", contestId: start.flappy.id, score: 1 }));
  store.handle(bob.ws, JSON.stringify({ type: "flappy_score", contestId: start.flappy.id, score: 1 }));
  assert.equal(last(ada.sent, "flappy").flappy.winner, "draw");
  assert.equal(last(bob.sent, "flappy").flappy.winner, "draw");
});
