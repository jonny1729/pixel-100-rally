import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from "firebase/database";

const projectId = "demo-hundred-rally";
const roomId = `spark-smoke-${Date.now()}`;
const authPort = Number(process.env.SPARK_AUTH_PORT || 9099);
const databasePort = Number(process.env.SPARK_DATABASE_PORT || 9000);
let stage = "startup";
const watchdog = setTimeout(() => {
  console.error(`Spark smoke timed out at: ${stage}`);
  process.exit(2);
}, 20_000);

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
    gameMode: "multiplication",
    difficulty: room.meta.difficulty,
    isLocked: room.meta.isLocked,
    status: room.meta.status,
    createdAt: room.meta.createdAt,
  };
  if (room.meta.finishedAt !== undefined) value.finishedAt = room.meta.finishedAt;
  return value;
}

stage = "create clients";
const host = client("spark-host");
const guest = client("spark-guest");
stage = "authenticate host";
const hostUser = (await signInAnonymously(host.auth)).user;
stage = "authenticate guest";
const guestUser = (await signInAnonymously(guest.auth)).user;
const now = Date.now();

const hostPlayer = player("HOST", now, "OPEN", true);
const room = {
  meta: {
    roomName: "SPARK SMOKE",
    hostId: hostUser.uid,
    maxPlayers: 8,
    gameMode: "multiplication",
    difficulty: "normal",
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
      seed: "spark-smoke-seed",
      rowValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      columnValues: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      difficulty: "normal",
      gameMode: "multiplication",
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
  completedCount: 67,
  progressAt: Date.now(),
});
await update(ref(guest.database, `rooms/${roomId}/players/${guestUser.uid}`), {
  completedCount: 100,
  status: "finished",
  elapsedTime: 43210,
  finishedAt: Date.now(),
});
await update(ref(guest.database, `rooms/${roomId}/meta`), { status: "results" });
await update(ref(host.database, `rooms/${roomId}/players/${hostUser.uid}`), {
  online: false,
  disconnectedAt: Date.now(),
  status: "dnf",
});
const expiredAt = Date.now() - 300_100;
await update(ref(guest.database, `rooms/${roomId}/meta`), { status: "finished", finishedAt: expiredAt });

const finished = (await get(ref(host.database, `rooms/${roomId}`))).val();
await set(ref(guest.database, `roomDirectory/${roomId}`), summary(finished, hostUser.uid));
if (finished.players[guestUser.uid].completedCount !== 100 || finished.players[hostUser.uid].status !== "dnf" || finished.meta.status !== "finished") {
  throw new Error("Progress or finish state did not synchronize.");
}

stage = "cleanup";
await remove(ref(guest.database, `roomSecrets/${roomId}`));
await remove(ref(guest.database, `rooms/${roomId}`));
await remove(ref(guest.database, `roomDirectory/${roomId}`));

await Promise.all([deleteApp(host.auth.app), deleteApp(guest.auth.app)]);
clearTimeout(watchdog);
console.log("Spark smoke passed: create, protected join, ready, start, progress, match exit, finish, TTL cleanup.");
process.exit(0);
