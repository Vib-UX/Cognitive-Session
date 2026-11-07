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
  FlappyView,
  BankView,
  SnakeDir,
  SnakeState,
  UiState,
} from "./types";

type Listener = (state: UiState, kind?: "snake") => void;

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
  private bankListeners = new Set<(view: BankView) => void>();
  private intentionalClose = false;

  me: SessionIdentity;
  connected = false;
  peers: PeerInfo[] = [];
  room: RoomInfo | null = null;
  pings: PingMessage[] = [];
  match: ChessState | null = null;
  snake: SnakeState | null = null;
  flappy: FlappyView | null = null;
  bank: BankView | null = null;
  challenges: ChallengeInfo[] = [];
  error: string | null = null;
  seeking = false;
  waiting = 0;
  drawing = false;

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
      snake: this.snake,
      flappy: this.flappy,
      challenges: this.challenges,
      error: this.error,
      seeking: this.seeking,
      waiting: this.waiting,
      drawing: this.drawing,
    };
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  onBank(fn: (view: BankView) => void): () => void {
    this.bankListeners.add(fn);
    if (this.bank) fn(this.bank);
    return () => this.bankListeners.delete(fn);
  }

  private emit(kind?: "snake") {
    const s = this.state;
    for (const fn of this.listeners) fn(s, kind);
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
        this.poll();
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
        if (msg.match.status !== "finished") {
          this.seeking = false;
          this.drawing = false;
        }
        break;
      case "snake":
        this.snake = msg.match;
        this.emit("snake");
        return;
      case "flappy":
        this.flappy = msg.flappy;
        break;
      case "bank":
        this.bank = msg.bank;
        if (this.error === "Unknown message type") this.error = null;
        for (const fn of this.bankListeners) fn(msg.bank);
        break;
      case "bank_paid":
        if (this.pendingClaim) {
          const pending = this.pendingClaim;
          this.pendingClaim = null;
          pending.onPaid(msg.usd, msg.chainName);
        }
        break;
      case "queue":
        this.seeking = msg.seeking;
        this.waiting = msg.waiting;
        this.drawing = Boolean(msg.drawing);
        break;
      case "poll_state":
        this.peers = msg.peers;
        this.room = msg.room;
        this.pings = msg.pings;
        this.match = msg.match;
        this.snake = msg.snake ?? null;
        this.flappy = msg.flappy ?? this.flappy;
        this.challenges = msg.challenges;
        if (msg.match && msg.match.status !== "finished") this.drawing = false;
        break;
      case "error":
        if (msg.scope === "bank") {
          const pending = this.pendingClaim;
          this.pendingClaim = null;
          pending?.onError(msg.message);
          return;
        }
        this.error = msg.message;
        if (this.pendingReward && (msg.scope === "reward" || msg.message === "Unknown message type")) {
          const pending = this.pendingReward;
          this.pendingReward = null;
          pending.onError(msg.message);
        }
        break;
      case "reward":
        if (this.pendingReward) {
          const pending = this.pendingReward;
          this.pendingReward = null;
          pending.onReward(msg.txHash, msg.chainName);
        }
        break;
    }
    this.emit();
  }

  private pendingReward: {
    onReward: (txHash: string, chainName: string) => void;
    onError: (message: string) => void;
  } | null = null;

  private pendingClaim: {
    onPaid: (usd: string, chainName: string) => void;
    onError: (message: string) => void;
  } | null = null;

  claimReward(
    amount: string,
    hooks: { onReward: (txHash: string, chainName: string) => void; onError: (message: string) => void },
  ) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      hooks.onError("Relay is disconnected");
      return;
    }
    this.pendingReward = hooks;
    this.send({ type: "claim_reward", amount });
  }

  /** Ask the relay to read a USDC transfer into the play balance. */
  syncDeposit(): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.send({ type: "sync_deposit" });
    return true;
  }

  claimBalance(hooks: { onPaid: (usd: string, chainName: string) => void; onError: (message: string) => void }) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      hooks.onError("Relay is disconnected");
      return;
    }
    this.pendingClaim = hooks;
    this.send({ type: "claim_balance" });
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

  /** Pair with whoever is waiting to fly. The relay compares the two scores. */
  flappyJoin() {
    this.error = null;
    this.send({ type: "flappy_join" });
  }

  flappyScore(contestId: string, score: number) {
    const points = Math.max(0, Math.floor(score));
    this.send({ type: "flappy_score", contestId, score: points });
  }

  /**
   * Join a snake room. A prompt that selects snakes passes OPEN, the shared room.
   * With no code, stay in the current room, or enter OPEN if there isn't one.
   */
  snakeJoin(code?: string) {
    const room = code?.trim().toUpperCase();
    const mine = this.snake?.players.find((player) => player.id === this.me.id);
    const already =
      mine?.connected && this.snake && this.snake.status !== "finished" && (!room || this.snake.roomCode === room);
    if (already) return;
    this.error = null;
    this.send(room ? { type: "snake_join", code: room } : { type: "snake_join" });
  }

  snakeSteer(dir: SnakeDir, boost = false) {
    if (!this.snake) return;
    this.send({ type: "snake_steer", matchId: this.snake.matchId, dir, boost });
  }

  snakeLeave() {
    this.send({ type: "snake_leave" });
  }

  setPlayer(wallet: `0x${string}`, chainId: number) {
    this.me.walletAddress = wallet;
    this.me.chainId = chainId;
    const path = join(homedir(), ".session", "cursor-extension", `identity-${this.me.id.slice(5)}.json`);
    mkdirSync(join(homedir(), ".session", "cursor-extension"), { recursive: true });
    writeFileSync(path, JSON.stringify(this.me, null, 2));
    this.send({ type: "hello", identity: this.me });
    this.emit();
  }
}
