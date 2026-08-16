import { describe, expect, it } from "vitest";
import type { Difficulty, GameMode, GridSize } from "../types";
import {
  generateOperands,
  greatestCommonDivisor,
  hasBorrow,
  hasCarry,
  hasOnlyPrimeFactors,
  normalizeSeed,
} from "./problems";

function generate(gameMode: GameMode, difficulty: Difficulty, gridSize: GridSize = 10, seed = "TEST-SEED") {
  return generateOperands({ gameMode, difficulty, gridSize, seed });
}

function cells(rows: number[], columns: number[], predicate: (row: number, column: number) => boolean): number {
  return rows.reduce((total, row) => total + columns.filter((column) => predicate(row, column)).length, 0);
}

describe("シード付き問題生成", () => {
  it("同じ4条件から同じ行列を再現する", () => {
    expect(generate("addition", "hard", 5, "SAME-1")).toEqual(generate("addition", "hard", 5, "same-1"));
    expect(generate("addition", "hard", 5, "SAME-1")).not.toEqual(generate("addition", "hard", 5, "OTHER-1"));
    expect(generate("addition", "hard", 5, "SAME-1")).not.toEqual(generate("subtraction", "hard", 5, "SAME-1"));
    expect(generate("addition", "hard", 5, "SAME-1")).not.toEqual(generate("addition", "normal", 5, "SAME-1"));
    expect(generate("addition", "hard", 5, "SAME-1")).not.toEqual(generate("addition", "hard", 10, "SAME-1"));
  });

  it("シードを大文字化して検証する", () => {
    expect(normalizeSeed("  race-24 ")).toBe("RACE-24");
    expect(() => normalizeSeed("日本語")).toThrow(/シード/);
  });

  it.each(["normal", "hard"] as Difficulty[])("足し算%sは半数以上で繰り上がる", (difficulty) => {
    const { rowValues, columnValues } = generate("addition", difficulty);
    expect(cells(rowValues, columnValues, hasCarry)).toBeGreaterThanOrEqual(50);
  });

  it.each(["easy", "normal", "hard"] as Difficulty[])("引き算%sは非負になる", (difficulty) => {
    const { rowValues, columnValues } = generate("subtraction", difficulty);
    expect(Math.min(...rowValues)).toBeGreaterThanOrEqual(Math.max(...columnValues));
    if (difficulty !== "easy") expect(cells(rowValues, columnValues, hasBorrow)).toBeGreaterThanOrEqual(50);
  });

  it.each(["easy", "normal", "hard"] as Difficulty[])("割り算%sは大小条件と両方の回答種別を満たす", (difficulty) => {
    const { rowValues, columnValues } = generate("division", difficulty);
    expect(Math.min(...rowValues)).toBeGreaterThan(Math.max(...columnValues));
    const divisible = cells(rowValues, columnValues, (row, column) => row % column === 0);
    expect(divisible).toBeGreaterThan(0);
    expect(divisible).toBeLessThan(rowValues.length * columnValues.length);
  });

  it("最大公約数の初級と中級は素因数を制限する", () => {
    const easy = generate("gcd", "easy");
    expect([...easy.rowValues, ...easy.columnValues].every((value) => value >= 10 && value <= 99 && hasOnlyPrimeFactors(value, [2, 3, 5]))).toBe(true);
    const normal = generate("gcd", "normal");
    expect([...normal.rowValues, ...normal.columnValues].every((value) => value >= 1 && value <= 200 && hasOnlyPrimeFactors(value, [2, 3, 5, 7, 11]))).toBe(true);
  });

  it.each(["easy", "normal", "hard"] as Difficulty[])("最大公約数%sに互いに素な組を含む", (difficulty) => {
    const { rowValues, columnValues } = generate("gcd", difficulty);
    expect(cells(rowValues, columnValues, (row, column) => greatestCommonDivisor(row, column) === 1)).toBeGreaterThan(0);
  });
});
