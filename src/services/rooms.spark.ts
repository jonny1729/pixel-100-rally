import { FirebaseError } from "firebase/app";
import { signInAnonymously, type User } from "firebase/auth";
import {
  get,
  limitToLast,
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
import type { Difficulty, RoomData, RoomPlayer, RoomSummary } from "../types";

const DISCONNECT_GRACE_MS = 30_000;
const FINISHED_ROOM_TTL_MS = 5 * 60_000;

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

function shuffled(values: number[]): number[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    const target = random % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function operands(difficulty: Difficulty): number[] {
  if (difficulty === "easy") {
    return Array.from({ length: 10 }, () => (crypto.getRandomValues(new Uint32Array(1))[0] % 5) + 1);
  }
  if (difficulty === "normal") return shuffled(Array.from({ length: 10 }, (_, index) => index + 1));
  return shuffled(Array.from({ length: 20 }, (_, index) => index + 1)).slice(0, 10);
}

type DirectoryValue = Omit<RoomSummary, "id"> & { hostId: string };

function directoryValue(room: StoredRoom): DirectoryValue {
  const value: DirectoryValue = {
    roomName: room.meta.roomName,
    hostId: room.meta.hostId,
    hostName: room.players[room.meta.hostId]?.name ?? "---",
    playerCount: Object.keys(room.players ?? {}).length,
    maxPlayers: room.meta.maxPlayers,
    gameMode: room.meta.gameMode,
    difficulty: room.meta.difficulty,
    isLocked: room.meta.isLocked,
    status: room.meta.status,
    createdAt: room.meta.createdAt,
  };
  if (room.meta.finishedAt !== undefined) value.finishedAt = room.meta.finishedAt;
  return value;
}

async function syncDirectory(roomId: string): Promise<void> {
  const snapshot = await get(ref(database, `rooms/${roomId}`));
  if (!snapshot.exists()) return;
  await set(ref(database, `roomDirectory/${roomId}`), directoryValue(snapshot.val() as StoredRoom));
}
async function cleanupExpiredRoom(room: Pick<RoomSummary, "id" | "status" | "finishedAt">): Promise<void> {
  if (room.status !== "finished" || !room.finishedAt || Date.now() - room.finishedAt < FINISHED_ROOM_TTL_MS) return;
  await remove(ref(database, `roomSecrets/${room.id}`));
  await remove(ref(database, `rooms/${room.id}`));
  await remove(ref(database, `roomDirectory/${room.id}`));
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
  const directoryQuery = query(ref(database, "roomDirectory"), orderByChild("createdAt"), limitToLast(50));
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = onValue(
    directoryQuery,
    (snapshot) => {
      if (expiryTimer) clearTimeout(expiryTimer);
      const value = (snapshot.val() ?? {}) as Record<string, Omit<RoomSummary, "id">>;
      const rooms = Object.entries(value)
        .map(([id, room]) => ({ id, ...room }))
        .sort((a, b) => b.createdAt - a.createdAt);
      const now = Date.now();
      const expired = rooms.filter((room) => room.status === "finished" && room.finishedAt && now - room.finishedAt >= FINISHED_ROOM_TTL_MS);
      expired.forEach((room) => { void cleanupExpiredRoom(room).catch(() => undefined); });
      onRooms(rooms.filter((room) => !expired.includes(room)));

      const nextExpiry = rooms
        .filter((room) => room.status === "finished" && room.finishedAt && now - room.finishedAt < FINISHED_ROOM_TTL_MS)
        .sort((a, b) => (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity))[0];
      if (nextExpiry?.finishedAt) {
        expiryTimer = setTimeout(() => {
          void cleanupExpiredRoom(nextExpiry).catch(() => undefined);
        }, Math.max(100, nextExpiry.finishedAt + FINISHED_ROOM_TTL_MS - now + 100));
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
    const room = snapshot.val() as RoomData | null;
    onRoom(room);
    if (room?.meta.status === "finished" && room.meta.finishedAt) {
      expiryTimer = setTimeout(() => {
        void cleanupExpiredRoom({ id: roomId, status: "finished", finishedAt: room.meta.finishedAt }).catch(() => undefined);
      }, Math.max(100, room.meta.finishedAt + FINISHED_ROOM_TTL_MS - Date.now() + 100));
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
      gameMode: "multiplication",
      difficulty: input.difficulty,
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
    current.meta.status = "playing";
    current.meta.currentRoundId = roundId;
    current.rounds ??= {};
    current.rounds[roundId] = {
      seed: crypto.randomUUID(),
      rowValues: operands(current.meta.difficulty),
      columnValues: operands(current.meta.difficulty),
      difficulty: current.meta.difficulty,
      gameMode: current.meta.gameMode,
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
  const rounded = Math.round(elapsedTime);
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 86_400_000) throw new Error("タイムが不正です。");

  const playerRef = ref(database, `rooms/${roomId}/players/${user.uid}`);
  const beforePlayer = room.players[user.uid] ?? null;
  const result = await runTransaction(playerRef, (player: StoredPlayer | null) => {
    player ??= beforePlayer ? structuredClone(beforePlayer) : null;
    if (!player || player.status === "dnf") return;
    if (player.status === "finished") return player;
    player.completedCount = 100;
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
