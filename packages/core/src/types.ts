export type HostKind = "cursor" | "claude";

export type SessionId = `sess_${string}`;

export interface SessionIdentity {
  id: SessionId;
  displayName: string;
  host: HostKind;
  ensName?: string;
  walletAddress?: `0x${string}`;
}

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

export type ChessColor = "w" | "b";

export type GameResult =
  | { kind: "win"; winner: SessionId; reason: "checkmate" | "resign" | "timeout" }
  | { kind: "draw"; reason: "stalemate" | "agreement" | "timeout" };

export interface ChessState {
  matchId: string;
  roomCode: string;
  white: SessionId;
  black: SessionId;
  fen: string;
  turn: ChessColor;
  clocksMs: { w: number; b: number };
  lastMoveAt: number;
  status: "pending_deposit" | "active" | "finished";
  result?: GameResult;
  stakeWei?: string;
  lockTx?: string;
  ccipMessageId?: string;
  payoutTx?: string;
}

export interface RoomInfo {
  code: string;
  members: SessionId[];
  createdAt: number;
  matchId: string | null;
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

export interface SnakeResult {
  kind: "win" | "draw";
  winner?: SessionId;
  reason: "score" | "last";
  scores: { id: SessionId; name: string; score: number }[];
}

export interface SnakeState {
  matchId: string;
  roomCode: string;
  width: number;
  height: number;
  tick: number;
  pelletSeq: number;
  players: SnakePlayer[];
  pellets: SnakePellet[];
  status: "waiting" | "active" | "finished";
  startedAt: number | null;
  endsAt: number | null;
  result?: SnakeResult;
}

/** Client -> relay */
export type ClientMessage =
  | { type: "hello"; identity: SessionIdentity }
  | { type: "heartbeat" }
  | { type: "create_room" }
  | { type: "join_room"; code: string }
  | { type: "leave_room" }
  | { type: "ping"; to: SessionId; text: string }
  | { type: "challenge"; to: SessionId; stakeWei?: string }
  | { type: "respond_challenge"; challengeId: string; accept: boolean }
  | { type: "move"; matchId: string; uci: string }
  | { type: "resign"; matchId: string }
  | { type: "poll" }
  | {
      type: "set_match_meta";
      matchId: string;
      lockTx?: string;
      ccipMessageId?: string;
      payoutTx?: string;
      status?: ChessState["status"];
    }
  | { type: "snake_join"; code?: string }
  | { type: "snake_steer"; matchId: string; dir: SnakeDir; boost?: boolean }
  | { type: "snake_leave" };

/** Relay -> client */
export type ServerMessage =
  | { type: "welcome"; identity: SessionIdentity; peers: PeerInfo[]; room: RoomInfo | null }
  | { type: "peers"; peers: PeerInfo[] }
  | { type: "room"; room: RoomInfo | null }
  | { type: "ping"; message: PingMessage }
  | { type: "challenge"; challenge: ChallengeInfo }
  | { type: "challenge_resolved"; challengeId: string; accepted: boolean; match?: ChessState }
  | { type: "match"; match: ChessState }
  | { type: "error"; message: string }
  | { type: "snake"; match: SnakeState }
  | {
      type: "poll_state";
      peers: PeerInfo[];
      room: RoomInfo | null;
      pings: PingMessage[];
      match: ChessState | null;
      challenges: ChallengeInfo[];
      snake: SnakeState | null;
    };

export interface PresenceSnapshot {
  peers: PeerInfo[];
  rooms: RoomInfo[];
  recentPings: PingMessage[];
  matches: ChessState[];
}
