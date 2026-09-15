import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/core/deck";
import { dealFromStock, dealNewGame, hasAnyMove, isWon, moveRun } from "../src/core/game";
import { Card, GameState } from "../src/core/types";

let seq = 0;
function card(rank: number, suit: Card["suit"], faceUp = true): Card {
  return { id: `c${seq++}`, rank, suit, faceUp };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    difficulty: "hard",
    tableau: Array.from({ length: 10 }, () => []),
    stock: [],
    completedSuits: [],
    score: 500,
    moves: 0,
    ...overrides,
  };
}

describe("dealNewGame", () => {
  it("deals the standard opening layout", () => {
    const state = dealNewGame("hard", mulberry32(123));

    expect(state.tableau).toHaveLength(10);
    state.tableau.forEach((column, i) => {
      expect(column).toHaveLength(i < 4 ? 6 : 5);
      column.forEach((c, idx) => {
        expect(c.faceUp).toBe(idx === column.length - 1);
      });
    });

    const dealtCount = state.tableau.reduce((sum, col) => sum + col.length, 0);
    expect(dealtCount).toBe(54);
    expect(state.stock).toHaveLength(50);
    expect(state.score).toBe(500);
    expect(state.moves).toBe(0);
    expect(state.completedSuits).toEqual([]);
  });

  it("is reproducible for the same seed", () => {
    const a = dealNewGame("medium", mulberry32(7));
    const b = dealNewGame("medium", mulberry32(7));
    expect(a).toEqual(b);
  });
});

describe("moveRun", () => {
  it("moves a valid run and flips the newly revealed card", () => {
    const state = baseState({
      tableau: [
        [card(10, "♠", false), card(9, "♠")], // from
        [card(10, "♥")], // to
        ...Array.from({ length: 8 }, () => []),
      ],
    });

    const next = moveRun(state, 0, 1, 1);
    expect(next).not.toBeNull();
    expect(next!.tableau[0]).toEqual([{ ...state.tableau[0]![0]!, faceUp: true }]);
    expect(next!.tableau[1]!.map((c) => c.rank)).toEqual([10, 9]);
    expect(next!.moves).toBe(1);
    expect(next!.score).toBe(499);
  });

  it("rejects a move onto a card that isn't exactly one rank higher", () => {
    const state = baseState({
      tableau: [[card(9, "♠")], [card(5, "♥")], ...Array.from({ length: 8 }, () => [])],
    });
    expect(moveRun(state, 0, 0, 1)).toBeNull();
  });

  it("rejects moving a card that isn't part of the movable run", () => {
    const state = baseState({
      tableau: [[card(9, "♥"), card(8, "♠")], [], ...Array.from({ length: 8 }, () => [])],
    });
    // index 0 (the ♥9) is buried under a suit break, so it can't move even though rank-wise it's on top of nothing
    expect(moveRun(state, 0, 0, 1)).toBeNull();
  });

  it("collects a completed K..A run and awards the bonus", () => {
    const queenToAce: Card[] = [];
    for (let rank = 12; rank >= 1; rank--) queenToAce.push(card(rank, "♠"));

    const state = baseState({
      tableau: [[card(13, "♠")], queenToAce, ...Array.from({ length: 8 }, () => [])],
      score: 500,
    });

    // moving the whole Q..A run (column 1) onto the lone K (column 0) completes a K..A run
    const next = moveRun(state, 1, 0, 0);
    expect(next).not.toBeNull();
    expect(next!.tableau[0]).toEqual([]);
    expect(next!.tableau[1]).toEqual([]);
    expect(next!.completedSuits).toEqual(["♠"]);
    expect(next!.score).toBe(500 - 1 + 100);
    expect(isWon(next!)).toBe(false);
  });
});

describe("dealFromStock", () => {
  it("deals one card to every column", () => {
    const state = baseState({
      tableau: Array.from({ length: 10 }, () => [card(5, "♠")]),
      stock: Array.from({ length: 10 }, (_, i) => card(1 + (i % 13), "♥", false)),
    });

    const next = dealFromStock(state);
    expect(next).not.toBeNull();
    expect(next!.stock).toHaveLength(0);
    next!.tableau.forEach((column) => {
      expect(column).toHaveLength(2);
      expect(column[column.length - 1]!.faceUp).toBe(true);
    });
  });

  it("refuses to deal when a column is empty", () => {
    const state = baseState({
      tableau: [[], ...Array.from({ length: 9 }, () => [card(5, "♠")])],
      stock: Array.from({ length: 10 }, () => card(1, "♥", false)),
    });
    expect(dealFromStock(state)).toBeNull();
  });

  it("refuses to deal when the stock is empty", () => {
    const state = baseState({ tableau: Array.from({ length: 10 }, () => [card(5, "♠")]), stock: [] });
    expect(dealFromStock(state)).toBeNull();
  });
});

describe("isWon", () => {
  it("is true once all 8 suit runs are collected", () => {
    const suits: Card["suit"][] = ["♠", "♥", "♦", "♣", "♠", "♥", "♦", "♣"];
    expect(isWon(baseState({ completedSuits: suits }))).toBe(true);
    expect(isWon(baseState({ completedSuits: suits.slice(0, 7) }))).toBe(false);
  });
});

describe("hasAnyMove", () => {
  it("is true when a tableau-to-tableau move exists", () => {
    const state = baseState({
      tableau: [[card(9, "♠")], [card(10, "♥")], ...Array.from({ length: 8 }, () => [])],
    });
    expect(hasAnyMove(state)).toBe(true);
  });

  it("is true when the stock can still be dealt", () => {
    const state = baseState({
      tableau: Array.from({ length: 10 }, () => [card(5, "♠")]),
      stock: Array.from({ length: 10 }, () => card(1, "♥", false)),
    });
    expect(hasAnyMove(state)).toBe(true);
  });

  it("is false when nothing can move and the stock is empty", () => {
    // all 10 columns occupied (no empty column to drop into) and every top card is
    // the same rank, so nothing is one rank higher than anything else
    const state = baseState({
      tableau: Array.from({ length: 10 }, () => [card(2, "♠")]),
      stock: [],
    });
    expect(hasAnyMove(state)).toBe(false);
  });
});
