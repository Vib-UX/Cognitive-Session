export type HostKind = "cursor" | "claude" | "web";
export type SessionId = `sess_${string}`;

export interface PeerInfo {
  id: SessionId;
  displayName: string;
  host: HostKind;
  nearby: boolean;
  roomCode: string | null;
  ensName?: string;
  lastSeen: number;
}

export interface PingMessage {
  id: string;
  from: SessionId;
  fromName: string;
  to: SessionId;
  text: string;
  at: number;
}

export interface RoomInfo {
  code: string;
  members: SessionId[];
  createdAt: number;
  matchId: string | null;
}

export interface ChessState {
  matchId: string;
  roomCode: string;
  white: SessionId;
  black: SessionId;
  fen: string;
  turn: "w" | "b";
  clocksMs: { w: number; b: number };
  lastMoveAt: number;
  status: "pending_deposit" | "active" | "finished";
  result?:
    | { kind: "win"; winner: SessionId; reason: string }
    | { kind: "draw"; reason: string };
  stakeWei?: string;
  lockTx?: string;
  ccipMessageId?: string;
  payoutTx?: string;
}

export interface ChallengeInfo {
  id: string;
  from: SessionId;
  fromName: string;
  to: SessionId;
  stakeWei: string;
  createdAt: number;
  expiresAt: number;
}

export type SnakeDir = "up" | "down" | "left" | "right";

export interface SnakePoint {
  x: number;
  y: number;
}

export interface SnakePlayer {
  id: SessionId;
  name: string;
  color: string;
  body: SnakePoint[];
  dir: SnakeDir;
  pendingDir: SnakeDir;
  alive: boolean;
  connected: boolean;
  score: number;
  boost: boolean;
  deadAt: number | null;
}

export interface SnakePellet {
  id: number;
  x: number;
  y: number;
  value: number;
}

export interface SnakeState {
  matchId: string;
  roomCode: string;
  width: number;
  height: number;
  tick: number;
  players: SnakePlayer[];
  pellets: SnakePellet[];
  status: "waiting" | "active" | "finished";
  startedAt: number | null;
  endsAt: number | null;
  result?: {
    kind: "win" | "draw";
    winner?: SessionId;
    reason: "score" | "last";
    scores: { id: SessionId; name: string; score: number }[];
  };
}

export interface PresenceSnapshot {
  peers: PeerInfo[];
  rooms: RoomInfo[];
  recentPings: PingMessage[];
  matches: ChessState[];
  challenges: ChallengeInfo[];
  snakes?: SnakeState[];
}
