import { FirebaseError } from "firebase/app";
import { signInAnonymously, type User } from "firebase/auth";
import {
  get,
  limitToFirst,
  off,
  onDisconnect,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type Unsubscribe,
} from "firebase/database";
import { auth, database } from "../firebase";
import { createRandomSeed, generateOperands, GENERATOR_VERSION, normalizeSeed } from "../game/problems";
import type { Difficulty, GameMode, GridSize, LeaderboardEntry, RoomData, RoomPlayer, RoomSummary, RoundConfig } from "../types";

const DISCONNECT_GRACE_MS = 30_000;
const FINISHED_ROOM_TTL_MS = 5 * 60_000;
const ACTIVE_ROOM_TTL_MS = 2 * 60 * 60_000;

type StoredPlayer = Omit<RoomPlayer, "id"> & { joinHash: string };
type StoredRoom = Omit<RoomData, "players"> & { players: Record<string, StoredPlayer> };

function cleanText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || Array.from(normalized).length > maxLength) {
    throw new Error(`${label}は1〜${maxLength}文字で入力してください。`);
  }
  return normalized;
}

async function passwordProof(password: string): Promise<string> {
  if (!password) return "OPEN";
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hash}`;
}

const GAME_MODES: GameMode[] = ["addition", "subtraction", "multiplication", "division", "gcd"];

function gameModeOf(value: unknown): GameMode {
  return typeof value === "string" && GAME_MODES.includes(value as GameMode) ? value as GameMode : "multiplication";
}

function gridSizeOf(value: unknown, rowValues?: number[]): GridSize {
  return value === 5 || rowValues?.length === 5 ? 5 : 10;
}

function roomSeed(room: Pick<StoredRoom, "meta" | "rounds">): string {
  const currentRound = room.meta.currentRoundId ? room.rounds?.[room.meta.currentRoundId] : undefined;
  return typeof room.meta.seed === "string" && room.meta.seed ? room.meta.seed : currentRound?.seed ?? "LEGACY";
}

function normalizedRound(id: string, round: Omit<RoundConfig, "id">): RoundConfig {
  return {
    ...round,
    id,
    gameMode: gameModeOf(round.gameMode),
    gridSize: gridSizeOf(round.gridSize, round.rowValues),
    generatorVersion: Number.isInteger(round.generatorVersion) ? round.generatorVersion : 0,
  };
}

function normalizedRoom(room: RoomData): RoomData {
  const rounds = Object.fromEntries(Object.entries(room.rounds ?? {}).map(([id, round]) => {
    const normalized = normalizedRound(id, round);
    const { id: _id, ...stored } = normalized;
    return [id, stored];
  }));
  return {
    ...room,
    meta: {
      ...room.meta,
      gameMode: gameModeOf(room.meta.gameMode),
      gridSize: gridSizeOf(room.meta.gridSize),
      seed: room.meta.seed || (room.meta.currentRoundId ? rounds[room.meta.currentRoundId]?.seed : undefined) || "LEGACY",
    },
    rounds,
  };
}

type DirectoryValue = Omit<RoomSummary, "id"> & { hostId: string };

function directoryValue(room: StoredRoom): DirectoryValue {
  const gridSize = gridSizeOf(room.meta.gridSize);
  const value: DirectoryValue = {
    roomName: room.meta.roomName,
    hostId: room.meta.hostId,
    hostName: room.players[room.meta.hostId]?.name ?? "---",
    playerCount: Object.keys(room.players ?? {}).length,
    maxPlayers: room.meta.maxPlayers,
    gameMode: gameModeOf(room.meta.gameMode),
    difficulty: room.meta.difficulty,
    gridSize,
    seed: roomSeed(room),
    isLocked: room.meta.isLocked,
    status: room.meta.status,
    createdAt: room.meta.createdAt,
  };
  const currentRound = room.meta.currentRoundId ? room.rounds?.[room.meta.currentRoundId] : undefined;
  if (currentRound?.createdAt !== undefined) value.startedAt = currentRound.createdAt;
  if (room.meta.finishedAt !== undefined) value.finishedAt = room.meta.finishedAt;
  return value;
}

async function syncDirectory(roomId: string): Promise<void> {
  const snapshot = await get(ref(database, `rooms/${roomId}`));
  if (!snapshot.exists()) return;
  await set(ref(database, `roomDirectory/${roomId}`), directoryValue(snapshot.val() as StoredRoom));
}
function roomExpiryAt(room: Pick<RoomSummary, "status" | "startedAt" | "finishedAt">): number | null {
  if (room.status === "finished" && room.finishedAt) return room.finishedAt + FINISHED_ROOM_TTL_MS;
  if ((room.status === "playing" || room.status === "results") && room.startedAt) return room.startedAt + ACTIVE_ROOM_TTL_MS;
  return null;
}

async function removeRoomData(roomId: string): Promise<void> {
  await remove(ref(database, `roomSecrets/${roomId}`));
  await remove(ref(database, `rooms/${roomId}`));
  await remove(ref(database, `roomDirectory/${roomId}`));
}

async function cleanupExpiredRoom(room: Pick<RoomSummary, "id" | "status" | "startedAt" | "finishedAt">): Promise<void> {
  const expiresAt = roomExpiryAt(room);
  if (!expiresAt || Date.now() < expiresAt) return;
  await removeRoomData(room.id);
}

export async function deleteFinishedRoom(roomId: string): Promise<void> {
  await ensureAnonymousUser();
  const snapshot = await get(ref(database, `roomDirectory/${roomId}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val() as Omit<RoomSummary, "id">;
  if (room.status !== "finished") throw new Error("終了したルームだけ削除できます。");
  await removeRoomData(roomId);
}

function normalizedStatus(room: StoredRoom): "playing" | "results" | "finished" {
  const players = Object.values(room.players ?? {});
  if (players.length > 0 && players.every((player) => player.status === "finished" || player.status === "dnf")) {
    return "finished";
  }
  return players.some((player) => player.status === "finished") ? "results" : "playing";
}

export async function ensureAnonymousUser(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}

export function friendlyError(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code.includes("permission-denied")) {
      return "合言葉が違うか、ルームの状態が変わりました。";
    }
    if (error.code.includes("unavailable") || error.code.includes("network-request-failed")) {
      return "Firebaseへ接続できません。ネットワークを確認してください。";
    }
    const message = error.message.replace(/^Firebase:\s*/i, "").replace(/\s*\([^)]*\)\.?$/, "");
    return message || "Firebaseでエラーが発生しました。";
  }
  return error instanceof Error ? error.message : "予期しないエラーが発生しました。";
}

export function subscribeRoomDirectory(
  onRooms: (rooms: RoomSummary[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const directoryQuery = query(ref(database, "roomDirectory"), orderByChild("createdAt"));
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = onValue(
    directoryQuery,
    (snapshot) => {
      if (expiryTimer) clearTimeout(expiryTimer);
      const value = (snapshot.val() ?? {}) as Record<string, Omit<RoomSummary, "id">>;
      const rooms = Object.entries(value)
        .map(([id, room]) => ({
          id,
          ...room,
          gameMode: gameModeOf(room.gameMode),
          gridSize: gridSizeOf(room.gridSize),
          seed: room.seed || "LEGACY",
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
      const now = Date.now();
      const expired = rooms.filter((room) => {
        const expiresAt = roomExpiryAt(room);
        return expiresAt !== null && now >= expiresAt;
      });
      expired.forEach((room) => { void cleanupExpiredRoom(room).catch(() => undefined); });
      onRooms(rooms.filter((room) => !expired.includes(room)));

      const nextExpiry = rooms
        .map((room) => ({ room, expiresAt: roomExpiryAt(room) }))
        .filter((item): item is { room: RoomSummary; expiresAt: number } => item.expiresAt !== null && item.expiresAt > now)
        .sort((a, b) => a.expiresAt - b.expiresAt)[0];
      if (nextExpiry) {
        expiryTimer = setTimeout(() => {
          void cleanupExpiredRoom(nextExpiry.room).catch(() => undefined);
        }, Math.max(100, nextExpiry.expiresAt - now + 100));
      }
    },
    onError,
  );
  return () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    unsubscribe();
  };
}

export function subscribeRoom(
  roomId: string,
  onRoom: (room: RoomData | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const roomRef = ref(database, `rooms/${roomId}`);
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = onValue(roomRef, (snapshot) => {
    if (expiryTimer) clearTimeout(expiryTimer);
    const stored = snapshot.val() as RoomData | null;
    const room = stored ? normalizedRoom(stored) : null;
    onRoom(room);
    if (!room) return;
    const startedAt = room.meta.currentRoundId ? room.rounds?.[room.meta.currentRoundId]?.createdAt : undefined;
    const summary = { id: roomId, status: room.meta.status, startedAt, finishedAt: room.meta.finishedAt };
    const expiresAt = roomExpiryAt(summary);
    if (expiresAt) {
      expiryTimer = setTimeout(() => {
        void cleanupExpiredRoom(summary).catch(() => undefined);
      }, Math.max(100, expiresAt - Date.now() + 100));
    }
  }, onError);
  return () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    unsubscribe();
  };
}

export async function createRoom(input: {
  roomName: string;
  playerName: string;
  password: string;
  maxPlayers: number;
  difficulty: Difficulty;
  gameMode: GameMode;
  gridSize: GridSize;
  seed: string;
}): Promise<string> {
  const user = await ensureAnonymousUser();
  const roomName = cleanText(input.roomName, "ルーム名", 24);
  const playerName = cleanText(input.playerName, "プレイヤー名", 16);
  if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < 1 || input.maxPlayers > 8) {
    throw new Error("最大人数は1〜8人で指定してください。");
  }
  if (!(["easy", "normal", "hard"] as string[]).includes(input.difficulty)) {
    throw new Error("難易度が不正です。");
  }
  if (!GAME_MODES.includes(input.gameMode)) throw new Error("計算モードが不正です。");
  if (input.gridSize !== 5 && input.gridSize !== 10) throw new Error("マス数が不正です。");
  const seed = input.seed.trim() ? normalizeSeed(input.seed) : createRandomSeed();

  const roomId = push(ref(database, "rooms")).key;
  if (!roomId) throw new Error("ルームIDを生成できませんでした。");
  const now = Date.now();
  const joinHash = await passwordProof(input.password);
  const player: StoredPlayer = {
    name: playerName,
    joinedAt: now,
    ready: true,
    online: true,
    disconnectedAt: null,
    completedCount: 0,
    status: "lobby",
    elapsedTime: null,
    finishedAt: null,
    joinHash,
  };
  const room: StoredRoom = {
    meta: {
      roomName,
      hostId: user.uid,
      maxPlayers: input.maxPlayers,
      gameMode: input.gameMode,
      difficulty: input.difficulty,
      gridSize: input.gridSize,
      seed,
      status: "waiting",
      isLocked: Boolean(input.password),
      createdAt: now,
    },
    players: { [user.uid]: player },
  };

  const secretRef = ref(database, `roomSecrets/${roomId}`);
  const roomRef = ref(database, `rooms/${roomId}`);
  try {
    await set(secretRef, { ownerId: user.uid, joinHash, createdAt: now });
    await set(roomRef, room);
    await set(ref(database, `roomDirectory/${roomId}`), directoryValue(room));
  } catch (error) {
    await Promise.allSettled([remove(roomRef), remove(secretRef), remove(ref(database, `roomDirectory/${roomId}`))]);
    throw error;
  }
  return roomId;
}

export async function joinRoom(input: { roomId: string; playerName: string; password: string }): Promise<string> {
  const user = await ensureAnonymousUser();
  const roomId = cleanText(input.roomId, "ルームID", 80);
  const playerName = cleanText(input.playerName, "プレイヤー名", 16);
  const summarySnapshot = await get(ref(database, `roomDirectory/${roomId}`));
  if (!summarySnapshot.exists()) throw new Error("ルームが見つかりません。");
  const summary = summarySnapshot.val() as RoomSummary;
  if (summary.status !== "waiting") throw new Error("このルームの受付は終了しました。");
  if (summary.playerCount >= summary.maxPlayers) throw new Error("このルームは満員です。");

  const joinHash = await passwordProof(input.password);
  const now = Date.now();
  const player: StoredPlayer = {
    name: playerName,
    joinedAt: now,
    ready: false,
    online: true,
    disconnectedAt: null,
    completedCount: 0,
    status: "lobby",
    elapsedTime: null,
    finishedAt: null,
    joinHash,
  };
  const playerRef = ref(database, `rooms/${roomId}/players/${user.uid}`);
  await set(playerRef, player);

  const roomSnapshot = await get(ref(database, `rooms/${roomId}`));
  const room = roomSnapshot.val() as StoredRoom | null;
  const duplicate = room && Object.entries(room.players).some(
    ([id, existing]) => id !== user.uid && existing.name.toLocaleLowerCase("ja") === playerName.toLocaleLowerCase("ja"),
  );
  if (duplicate) {
    await remove(playerRef);
    throw new Error("同じ名前の参加者がいます。");
  }
  await syncDirectory(roomId);
  return roomId;
}

export async function leaveRoom(roomId: string): Promise<void> {
  const user = await ensureAnonymousUser();
  const roomRef = ref(database, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;
  const room = snapshot.val() as StoredRoom;
  const player = room.players[user.uid];
  if (!player) return;

  if (room.meta.status === "waiting" && room.meta.hostId === user.uid) {
    await remove(ref(database, `roomDirectory/${roomId}`));
    await remove(roomRef);
    await remove(ref(database, `roomSecrets/${roomId}`));
    return;
  }
  if (room.meta.status === "waiting") {
    await remove(ref(database, `rooms/${roomId}/players/${user.uid}`));
    await syncDirectory(roomId);
    return;
  }

  await update(ref(database, `rooms/${roomId}/players/${user.uid}`), {
    online: false,
    disconnectedAt: Date.now(),
    status: player.status === "racing" ? "dnf" : player.status,
  });
  if (room.meta.hostId === user.uid) {
    await reconcileRoom(roomId);
    return;
  }

  const latest = (await get(roomRef)).val() as StoredRoom | null;
  if (!latest) return;
  const status = normalizedStatus(latest);
  if (status !== latest.meta.status) {
    const metaUpdate: { status: "playing" | "results" | "finished"; finishedAt?: number } = { status };
    if (status === "finished") metaUpdate.finishedAt = Date.now();
    await update(ref(database, `rooms/${roomId}/meta`), metaUpdate);
    await syncDirectory(roomId);
  }
}

export async function startRound(roomId: string): Promise<void> {
  const user = await ensureAnonymousUser();
  const roomRef = ref(database, `rooms/${roomId}`);
  const before = (await get(roomRef)).val() as StoredRoom | null;
  const roundId = push(ref(database, `rooms/${roomId}/rounds`)).key;
  if (!roundId) throw new Error("ラウンドIDを生成できませんでした。");
  const fallbackSeed = createRandomSeed();
  let failure = "現在は開始できません。";

  const result = await runTransaction(roomRef, (current: StoredRoom | null) => {
    current ??= before ? structuredClone(before) : null;
    if (!current || current.meta.status !== "waiting") return;
    if (current.meta.hostId !== user.uid) {
      failure = "ホストだけが開始できます。";
      return;
    }
    const entries = Object.entries(current.players ?? {}).sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
    if (entries.length < 1 || entries.some(([id, player]) => id !== user.uid && !player.ready)) {
      failure = "READYになっていない参加者がいます。";
      return;
    }
    const now = Date.now();
    const gameMode = gameModeOf(current.meta.gameMode);
    const gridSize = gridSizeOf(current.meta.gridSize);
    const seed = current.meta.seed ? normalizeSeed(current.meta.seed) : fallbackSeed;
    const generated = generateOperands({ seed, gameMode, gridSize, difficulty: current.meta.difficulty });
    current.meta.gameMode = gameMode;
    current.meta.gridSize = gridSize;
    current.meta.seed = seed;
    current.meta.status = "playing";
    current.meta.currentRoundId = roundId;
    current.rounds ??= {};
    current.rounds[roundId] = {
      seed,
      generatorVersion: GENERATOR_VERSION,
      rowValues: generated.rowValues,
      columnValues: generated.columnValues,
      difficulty: current.meta.difficulty,
      gameMode,
      gridSize,
      createdAt: now,
      participantIds: entries.map(([id]) => id),
    };
    for (const [, player] of entries) {
      player.ready = false;
      player.completedCount = 0;
      player.status = "racing";
      player.elapsedTime = null;
      player.finishedAt = null;
    }
    return current;
  }, { applyLocally: false });

  if (!result.committed) throw new Error(failure);
  await syncDirectory(roomId);
}

export async function resumeRoom(roomId: string): Promise<void> {
  const user = await ensureAnonymousUser();
  let failure = "ルームに復帰できません。";
  const playerRef = ref(database, `rooms/${roomId}/players/${user.uid}`);
  const before = (await get(playerRef)).val() as StoredPlayer | null;
  const result = await runTransaction(playerRef, (player: StoredPlayer | null) => {
    player ??= before ? structuredClone(before) : null;
    if (!player) return;
    if (player.status === "dnf") {
      failure = "再接続猶予を過ぎました。";
      return;
    }
    if (player.disconnectedAt && Date.now() - player.disconnectedAt > DISCONNECT_GRACE_MS && player.status === "racing") {
      failure = "再接続猶予を過ぎました。";
      return;
    }
    player.online = true;
    player.disconnectedAt = null;
    return player;
  });
  if (!result.committed) throw new Error(failure);
}

export async function submitFinish(roomId: string, roundId: string, elapsedTime: number): Promise<void> {
  const user = await ensureAnonymousUser();
  const roomSnapshot = await get(ref(database, `rooms/${roomId}`));
  const room = roomSnapshot.val() as StoredRoom | null;
  if (!room || room.meta.currentRoundId !== roundId) throw new Error("ゴールを確定できませんでした。");
  const round = room.rounds?.[roundId];
  if (!round) throw new Error("ゴールを確定できませんでした。");
  const total = gridSizeOf(round.gridSize, round.rowValues) ** 2;
  const rounded = Math.round(elapsedTime);
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 86_400_000) throw new Error("タイムが不正です。");

  const playerRef = ref(database, `rooms/${roomId}/players/${user.uid}`);
  const beforePlayer = room.players[user.uid] ?? null;
  const result = await runTransaction(playerRef, (player: StoredPlayer | null) => {
    player ??= beforePlayer ? structuredClone(beforePlayer) : null;
    if (!player || player.status === "dnf") return;
    if (player.status === "finished") return player;
    player.completedCount = total;
    player.status = "finished";
    player.elapsedTime = rounded;
    player.finishedAt = Date.now();
    return player;
  });
  if (!result.committed) throw new Error("ゴールを確定できませんでした。");
  const latest = (await get(ref(database, `rooms/${roomId}`))).val() as StoredRoom | null;
  if (!latest) return;
  const status = normalizedStatus(latest);
  const metaUpdate: { status: "playing" | "results" | "finished"; finishedAt?: number } = { status };
  if (status === "finished") metaUpdate.finishedAt = latest.meta.finishedAt ?? Date.now();
  await update(ref(database, `rooms/${roomId}/meta`), metaUpdate);
  await syncDirectory(roomId);
  await recordLeaderboardBest(roomId, roundId);
}

export async function recordLeaderboardBest(roomId: string, roundId: string): Promise<void> {
  const user = await ensureAnonymousUser();
  const snapshot = await get(ref(database, `rooms/${roomId}`));
  const stored = snapshot.val() as StoredRoom | null;
  if (!stored || stored.meta.currentRoundId !== roundId) throw new Error("ランキング記録を確認できませんでした。");
  const room = normalizedRoom(stored);
  const player = room.players[user.uid];
  const roundValue = room.rounds?.[roundId];
  if (!player || player.status !== "finished" || player.elapsedTime == null || !roundValue) {
    throw new Error("完走後にランキングへ登録できます。");
  }
  const round = normalizedRound(roundId, roundValue);
  const entryRef = ref(database, `leaderboards/${round.gameMode}/${round.gridSize}/${round.difficulty}/${user.uid}`);
  const entry: Omit<LeaderboardEntry, "id"> = {
    playerName: player.name,
    elapsedTime: player.elapsedTime,
    seed: round.seed,
    achievedAt: player.finishedAt ?? Date.now(),
    roomId,
    roundId,
    generatorVersion: round.generatorVersion,
  };
  await runTransaction(entryRef, (current: Omit<LeaderboardEntry, "id"> | null) => {
    if (current && current.elapsedTime <= entry.elapsedTime) return current;
    return entry;
  }, { applyLocally: false });
}

export function subscribeLeaderboard(
  gameMode: GameMode,
  gridSize: GridSize,
  difficulty: Difficulty,
  onEntries: (entries: LeaderboardEntry[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const leaderboardQuery = query(
    ref(database, `leaderboards/${gameMode}/${gridSize}/${difficulty}`),
    orderByChild("elapsedTime"),
    limitToFirst(5),
  );
  return onValue(leaderboardQuery, (snapshot) => {
    const value = (snapshot.val() ?? {}) as Record<string, Omit<LeaderboardEntry, "id">>;
    const entries = Object.entries(value)
      .map(([id, entry]) => ({ id, ...entry }))
      .sort((left, right) => left.elapsedTime - right.elapsedTime || left.id.localeCompare(right.id))
      .slice(0, 5);
    onEntries(entries);
  }, onError);
}

export async function reconcileRoom(roomId: string): Promise<void> {
  const user = await ensureAnonymousUser();
  const roomRef = ref(database, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  const before = snapshot.val() as StoredRoom | null;
  if (!before || before.meta.hostId !== user.uid) return;

  const now = Date.now();
  const result = await runTransaction(roomRef, (current: StoredRoom | null) => {
    current ??= structuredClone(before);
    if (!current || current.meta.hostId !== user.uid) return;
    for (const [id, player] of Object.entries(current.players ?? {})) {
      const expired = !player.online && player.disconnectedAt && now - player.disconnectedAt >= DISCONNECT_GRACE_MS;
      if (!expired) continue;
      if (current.meta.status === "waiting" && id !== user.uid) delete current.players[id];
      else if (player.status === "racing") player.status = "dnf";
    }
    if (current.meta.status !== "waiting") {
      const status = normalizedStatus(current);
      current.meta.status = status;
      if (status === "finished") current.meta.finishedAt ??= now;
    }
    return current;
  }, { applyLocally: false });
  if (result.committed) await syncDirectory(roomId);
}

export async function setReady(roomId: string, uid: string, ready: boolean): Promise<void> {
  if (auth.currentUser?.uid !== uid) throw new Error("自分のREADY状態だけ変更できます。");
  await set(ref(database, `rooms/${roomId}/players/${uid}/ready`), ready);
}

export function syncCompletedCount(roomId: string, uid: string, count: number): Promise<void> {
  if (auth.currentUser?.uid !== uid) return Promise.reject(new Error("自分の進捗だけ同期できます。"));
  return update(ref(database, `rooms/${roomId}/players/${uid}`), {
    completedCount: count,
    progressAt: serverTimestamp(),
  });
}

export async function attachPresence(roomId: string, uid: string): Promise<() => void> {
  const onlineRef = ref(database, `rooms/${roomId}/players/${uid}/online`);
  const disconnectedRef = ref(database, `rooms/${roomId}/players/${uid}/disconnectedAt`);
  const onlineDisconnect = onDisconnect(onlineRef);
  const timestampDisconnect = onDisconnect(disconnectedRef);
  await onlineDisconnect.set(false);
  await timestampDisconnect.set(serverTimestamp());
  await Promise.all([set(onlineRef, true), remove(disconnectedRef)]);

  return () => {
    void onlineDisconnect.cancel();
    void timestampDisconnect.cancel();
    off(onlineRef);
    off(disconnectedRef);
  };
}
