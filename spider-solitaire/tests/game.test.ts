import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/core/deck";
import {
  dealFromStock,
  dealNewGame,
  findAutoTarget,
  findHint,
  hasAnyMove,
  isBoardFullyRevealed,
  isWon,
  moveRun,
} from "../src/core/game";
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

  it("flips the card newly exposed by a collected run face-up", () => {
    const queenToAce: Card[] = [];
    for (let rank = 12; rank >= 1; rank--) queenToAce.push(card(rank, "♠"));
    const buried = card(9, "♥", false);

    // column 0 (the move's destination) has a buried face-down card sitting under the K;
    // moving the whole Q..A run onto it completes a K..A run, and once those 13 cards are
    // collected, the buried card underneath should flip face-up automatically.
    const state = baseState({
      tableau: [[buried, card(13, "♠")], queenToAce, ...Array.from({ length: 8 }, () => [])],
    });

    const next = moveRun(state, 1, 0, 0);
    expect(next).not.toBeNull();
    expect(next!.tableau[0]).toEqual([{ ...buried, faceUp: true }]);
    expect(next!.completedSuits).toEqual(["♠"]);
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

describe("findHint", () => {
  it("returns a concrete tableau move when one exists", () => {
    const state = baseState({
      tableau: [[card(9, "♠")], [card(10, "♥")], ...Array.from({ length: 8 }, () => [])],
    });
    expect(findHint(state)).toEqual({ type: "move", fromCol: 0, cardIndex: 0, toCol: 1 });
  });

  it("falls back to a stock deal when no tableau move exists", () => {
    const state = baseState({
      tableau: Array.from({ length: 10 }, () => [card(5, "♠")]),
      stock: Array.from({ length: 10 }, () => card(1, "♥", false)),
    });
    expect(findHint(state)).toEqual({ type: "deal" });
  });

  it("returns null when the game is stuck", () => {
    const state = baseState({
      tableau: Array.from({ length: 10 }, () => [card(2, "♠")]),
      stock: [],
    });
    expect(findHint(state)).toBeNull();
  });
});

describe("isBoardFullyRevealed", () => {
  it("is true when the stock is empty and every card is face-up", () => {
    const state = baseState({
      tableau: [[card(5, "♠")], [card(6, "♥")], ...Array.from({ length: 8 }, () => [])],
      stock: [],
    });
    expect(isBoardFullyRevealed(state)).toBe(true);
  });

  it("is false with a face-down card still on the board", () => {
    const state = baseState({
      tableau: [[card(5, "♠", false), card(6, "♥")], ...Array.from({ length: 9 }, () => [])],
      stock: [],
    });
    expect(isBoardFullyRevealed(state)).toBe(false);
  });

  it("is false while the stock still has cards", () => {
    const state = baseState({
      tableau: [[card(5, "♠")], ...Array.from({ length: 9 }, () => [])],
      stock: [card(1, "♥", false)],
    });
    expect(isBoardFullyRevealed(state)).toBe(false);
  });
});

describe("findAutoTarget", () => {
  it("finds a legal landing column for the run", () => {
    const state = baseState({
      tableau: [[card(9, "♠")], [card(10, "♥")], ...Array.from({ length: 8 }, () => [])],
    });
    expect(findAutoTarget(state, 0, 0)).toBe(1);
  });

  it("returns null when the card can't move", () => {
    const state = baseState({
      tableau: [[card(9, "♥"), card(8, "♠")], [], ...Array.from({ length: 8 }, () => [])],
    });
    expect(findAutoTarget(state, 0, 0)).toBeNull();
  });

  it("returns null when nothing accepts the run (no empty columns either)", () => {
    const state = baseState({
      tableau: [[card(9, "♠")], ...Array.from({ length: 9 }, () => [card(5, "♥")])],
    });
    expect(findAutoTarget(state, 0, 0)).toBeNull();
  });
});
