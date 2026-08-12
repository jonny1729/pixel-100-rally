import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomData, RoundConfig } from "../types";
import { GameScreen } from "./GameScreen";
import { Lobby } from "./Lobby";

vi.mock("../services/rooms.spark", () => ({
  friendlyError: (error: unknown) => error instanceof Error ? error.message : "error",
  setReady: vi.fn(),
  startRound: vi.fn(),
  submitFinish: vi.fn(),
  syncCompletedCount: vi.fn(() => Promise.resolve()),
}));

const round: RoundConfig = {
  id: "round-a",
  seed: "seed",
  rowValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  columnValues: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  difficulty: "normal",
  gameMode: "multiplication",
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
});
