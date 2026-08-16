import type { Difficulty, GameMode, GridSize } from "../types";

export const GENERATOR_VERSION = 1;
const SEED_PATTERN = /^[A-Z0-9-]{1,24}$/;
const RANDOM_SEED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface ProblemSettings {
  seed: string;
  gameMode: GameMode;
  difficulty: Difficulty;
  gridSize: GridSize;
}

export interface GeneratedOperands {
  rowValues: number[];
  columnValues: number[];
}

type Random = () => number;

export function normalizeSeed(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!SEED_PATTERN.test(normalized)) throw new Error("シードは英数字とハイフンで1〜24文字にしてください。");
  return normalized;
}

export function createRandomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const parts = Array.from(bytes, (byte) => RANDOM_SEED_ALPHABET[byte % RANDOM_SEED_ALPHABET.length]);
  return `${parts.slice(0, 4).join("")}-${parts.slice(4).join("")}`;
}

function xmur3(value: string): () => number {
  let hash = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = hash << 13 | hash >>> 19;
  }
  return () => {
    hash = Math.imul(hash ^ hash >>> 16, 2246822507);
    hash = Math.imul(hash ^ hash >>> 13, 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): Random {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const total = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11);
    c = c + total | 0;
    return (total >>> 0) / 4294967296;
  };
}

function randomFor(settings: ProblemSettings): Random {
  const source = `pixel-rally:v${GENERATOR_VERSION}|${settings.seed}|${settings.gameMode}|${settings.gridSize}|${settings.difficulty}`;
  const seed = xmur3(source);
  return sfc32(seed(), seed(), seed(), seed());
}

function integer(random: Random, minimum: number, maximum: number): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function shuffled<T>(values: T[], random: Random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = integer(random, 0, index);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function range(minimum: number, maximum: number): number[] {
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

function sample(candidates: number[], count: number, random: Random): number[] {
  if (candidates.length >= count) return shuffled(candidates, random).slice(0, count);
  const values: number[] = [];
  while (values.length < count) values.push(...shuffled(candidates, random));
  return shuffled(values.slice(0, count), random);
}

export function hasCarry(left: number, right: number): boolean {
  let a = left;
  let b = right;
  let carry = 0;
  while (a > 0 || b > 0) {
    const sum = a % 10 + b % 10 + carry;
    if (sum >= 10) return true;
    carry = Math.floor(sum / 10);
    a = Math.floor(a / 10);
    b = Math.floor(b / 10);
  }
  return false;
}

export function hasBorrow(minuend: number, subtrahend: number): boolean {
  let left = minuend;
  let right = subtrahend;
  let borrow = 0;
  while (left > 0 || right > 0) {
    const top = left % 10 - borrow;
    const bottom = right % 10;
    if (top < bottom) return true;
    borrow = 0;
    left = Math.floor(left / 10);
    right = Math.floor(right / 10);
  }
  return false;
}

export function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export function hasOnlyPrimeFactors(value: number, allowedPrimes: number[]): boolean {
  if (value === 1) return true;
  let remaining = value;
  for (const prime of allowedPrimes) while (remaining % prime === 0) remaining /= prime;
  return remaining === 1;
}

function matchingCells(rows: number[], columns: number[], predicate: (row: number, column: number) => boolean): number {
  return rows.reduce((total, row) => total + columns.filter((column) => predicate(row, column)).length, 0);
}

function multiplicationOperands(difficulty: Difficulty, count: number, random: Random): GeneratedOperands {
  const maximum = difficulty === "easy" ? 5 : difficulty === "normal" ? 10 : 20;
  const candidates = range(1, maximum);
  return { rowValues: sample(candidates, count, random), columnValues: sample(candidates, count, random) };
}

function additionOperands(difficulty: Difficulty, count: number, random: Random): GeneratedOperands {
  const [minimum, maximum] = difficulty === "easy" ? [1, 20] : difficulty === "normal" ? [10, 100] : [100, 999];
  const candidates = range(minimum, maximum);
  if (difficulty === "easy") return { rowValues: sample(candidates, count, random), columnValues: sample(candidates, count, random) };
  const required = Math.ceil(count * count / 2);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rowValues = sample(candidates, count, random);
    const columnValues = sample(candidates, count, random);
    if (matchingCells(rowValues, columnValues, hasCarry) >= required) return { rowValues, columnValues };
  }
  const carryCandidates = candidates.filter((value) => value % 10 >= 5);
  return { rowValues: sample(carryCandidates, count, random), columnValues: sample(carryCandidates, count, random) };
}

function subtractionOperands(difficulty: Difficulty, count: number, random: Random): GeneratedOperands {
  const [columnMinimum, columnMaximum, rowMinimum, rowMaximum] = difficulty === "easy"
    ? [1, 10, 11, 20]
    : difficulty === "normal" ? [10, 54, 55, 100] : [100, 549, 550, 999];
  const columns = range(columnMinimum, columnMaximum);
  const rows = range(rowMinimum, rowMaximum);
  if (difficulty === "easy") return { rowValues: sample(rows, count, random), columnValues: sample(columns, count, random) };
  const required = Math.ceil(count * count / 2);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rowValues = sample(rows, count, random);
    const columnValues = sample(columns, count, random);
    if (matchingCells(rowValues, columnValues, hasBorrow) >= required) return { rowValues, columnValues };
  }
  const borrowRows = rows.filter((value) => value % 10 <= 4);
  const borrowColumns = columns.filter((value) => value % 10 >= 5);
  return { rowValues: sample(borrowRows, count, random), columnValues: sample(borrowColumns, count, random) };
}

function divisionOperands(difficulty: Difficulty, count: number, random: Random): GeneratedOperands {
  const [dividendMinimum, dividendMaximum, divisorMinimum, divisorMaximum] = difficulty === "easy"
    ? [2, 20, 1, 5]
    : difficulty === "normal" ? [10, 100, 2, 10] : [100, 999, 2, 20];
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const columnValues = sample(range(divisorMinimum, divisorMaximum), count, random);
    const minimumDividend = Math.max(dividendMinimum, Math.max(...columnValues) + 1);
    const rowValues = sample(range(minimumDividend, dividendMaximum), count, random);
    const divisible = matchingCells(rowValues, columnValues, (row, column) => row % column === 0);
    if (divisible > 0 && divisible < count * count) return { rowValues, columnValues };
  }
  const columnValues = sample(range(divisorMinimum, divisorMaximum), count, random);
  const minimumDividend = Math.max(dividendMinimum, Math.max(...columnValues) + 1);
  const rowValues = sample(range(minimumDividend, dividendMaximum), count, random);
  const divisor = columnValues.find((value) => value > 1) ?? 1;
  const exact = range(minimumDividend, dividendMaximum).find((value) => value % divisor === 0);
  const inexact = range(minimumDividend, dividendMaximum).find((value) => value % divisor !== 0);
  if (exact !== undefined) rowValues[0] = exact;
  if (inexact !== undefined && rowValues.length > 1) rowValues[1] = inexact;
  return { rowValues: shuffled(rowValues, random), columnValues: shuffled(columnValues, random) };
}

function gcdOperands(difficulty: Difficulty, count: number, random: Random): GeneratedOperands {
  const candidates = difficulty === "easy"
    ? range(10, 99).filter((value) => hasOnlyPrimeFactors(value, [2, 3, 5]))
    : difficulty === "normal"
      ? range(1, 200).filter((value) => hasOnlyPrimeFactors(value, [2, 3, 5, 7, 11]))
      : range(100, 999);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const rowValues = sample(candidates, count, random);
    const columnValues = sample(candidates, count, random);
    if (matchingCells(rowValues, columnValues, (row, column) => greatestCommonDivisor(row, column) === 1) > 0) return { rowValues, columnValues };
  }
  const [coprimeRow, coprimeColumn] = difficulty === "easy" ? [16, 25] : difficulty === "normal" ? [1, 2] : [100, 101];
  const rowValues = sample(candidates, count, random);
  const columnValues = sample(candidates, count, random);
  rowValues[0] = coprimeRow;
  columnValues[0] = coprimeColumn;
  return { rowValues: shuffled(rowValues, random), columnValues: shuffled(columnValues, random) };
}

export function generateOperands(settings: ProblemSettings): GeneratedOperands {
  const normalizedSettings = { ...settings, seed: normalizeSeed(settings.seed) };
  const random = randomFor(normalizedSettings);
  switch (normalizedSettings.gameMode) {
    case "addition": return additionOperands(normalizedSettings.difficulty, normalizedSettings.gridSize, random);
    case "subtraction": return subtractionOperands(normalizedSettings.difficulty, normalizedSettings.gridSize, random);
    case "division": return divisionOperands(normalizedSettings.difficulty, normalizedSettings.gridSize, random);
    case "gcd": return gcdOperands(normalizedSettings.difficulty, normalizedSettings.gridSize, random);
    case "multiplication": return multiplicationOperands(normalizedSettings.difficulty, normalizedSettings.gridSize, random);
  }
}
