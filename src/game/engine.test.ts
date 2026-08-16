import { describe, expect, it } from "vitest";
import type { RoundConfig } from "../types";
import {
  answerFor,
  backspaceInput,
  clearInput,
  completedCount,
  createRun,
  enterDigit,
  enterNotDivisible,
  formatTime,
  passCurrent,
} from "./engine";

const round: RoundConfig = {
  id: "round-1",
  seed: "seed",
  rowValues: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  columnValues: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  difficulty: "normal",
  gameMode: "multiplication",
  gridSize: 10,
  generatorVersion: 1,
  createdAt: 0,
  participantIds: ["a"],
};

describe("100マス計算エンジン", () => {
  it("座標から正しい掛け算結果を返す", () => {
    expect(answerFor(round, 0)).toBe(8);
    expect(answerFor(round, 11)).toBe(15);
    expect(answerFor(round, 99)).toBe(143);
  });

  it("正解した瞬間に次の問題へ進む", () => {
    const result = enterDigit(createRun(round.id), 8, round);
    expect(result.event).toBe("correct");
    expect(result.state.remainingQueue[0]).toBe(1);
    expect(result.state.answers[0]).toBe(8);
    expect(completedCount(result.state)).toBe(1);
  });

  it("複数桁の途中入力を保持する", () => {
    const state = { ...createRun(round.id), remainingQueue: [11] };
    const result = enterDigit(state, 1, round);
    expect(result.event).toBe("pending");
    expect(result.state.input).toBe("1");
  });

  it("正解と同じ桁数の誤答を即クリアする", () => {
    const state = { ...createRun(round.id), remainingQueue: [11] };
    const first = enterDigit(state, 1, round);
    const second = enterDigit(first.state, 6, round);
    expect(second.event).toBe("wrong");
    expect(second.state.input).toBe("");
  });

  it("PASSした問題をキュー末尾へ移す", () => {
    const state = passCurrent(createRun(round.id));
    expect(state.remainingQueue[0]).toBe(1);
    expect(state.remainingQueue.at(-1)).toBe(0);
    expect(state.passed[0]).toBe(true);
    expect(completedCount(state)).toBe(0);
  });

  it("ClearとBackspaceを処理する", () => {
    const state = { ...createRun(round.id), input: "123" };
    expect(backspaceInput(state).input).toBe("12");
    expect(clearInput(state).input).toBe("");
  });

  it("最後の問題の正解でfinishedになる", () => {
    const state = { ...createRun(round.id), remainingQueue: [0] };
    const result = enterDigit(state, 8, round);
    expect(result.event).toBe("finished");
    expect(completedCount(result.state)).toBe(100);
  });

  it("タイムを分・秒・ミリ秒で整形する", () => {
    expect(formatTime(83_482)).toBe("01:23.482");
    expect(formatTime(undefined)).toBe("--:--.---");
  });

  it("5×5では25問で完走する", () => {
    const smallRound = { ...round, gridSize: 5 as const, rowValues: [1, 2, 3, 4, 5], columnValues: [1, 2, 3, 4, 5] };
    const state = { ...createRun(smallRound.id, 5), remainingQueue: [0] };
    const result = enterDigit(state, 1, smallRound);
    expect(result.event).toBe("finished");
    expect(completedCount(result.state)).toBe(25);
  });

  it("割り切れない問題は専用入力だけを正解にする", () => {
    const divisionRound = { ...round, gameMode: "division" as const, rowValues: [7, ...round.rowValues.slice(1)], columnValues: [3, ...round.columnValues.slice(1)] };
    expect(enterDigit(createRun(divisionRound.id), 2, divisionRound).event).toBe("wrong");
    const result = enterNotDivisible(createRun(divisionRound.id), divisionRound);
    expect(result.event).toBe("correct");
    expect(result.state.answers[0]).toBe("not-divisible");
  });
});
