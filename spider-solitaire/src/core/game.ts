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
  const remaining = column.slice(0, column.length - 13);
  if (remaining.length > 0) {
    const topIndex = remaining.length - 1;
    const top = remaining[topIndex]!;
    if (!top.faceUp) remaining[topIndex] = { ...top, faceUp: true };
  }
  nextTableau[columnIndex] = remaining;
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

/**
 * Deals one card face-up onto every column from the stock. Null only if the stock doesn't
 * have a full round left. Unlike strict Spider rules, this house rule lets a deal fill an
 * empty column too, rather than requiring every column be filled first.
 */
export function dealFromStock(state: GameState): GameState | null {
  if (state.stock.length < STOCK_DEAL_SIZE) return null;

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

/** Finds every distinct movable-card hint currently available — one per source column with a
 *  legal target, in column order — plus a trailing stock-deal hint if one is available. Lets
 *  the hint button cycle through options instead of only ever pointing at the first one. */
export function findAllHints(state: GameState): HintMove[] {
  const hints: HintMove[] = [];
  for (let from = 0; from < state.tableau.length; from++) {
    const column = state.tableau[from]!;
    const runLength = getMovableRunLength(column);
    if (runLength === 0) continue;
    const cardIndex = column.length - runLength;
    const run = column.slice(cardIndex);
    for (let to = 0; to < state.tableau.length; to++) {
      if (to === from) continue;
      if (canPlaceRun(run, state.tableau[to]!)) {
        hints.push({ type: "move", fromCol: from, cardIndex, toCol: to });
        break;
      }
    }
  }
  if (dealFromStock(state) !== null) hints.push({ type: "deal" });
  return hints;
}

/** Finds one legal move to suggest, preferring a tableau move over a stock deal. Null if the game is stuck. */
export function findHint(state: GameState): HintMove | null {
  return findAllHints(state)[0] ?? null;
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

/** True once the stock is empty and every card on the board is face-up — nothing left to discover. */
export function isBoardFullyRevealed(state: GameState): boolean {
  return state.stock.length === 0 && state.tableau.every((column) => column.every((card) => card.faceUp));
}

export type AutoCompleteMove = { fromCol: number; cardIndex: number; toCol: number };

/**
 * Finds a sequence of tableau-only moves that fully clears the board, for use once
 * isBoardFullyRevealed is true (no more hidden information, nothing left to deal).
 * findHint's single first-legal-move suggestion isn't enough to drive "자동 정리": greedily
 * always taking the first legal move often dead-ends on a board that's still fully clearable
 * with a different move order. This backtracks instead, trying moves onto a same-suit top
 * card first (since that's the direction that eventually completes a run) and bailing out
 * once nodeBudget positions have been explored, returning null rather than searching forever
 * on a board that turns out not to be clearable after all.
 */
export function findAutoCompletePlan(state: GameState, nodeBudget = 8000): AutoCompleteMove[] | null {
  let nodesExplored = 0;
  const path: AutoCompleteMove[] = [];

  function candidateMoves(current: GameState): (AutoCompleteMove & { score: number })[] {
    const moves: (AutoCompleteMove & { score: number })[] = [];
    for (let from = 0; from < current.tableau.length; from++) {
      const column = current.tableau[from]!;
      const runLength = getMovableRunLength(column);
      if (runLength === 0) continue;
      const cardIndex = column.length - runLength;
      const run = column.slice(cardIndex);
      const runBottom = run[0]!;
      for (let to = 0; to < current.tableau.length; to++) {
        if (to === from) continue;
        const target = current.tableau[to]!;
        if (!canPlaceRun(run, target)) continue;
        const targetTop = target[target.length - 1];
        const sameSuit = targetTop ? targetTop.suit === runBottom.suit : false;
        const score = (sameSuit ? 2 : 0) + (target.length > 0 ? 1 : 0);
        moves.push({ fromCol: from, cardIndex, toCol: to, score });
      }
    }
    moves.sort((a, b) => b.score - a.score);
    return moves;
  }

  function dfs(current: GameState): boolean {
    if (current.tableau.every((column) => column.length === 0)) return true;
    if (nodesExplored++ > nodeBudget) return false;

    for (const move of candidateMoves(current)) {
      const next = moveRun(current, move.fromCol, move.cardIndex, move.toCol);
      if (!next) continue;
      path.push({ fromCol: move.fromCol, cardIndex: move.cardIndex, toCol: move.toCol });
      if (dfs(next)) return true;
      path.pop();
    }
    return false;
  }

  return dfs(state) ? path : null;
}

/** First column (other than fromCol) the run starting at cardIndex could legally land on, if any. */
export function findAutoTarget(state: GameState, fromCol: number, cardIndex: number): number | null {
  const column = state.tableau[fromCol];
  if (!column || !canMoveFrom(column, cardIndex)) return null;
  const run = column.slice(cardIndex);
  for (let to = 0; to < state.tableau.length; to++) {
    if (to === fromCol) continue;
    if (canPlaceRun(run, state.tableau[to]!)) return to;
  }
  return null;
}
