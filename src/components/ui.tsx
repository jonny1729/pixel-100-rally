import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { Difficulty, RoomData, RoomPlayer, RoomStatus, RoundConfig } from "../types";

export const PLAYER_COLORS = ["#ff4f72", "#45e7ff", "#ffd43b", "#7cff6b", "#b980ff", "#ff8c42", "#ff75df", "#71a7ff"];

export const statusLabels: Record<RoomStatus, string> = {
  waiting: "募集中",
  playing: "対戦中",
  results: "リザルト中",
  finished: "終了",
};

export const difficultyLabels: Record<Difficulty, string> = {
  easy: "かんたん 1-5",
  normal: "ふつう 1-10",
  hard: "むずかしい 1-20",
};

export function roomPlayers(room: RoomData): RoomPlayer[] {
  return Object.entries(room.players ?? {})
    .map(([id, player]) => ({ id, ...player }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

export function activeRound(room: RoomData): RoundConfig | null {
  const id = room.meta.currentRoundId;
  const round = id ? room.rounds?.[id] : undefined;
  return id && round ? { id, ...round } : null;
}

export function PixelButton({
  children,
  tone = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button className={`pixel-button pixel-button--${tone} ${className}`} {...props}>
      <span>{children}</span>
    </button>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`} aria-label="Pixel 100 Rally">
      <span className="brand__flag" aria-hidden="true" />
      <div>
        <span className="brand__eyebrow">CALCULATION CIRCUIT</span>
        <strong>PIXEL 100 RALLY</strong>
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span aria-hidden="true">!</span>
      <p>{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="pixel-panel modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function LoadingScreen({ message = "CONNECTING" }: { message?: string }) {
  return (
    <main className="loading-screen">
      <Brand />
      <div className="loading-dots">•••</div>
      <p>{message}</p>
    </main>
  );
}

export function playerColorStyle(index: number): CSSProperties {
  return { "--player-color": PLAYER_COLORS[index % PLAYER_COLORS.length] } as CSSProperties;
}
