import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type {
  ChallengeInfo,
  ChessState,
  PeerInfo,
  PingMessage,
  RoomInfo,
  ServerMessage,
  SessionIdentity,
  SessionId,
  UiState,
} from "./types";

type Listener = (state: UiState) => void;

/**
 * One identity per Cursor window (extension host), not one global file.
 * Sharing a single sess_ id made two windows kick each other off the relay.
 */
function loadIdentity(displayName: string, instanceId: string): SessionIdentity {
  const dir = join(homedir(), ".session", "cursor-extension");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `identity-${instanceId}.json`);
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SessionIdentity;
    if (displayName && !raw.displayName.startsWith(displayName)) {
      raw.displayName = `${displayName}-${instanceId.slice(0, 4)}`;
      writeFileSync(path, JSON.stringify(raw, null, 2));
    }
    return raw;
  }
  const short = instanceId.slice(0, 4);
  const base = displayName || `cursor`;
  const identity: SessionIdentity = {
    id: `sess_${instanceId}` as SessionId,
    displayName: `${base}-${short}`,
    host: "cursor",
    ensName: undefined,
  };
  const label = identity.displayName.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20);
  identity.ensName = `${label || short}.session.eth`;
  writeFileSync(path, JSON.stringify(identity, null, 2));
  return identity;
}

export class RelayBridge {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private intentionalClose = false;

  me: SessionIdentity;
  connected = false;
  peers: PeerInfo[] = [];
  room: RoomInfo | null = null;
  pings: PingMessage[] = [];
  match: ChessState | null = null;
  challenges: ChallengeInfo[] = [];
  error: string | null = null;
  seeking = false;
  waiting = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;

  constructor(
    private relayUrl: string,
    displayName: string,
    instanceId: string,
  ) {
    this.me = loadIdentity(displayName, instanceId);
  }

  get state(): UiState {
    return {
      connected: this.connected,
      me: this.me,
      peers: this.peers.filter((p) => p.id !== this.me.id),
      room: this.room,
      pings: this.pings,
      match: this.match,
      challenges: this.challenges,
      error: this.error,
      seeking: this.seeking,
      waiting: this.waiting,
    };
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.connecting) return;
    this.intentionalClose = false;
    this.error = null;
    this.connecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(this.relayUrl);
        this.ws = ws;
        const onOpen = () => {
          cleanup();
          this.connected = true;
          this.connecting = false;
          this.send({ type: "hello", identity: this.me });
          this.startHeartbeat();
          this.emit();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          this.connecting = false;
          this.error = err.message;
          this.emit();
          reject(err);
        };
        const cleanup = () => {
          ws.off("open", onOpen);
          ws.off("error", onError);
        };
        ws.on("open", onOpen);
        ws.on("error", onError);
        ws.on("message", (data) => this.onMessage(data.toString()));
        ws.on("close", () => {
          this.connected = false;
          this.connecting = false;
          this.stopHeartbeat();
          this.emit();
          this.scheduleReconnect();
        });
      });
    } catch (err) {
      this.connecting = false;
      this.scheduleReconnect();
      throw err;
    }
  }

  private scheduleReconnect() {
    if (this.intentionalClose || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => undefined);
    }, 2500);
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.emit();
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ type: "heartbeat" }), 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private onMessage(raw: string) {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        this.peers = msg.peers;
        this.room = msg.room;
        this.seeking = false;
        this.waiting = msg.peers.filter((p) => p.waiting).length;
        break;
      case "peers":
        this.peers = msg.peers;
        this.waiting = msg.peers.filter((p) => p.waiting && p.id !== this.me.id).length;
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
        if (msg.match.status !== "finished") this.seeking = false;
        break;
      case "queue":
        this.seeking = msg.seeking;
        this.waiting = msg.waiting;
        break;
      case "poll_state":
        this.peers = msg.peers;
        this.room = msg.room;
        this.pings = msg.pings;
        this.match = msg.match;
        this.challenges = msg.challenges;
        break;
      case "error":
        this.error = msg.message;
        break;
    }
    this.emit();
  }

  createRoom() {
    this.send({ type: "create_room" });
  }

  joinRoom(code: string) {
    this.send({ type: "join_room", code: code.toUpperCase().trim() });
  }

  leaveRoom() {
    this.send({ type: "leave_room" });
  }

  ping(to: SessionId, text: string) {
    this.send({ type: "ping", to, text });
  }

  challenge(to: SessionId, stakeWei = "0") {
    this.send({ type: "challenge", to, stakeWei });
  }

  respond(challengeId: string, accept: boolean) {
    this.send({ type: "respond_challenge", challengeId, accept });
  }

  move(matchId: string, uci: string) {
    this.send({ type: "move", matchId, uci });
  }

  resign(matchId: string) {
    this.send({ type: "resign", matchId });
  }

  /** Pair with whoever is already waiting, or wait for the next person. */
  next() {
    this.error = null;
    this.send({ type: "next" });
  }

  poll() {
    this.send({ type: "poll" });
  }
}
