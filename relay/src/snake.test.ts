import assert from "node:assert/strict";
import test from "node:test";
import type WebSocket from "ws";
import { RelayStore } from "./store.js";
import {
  SNAKE_ROUND_MS,
  SNAKE_START_LEN,
  createSnakeMatch,
  disconnectSnake,
  joinSnake,
  setSnakeHeading,
  tickSnake,
} from "./snake.js";
import type { ServerMessage, SessionId } from "./types.js";

const A = "sess_aaa11111" as SessionId;
const B = "sess_bbb22222" as SessionId;

function arena() {
  const state = createSnakeMatch("ROOM", () => 0);
  state.pellets = [];
  return state;
}

function activate(now = 1_000) {
  const state = arena();
  joinSnake(state, A, "ada", now);
  joinSnake(state, B, "bob", now);
  state.pellets = [];
  return state;
}

test("snakes move forward and refuse to reverse", () => {
  const state = activate();
  const ada = state.players[0]!;
  assert.equal(ada.body[0]!.x, 8);
  setSnakeHeading(state, A, "left");
  tickSnake(state, 1_000, () => 0);
  assert.equal(ada.dir, "right");
  assert.equal(ada.body[0]!.x, 9);
  assert.equal(ada.body.length, SNAKE_START_LEN);
});

test("eating a pellet grows the snake and adds score", () => {
  const state = activate();
  const ada = state.players[0]!;
  state.pellets = [{ id: 1, x: 9, y: 24, value: 3 }];
  tickSnake(state, 1_000, () => 0);
  assert.equal(ada.score, 3);
  assert.equal(ada.body.length, SNAKE_START_LEN + 1);
  assert.equal(state.pellets.some((pellet) => pellet.x === 9 && pellet.y === 24), false);
});

test("a wall or another body kills, a tail does not", () => {
  const wall = activate();
  const ada = wall.players[0]!;
  ada.body = [
    { x: 47, y: 10 },
    { x: 46, y: 10 },
    { x: 45, y: 10 },
    { x: 44, y: 10 },
  ];
  ada.dir = "right";
  ada.pendingDir = "right";
  tickSnake(wall, 1_000, () => 0);
  assert.equal(ada.alive, false);

  const body = activate();
  const hunter = body.players[0]!;
  const prey = body.players[1]!;
  hunter.body = [
    { x: 20, y: 20 },
    { x: 19, y: 20 },
    { x: 18, y: 20 },
    { x: 17, y: 20 },
  ];
  hunter.dir = "right";
  hunter.pendingDir = "right";
  prey.body = [
    { x: 22, y: 20 },
    { x: 21, y: 20 },
    { x: 21, y: 21 },
    { x: 21, y: 22 },
  ];
  prey.dir = "right";
  prey.pendingDir = "right";
  tickSnake(body, 1_000, () => 0);
  assert.equal(hunter.alive, false);
  assert.equal(prey.alive, true);

  const tail = activate();
  const cutter = tail.players[0]!;
  const other = tail.players[1]!;
  cutter.body = [
    { x: 10, y: 10 },
    { x: 10, y: 11 },
    { x: 9, y: 11 },
    { x: 9, y: 10 },
  ];
  cutter.dir = "right";
  cutter.pendingDir = "right";
  other.body = [
    { x: 14, y: 14 },
    { x: 15, y: 14 },
    { x: 16, y: 14 },
    { x: 11, y: 10 },
  ];
  other.dir = "right";
  other.pendingDir = "right";
  tickSnake(tail, 1_000, () => 0);
  assert.equal(cutter.alive, true);
  assert.equal(cutter.body[0]!.x, 11);
});

test("two heads aiming at the same cell both die", () => {
  const state = activate();
  const ada = state.players[0]!;
  const bob = state.players[1]!;
  ada.body = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
    { x: 7, y: 10 },
  ];
  ada.dir = "right";
  ada.pendingDir = "right";
  bob.body = [
    { x: 12, y: 10 },
    { x: 13, y: 10 },
    { x: 14, y: 10 },
    { x: 15, y: 10 },
  ];
  bob.dir = "left";
  bob.pendingDir = "left";
  tickSnake(state, 1_000, () => 0);
  assert.equal(ada.alive, false);
  assert.equal(bob.alive, false);
});

test("boost moves two cells and sheds when long enough", () => {
  const state = activate();
  const ada = state.players[0]!;
  ada.body = Array.from({ length: 12 }, (_, i) => ({ x: 20 - i, y: 24 }));
  ada.dir = "right";
  ada.pendingDir = "right";
  ada.boost = true;
  tickSnake(state, 1_000, () => 0);
  assert.equal(ada.body[0]!.x, 22);
  assert.equal(ada.body.length, 11);
  assert.equal(
    state.pellets.some((pellet) => pellet.x === 11 && pellet.y === 24),
    true,
  );
});

test("a dead snake respawns after the delay with score intact", () => {
  const state = activate();
  const ada = state.players[0]!;
  ada.score = 7;
  ada.body = [
    { x: 47, y: 10 },
    { x: 46, y: 10 },
    { x: 45, y: 10 },
    { x: 44, y: 10 },
  ];
  ada.dir = "right";
  ada.pendingDir = "right";
  tickSnake(state, 1_000, () => 0);
  assert.equal(ada.alive, false);
  tickSnake(state, 2_999, () => 0);
  assert.equal(ada.alive, false);
  tickSnake(state, 3_000, () => 0);
  assert.equal(ada.alive, true);
  assert.equal(ada.body.length, SNAKE_START_LEN);
  assert.equal(ada.score, 7);
});

test("the round awards the higher score, and a tie draws", () => {
  const state = activate(5_000);
  state.players[0]!.score = 4;
  state.players[1]!.score = 9;
  state.endsAt = 5_000;
  tickSnake(state, 5_000, () => 0);
  assert.equal(state.status, "finished");
  assert.equal(state.result?.kind, "win");
  assert.equal(state.result?.winner, B);

  const tied = activate(5_000);
  tied.players[0]!.score = 3;
  tied.players[1]!.score = 3;
  tied.endsAt = 5_000;
  tickSnake(tied, 5_000, () => 0);
  assert.equal(tied.result?.kind, "draw");
});

test("the second player starts a 90 second round", () => {
  const state = arena();
  const now = 10_000;
  joinSnake(state, A, "ada", now);
  assert.equal(state.status, "waiting");
  joinSnake(state, B, "bob", now);
  assert.equal(state.status, "active");
  assert.equal(state.endsAt, now + SNAKE_ROUND_MS);
});

test("a disconnect while the round is live crowns the remaining player", () => {
  const state = activate();
  assert.equal(disconnectSnake(state, A, 2_000), "ok");
  assert.equal(state.status, "finished");
  assert.equal(state.result?.winner, B);
  assert.equal(state.result?.reason, "last");
});

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

test("players who skip the room code share the open arena", () => {
  const store = new RelayStore();
  const ada = fakeSocket();
  const bob = fakeSocket();
  const cam = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.add(cam.ws);
  for (const [sock, id, name] of [
    [ada, A, "ada"],
    [bob, B, "bob"],
    [cam, "sess_ccc33333", "cam"],
  ] as const) {
    store.handle(
      sock.ws,
      JSON.stringify({ type: "hello", identity: { id, displayName: name, host: "cursor" } }),
    );
    store.handle(sock.ws, JSON.stringify({ type: "snake_join" }));
  }
  const started = last(cam.sent, "snake");
  assert.equal(started.match.roomCode, "OPEN");
  assert.equal(started.match.status, "active");
  assert.equal(started.match.players.length, 3);
  const room = last(ada.sent, "room");
  assert.equal(room.type, "room");
  assert.equal(room.room?.code, "OPEN");
  assert.equal(room.room?.members.length, 3);
});

test("a room code starts or joins that private arena", () => {
  const store = new RelayStore();
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(
    ada.ws,
    JSON.stringify({ type: "hello", identity: { id: A, displayName: "ada", host: "cursor" } }),
  );
  store.handle(ada.ws, JSON.stringify({ type: "snake_join", code: "pit" }));
  store.handle(
    bob.ws,
    JSON.stringify({ type: "hello", identity: { id: B, displayName: "bob", host: "claude" } }),
  );
  store.handle(bob.ws, JSON.stringify({ type: "snake_join", code: "PIT" }));
  const started = last(bob.sent, "snake");
  assert.equal(started.match.roomCode, "PIT");
  assert.equal(started.match.players.length, 2);
  assert.equal(started.match.status, "active");
});

test("two relay clients join an arena and steer", () => {
  const store = new RelayStore();
  const ada = fakeSocket();
  const bob = fakeSocket();
  store.add(ada.ws);
  store.add(bob.ws);
  store.handle(
    ada.ws,
    JSON.stringify({
      type: "hello",
      identity: { id: A, displayName: "ada", host: "cursor" },
    }),
  );
  store.handle(
    bob.ws,
    JSON.stringify({
      type: "hello",
      identity: { id: B, displayName: "bob", host: "claude" },
    }),
  );
  store.handle(ada.ws, JSON.stringify({ type: "create_room" }));
  const room = last(ada.sent, "room");
  assert.equal(room.type, "room");
  assert.ok(room.room);
  store.handle(bob.ws, JSON.stringify({ type: "join_room", code: room.room.code }));
  store.handle(ada.ws, JSON.stringify({ type: "snake_join" }));
  store.handle(bob.ws, JSON.stringify({ type: "snake_join" }));
  const started = last(bob.sent, "snake");
  assert.equal(started.match.status, "active");
  assert.equal(started.match.players.length, 2);

  store.handle(
    ada.ws,
    JSON.stringify({ type: "snake_steer", matchId: started.match.matchId, dir: "up" }),
  );
  store.tickSnakes((started.match.startedAt ?? 0) + 20);
  const moved = last(ada.sent, "snake");
  const self = moved.match.players.find((player) => player.id === A);
  assert.equal(moved.match.tick, 1);
  assert.equal(self?.dir, "up");
  assert.equal(store.snapshot().snakes.length, 1);
});
