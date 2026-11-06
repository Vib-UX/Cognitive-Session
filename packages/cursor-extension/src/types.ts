export type SessionId = `sess_${string}`;

export interface SessionIdentity {
  id: SessionId;
  displayName: string;
  host: "cursor" | "claude";
  ensName?: string;
}

export interface PeerInfo {
  id: SessionId;
  displayName: string;
  host: string;
  nearby: boolean;
  roomCode: string | null;
  ensName?: string;
  lastSeen: number;
  waiting?: boolean;
}

export interface RoomInfo {
  code: string;
  members: SessionId[];
  createdAt: number;
  matchId: string | null;
}

export interface PingMessage {
  id: string;
  from: SessionId;
  fromName: string;
  to: SessionId;
  text: string;
  at: number;
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
  result?: unknown;
  stakeWei?: string;
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

export type ServerMessage =
  | { type: "welcome"; identity: SessionIdentity; peers: PeerInfo[]; room: RoomInfo | null }
  | { type: "peers"; peers: PeerInfo[] }
  | { type: "room"; room: RoomInfo | null }
  | { type: "ping"; message: PingMessage }
  | { type: "challenge"; challenge: ChallengeInfo }
  | { type: "challenge_resolved"; challengeId: string; accepted: boolean; match?: ChessState }
  | { type: "match"; match: ChessState }
  | { type: "queue"; seeking: boolean; waiting: number }
  | { type: "error"; message: string }
  | {
      type: "poll_state";
      peers: PeerInfo[];
      room: RoomInfo | null;
      pings: PingMessage[];
      match: ChessState | null;
      challenges: ChallengeInfo[];
    };

export interface UiState {
  connected: boolean;
  me: SessionIdentity | null;
  peers: PeerInfo[];
  room: RoomInfo | null;
  pings: PingMessage[];
  match: ChessState | null;
  challenges: ChallengeInfo[];
  error: string | null;
  /** This window pressed Next and is waiting for a partner. */
  seeking: boolean;
  /** Other sessions already waiting for Next. */
  waiting: number;
}
