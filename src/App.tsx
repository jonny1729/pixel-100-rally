import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "./firebase";
import { primeAudio } from "./game/sound";
import { activeRound, Brand, ErrorBanner, LoadingScreen, PixelButton, roomPlayers } from "./components/ui";
import { GameScreen } from "./screens/GameScreen";
import { Lobby } from "./screens/Lobby";
import { RoomBrowser } from "./screens/RoomBrowser";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import {
  attachPresence,
  ensureAnonymousUser,
  friendlyError,
  leaveRoom,
  reconcileRoom,
  resumeRoom,
  subscribeRoom,
} from "./services/rooms.spark";
import type { RoomData } from "./types";

const PLAYER_NAME_KEY = "pixel-rally:player-name";
const ROOM_ID_KEY = "pixel-rally:room-id";

export default function App() {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const [uid, setUid] = useState(() => auth.currentUser?.uid ?? "");
  const [roomId, setRoomId] = useState(() => localStorage.getItem(ROOM_ID_KEY) ?? "");
  const [room, setRoom] = useState<RoomData | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState("");
  const presenceCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unlock = () => { void primeAudio(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const authenticate = useCallback(async () => {
    const user = await ensureAnonymousUser();
    setUid(user.uid);
    setAuthReady(true);
    return user;
  }, []);

  useEffect(() => {
    if (!playerName) {
      setAuthReady(true);
      return;
    }
    void authenticate().catch((cause) => {
      setError(friendlyError(cause));
      setAuthReady(true);
    });
  }, [authenticate, playerName]);

  useEffect(() => {
    if (!roomId || !uid) {
      setRoom(null);
      return;
    }
    let active = true;
    setError("");
    void resumeRoom(roomId)
      .then(() => attachPresence(roomId, uid))
      .then((cleanup) => {
        if (active) presenceCleanup.current = cleanup;
        else cleanup();
      })
      .catch((cause) => {
        if (active) setError(friendlyError(cause));
      });
    const unsubscribe = subscribeRoom(
      roomId,
      (nextRoom) => {
        if (!active) return;
        if (!nextRoom) {
          localStorage.removeItem(ROOM_ID_KEY);
          setRoomId("");
          setRoom(null);
        } else {
          setRoom(nextRoom);
        }
      },
      (cause) => active && setError(friendlyError(cause)),
    );
    return () => {
      active = false;
      unsubscribe();
      presenceCleanup.current?.();
      presenceCleanup.current = null;
    };
  }, [roomId, uid]);

  useEffect(() => {
    if (!room || !roomId || !uid) return;
    const offlinePlayers = roomPlayers(room).filter((player) => !player.online && player.disconnectedAt);
    if (offlinePlayers.length === 0) return;
    const nearestDeadline = Math.min(...offlinePlayers.map((player) => (player.disconnectedAt ?? Date.now()) + 30_000));
    const timer = window.setTimeout(() => {
      void reconcileRoom(roomId).catch(() => undefined);
    }, Math.max(0, nearestDeadline - Date.now() + 100));
    return () => clearTimeout(timer);
  }, [room, roomId, uid]);

  async function completeName(name: string) {
    await authenticate();
    localStorage.setItem(PLAYER_NAME_KEY, name);
    setPlayerName(name);
  }

  function enterRoom(nextRoomId: string) {
    localStorage.setItem(ROOM_ID_KEY, nextRoomId);
    setRoomId(nextRoomId);
  }

  async function exitRoom() {
    if (roomId) {
      try {
        presenceCleanup.current?.();
        await leaveRoom(roomId);
      } catch (cause) {
        setError(friendlyError(cause));
      }
    }
    localStorage.removeItem(ROOM_ID_KEY);
    setRoomId("");
    setRoom(null);
  }

  function rename() {
    localStorage.removeItem(PLAYER_NAME_KEY);
    setPlayerName("");
  }

  if (!authReady) return <LoadingScreen />;
  if (!playerName) return <WelcomeScreen onComplete={completeName} />;
  if (error && roomId && !room) {
    return (
      <main className="loading-screen">
        <Brand />
        <ErrorBanner message={error} />
        <PixelButton tone="secondary" onClick={() => void exitRoom()}>ルーム一覧へ戻る</PixelButton>
      </main>
    );
  }
  if (!roomId) return <RoomBrowser playerName={playerName} onJoin={enterRoom} onRename={rename} />;
  if (!room || !uid) return <LoadingScreen message="JOINING ROOM" />;
  if (room.meta.status === "waiting") return <Lobby roomId={roomId} room={room} uid={uid} onLeave={() => void exitRoom()} />;
  const round = activeRound(room);
  if (!round) return <LoadingScreen message="PREPARING GRID" />;
  return <GameScreen key={round.id} roomId={roomId} room={room} round={round} uid={uid} onLeave={() => void exitRoom()} />;
}
