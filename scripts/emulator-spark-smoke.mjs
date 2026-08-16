import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  limitToFirst,
  orderByChild,
  query,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from "firebase/database";

const projectId = "demo-hundred-rally";
const roomId = `spark-smoke-${Date.now()}`;
const activeRoomId = `${roomId}-active`;
const staleRoomId = `${roomId}-stale`;
const authPort = Number(process.env.SPARK_AUTH_PORT || 9099);
const databasePort = Number(process.env.SPARK_DATABASE_PORT || 9000);
let stage = "startup";
const watchdog = setTimeout(() => {
  console.error(`Spark smoke timed out at: ${stage}`);
  process.exit(2);
}, 30_000);

function client(name) {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    appId: `1:123456789:web:${name}`,
  }, name);
  const auth = getAuth(app);
  const database = getDatabase(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, { disableWarnings: true });
  connectDatabaseEmulator(database, "127.0.0.1", databasePort);
  return { auth, database };
}

function player(name, joinedAt, joinHash, ready) {
  return {
    name,
    joinedAt,
    ready,
    online: true,
    completedCount: 0,
    status: "lobby",
    joinHash,
  };
}

function summary(room, hostId) {
  const value = {
    roomName: room.meta.roomName,
    hostId,
    hostName: room.players[hostId].name,
    playerCount: Object.keys(room.players).length,
    maxPlayers: room.meta.maxPlayers,
    gameMode: room.meta.gameMode,
    difficulty: room.meta.difficulty,
    isLocked: room.meta.isLocked,
    status: room.meta.status,
    createdAt: room.meta.createdAt,
  };
  if (room.meta.gridSize !== undefined) value.gridSize = room.meta.gridSize;
  if (room.meta.seed !== undefined) value.seed = room.meta.seed;
  const currentRound = room.meta.currentRoundId ? room.rounds?.[room.meta.currentRoundId] : undefined;
  if (currentRound?.createdAt !== undefined) value.startedAt = currentRound.createdAt;
  if (room.meta.finishedAt !== undefined) value.finishedAt = room.meta.finishedAt;
  return value;
}

stage = "create clients";
const host = client("spark-host");
const guest = client("spark-guest");
const outsider = client("spark-outsider");
stage = "authenticate host";
const hostUser = (await signInAnonymously(host.auth)).user;
stage = "authenticate guest";
const guestUser = (await signInAnonymously(guest.auth)).user;
stage = "authenticate outsider";
await signInAnonymously(outsider.auth);
const now = Date.now();

const hostPlayer = player("HOST", now, "OPEN", true);
const room = {
  meta: {
    roomName: "SPARK SMOKE",
    hostId: hostUser.uid,
    maxPlayers: 8,
    gameMode: "division",
    difficulty: "normal",
    gridSize: 5,
    seed: "SPARK-SEED",
    status: "waiting",
    isLocked: false,
    createdAt: now,
  },
  players: { [hostUser.uid]: hostPlayer },
};

stage = "create secret";
await set(ref(host.database, `roomSecrets/${roomId}`), {
  ownerId: hostUser.uid,
  joinHash: "OPEN",
  createdAt: now,
});
stage = "create room";
await set(ref(host.database, `rooms/${roomId}`), room);
stage = "create directory";
await set(ref(host.database, `roomDirectory/${roomId}`), summary(room, hostUser.uid));

stage = "reject invalid guest";
let rejected = false;
try {
  await set(ref(guest.database, `rooms/${roomId}/players/${guestUser.uid}`), player("GUEST", now + 1, "WRONG", false));
} catch {
  rejected = true;
}
if (!rejected) throw new Error("A guest with an invalid join proof was accepted.");

stage = "join valid guest";
await set(ref(guest.database, `rooms/${roomId}/players/${guestUser.uid}`), player("GUEST", now + 1, "OPEN", false));
await set(ref(guest.database, `rooms/${roomId}/players/${guestUser.uid}/ready`), true);

stage = "read joined room";
const joined = (await get(ref(host.database, `rooms/${roomId}`))).val();
await set(ref(guest.database, `roomDirectory/${roomId}`), summary(joined, hostUser.uid));

stage = "start transaction";
const roundId = "round-1";
const started = await runTransaction(ref(host.database, `rooms/${roomId}`), (current) => {
  current ??= structuredClone(joined);
  current.meta.status = "playing";
  current.meta.currentRoundId = roundId;
  current.rounds = {
    [roundId]: {
      seed: "SPARK-SEED",
      generatorVersion: 1,
      rowValues: [11, 12, 13, 14, 15],
      columnValues: [1, 2, 3, 4, 5],
      difficulty: "normal",
      gameMode: "division",
      gridSize: 5,
      createdAt: Date.now(),
      participantIds: [hostUser.uid, guestUser.uid],
    },
  };
  for (const racer of Object.values(current.players)) {
    racer.ready = false;
    racer.completedCount = 0;
    racer.status = "racing";
  }
  return current;
});
if (!started.committed) throw new Error("Host could not start the round.");

await set(ref(host.database, `roomDirectory/${roomId}`), summary(started.snapshot.val(), hostUser.uid));
stage = "sync progress";
await update(ref(guest.database, `rooms/${roomId}/players/${guestUser.uid}`), {
  completedCount: 17,
  progressAt: Date.now(),
});
const guestFinishedAt = Date.now();
await update(ref(guest.database, `rooms/${roomId}/players/${guestUser.uid}`), {
  completedCount: 25,
  status: "finished",
  elapsedTime: 43210,
  finishedAt: guestFinishedAt,
});
await update(ref(guest.database, `rooms/${roomId}/meta`), { status: "results" });

stage = "write leaderboard personal best";
const leaderboardRef = ref(guest.database, `leaderboards/division/5/normal/${guestUser.uid}`);
const leaderboardEntry = {
  playerName: "GUEST",
  elapsedTime: 43210,
  seed: "SPARK-SEED",
  achievedAt: guestFinishedAt,
  roomId,
  roundId,
  generatorVersion: 1,
};
await set(leaderboardRef, leaderboardEntry);
let slowerRejected = false;
try {
  await set(leaderboardRef, { ...leaderboardEntry, elapsedTime: 50000 });
} catch {
  slowerRejected = true;
}
if (!slowerRejected) throw new Error("A slower leaderboard time replaced a personal best.");
let outsiderOverwriteRejected = false;
try {
  await set(ref(outsider.database, `leaderboards/division/5/normal/${guestUser.uid}`), { ...leaderboardEntry, elapsedTime: 1000 });
} catch {
  outsiderOverwriteRejected = true;
}
if (!outsiderOverwriteRejected) throw new Error("An outsider overwrote another leaderboard entry.");
const topFive = await get(query(ref(outsider.database, "leaderboards/division/5/normal"), orderByChild("elapsedTime"), limitToFirst(5)));
const topFiveValue = topFive.val() ?? {};
if (!topFiveValue[guestUser.uid] || Object.keys(topFiveValue).length > 5) throw new Error("The leaderboard top-five query did not return the expected entry.");
await update(ref(host.database, `rooms/${roomId}/players/${hostUser.uid}`), {
  online: false,
  disconnectedAt: Date.now(),
  status: "dnf",
});
await update(ref(guest.database, `rooms/${roomId}/meta`), { status: "finished", finishedAt: Date.now() });

const finished = (await get(ref(host.database, `rooms/${roomId}`))).val();
await set(ref(guest.database, `roomDirectory/${roomId}`), summary(finished, hostUser.uid));
if (finished.players[guestUser.uid].completedCount !== 25 || finished.players[hostUser.uid].status !== "dnf" || finished.meta.status !== "finished") {
  throw new Error("Progress or finish state did not synchronize.");
}

stage = "finished room cleanup by outsider";
await remove(ref(outsider.database, `roomSecrets/${roomId}`));
await remove(ref(outsider.database, `rooms/${roomId}`));
await remove(ref(outsider.database, `roomDirectory/${roomId}`));

function racingRoom(startedAt) {
  return {
    meta: {
      roomName: "ACTIVE RACE",
      hostId: hostUser.uid,
      maxPlayers: 8,
      gameMode: "multiplication",
      difficulty: "normal",
      status: "playing",
      isLocked: false,
      createdAt: startedAt,
      currentRoundId: "round-active",
    },
    players: {
      [hostUser.uid]: { ...player("HOST", startedAt, "OPEN", false), status: "racing" },
    },
    rounds: {
      "round-active": {
        seed: "active-seed",
        rowValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        columnValues: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        difficulty: "normal",
        gameMode: "multiplication",
        createdAt: startedAt,
        participantIds: [hostUser.uid],
      },
    },
  };
}

stage = "reject early active cleanup";
const activeStartedAt = Date.now();
const activeRoom = racingRoom(activeStartedAt);
await set(ref(host.database, `roomSecrets/${activeRoomId}`), { ownerId: hostUser.uid, joinHash: "OPEN", createdAt: activeStartedAt });
await set(ref(host.database, `rooms/${activeRoomId}`), activeRoom);
await set(ref(host.database, `roomDirectory/${activeRoomId}`), summary(activeRoom, hostUser.uid));
let activeCleanupRejected = false;
try {
  await remove(ref(outsider.database, `roomDirectory/${activeRoomId}`));
} catch {
  activeCleanupRejected = true;
}
if (!activeCleanupRejected) throw new Error("A non-expired active room was deleted by an outsider.");
await remove(ref(host.database, `roomSecrets/${activeRoomId}`));
await remove(ref(host.database, `rooms/${activeRoomId}`));
await remove(ref(host.database, `roomDirectory/${activeRoomId}`));

stage = "two-hour active room cleanup by outsider";
const staleStartedAt = Date.now() - 7_200_100;
const staleRoom = racingRoom(staleStartedAt);
await set(ref(host.database, `roomSecrets/${staleRoomId}`), { ownerId: hostUser.uid, joinHash: "OPEN", createdAt: staleStartedAt });
await set(ref(host.database, `rooms/${staleRoomId}`), staleRoom);
await set(ref(host.database, `roomDirectory/${staleRoomId}`), summary(staleRoom, hostUser.uid));
await remove(ref(outsider.database, `roomSecrets/${staleRoomId}`));
await remove(ref(outsider.database, `rooms/${staleRoomId}`));
await remove(ref(outsider.database, `roomDirectory/${staleRoomId}`));

await Promise.all([deleteApp(host.auth.app), deleteApp(guest.auth.app), deleteApp(outsider.auth.app)]);
clearTimeout(watchdog);
console.log("Spark smoke passed: finished deletion by outsider, early-delete rejection, and two-hour active cleanup.");
process.exit(0);
