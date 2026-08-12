export type Difficulty = "easy" | "normal" | "hard";
export type GameMode = "multiplication";
export type RoomStatus = "waiting" | "playing" | "results" | "finished";
export type PlayerStatus = "lobby" | "racing" | "finished" | "dnf";

export interface RoomSummary {
  id: string;
  roomName: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  gameMode: GameMode;
  difficulty: Difficulty;
  isLocked: boolean;
  status: RoomStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface RoomMeta {
  roomName: string;
  hostId: string;
  maxPlayers: number;
  gameMode: GameMode;
  difficulty: Difficulty;
  status: RoomStatus;
  isLocked: boolean;
  createdAt: number;
  currentRoundId?: string;
  finishedAt?: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  joinedAt: number;
  ready: boolean;
  online: boolean;
  disconnectedAt?: number | null;
  completedCount: number;
  progressAt?: number;
  status: PlayerStatus;
  elapsedTime?: number | null;
  finishedAt?: number | null;
}

export interface RoundConfig {
  id: string;
  seed: string;
  rowValues: number[];
  columnValues: number[];
  difficulty: Difficulty;
  gameMode: GameMode;
  createdAt: number;
  participantIds: string[];
}

export interface RoomData {
  meta: RoomMeta;
  players: Record<string, Omit<RoomPlayer, "id">>;
  rounds?: Record<string, Omit<RoundConfig, "id">>;
}

export interface LocalRunState {
  roundId: string;
  remainingQueue: number[];
  answers: Array<number | null>;
  passed: boolean[];
  input: string;
  feedback: "idle" | "correct" | "wrong";
}

export interface PersistedRun {
  state: LocalRunState;
  elapsedMs: number;
  savedAt: number;
}

export interface GameDefinition {
  id: GameMode;
  label: string;
  symbol: string;
  answer(rowValue: number, columnValue: number): number;
}
