import { Card, CARDS_PER_SUIT_RUN, Suit } from "./types";

/**
 * Column arrays are ordered bottom-to-top: index 0 was dealt first, the last
 * index is the visible top card. A "run" is read as [deepest ... topmost].
 */

/** Length of the same-suit, consecutive-descending run sitting on top of the column. 0 if the column is empty or its top card is face-down. */
export function getMovableRunLength(column: readonly Card[]): number {
  if (column.length === 0) return 0;
  const top = column[column.length - 1]!;
  if (!top.faceUp) return 0;

  let length = 1;
  for (let i = column.length - 2; i >= 0; i--) {
    const card = column[i]!;
    const above = column[i + 1]!;
    const isConsecutive = card.faceUp && card.suit === above.suit && card.rank === above.rank + 1;
    if (!isConsecutive) break;
    length++;
  }
  return length;
}

/** Whether the cards starting at startIndex form a legal, draggable run (a suffix of the movable run). */
export function canMoveFrom(column: readonly Card[], startIndex: number): boolean {
  if (startIndex < 0 || startIndex >= column.length) return false;
  const runLength = getMovableRunLength(column);
  const runStart = column.length - runLength;
  return startIndex >= runStart;
}

/** Whether `run` (deepest-to-topmost) may be dropped onto `targetColumn`. */
export function canPlaceRun(run: readonly Card[], targetColumn: readonly Card[]): boolean {
  if (run.length === 0) return false;
  if (targetColumn.length === 0) return true;
  const targetTop = targetColumn[targetColumn.length - 1]!;
  const runBottom = run[0]!;
  return targetTop.faceUp && targetTop.rank === runBottom.rank + 1;
}

/** If the top CARDS_PER_SUIT_RUN cards form a complete same-suit K..A run, returns that suit. Otherwise null. */
export function isCompletedSuitRun(column: readonly Card[]): Suit | null {
  if (column.length < CARDS_PER_SUIT_RUN) return null;
  const run = column.slice(column.length - CARDS_PER_SUIT_RUN);
  const suit = run[0]!.suit;
  for (let i = 0; i < run.length; i++) {
    const card = run[i]!;
    const expectedRank = CARDS_PER_SUIT_RUN - i;
    if (!card.faceUp || card.suit !== suit || card.rank !== expectedRank) return null;
  }
  return suit;
}
