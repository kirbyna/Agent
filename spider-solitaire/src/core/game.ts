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

export type TableauMove = { fromCol: number; cardIndex: number; toCol: number };
export type HintMove = ({ type: "move" } & TableauMove) | { type: "deal" };

/**
 * Every move available from one column: for each other pile, the one cut of the column's
 * movable run that fits on it (the run's ranks are consecutive, so at most one does), plus
 * each cut onto an empty column. Moving only part of a run counts — it is a legal move even
 * when the whole run fits nowhere. Left out: parking an entire column in an empty one, which
 * only swaps two columns, and more than one empty column, since they're all the same place.
 */
function movesFromColumn(tableau: Card[][], from: number): TableauMove[] {
  const column = tableau[from]!;
  const runLength = getMovableRunLength(column);
  if (runLength === 0) return [];
  const runStart = column.length - runLength;
  const runBottomRank = column[runStart]!.rank;
  const moves: TableauMove[] = [];
  let emptyColumn = -1;

  for (let to = 0; to < tableau.length; to++) {
    if (to === from) continue;
    const target = tableau[to]!;
    if (target.length === 0) {
      if (emptyColumn === -1) emptyColumn = to;
      continue;
    }
    const top = target[target.length - 1]!;
    if (!top.faceUp) continue;
    const cardIndex = runStart + (runBottomRank - (top.rank - 1));
    if (cardIndex >= runStart && cardIndex < column.length) moves.push({ fromCol: from, cardIndex, toCol: to });
  }

  if (emptyColumn !== -1) {
    for (let cardIndex = Math.max(runStart, 1); cardIndex < column.length; cardIndex++) {
      moves.push({ fromCol: from, cardIndex, toCol: emptyColumn });
    }
  }
  return moves;
}

/** How worthwhile a move looks, for choosing which one to suggest: joining the same suit
 *  beats everything, keeping a run whole beats splitting it, and a pile beats an empty
 *  column. Shuffling a run sideways between two off-suit parents ranks last. */
function rateMove(tableau: Card[][], move: TableauMove): number {
  const column = tableau[move.fromCol]!;
  const moved = column[move.cardIndex]!;
  const parent = column[move.cardIndex - 1];
  const target = tableau[move.toCol]!;
  const targetTop = target[target.length - 1];
  const sameSuit = !!targetTop && targetTop.suit === moved.suit;
  const splitsRun = !!parent && parent.faceUp && parent.suit === moved.suit && parent.rank === moved.rank + 1;
  const sideways = !sameSuit && !!targetTop && !!parent && parent.faceUp && parent.rank === moved.rank + 1;
  if (sideways) return 0;
  return (sameSuit ? 4 : 0) + (splitsRun ? 0 : 2) + (targetTop ? 1 : 0);
}

/** Finds the best available move out of each column, most worthwhile first, plus a trailing
 *  stock-deal hint if one is available. Lets the hint button cycle through options instead
 *  of only ever pointing at one. */
export function findAllHints(state: GameState): HintMove[] {
  const best: { move: TableauMove; score: number }[] = [];
  for (let from = 0; from < state.tableau.length; from++) {
    let top: { move: TableauMove; score: number } | null = null;
    for (const move of movesFromColumn(state.tableau, from)) {
      const score = rateMove(state.tableau, move);
      if (!top || score > top.score) top = { move, score };
    }
    if (top) best.push(top);
  }
  best.sort((a, b) => b.score - a.score);
  const hints: HintMove[] = best.map(({ move }) => ({ type: "move", ...move }));
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
    if (movesFromColumn(state.tableau, from).length > 0) return true;
  }
  return dealFromStock(state) !== null;
}

/** True once the stock is empty and every card on the board is face-up — nothing left to discover. */
export function isBoardFullyRevealed(state: GameState): boolean {
  return state.stock.length === 0 && state.tableau.every((column) => column.every((card) => card.faceUp));
}

export type AutoCompleteMove = TableauMove;

/** How many separate same-suit descending runs the tableau is broken into. An empty board
 *  scores 0, and every join of two matching pieces lowers it by one, so it measures how far
 *  a fully revealed board is from being cleared. */
function countRunSegments(tableau: Card[][]): number {
  let segments = 0;
  for (const column of tableau) {
    for (let i = 0; i < column.length; i++) {
      const card = column[i]!;
      const below = column[i - 1];
      if (!below || below.suit !== card.suit || below.rank !== card.rank + 1) segments++;
    }
  }
  return segments;
}

/**
 * Finds a sequence of tableau-only moves that fully clears the board, for use once
 * isBoardFullyRevealed is true (no more hidden information, nothing left to deal).
 * Repeating findHint's first legal move isn't enough to drive "자동 정리": it dead-ends on
 * boards that a different move order clears. This is a best-first search instead — it always
 * continues from the most-sorted position found so far (fewest run segments), may split a
 * run when only part of it fits somewhere, and never revisits a position, so two columns
 * can't hand the same cards back and forth. It's a loop over a queue rather than recursion,
 * so a long line of play can't overflow the call stack. Gives up (null) after nodeBudget positions
 * rather than searching forever on a board that turns out not to be clearable.
 */
export function findAutoCompletePlan(state: GameState, nodeBudget = 1500): AutoCompleteMove[] | null {
  interface Node {
    state: GameState;
    parent: Node | null;
    move: AutoCompleteMove | null;
  }

  // Which of two columns holds a pile makes no difference to what's solvable, so
  // positions are compared with their columns sorted.
  function positionKey(tableau: Card[][]): string {
    return tableau
      .map((column) => column.map((card) => card.suit + card.rank).join(","))
      .sort()
      .join("|");
  }

  // Open positions bucketed by segment count; the lowest bucket is expanded first, newest
  // position first, which keeps the search following one promising line at a time.
  const open: Node[][] = [];
  const push = (node: Node) => {
    const segments = countRunSegments(node.state.tableau);
    (open[segments] ??= []).push(node);
  };
  const pop = (): Node | undefined => {
    for (const bucket of open) {
      if (bucket && bucket.length > 0) return bucket.pop();
    }
    return undefined;
  };

  const visited = new Set<string>([positionKey(state.tableau)]);
  push({ state, parent: null, move: null });

  for (let explored = 0; explored < nodeBudget; explored++) {
    const node = pop();
    if (!node) return null;

    if (node.state.tableau.every((column) => column.length === 0)) {
      const plan: AutoCompleteMove[] = [];
      for (let n: Node | null = node; n && n.move; n = n.parent) plan.push(n.move);
      return plan.reverse();
    }

    const moves = node.state.tableau.flatMap((_, from) => movesFromColumn(node.state.tableau, from));
    for (const move of moves) {
      const next = moveRun(node.state, move.fromCol, move.cardIndex, move.toCol);
      if (!next) continue;
      const key = positionKey(next.tableau);
      if (visited.has(key)) continue;
      visited.add(key);
      push({ state: next, parent: node, move });
    }
  }
  return null;
}

/** The best column for the run starting at cardIndex to land on, if any: a same-suit pile
 *  first, then any pile, then an empty column (unless that would just relocate the whole column). */
export function findAutoTarget(state: GameState, fromCol: number, cardIndex: number): number | null {
  const column = state.tableau[fromCol];
  if (!column || !canMoveFrom(column, cardIndex)) return null;
  const run = column.slice(cardIndex);
  let best: { toCol: number; score: number } | null = null;
  for (let to = 0; to < state.tableau.length; to++) {
    if (to === fromCol) continue;
    const target = state.tableau[to]!;
    if (!canPlaceRun(run, target)) continue;
    if (target.length === 0 && cardIndex === 0) continue;
    const score = rateMove(state.tableau, { fromCol, cardIndex, toCol: to });
    if (!best || score > best.score) best = { toCol: to, score };
  }
  return best ? best.toCol : null;
}
