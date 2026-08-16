import type { Answer, GameDefinition, GameMode, GridSize, LocalRunState, RoundConfig } from "../types";
import { greatestCommonDivisor } from "./problems";

export const NOT_DIVISIBLE = "not-divisible" as const;

export const gameDefinitions: Record<GameMode, GameDefinition> = {
  addition: { id: "addition", label: "足し算", symbol: "+", answer: (row, column) => row + column },
  subtraction: { id: "subtraction", label: "引き算", symbol: "−", answer: (row, column) => row - column },
  multiplication: { id: "multiplication", label: "かけ算", symbol: "×", answer: (row, column) => row * column },
  division: {
    id: "division",
    label: "割り算",
    symbol: "÷",
    answer: (row, column) => row % column === 0 ? row / column : NOT_DIVISIBLE,
  },
  gcd: { id: "gcd", label: "最大公約数", symbol: "GCD", answer: greatestCommonDivisor },
};

export const multiplicationGame = gameDefinitions.multiplication;

export type InputEvent = "pending" | "correct" | "wrong" | "finished";

export interface InputResult {
  state: LocalRunState;
  event: InputEvent;
}

export function roundGridSize(round: Pick<RoundConfig, "gridSize" | "rowValues">): GridSize {
  return round.gridSize === 5 || round.rowValues.length === 5 ? 5 : 10;
}

export function totalProblems(round: Pick<RoundConfig, "gridSize" | "rowValues">): number {
  return roundGridSize(round) ** 2;
}

export function createRun(roundId: string, gridSize: GridSize = 10): LocalRunState {
  const total = gridSize ** 2;
  return {
    roundId,
    remainingQueue: Array.from({ length: total }, (_, index) => index),
    answers: Array.from({ length: total }, () => null),
    passed: Array.from({ length: total }, () => false),
    input: "",
    feedback: "idle",
  };
}

export function completedCount(state: LocalRunState): number {
  return state.answers.length - state.remainingQueue.length;
}

export function currentIndex(state: LocalRunState): number | null {
  return state.remainingQueue[0] ?? null;
}

export function coordinates(index: number, gridSize: GridSize = 10): { row: number; column: number } {
  return { row: Math.floor(index / gridSize), column: index % gridSize };
}

export function answerFor(round: RoundConfig, index: number): Answer {
  const gridSize = roundGridSize(round);
  const { row, column } = coordinates(index, gridSize);
  return gameDefinitions[round.gameMode ?? "multiplication"].answer(round.rowValues[row], round.columnValues[column]);
}

function acceptAnswer(state: LocalRunState, index: number, answer: Answer): InputResult {
  const nextAnswers = [...state.answers];
  const nextPassed = [...state.passed];
  nextAnswers[index] = answer;
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

export function enterDigit(state: LocalRunState, digit: number, round: RoundConfig): InputResult {
  const index = currentIndex(state);
  if (index === null || digit < 0 || digit > 9) return { state, event: index === null ? "finished" : "pending" };

  const answer = answerFor(round, index);
  if (answer === NOT_DIVISIBLE) return { state: { ...state, input: "", feedback: "wrong" }, event: "wrong" };
  const target = String(answer);
  const nextInput = `${state.input}${digit}`;
  if (nextInput === target) return acceptAnswer(state, index, answer);
  if (nextInput.length >= target.length) return { state: { ...state, input: "", feedback: "wrong" }, event: "wrong" };
  return { state: { ...state, input: nextInput, feedback: "idle" }, event: "pending" };
}

export function enterNotDivisible(state: LocalRunState, round: RoundConfig): InputResult {
  const index = currentIndex(state);
  if (index === null) return { state, event: "finished" };
  if (answerFor(round, index) !== NOT_DIVISIBLE) {
    return { state: { ...state, input: "", feedback: "wrong" }, event: "wrong" };
  }
  return acceptAnswer(state, index, NOT_DIVISIBLE);
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
  return { ...state, remainingQueue: [...rest, current], passed: nextPassed, input: "", feedback: "idle" };
}

export function formatTime(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) return "--:--.---";
  const safe = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
