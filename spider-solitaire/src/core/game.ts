import { createDeck, shuffle } from "./deck";
import { canMoveFrom, canPlaceRun, isCompletedSuitRun, getMovableRunLength } from "./rules";
import { Card, COLUMN_COUNT, Difficulty, GameState, STOCK_DEAL_SIZE } from "./types";

const STARTING_SCORE = 500;
const MOVE_PENALTY = 1;
const COMPLETED_RUN_BONUS = 100;

function collectCompletedRun(tableau: Card[][], columnIndex: number, score: number, completedSuits: GameState["completedSuits"]) {
  const suit = isCompletedSuitRun(tableau[columnIndex]!);
  if (!suit) return { tableau, score, completedSuits };
  const nextTableau = tableau.slice();
  const column = nextTableau[columnIndex]!;
  nextTableau[columnIndex] = column.slice(0, column.length - 13);
  return {
    tableau: nextTableau,
    score: score + COMPLETED_RUN_BONUS,
    completedSuits: [...completedSuits, suit],
  };
}

/** Shuffles a fresh deck and deals the standard Spider Solitaire opening layout. */
export function dealNewGame(difficulty: Difficulty, rng: () => number = Math.random): GameState {
  const deck = shuffle(createDeck(difficulty), rng);
  const tableau: Card[][] = Array.from({ length: COLUMN_COUNT }, () => []);

  let cursor = 0;
  for (let col = 0; col < COLUMN_COUNT; col++) {
    const count = col < 4 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      tableau[col]!.push({ ...deck[cursor++]!, faceUp: false });
    }
    const column = tableau[col]!;
    column[column.length - 1] = { ...column[column.length - 1]!, faceUp: true };
  }

  const stock = deck.slice(cursor);

  return {
    difficulty,
    tableau,
    stock,
    completedSuits: [],
    score: STARTING_SCORE,
    moves: 0,
  };
}

/**
 * Moves the run starting at `cardIndex` in `fromCol` onto `toCol`.
 * Returns a new GameState, or null if the move is illegal.
 */
export function moveRun(state: GameState, fromCol: number, cardIndex: number, toCol: number): GameState | null {
  if (fromCol === toCol) return null;
  const source = state.tableau[fromCol];
  const target = state.tableau[toCol];
  if (!source || !target) return null;
  if (!canMoveFrom(source, cardIndex)) return null;

  const run = source.slice(cardIndex);
  if (!canPlaceRun(run, target)) return null;

  const remainingSource = source.slice(0, cardIndex);
  if (remainingSource.length > 0) {
    const topIndex = remainingSource.length - 1;
    const top = remainingSource[topIndex]!;
    if (!top.faceUp) remainingSource[topIndex] = { ...top, faceUp: true };
  }

  const nextTableau = state.tableau.slice();
  nextTableau[fromCol] = remainingSource;
  nextTableau[toCol] = [...target, ...run];

  const collected = collectCompletedRun(nextTableau, toCol, state.score - MOVE_PENALTY, state.completedSuits);

  return {
    ...state,
    tableau: collected.tableau,
    score: collected.score,
    completedSuits: collected.completedSuits,
    moves: state.moves + 1,
  };
}

/** Deals one card face-up onto every column from the stock. Null if the stock is empty or any column is empty. */
export function dealFromStock(state: GameState): GameState | null {
  if (state.stock.length < STOCK_DEAL_SIZE) return null;
  if (state.tableau.some((column) => column.length === 0)) return null;

  const dealt = state.stock.slice(0, STOCK_DEAL_SIZE);
  const stock = state.stock.slice(STOCK_DEAL_SIZE);

  let tableau = state.tableau.map((column, i) => [...column, { ...dealt[i]!, faceUp: true }]);
  let score = state.score;
  let completedSuits = state.completedSuits;

  for (let col = 0; col < tableau.length; col++) {
    const collected = collectCompletedRun(tableau, col, score, completedSuits);
    tableau = collected.tableau;
    score = collected.score;
    completedSuits = collected.completedSuits;
  }

  return { ...state, tableau, stock, score, completedSuits };
}

export function isWon(state: GameState): boolean {
  return state.completedSuits.length === 8;
}

export type HintMove = { type: "move"; fromCol: number; cardIndex: number; toCol: number } | { type: "deal" };

/** Finds one legal move to suggest, preferring a tableau move over a stock deal. Null if the game is stuck. */
export function findHint(state: GameState): HintMove | null {
  for (let from = 0; from < state.tableau.length; from++) {
    const column = state.tableau[from]!;
    const runLength = getMovableRunLength(column);
    if (runLength === 0) continue;
    const cardIndex = column.length - runLength;
    const run = column.slice(cardIndex);
    for (let to = 0; to < state.tableau.length; to++) {
      if (to === from) continue;
      if (canPlaceRun(run, state.tableau[to]!)) {
        return { type: "move", fromCol: from, cardIndex, toCol: to };
      }
    }
  }
  return dealFromStock(state) !== null ? { type: "deal" } : null;
}

/** True if any tableau-to-tableau move or stock deal is currently available. */
export function hasAnyMove(state: GameState): boolean {
  for (let from = 0; from < state.tableau.length; from++) {
    const column = state.tableau[from]!;
    const runLength = getMovableRunLength(column);
    if (runLength === 0) continue;
    const run = column.slice(column.length - runLength);
    for (let to = 0; to < state.tableau.length; to++) {
      if (to === from) continue;
      if (canPlaceRun(run, state.tableau[to]!)) return true;
    }
  }
  return dealFromStock(state) !== null;
}
