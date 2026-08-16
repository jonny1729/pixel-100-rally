import { useState, type CSSProperties } from "react";
import { Brand, difficultyLabels, ErrorBanner, gameModeLabels, PixelButton, PLAYER_COLORS, roomPlayers } from "../components/ui";
import { friendlyError, setReady, startRound } from "../services/rooms.spark";
import type { RoomData } from "../types";

export function Lobby({ roomId, room, uid, onLeave }: { roomId: string; room: RoomData; uid: string; onLeave: () => void }) {
  const players = roomPlayers(room);
  const me = room.players[uid];
  const isHost = room.meta.hostId === uid;
  const canStart = isHost && players.length >= 1 && players.every((player) => player.id === uid || player.ready);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggleReady() {
    setBusy(true);
    setError("");
    try {
      await setReady(roomId, uid, !me.ready);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    setBusy(true);
    setError("");
    try {
      await startRound(roomId);
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  }

  async function copySeed() {
    try {
      await navigator.clipboard.writeText(room.meta.seed);
    } catch {
      setError("シードをコピーできませんでした。");
    }
  }

  return (
    <main className="screen-shell lobby-screen">
      <header className="topbar"><Brand compact /><span className="connection-light"><i /> LIVE ROOM</span></header>
      <section className="lobby-layout">
        <div className="pixel-panel lobby-main">
          <div className="lobby-title">
            <div><span className="section-kicker">STARTING GRID</span><h1>{room.meta.roomName}</h1></div>
            <span className="room-id">ID {roomId.slice(-6).toUpperCase()}</span>
          </div>
          <div className="race-settings">
            <span><small>MODE</small><strong>{gameModeLabels[room.meta.gameMode]}</strong></span>
            <span><small>LEVEL</small><strong>{difficultyLabels[room.meta.difficulty]}</strong></span>
            <span><small>GRID</small><strong>{room.meta.gridSize} × {room.meta.gridSize}</strong></span>
            <span><small>ENTRY</small><strong>{players.length} / {room.meta.maxPlayers}</strong></span>
          </div>
          <button type="button" className="seed-chip" onClick={() => void copySeed()}><small>SEED</small><strong>{room.meta.seed}</strong><span>コピー</span></button>
          <div className="grid-slots">
            {Array.from({ length: room.meta.maxPlayers }, (_, index) => {
              const player = players[index];
              if (!player) return <div className="grid-slot grid-slot--empty" key={index}><span>+</span><p>WAITING...</p></div>;
              const host = player.id === room.meta.hostId;
              return (
                <div className="grid-slot" key={player.id} style={{ "--player-color": PLAYER_COLORS[index] } as CSSProperties}>
                  <span className="grid-slot__position">{String(index + 1).padStart(2, "0")}</span>
                  <span className="pixel-avatar" aria-hidden="true"><i /></span>
                  <div><strong>{player.name}</strong><small>{host ? "HOST" : player.ready ? "READY!" : "STANDBY"}</small></div>
                  <span className={`online-dot ${player.online ? "online-dot--on" : ""}`} aria-label={player.online ? "オンライン" : "再接続待ち"} />
                </div>
              );
            })}
          </div>
          {players.length === 1 && <p className="practice-note">SOLO PRACTICE — 1人ですぐにスタートできます</p>}
          {error && <ErrorBanner message={error} onClose={() => setError("")} />}
          <div className="lobby-actions">
            <PixelButton tone="ghost" onClick={onLeave} disabled={busy}>退出する</PixelButton>
            {isHost ? (
              <PixelButton onClick={handleStart} disabled={!canStart || busy}>{busy ? "STARTING..." : canStart ? "START RACE" : "READY待ち"}</PixelButton>
            ) : (
              <PixelButton tone={me.ready ? "secondary" : "primary"} onClick={toggleReady} disabled={busy}>{me.ready ? "READY! 解除" : "READY!"}</PixelButton>
            )}
          </div>
        </div>
        <aside className="pixel-panel lobby-rules">
          <span className="section-kicker">HOW TO RACE</span>
          <h2>操作ルール</h2>
          <ol>
            <li><b>01</b><span>左上から順に回答</span></li>
            <li><b>02</b><span>入力した答えを即判定</span></li>
            <li><b>03</b><span>迷ったらPASS</span></li>
            <li><b>04</b><span>{room.meta.gridSize ** 2}問正解でGOAL</span></li>
          </ol>
          <p>入力とタイマーはローカル処理。通信を待たずに走れます。</p>
        </aside>
      </section>
    </main>
  );
}
