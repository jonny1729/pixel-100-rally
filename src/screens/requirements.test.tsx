import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomData, RoundConfig } from "../types";
import { GameScreen } from "./GameScreen";
import { Lobby } from "./Lobby";
import { RoomBrowser } from "./RoomBrowser";

vi.mock("../services/rooms.spark", () => ({
  friendlyError: (error: unknown) => error instanceof Error ? error.message : "error",
  createRoom: vi.fn(),
  deleteFinishedRoom: vi.fn(),
  joinRoom: vi.fn(),
  recordLeaderboardBest: vi.fn(() => Promise.resolve()),
  setReady: vi.fn(),
  startRound: vi.fn(),
  submitFinish: vi.fn(),
  subscribeLeaderboard: vi.fn((_mode: unknown, _size: unknown, _difficulty: unknown, onEntries: (entries: unknown[]) => void) => {
    onEntries([]);
    return () => undefined;
  }),
  subscribeRoomDirectory: vi.fn((onRooms: (rooms: unknown[]) => void) => {
    onRooms([]);
    return () => undefined;
  }),
  syncCompletedCount: vi.fn(() => Promise.resolve()),
}));

const round: RoundConfig = {
  id: "round-a",
  seed: "seed",
  rowValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  columnValues: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  difficulty: "normal",
  gameMode: "multiplication",
  gridSize: 10,
  generatorVersion: 1,
  createdAt: 1,
  participantIds: ["me", "rival"],
};

function makeRoom(playerCount = 1): RoomData {
  return {
    meta: {
      roomName: "テストサーキット",
      hostId: "me",
      maxPlayers: 8,
      gameMode: "multiplication",
      difficulty: "normal",
      gridSize: 10,
      seed: "TEST-SEED",
      status: "waiting",
      isLocked: false,
      createdAt: 1,
    },
    players: {
      me: {
        name: "ME",
        joinedAt: 1,
        ready: true,
        online: true,
        completedCount: 0,
        status: "lobby",
      },
      ...(playerCount > 1 ? {
        rival: {
          name: "RIVAL",
          joinedAt: 2,
          ready: true,
          online: true,
          completedCount: 67,
          status: "racing" as const,
        },
      } : {}),
    },
  };
}

describe("追加された対戦要件", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("参加者がホスト1人だけでもレースを開始できる", () => {
    render(<Lobby roomId="room" room={makeRoom()} uid="me" onLeave={() => undefined} />);
    expect(screen.getByRole("button", { name: "START RACE" })).toBeEnabled();
    expect(screen.getByText(/SOLO PRACTICE/)).toBeInTheDocument();
  });

  it("他参加者の正解数は文字で出さず、ドット位置にだけ反映する", () => {
    const room = makeRoom(2);
    room.meta.status = "playing";
    room.meta.currentRoundId = round.id;
    room.rounds = { [round.id]: { ...round, id: undefined } as never };
    room.players.me.status = "racing";

    const { container } = render(
      <GameScreen roomId="room" room={room} round={round} uid="me" onLeave={() => undefined} />,
    );

    expect(screen.queryByText(/67\s*\/\s*100/)).not.toBeInTheDocument();
    const rivalDot = container.querySelectorAll<HTMLElement>(".racer-dot")[1];
    expect(rivalDot.style.getPropertyValue("--progress")).toBe("67%");
  });

  it("5×5の割り算盤面と専用回答ボタンを表示する", () => {
    const smallRound: RoundConfig = {
      ...round,
      gridSize: 5,
      gameMode: "division",
      rowValues: [11, 12, 13, 14, 15],
      columnValues: [1, 2, 3, 4, 5],
    };
    const room = makeRoom();
    room.meta.status = "playing";
    room.meta.gameMode = "division";
    room.meta.gridSize = 5;
    room.meta.currentRoundId = smallRound.id;
    room.rounds = { [smallRound.id]: { ...smallRound, id: undefined } as never };
    room.players.me.status = "racing";

    const { container } = render(<GameScreen roomId="room" room={room} round={smallRound} uid="me" onLeave={() => undefined} />);
    expect(container.querySelectorAll(".grid-cell")).toHaveLength(25);
    expect(screen.getByRole("button", { name: "割り切れない" })).toBeInTheDocument();
  });

  it("ルーム作成設定と3つのランキング絞り込みを表示する", () => {
    render(<RoomBrowser playerName="ME" onJoin={() => undefined} onRename={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /ルームを作る/ }));
    expect(screen.getByLabelText("計算モード")).toBeInTheDocument();
    expect(screen.getByText("5 × 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "TOP 5" }));
    expect(screen.getByRole("dialog", { name: "LEADERBOARD TOP 5" }).querySelectorAll("select")).toHaveLength(3);
  });
});
