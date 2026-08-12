import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Brand, difficultyLabels, ErrorBanner, Modal, PixelButton, PLAYER_COLORS, statusLabels } from "../components/ui";
import { createRoom, deleteFinishedRoom, friendlyError, joinRoom, subscribeRoomDirectory } from "../services/rooms.spark";
import type { Difficulty, RoomSummary } from "../types";

export function RoomBrowser({
  playerName,
  onJoin,
  onRename,
}: {
  playerName: string;
  onJoin: (roomId: string) => void;
  onRename: () => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);

  useEffect(() => subscribeRoomDirectory(
    (nextRooms) => {
      setRooms(nextRooms);
      setLoading(false);
    },
    (cause) => {
      setError(friendlyError(cause));
      setLoading(false);
    },
  ), []);

  const joinSelected = useCallback(async (room: RoomSummary, password = "") => {
    if (room.status !== "waiting" || room.playerCount >= room.maxPlayers) return;
    setJoiningRoomId(room.id);
    setError("");
    try {
      const roomId = await joinRoom({ roomId: room.id, playerName, password });
      setJoinTarget(null);
      onJoin(roomId);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setJoiningRoomId(null);
    }
  }, [onJoin, playerName]);

  const deleteRoom = useCallback(async (room: RoomSummary) => {
    if (room.status !== "finished" || !window.confirm(`終了した「${room.roomName}」を削除しますか？`)) return;
    setDeletingRoomId(room.id);
    setError("");
    try {
      await deleteFinishedRoom(room.id);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setDeletingRoomId(null);
    }
  }, []);

  return (
    <main className="screen-shell browser-screen">
      <header className="topbar">
        <Brand compact />
        <div className="player-chip">
          <span className="player-chip__dot" />
          <div><small>RACER</small><strong>{playerName}</strong></div>
          <button type="button" onClick={onRename}>変更</button>
        </div>
      </header>

      <section className="browser-heading">
        <div>
          <span className="section-kicker">ONLINE PADDOCK</span>
          <h1>レースを選ぶ</h1>
          <p>1人練習から8人対戦まで。募集中のルームへ参加できます。</p>
        </div>
        <PixelButton onClick={() => setCreating(true)}>＋ ルームを作る</PixelButton>
      </section>

      {error && !joinTarget && <ErrorBanner message={error} onClose={() => setError("")} />}

      <section className="room-grid" aria-live="polite">
        {loading && <div className="empty-state"><span className="loading-dots">•••</span><p>ルームを受信中</p></div>}
        {!loading && rooms.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__flag" aria-hidden="true" />
            <h2>まだレースがありません</h2>
            <p>最初のルームを作って、サーキットを開きましょう。</p>
          </div>
        )}
        {rooms.map((room, index) => {
          const joinable = room.status === "waiting" && room.playerCount < room.maxPlayers;
          return (
            <div className="room-card-shell" key={room.id}>
              <button
                type="button"
                className={`room-card ${joinable ? "room-card--joinable" : "room-card--closed"}`}
                onClick={() => room.isLocked ? setJoinTarget(room) : void joinSelected(room)}
                disabled={!joinable || joiningRoomId === room.id}
              >
                <span className="room-card__stripe" style={{ "--room-color": PLAYER_COLORS[index % PLAYER_COLORS.length] } as CSSProperties} />
                <span className="room-card__topline">
                  <span className={`status status--${room.status}`}>{statusLabels[room.status]}</span>
                  {room.isLocked && <span className="lock" aria-label="合言葉あり">◆</span>}
                </span>
                <strong className="room-card__name">{room.roomName}</strong>
                <span className="room-card__host">HOST / {room.hostName}</span>
                <span className="room-card__details">
                  <span>{difficultyLabels[room.difficulty]}</span>
                  <b>{room.playerCount}<i>/</i>{room.maxPlayers}</b>
                </span>
                <span className="room-card__cta">{joiningRoomId === room.id ? "JOINING..." : joinable ? "JOIN RACE ›" : statusLabels[room.status]}</span>
              </button>
              {room.status === "finished" && (
                <button
                  type="button"
                  className="room-card-delete"
                  onClick={() => void deleteRoom(room)}
                  disabled={deletingRoomId === room.id}
                >
                  {deletingRoomId === room.id ? "削除中..." : "削除"}
                </button>
              )}
            </div>
          );
        })}
      </section>

      {creating && (
        <CreateRoomModal
          playerName={playerName}
          onClose={() => setCreating(false)}
          onCreated={(roomId) => {
            setCreating(false);
            onJoin(roomId);
          }}
        />
      )}
      {joinTarget && (
        <JoinRoomModal
          room={joinTarget}
          busy={joiningRoomId === joinTarget.id}
          error={error}
          onClose={() => {
            setJoinTarget(null);
            setError("");
          }}
          onJoin={(password) => joinSelected(joinTarget, password)}
        />
      )}
    </main>
  );
}

function CreateRoomModal({
  playerName,
  onClose,
  onCreated,
}: {
  playerName: string;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [roomName, setRoomName] = useState(`${playerName}の100マス杯`);
  const [password, setPassword] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const roomId = await createRoom({ roomName, playerName, password, maxPlayers, difficulty });
      onCreated(roomId);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="NEW RACE" onClose={onClose}>
      <form className="form-stack" onSubmit={handleSubmit}>
        <label>ルーム名<input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={24} required /></label>
        <label>合言葉 <em>OPTION</em><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={64} placeholder="なしでも作れます" /></label>
        <fieldset>
          <legend>難易度</legend>
          <div className="segmented">
            {(["easy", "normal", "hard"] as Difficulty[]).map((item) => (
              <label key={item} className={difficulty === item ? "selected" : ""}>
                <input type="radio" name="difficulty" value={item} checked={difficulty === item} onChange={() => setDifficulty(item)} />
                {item === "easy" ? "EASY" : item === "normal" ? "NORMAL" : "HARD"}
                <small>{item === "easy" ? "1-5" : item === "normal" ? "1-10" : "1-20"}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <label>参加人数 <strong>{maxPlayers}人</strong><input type="range" min={1} max={8} value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))} /></label>
        <p className="form-hint">1人にするとタイムアタック練習として遊べます。</p>
        {error && <ErrorBanner message={error} />}
        <div className="form-actions">
          <PixelButton type="button" tone="ghost" onClick={onClose}>キャンセル</PixelButton>
          <PixelButton type="submit" disabled={busy || !roomName.trim()}>{busy ? "CREATING..." : "CREATE"}</PixelButton>
        </div>
      </form>
    </Modal>
  );
}

function JoinRoomModal({
  room,
  busy,
  error,
  onClose,
  onJoin,
}: {
  room: RoomSummary;
  busy: boolean;
  error: string;
  onClose: () => void;
  onJoin: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <Modal title="LOCKED RACE" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onJoin(password); }}>
        <p className="modal-copy"><strong>{room.roomName}</strong> には合言葉が必要です。</p>
        <label>合言葉<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required /></label>
        {error && <ErrorBanner message={error} />}
        <div className="form-actions">
          <PixelButton type="button" tone="ghost" onClick={onClose}>戻る</PixelButton>
          <PixelButton type="submit" disabled={busy}>{busy ? "CHECKING..." : "JOIN"}</PixelButton>
        </div>
      </form>
    </Modal>
  );
}
