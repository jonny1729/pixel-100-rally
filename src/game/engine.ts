import type { GameDefinition, LocalRunState, RoundConfig } from "../types";

export const multiplicationGame: GameDefinition = {
  id: "multiplication",
  label: "かけ算",
  symbol: "×",
  answer: (rowValue, columnValue) => rowValue * columnValue,
};

export type InputEvent = "pending" | "correct" | "wrong" | "finished";

export interface InputResult {
  state: LocalRunState;
  event: InputEvent;
}

export function createRun(roundId: string): LocalRunState {
  return {
    roundId,
    remainingQueue: Array.from({ length: 100 }, (_, index) => index),
    answers: Array.from({ length: 100 }, () => null),
    passed: Array.from({ length: 100 }, () => false),
    input: "",
    feedback: "idle",
  };
}

export function completedCount(state: LocalRunState): number {
  return 100 - state.remainingQueue.length;
}

export function currentIndex(state: LocalRunState): number | null {
  return state.remainingQueue[0] ?? null;
}

export function coordinates(index: number): { row: number; column: number } {
  return { row: Math.floor(index / 10), column: index % 10 };
}

export function answerFor(round: RoundConfig, index: number): number {
  const { row, column } = coordinates(index);
  return multiplicationGame.answer(round.rowValues[row], round.columnValues[column]);
}

export function enterDigit(
  state: LocalRunState,
  digit: number,
  round: RoundConfig,
): InputResult {
  const index = currentIndex(state);
  if (index === null || digit < 0 || digit > 9) {
    return { state, event: index === null ? "finished" : "pending" };
  }

  const target = String(answerFor(round, index));
  const nextInput = `${state.input}${digit}`;

  if (nextInput === target) {
    const nextAnswers = [...state.answers];
    const nextPassed = [...state.passed];
    nextAnswers[index] = Number(target);
    nextPassed[index] = false;
    const nextQueue = state.remainingQueue.slice(1);
    return {
      state: {
        ...state,
        remainingQueue: nextQueue,
        answers: nextAnswers,
        passed: nextPassed,
        input: "",
        feedback: "correct",
      },
      event: nextQueue.length === 0 ? "finished" : "correct",
    };
  }

  if (nextInput.length >= target.length) {
    return {
      state: { ...state, input: "", feedback: "wrong" },
      event: "wrong",
    };
  }

  return {
    state: { ...state, input: nextInput, feedback: "idle" },
    event: "pending",
  };
}

export function clearInput(state: LocalRunState): LocalRunState {
  if (!state.input && state.feedback === "idle") return state;
  return { ...state, input: "", feedback: "idle" };
}

export function backspaceInput(state: LocalRunState): LocalRunState {
  if (!state.input) return { ...state, feedback: "idle" };
  return { ...state, input: state.input.slice(0, -1), feedback: "idle" };
}

export function passCurrent(state: LocalRunState): LocalRunState {
  const [current, ...rest] = state.remainingQueue;
  if (current === undefined) return state;
  const nextPassed = [...state.passed];
  nextPassed[current] = true;
  return {
    ...state,
    remainingQueue: [...rest, current],
    passed: nextPassed,
    input: "",
    feedback: "idle",
  };
}

export function formatTime(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return "--:--.---";
  }
  const safe = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
