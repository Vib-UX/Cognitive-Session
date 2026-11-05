import WebSocket from "ws";
import type {
  ChallengeInfo,
  ChessState,
  ClientMessage,
  PeerInfo,
  PingMessage,
  RoomInfo,
  ServerMessage,
  SessionIdentity,
} from "./types.js";

export type RelayEventHandler = (msg: ServerMessage) => void;

export class RelayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers = new Set<RelayEventHandler>();
  private pending = new Map<
    string,
    { resolve: (v: ServerMessage) => void; reject: (e: Error) => void }
  >();
  private req = 0;
  private intentionalClose = false;

  peers: PeerInfo[] = [];
  room: RoomInfo | null = null;
  pings: PingMessage[] = [];
  match: ChessState | null = null;
  challenges: ChallengeInfo[] = [];
  connected = false;

  constructor(
    private url: string,
    private identity: SessionIdentity,
  ) {}

  on(handler: RelayEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.intentionalClose = false;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const onOpen = () => {
        cleanup();
        this.connected = true;
        this.send({ type: "hello", identity: this.identity });
        this.startHeartbeat();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        ws.off("open", onOpen);
        ws.off("error", onError);
      };

      ws.on("open", onOpen);
      ws.on("error", onError);
      ws.on("message", (data) => this.handleRaw(data.toString()));
      ws.on("close", () => {
        this.connected = false;
        this.stopHeartbeat();
        if (!this.intentionalClose) this.scheduleReconnect();
      });
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => this.scheduleReconnect());
    }, 2000);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "heartbeat" });
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to relay");
    }
    this.ws.send(JSON.stringify(msg));
  }

  private handleRaw(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    this.apply(msg);
    for (const h of this.handlers) h(msg);
  }

  private apply(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome":
        this.peers = msg.peers;
        this.room = msg.room;
        break;
      case "peers":
        this.peers = msg.peers;
        break;
      case "room":
        this.room = msg.room;
        break;
      case "ping":
        this.pings = [...this.pings.slice(-49), msg.message];
        break;
      case "challenge":
        this.challenges = [
          ...this.challenges.filter((c) => c.id !== msg.challenge.id),
          msg.challenge,
        ];
        break;
      case "challenge_resolved":
        this.challenges = this.challenges.filter((c) => c.id !== msg.challengeId);
        if (msg.match) this.match = msg.match;
        break;
      case "match":
        this.match = msg.match;
        break;
      case "poll_state":
        this.peers = msg.peers;
        this.room = msg.room;
        this.pings = msg.pings;
        this.match = msg.match;
        this.challenges = msg.challenges;
        break;
      default:
        break;
    }
  }

  /** Wait until the next matching message (or timeout). */
  waitFor(
    type: ServerMessage["type"],
    timeoutMs = 8000,
    predicate?: (msg: ServerMessage) => boolean,
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const key = `${type}:${++this.req}`;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        off();
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeoutMs);

      const off = this.on((msg) => {
        if (msg.type !== type) return;
        if (predicate && !predicate(msg)) return;
        clearTimeout(timer);
        this.pending.delete(key);
        off();
        resolve(msg);
      });
      this.pending.set(key, { resolve, reject });
    });
  }

  /** Register the waiter before sending to avoid missing a fast reply. */
  async request(
    type: ServerMessage["type"],
    sendFn: () => void,
    timeoutMs = 8000,
    predicate?: (msg: ServerMessage) => boolean,
  ): Promise<ServerMessage> {
    const pending = this.waitFor(type, timeoutMs, predicate);
    sendFn();
    return pending;
  }

  createRoom(): void {
    this.send({ type: "create_room" });
  }

  joinRoom(code: string): void {
    this.send({ type: "join_room", code: code.toUpperCase() });
  }

  leaveRoom(): void {
    this.send({ type: "leave_room" });
  }

  ping(to: SessionIdentity["id"], text: string): void {
    this.send({ type: "ping", to, text });
  }

  challenge(to: SessionIdentity["id"], stakeWei = "0"): void {
    this.send({ type: "challenge", to, stakeWei });
  }

  respondChallenge(challengeId: string, accept: boolean): void {
    this.send({ type: "respond_challenge", challengeId, accept });
  }

  move(matchId: string, uci: string): void {
    this.send({ type: "move", matchId, uci });
  }

  resign(matchId: string): void {
    this.send({ type: "resign", matchId });
  }

  poll(): void {
    this.send({ type: "poll" });
  }

  createRoomAsync(): Promise<ServerMessage> {
    return this.request("room", () => this.createRoom());
  }

  joinRoomAsync(code: string): Promise<ServerMessage> {
    return this.request("room", () => this.joinRoom(code));
  }

  pingAsync(to: SessionIdentity["id"], text: string): Promise<ServerMessage> {
    return this.request("ping", () => this.ping(to, text));
  }

  challengeAsync(to: SessionIdentity["id"], stakeWei = "0"): Promise<ServerMessage> {
    return this.request("challenge", () => this.challenge(to, stakeWei));
  }

  respondChallengeAsync(challengeId: string, accept: boolean): Promise<ServerMessage> {
    return this.request("challenge_resolved", () => this.respondChallenge(challengeId, accept));
  }

  async moveAsync(matchId: string, uci: string): Promise<ServerMessage> {
    if (this.match?.matchId !== matchId) {
      await this.waitFor(
        "match",
        8000,
        (msg) => msg.type === "match" && msg.match.matchId === matchId,
      );
    }
    const beforeFen = this.match?.fen;
    return this.request(
      "match",
      () => this.move(matchId, uci),
      8000,
      (msg) =>
        msg.type === "match" &&
        msg.match.matchId === matchId &&
        msg.match.fen !== beforeFen,
    );
  }
}
